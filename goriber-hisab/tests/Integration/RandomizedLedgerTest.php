<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Integration;

use GoriberHisab\Support\HisabException;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Tests\IntegrationTestCase;

/**
 * Property test: whatever sequence of business operations happens, the books
 * stay synchronised. Seeded for reproducibility (BZL_SEED env var).
 */
final class RandomizedLedgerTest extends IntegrationTestCase {

	public function testRandomOperationsKeepBooksInSync(): void {
		$seed = (int) ( getenv( 'BZL_SEED' ) ?: 20260315 );
		mt_srand( $seed );
		$this->k->settings->update( $this->ctx, array( 'tax.enabled' => true ) );
		$vat = $this->k->taxes->save( $this->ctx, array( 'name' => 'VAT', 'rate' => '7.5' ) );
		$inc = $this->k->taxes->save( $this->ctx, array( 'name' => 'Incl 5', 'rate' => '5', 'is_inclusive' => true ) );

		$products  = array();
		for ( $i = 0; $i < 6; $i++ ) {
			$products[] = $this->product( "P{$i}", (string) mt_rand( 10, 500 ), (string) mt_rand( 5, 300 ), (string) mt_rand( 0, 40 ), array( 'tax_rate_id' => array( 0, $vat['id'], $inc['id'] )[ $i % 3 ] ) );
		}
		$customers = array( 0, $this->customer( 'C1', '100' ), $this->customer( 'C2' ), $this->customer( 'C3' ) );
		$suppliers = array( $this->supplier( 'S1', '250' ), $this->supplier( 'S2' ) );
		$accounts  = array( $this->account( 'cash' ), $this->account( 'bank' ), $this->account( 'mobile' ) );
		$sales     = array();
		$purchases = array();
		$returns   = array();
		$payments  = array();
		$ok        = 0;
		$rejected  = 0;
		$money     = static fn( int $min, int $max ) => mt_rand( $min, $max ) . '.' . str_pad( (string) mt_rand( 0, 99 ), 2, '0', STR_PAD_LEFT );

		for ( $step = 0; $step < 250; $step++ ) {
			$op = mt_rand( 1, 100 );
			try {
				if ( $op <= 30 ) {
					$items = array();
					foreach ( (array) array_rand( array_flip( $products ), mt_rand( 1, 3 ) ) as $pid ) {
						$items[] = array( 'product_id' => $pid, 'qty' => (string) mt_rand( 1, 4 ), 'discount_type' => 'percent', 'discount_value' => (string) mt_rand( 0, 15 ) );
					}
					$customer = $customers[ mt_rand( 0, 3 ) ];
					$ship     = (string) mt_rand( 0, 20 );
					$quote    = $this->k->sales->quote( $this->ctx, array( 'items' => $items, 'discount_value' => $money( 0, 5 ), 'shipping_amount' => $ship ) );
					$total    = Decimal::of( $quote['total'] );
					$paid     = $customer ? Decimal::divInt( Decimal::mul( $total, Decimal::of( mt_rand( 0, 100 ) ) ), 100 ) : $total;
					$paid     = Decimal::round( $paid, 2 );
					$tenders  = array();
					if ( $paid > 0 ) {
						$first     = Decimal::round( Decimal::divInt( $paid, mt_rand( 1, 2 ) ), 2 );
						$tenders[] = array( 'amount' => Decimal::toString( $first ), 'account_id' => $accounts[ mt_rand( 0, 2 ) ] );
						if ( $paid - $first > 0 ) {
							$tenders[] = array( 'amount' => Decimal::toString( $paid - $first ), 'account_id' => $accounts[ mt_rand( 0, 2 ) ] );
						}
					}
					$sales[] = $this->k->sales->create( $this->ctx, array( 'customer_id' => $customer, 'items' => $items, 'discount_value' => $quote['discount_amount'], 'payments' => $tenders, 'shipping_amount' => $ship ) )['id'];
				} elseif ( $op <= 50 ) {
					$items = array();
					foreach ( (array) array_rand( array_flip( $products ), mt_rand( 1, 3 ) ) as $pid ) {
						$items[] = array( 'product_id' => $pid, 'qty' => (string) mt_rand( 1, 15 ), 'unit_price' => $money( 5, 300 ) );
					}
					$purchases[] = $this->k->purchases->create( $this->ctx, array( 'supplier_id' => $suppliers[ mt_rand( 0, 1 ) ], 'items' => $items, 'shipping_amount' => $money( 0, 30 ), 'other_cost' => $money( 0, 10 ), 'discount_value' => $money( 0, 5 ), 'payments' => mt_rand( 0, 1 ) ? array( array( 'amount' => $money( 1, 50 ) ) ) : array() ) )['id'];
				} elseif ( $op <= 60 ) {
					$c          = $customers[ mt_rand( 1, 3 ) ];
					$payments[] = $this->k->payments->receive( $this->ctx, array( 'contact_id' => $c, 'account_id' => $accounts[ mt_rand( 0, 2 ) ], 'amount' => $money( 1, 400 ) ) )['id'];
				} elseif ( $op <= 66 ) {
					$payments[] = $this->k->payments->pay( $this->ctx, array( 'contact_id' => $suppliers[ mt_rand( 0, 1 ) ], 'account_id' => $accounts[ mt_rand( 0, 2 ) ], 'amount' => $money( 1, 400 ) ) )['id'];
				} elseif ( $op <= 74 && $sales ) {
					$sale = $this->k->sales->get( $this->ctx, $sales[ array_rand( $sales ) ] );
					$item = $sale['items'][ array_rand( $sale['items'] ) ];
					$left = Decimal::of( $item['qty'] ) - Decimal::of( $item['returned_qty'] );
					if ( 'completed' === $sale['status'] && $left > 0 ) {
						$qty       = Decimal::toString( Decimal::of( (string) mt_rand( 1, (int) ( $left / Decimal::FACTOR ) ) ) );
						$returns[] = $this->k->returns->create( $this->ctx, 'sale', array( 'document_id' => $sale['id'], 'items' => array( array( 'item_id' => $item['id'], 'qty' => $qty ) ), 'refund_amount' => $sale['customer_id'] ? '0' : null ) )['id'] ?? null;
					}
				} elseif ( $op <= 78 && $purchases ) {
					$pur  = $this->k->purchases->get( $this->ctx, $purchases[ array_rand( $purchases ) ] );
					$item = $pur['items'][0];
					if ( 'completed' === $pur['status'] && Decimal::of( $item['qty'] ) > Decimal::of( $item['returned_qty'] ) ) {
						$returns[] = $this->k->returns->create( $this->ctx, 'purchase', array( 'document_id' => $pur['id'], 'items' => array( array( 'item_id' => $item['id'], 'qty' => '1' ) ), 'refund_amount' => '0' ) )['id'];
					}
				} elseif ( $op <= 84 && $sales ) {
					$id = $sales[ array_rand( $sales ) ];
					if ( mt_rand( 0, 1 ) ) {
						$this->k->sales->void( $this->ctx, $id );
					} else {
						$s = $this->k->sales->get( $this->ctx, $id );
						if ( 'completed' === $s['status'] ) {
							$this->k->sales->update( $this->ctx, $id, array( 'items' => array( array( 'product_id' => $products[ mt_rand( 0, 5 ) ], 'qty' => (string) mt_rand( 1, 3 ) ) ), 'payments' => array() ) );
						}
					}
				} elseif ( $op <= 88 && $purchases ) {
					$this->k->purchases->void( $this->ctx, $purchases[ array_rand( $purchases ) ] );
				} elseif ( $op <= 91 && $returns ) {
					$r = array_filter( $returns );
					if ( $r ) {
						$this->k->returns->void( $this->ctx, $r[ array_rand( $r ) ] );
					}
				} elseif ( $op <= 94 && $payments ) {
					$this->k->payments->void( $this->ctx, $payments[ array_rand( $payments ) ] );
				} elseif ( $op <= 97 ) {
					$this->k->stock->adjust( $this->ctx, array( 'product_id' => $products[ mt_rand( 0, 5 ) ], 'mode' => array( 'add', 'remove', 'set' )[ mt_rand( 0, 2 ) ], 'qty' => (string) mt_rand( 1, 8 ), 'reason' => 'Random count' ) );
				} else {
					$exp = $this->k->accounts->list( $this->ctx, array( 'type' => 'expense', 'subtype' => 'operating' ) );
					$this->k->finance->create( $this->ctx, 'expense', array( 'account_id' => $exp[ array_rand( $exp ) ]['id'], 'amount' => $money( 1, 200 ), 'payment_account_id' => $accounts[ mt_rand( 0, 2 ) ] ) );
				}
				++$ok;
			} catch ( \GoriberHisab\Support\DatabaseException $e ) {
				throw $e; // Never acceptable.
			} catch ( HisabException $e ) {
				if ( getenv( 'BZL_VERBOSE' ) ) {
					fwrite( STDERR, get_class( $e ) . ': ' . $e->getMessage() . "\n" );
				}
				// Business-rule rejections (insufficient stock, credit, etc.) are fine;
				// what matters is that they leave no partial writes behind.
				++$rejected;
			}
			if ( 0 === $step % 25 ) {
				$this->assertBooksBalanced( "seed {$seed} step {$step}" );
			}
		}
		$this->assertBooksBalanced( "seed {$seed} final" );
		if ( getenv( "BZL_VERBOSE" ) ) {
			fwrite( STDERR, "seed {$seed}: {$ok} ok, {$rejected} rejected\n" );
		}
		$this->assertTrue( $ok > 150, "most operations succeed ({$ok} ok, {$rejected} rejected)" );
	}
}
