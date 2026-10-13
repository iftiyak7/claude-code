<?php
/**
 * Base for tests that need a full kernel on SQLite.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Tests;

use BizLedger\Database\PdoDatabase;
use BizLedger\Database\Schema;
use BizLedger\Kernel;
use BizLedger\Support\Clock;
use BizLedger\Support\Decimal;
use BizLedger\Support\Events;
use BizLedger\Tenancy\BusinessContext;

/**
 * Fresh in-memory database + business per test, with helpers to assert the
 * accounting invariants that must hold after any operation.
 */
abstract class IntegrationTestCase extends TestCase {

	protected Kernel $k;
	protected PdoDatabase $db;
	protected MemoryUsers $users;
	protected BusinessContext $ctx;
	protected int $owner;

	public function setUp(): void {
		$this->db = PdoDatabase::sqliteMemory();
		foreach ( Schema::sqlite( $this->db ) as $sql ) {
			$this->db->ddl( $sql );
		}
		$this->users = new MemoryUsers();
		$this->owner = $this->users->add( 'Owner', 'owner@example.com' );
		$this->k     = new Kernel( $this->db, new Clock( new \DateTimeImmutable( '2026-03-15 10:00:00', new \DateTimeZone( 'UTC' ) ) ), new Events(), $this->users );
		$this->k->notifications->subscribe();
		$business  = $this->k->businesses->create(
			$this->owner,
			array(
				'name'          => 'Test Shop',
				'currency_code' => 'BDT',
				'decimals'      => 2,
				'timezone'      => 'Asia/Dhaka',
				'business_type' => 'retail',
			)
		);
		$this->ctx = $this->k->contexts->forUser( $this->owner, $business );
	}

	protected function account( string $key ): int {
		return $this->k->accounts->systemId( $this->ctx->business_id, $key );
	}

	/**
	 * Ledger balance of an account in its normal direction, as a decimal string.
	 */
	protected function balance( string $key, int $contact = -1 ): string {
		$l   = $this->db->table( 'journal_lines' );
		$sql = "SELECT COALESCE(SUM(debit),0) AS dr, COALESCE(SUM(credit),0) AS cr FROM {$l} WHERE business_id = %d AND account_id = %d";
		$p   = array( $this->ctx->business_id, $this->account( $key ) );
		if ( $contact >= 0 ) {
			$sql .= ' AND contact_id = %d';
			$p[]  = $contact;
		}
		$r    = $this->db->row( $sql, $p );
		$acc  = $this->k->accounts->get( $this->ctx, $this->account( $key ) );
		$sign = \BizLedger\Accounting\AccountService::normalSign( $acc );
		return Decimal::toString( $sign * ( Decimal::of( $r['dr'] ) - Decimal::of( $r['cr'] ) ) );
	}

	/**
	 * @param array<string,mixed> $extra Overrides.
	 */
	protected function product( string $name, string $price, string $cost = '0', string $opening = '0', array $extra = array() ): int {
		return $this->k->products->create(
			$this->ctx,
			array_merge(
				array(
					'name'           => $name,
					'selling_price'  => $price,
					'purchase_price' => $cost,
					'opening_qty'    => $opening,
				),
				$extra
			)
		)['id'];
	}

	protected function customer( string $name, string $opening = '0' ): int {
		return $this->k->contacts->create( $this->ctx, 'customer', array( 'name' => $name, 'opening_balance' => $opening ) )['id'];
	}

	protected function supplier( string $name, string $opening = '0' ): int {
		return $this->k->contacts->create( $this->ctx, 'supplier', array( 'name' => $name, 'opening_balance' => $opening ) )['id'];
	}

	protected function qty( int $product, int $variant = 0 ): string {
		return Decimal::toString( $this->k->stock->onHand( $this->ctx, $product, $variant ) );
	}

