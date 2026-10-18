<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Integration;

use GoriberHisab\Support\ConflictException;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tests\IntegrationTestCase;

final class AccountingTest extends IntegrationTestCase {

	public function testManualJournalAndGuards(): void {
		$cap = $this->account( 'capital' );
		$id  = $this->k->journal->manual(
			$this->ctx,
			array( 'memo' => 'Owner investment' ),
			array(
				array( 'account_id' => $this->account( 'bank' ), 'debit' => '50000' ),
				array( 'account_id' => $cap, 'credit' => '50000' ),
			)
		);
		$this->assertTrue( $id > 0 );
		$this->assertMoney( '50000', $this->balance( 'bank' ) );
		$this->assertMoney( '50000', $this->balance( 'capital' ) );

		$this->assertThrows( ValidationException::class, fn() => $this->k->journal->manual( $this->ctx, array(), array( array( 'account_id' => $cap, 'debit' => '1' ), array( 'account_id' => $this->account( 'cash' ), 'credit' => '2' ) ) ) );
		$e = $this->assertThrows( ValidationException::class, fn() => $this->k->journal->manual( $this->ctx, array(), array( array( 'account_id' => $this->account( 'receivable' ), 'debit' => '1' ), array( 'account_id' => $cap, 'credit' => '1' ) ) ) );
		$this->assertTrue( str_contains( (string) current( $e->errors() ), 'modules' ), 'sub-ledger accounts protected' );

		$this->k->journal->voidManual( $this->ctx, $id );
		$this->assertMoney( '0', $this->balance( 'bank' ) );
		$this->assertBooksBalanced( 'manual' );
	}

	public function testLockDateBlocksBackdatedPostings(): void {
		$this->k->settings->update( $this->ctx, array( 'accounting.lock_date' => '2026-02-28' ) );
		$rent = $this->k->accounts->list( $this->ctx, array( 'type' => 'expense', 'search' => 'Rent' ) )[0]['id'];
		$e    = $this->assertThrows( ValidationException::class, fn() => $this->k->finance->create( $this->ctx, 'expense', array( 'account_id' => $rent, 'amount' => '10', 'date' => '2026-02-10' ) ) );
		$this->assertTrue( str_contains( $e->getMessage(), 'locked' ) );
		$this->k->finance->create( $this->ctx, 'expense', array( 'account_id' => $rent, 'amount' => '10', 'date' => '2026-03-01' ) );
		$this->assertBooksBalanced( 'lock' );
	}

	public function testExpenseEditAndVoid(): void {
		$rent = $this->k->accounts->list( $this->ctx, array( 'type' => 'expense', 'search' => 'Rent' ) )[0]['id'];
		$ex   = $this->k->finance->create( $this->ctx, 'expense', array( 'account_id' => $rent, 'amount' => '1000', 'payment_account_id' => $this->account( 'bank' ) ) );
		$this->assertSame( 'EXP-000001', $ex['number'] );
		$this->k->finance->update( $this->ctx, 'expense', $ex['id'], array( 'amount' => '1200' ) );
		$this->assertMoney( '-1200', $this->balance( 'bank' ) );
		$this->k->finance->void( $this->ctx, 'expense', $ex['id'] );
		$this->assertMoney( '0', $this->balance( 'bank' ) );
		$list = $this->k->finance->list( $this->ctx, 'expense', array() );
		$this->assertSame( 0, $list['total'] );
		$this->assertThrows( ValidationException::class, fn() => $this->k->finance->create( $this->ctx, 'expense', array( 'account_id' => $this->account( 'cogs' ), 'amount' => '5' ) ) );
		$this->assertBooksBalanced( 'expenses' );
	}

	public function testChartOfAccountsManagement(): void {
		$acc = $this->k->accounts->create( $this->ctx, array( 'name' => 'City Bank', 'type' => 'asset', 'is_payment' => true, 'subtype' => 'bank' ) );
		$this->assertTrue( $acc['is_payment'] );
		$this->assertThrows( ConflictException::class, fn() => $this->k->accounts->delete( $this->ctx, $this->account( 'cash' ) ) );
		$cat = $this->k->accounts->create( $this->ctx, array( 'name' => 'Software', 'type' => 'expense' ) );
		$this->k->finance->create( $this->ctx, 'expense', array( 'account_id' => $cat['id'], 'amount' => '99', 'payment_account_id' => $acc['id'] ) );
		$this->assertThrows( ConflictException::class, fn() => $this->k->accounts->delete( $this->ctx, $cat['id'] ) );
		$ledger = $this->k->reports->ledger( $this->ctx, array( 'account_id' => $acc['id'] ) );
		$this->assertMoney( '-99', $ledger['closing_balance'] );
		$this->assertBooksBalanced( 'coa' );
	}

