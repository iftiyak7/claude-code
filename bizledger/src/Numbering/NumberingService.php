<?php
/**
 * Document numbering.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Numbering;

use BizLedger\Database\Database;
use BizLedger\Settings\SettingsService;
use BizLedger\Support\Clock;
use BizLedger\Tenancy\BusinessContext;

/**
 * Generates gap-tolerant, collision-free document numbers.
 *
 * Format tokens: {SEQ} {SEQ:n} {YYYY} {YY} {MM} {DD} {BRANCH}.
 * Sequences are per business, document type and reset period, and are
 * incremented under a row lock inside the caller's transaction.
 */
final class NumberingService {

	private Database $db;
	private Clock $clock;
	private SettingsService $settings;

	public function __construct( Database $db, Clock $clock, SettingsService $settings ) {
		$this->db       = $db;
		$this->clock    = $clock;
		$this->settings = $settings;
	}

	/**
	 * Next number for a document type (e.g. "sale").
	 *
	 * @param string|null $date Document date (Y-m-d); defaults to today.
	 */
	public function next( BusinessContext $ctx, string $doc_type, ?string $date = null ): string {
		$all    = $this->settings->all( $ctx );
		$format = (string) ( $all[ 'numbering.' . $doc_type ] ?? strtoupper( substr( $doc_type, 0, 3 ) ) . '-{SEQ:6}' );
		$reset  = (string) ( $all['numbering.reset'] ?? 'never' );
		$date   = $date ?? $this->clock->today( $ctx->timezone() );
		$period = 'yearly' === $reset ? substr( $date, 0, 4 ) : ( 'monthly' === $reset ? substr( $date, 0, 7 ) : '' );
		// Branch-specific sequence only when the format shows the branch.
		$branch = str_contains( $format, '{BRANCH}' ) ? $ctx->branch_id : 0;

		$seq = $this->increment( $ctx->business_id, $branch, $doc_type, $period );
		return $this->format( $format, $seq, $date, $ctx );
	}

	/**
	 * Preview the number that would be issued next (does not reserve it).
	 */
	public function preview( BusinessContext $ctx, string $doc_type ): string {
		$all    = $this->settings->all( $ctx );
		$format = (string) ( $all[ 'numbering.' . $doc_type ] ?? 'DOC-{SEQ:6}' );
		$t      = $this->db->table( 'sequences' );
		$cur    = (int) $this->db->value( "SELECT MAX(next_number) FROM {$t} WHERE business_id = %d AND doc_type = %s", array( $ctx->business_id, $doc_type ) );
		return $this->format( $format, max( 1, $cur ), $this->clock->today( $ctx->timezone() ), $ctx );
	}

	private function increment( int $business_id, int $branch_id, string $doc_type, string $period ): int {
		$t = $this->db->table( 'sequences' );
		return $this->db->transaction(
			function () use ( $t, $business_id, $branch_id, $doc_type, $period ) {
				$row = $this->db->row(
					"SELECT id, next_number FROM {$t} WHERE business_id = %d AND branch_id = %d AND doc_type = %s AND period = %s" . $this->db->forUpdate(),
					array( $business_id, $branch_id, $doc_type, $period )
				);
				if ( null === $row ) {
					$this->db->insert(
						$t,
						array(
							'business_id' => $business_id,
							'branch_id'   => $branch_id,
							'doc_type'    => $doc_type,
							'period'      => $period,
							'next_number' => 2,
						)
					);
					return 1;
				}
				$n = max( 1, (int) $row['next_number'] );
				$this->db->update( $t, array( 'next_number' => $n + 1 ), array( 'id' => (int) $row['id'] ) );
				return $n;
			}
		);
	}

	private function format( string $format, int $seq, string $date, BusinessContext $ctx ): string {
		$ts  = strtotime( $date ) ?: time();
		$out = (string) preg_replace_callback(
			'/\{SEQ(?::(\d{1,2}))?\}/',
			static fn( array $m ) => str_pad( (string) $seq, isset( $m[1] ) ? (int) $m[1] : 1, '0', STR_PAD_LEFT ),
			$format
		);
		return strtr(
			$out,
			array(
				'{YYYY}'   => gmdate( 'Y', $ts ),
				'{YY}'     => gmdate( 'y', $ts ),
				'{MM}'     => gmdate( 'm', $ts ),
				'{DD}'     => gmdate( 'd', $ts ),
				'{BRANCH}' => (string) $ctx->branch_id,
			)
		);
	}
}