	/**
	 * Every invariant from docs/ACCOUNTING.md §7.
	 */
	protected function assertBooksBalanced( string $label = '' ): void {
		$p   = $label ? $label . ': ' : '';
		$bid = $this->ctx->business_id;

		// 1. Every entry and the whole ledger balance.
		$l  = $this->db->table( 'journal_lines' );
		$un = $this->db->rows( "SELECT entry_id, SUM(debit) AS dr, SUM(credit) AS cr FROM {$l} WHERE business_id = %d GROUP BY entry_id", array( $bid ) );
		foreach ( $un as $r ) {
			$this->assertMoney( $r['dr'], $r['cr'], $p . 'entry ' . $r['entry_id'] . ' balances' );
		}
		$tb = $this->k->reports->trialBalance( $this->ctx, array() );
		$this->assertTrue( $tb['balanced'], $p . 'trial balance balances' );
		$bs = $this->k->reports->balanceSheet( $this->ctx, array() );
		$this->assertTrue( $bs['balanced'], $p . 'balance sheet balances (A=L+E): ' . $bs['total_assets'] . ' vs ' . $bs['total_liabilities_and_equity'] );

		// 2. Inventory account = stock value.
		$st = $this->db->table( 'stock_levels' );
		$sv = $this->db->value( "SELECT COALESCE(SUM(value),0) FROM {$st} WHERE business_id = %d", array( $bid ) );
		$this->assertMoney( $sv, $this->balance( 'inventory' ), $p . 'inventory account equals stock value' );

		// 3/4. Contact caches equal sub-ledgers.
		$ct = $this->db->table( 'contacts' );
		foreach ( $this->db->rows( "SELECT id, type, balance FROM {$ct} WHERE business_id = %d", array( $bid ) ) as $c ) {
			$key = 'customer' === $c['type'] ? 'receivable' : 'payable';
			$this->assertMoney( $this->balance( $key, (int) $c['id'] ), $c['balance'], $p . $c['type'] . ' #' . $c['id'] . ' balance cache' );
		}

		// 6. Stock qty = sum of movements.
		$mt = $this->db->table( 'stock_movements' );
		foreach ( $this->db->rows( "SELECT product_id, variant_id, branch_id, qty FROM {$st} WHERE business_id = %d", array( $bid ) ) as $lvl ) {
			$sum = $this->db->value( "SELECT COALESCE(SUM(qty),0) FROM {$mt} WHERE business_id = %d AND product_id = %d AND variant_id = %d AND branch_id = %d", array( $bid, $lvl['product_id'], $lvl['variant_id'], $lvl['branch_id'] ) );
			$this->assertMoney( $sum, $lvl['qty'], $p . 'stock qty equals movements for product ' . $lvl['product_id'] );
		}

		// 5. Document due = total - allocated - (returned - refunded).
		foreach ( array( 'sales' => 'sale', 'purchases' => 'purchase' ) as $table => $type ) {
			$t  = $this->db->table( $table );
			$at = $this->db->table( 'payment_allocations' );
			$pt = $this->db->table( 'payments' );
			$rt = $this->db->table( 'returns' );
			foreach ( $this->db->rows( "SELECT id, total, due_amount, paid_amount FROM {$t} WHERE business_id = %d AND status = 'completed'", array( $bid ) ) as $d ) {
				$paid = Decimal::of( $this->db->value( "SELECT COALESCE(SUM(a.amount),0) FROM {$at} a JOIN {$pt} p ON p.id = a.payment_id WHERE a.document_type = %s AND a.document_id = %d AND p.status = 'completed'", array( $type, $d['id'] ) ) );
				$ret  = $this->db->row( "SELECT COALESCE(SUM(total),0) AS t, COALESCE(SUM(refund_amount),0) AS r FROM {$rt} WHERE return_type = %s AND document_id = %d AND status = 'completed'", array( $type, $d['id'] ) );
				$due  = max( 0, Decimal::of( $d['total'] ) - $paid - Decimal::of( $ret['t'] ) + Decimal::of( $ret['r'] ) );
				$this->assertMoney( Decimal::toString( $due ), $d['due_amount'], $p . $type . ' #' . $d['id'] . ' due' );
				$this->assertMoney( Decimal::toString( $paid ), $d['paid_amount'], $p . $type . ' #' . $d['id'] . ' paid' );
			}
		}
	}
}
