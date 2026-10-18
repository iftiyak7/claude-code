<?php
/**
 * Scheduled jobs.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Core;

use GoriberHisab\Kernel;
use GoriberHisab\Support\Decimal;

/**
 * Daily maintenance: due reminders and backup reminders. Each business is
 * processed independently so one failure never blocks the others.
 */
final class Cron {

	private Kernel $k;

	public function __construct( Kernel $kernel ) {
		$this->k = $kernel;
	}

	public function register(): void {
		add_action( 'goriber_hisab_daily', array( $this, 'daily' ) );
	}

	public function daily(): void {
		$bt  = $this->k->db->table( 'businesses' );
		$ids = array_map( 'intval', $this->k->db->column( "SELECT id FROM {$bt} WHERE status = 'active' AND deleted_at IS NULL" ) );
		foreach ( $ids as $id ) {
			try {
				$ctx = $this->k->businesses->systemContext( $id );
				$this->dueReminder( $ctx );
				$this->backupReminder( $ctx );
				$this->k->notifications->lowStockSummary( $ctx );
				do_action( 'goriber_hisab/daily', $ctx );
			} catch ( \Throwable $e ) {
				error_log( 'Goriber Hisab daily job failed for business ' . $id . ': ' . $e->getMessage() ); // phpcs:ignore
			}
		}
	}

	private function dueReminder( \GoriberHisab\Tenancy\BusinessContext $ctx ): void {
		$ct  = $this->k->db->table( 'contacts' );
		$row = $this->k->db->row( "SELECT COUNT(*) AS n, COALESCE(SUM(balance),0) AS total FROM {$ct} WHERE business_id = %d AND type = 'customer' AND balance > 0 AND deleted_at IS NULL", array( $ctx->business_id ) );
		if ( (int) $row['n'] > 0 ) {
			$this->k->notifications->notify(
				$ctx,
				'customer_due',
				sprintf( '%d customers owe you', (int) $row['n'] ),
				sprintf( 'Total receivable: %s', Decimal::toString( Decimal::of( $row['total'] ), $ctx->decimals() ) ),
				array(),
				'info',
				'customer_due:' . gmdate( 'Y-m-d' )
			);
		}
		$sup = $this->k->db->row( "SELECT COUNT(*) AS n, COALESCE(SUM(balance),0) AS total FROM {$ct} WHERE business_id = %d AND type = 'supplier' AND balance > 0 AND deleted_at IS NULL", array( $ctx->business_id ) );
		if ( (int) $sup['n'] > 0 ) {
			$this->k->notifications->notify(
				$ctx,
				'supplier_due',
				sprintf( 'You owe %d suppliers', (int) $sup['n'] ),
				sprintf( 'Total payable: %s', Decimal::toString( Decimal::of( $sup['total'] ), $ctx->decimals() ) ),
				array(),
				'info',
				'supplier_due:' . gmdate( 'Y-m-d' )
			);
		}
	}

	private function backupReminder( \GoriberHisab\Tenancy\BusinessContext $ctx ): void {
		$days = (int) $this->k->settings->all( $ctx )['notifications.backup_reminder_days'];
		if ( $days <= 0 ) {
			return;
		}
		$last = (int) get_option( 'bizledger_last_backup_' . $ctx->business_id, 0 );
		if ( time() - $last > $days * DAY_IN_SECONDS ) {
			$this->k->notifications->notify( $ctx, 'backup_reminder', 'Time to back up your data', 'Download a backup from Settings → Backup.', array(), 'warning', 'backup_reminder:' . gmdate( 'Y-W' ) );
		}
	}
}