	public function testStatementsAndAging(): void {
		$p = $this->product( 'Item', '100', '50', '50' );
		$c = $this->customer( 'Aged', '200' );
		$this->k->sales->create( $this->ctx, array( 'customer_id' => $c, 'items' => array( array( 'product_id' => $p, 'qty' => '3' ) ) ) );
		$this->k->payments->receive( $this->ctx, array( 'contact_id' => $c, 'account_id' => $this->account( 'cash' ), 'amount' => '150' ) );
		$st = $this->k->contacts->statement( $this->ctx, 'customer', $c );
		$this->assertSame( 3, count( $st['lines'] ) );
		$this->assertMoney( '350', $st['closing_balance'] );
		$dues = $this->k->reports->dues( $this->ctx, array( 'type' => 'customer' ) );
		$this->assertMoney( '350', $dues['totals']['balance'] );
		$this->assertMoney( '150', $dues['totals']['d0_30'] );
		$profile = $this->k->contacts->get( $this->ctx, 'customer', $c );
		$this->assertMoney( '300', $profile['summary']['total_amount'] );
		$this->assertThrows( ConflictException::class, fn() => $this->k->contacts->delete( $this->ctx, 'customer', $c ) );
	}

	public function testNumberingFormats(): void {
		$this->k->settings->update( $this->ctx, array( 'numbering.sale' => 'S{YY}{MM}-{SEQ:4}', 'numbering.reset' => 'monthly' ) );
		$this->assertSame( 'S2603-0001', $this->k->numbers->next( $this->ctx, 'sale', '2026-03-15' ) );
		$this->assertSame( 'S2603-0002', $this->k->numbers->next( $this->ctx, 'sale', '2026-03-20' ) );
		$this->assertSame( 'S2604-0001', $this->k->numbers->next( $this->ctx, 'sale', '2026-04-01' ) );
		$this->assertThrows( ValidationException::class, fn() => $this->k->settings->update( $this->ctx, array( 'numbering.sale' => 'NOSEQ' ) ) );
	}

	public function testReportsRun(): void {
		$p = $this->product( 'R', '100', '60', '10' );
		$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '2' ) ), 'payments' => array( array( 'amount' => '200' ) ) ) );
		foreach ( array( 'day', 'month', 'product', 'customer', 'user', 'branch', 'category' ) as $g ) {
			$r = $this->k->reports->sales( $this->ctx, array( 'group_by' => $g ) );
			$this->assertMoney( '200', $r['totals']['net'], "sales by {$g}" );
		}
		foreach ( array( 'supplier', 'product', 'day', 'month' ) as $g ) {
			$this->k->reports->purchases( $this->ctx, array( 'group_by' => $g ) );
		}
		$cf = $this->k->reports->cashFlow( $this->ctx, array() );
		$this->assertMoney( '200', $cf['net_change'] );
		$this->k->reports->tax( $this->ctx, array() );
		$this->k->reports->byCategory( $this->ctx, 'expense', array() );
		$this->k->reports->invoiceProfit( $this->ctx, array() );
		$this->assertSame( 1, count( $this->k->reports->slowMovers( $this->ctx, array() ) ) );
		$d = $this->k->reports->dashboard( $this->ctx, array( 'range' => 'this_year' ) );
		$this->assertSame( 'month', $d['charts']['interval'] );
		$this->assertSame( 1, count( $d['top_products'] ) );
	}

	public function testCashMoves(): void {
		$cash   = $this->account( 'cash' );
		$mobile = $this->account( 'mobile' );
		$c      = $this->k->cash;
		$c->create( $this->ctx, array( 'kind' => 'owner_in', 'amount' => '5000', 'to_account_id' => $cash ) );
		$this->assertMoney( '5000', $this->balance( 'cash' ) );
		$this->assertMoney( '5000', $this->balance( 'capital' ) );
		$c->create( $this->ctx, array( 'kind' => 'transfer', 'amount' => '1200', 'from_account_id' => $cash, 'to_account_id' => $mobile ) );
		$this->assertMoney( '3800', $this->balance( 'cash' ) );
		$this->assertMoney( '1200', $this->balance( 'mobile' ) );
		$out = $c->create( $this->ctx, array( 'kind' => 'owner_out', 'amount' => '800', 'from_account_id' => $cash, 'note' => 'Family' ) );
		$this->assertMoney( '3000', $this->balance( 'cash' ) );
		$this->assertMoney( '800', $this->balance( 'drawings' ) );
		// Counted 2950 in the drawer: 50 short.
		$cnt = $c->create( $this->ctx, array( 'kind' => 'count', 'account_id' => $cash, 'counted' => '2950' ) );
		$this->assertMoney( '50', $cnt['amount'] );
		$this->assertMoney( '2950', $this->balance( 'cash' ) );
		$this->assertMoney( '50', $this->balance( 'other_expense' ) );
		$this->assertThrows( ValidationException::class, fn() => $c->create( $this->ctx, array( 'kind' => 'count', 'account_id' => $cash, 'counted' => '2950' ) ) );
		$this->assertThrows( ValidationException::class, fn() => $c->create( $this->ctx, array( 'kind' => 'transfer', 'amount' => '1', 'from_account_id' => $cash, 'to_account_id' => $cash ) ) );
		$c->void( $this->ctx, $out['id'] );
		$this->assertMoney( '3750', $this->balance( 'cash' ) );
		$this->assertMoney( '0', $this->balance( 'drawings' ) );
		$o = $c->overview( $this->ctx );
		$this->assertMoney( '4950', $o['total'] );
		$this->assertSame( 4, $c->list( $this->ctx )['total'] );
		$this->assertBooksBalanced( 'cash moves' );
	}
}
