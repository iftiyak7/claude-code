<?php
/**
 * Optional sample data for new businesses.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Data;

use BizLedger\Kernel;
use BizLedger\Support\Decimal;
use BizLedger\Tenancy\BusinessContext;

/**
 * Seeds a realistic small catalogue and a few transactions through the
 * normal services, so demo books are as consistent as real ones.
 */
final class DemoData {

	private Kernel $k;

	public function __construct( Kernel $kernel ) {
		$this->k = $kernel;
	}

	public function seed( BusinessContext $ctx ): void {
		$this->k->db->transaction(
			function () use ( $ctx ) {
				// Owner's starting capital so the cash book doesn't start negative.
				$this->k->journal->post(
					$ctx,
					array(
						'date'   => $this->k->clock->today( $ctx->timezone() ),
						'source' => 'demo_capital',
						'memo'   => "Owner's capital (demo)",
					),
					array(
						array( 'account' => 'cash', 'debit' => Decimal::of( '50000' ) ),
						array( 'account' => 'capital', 'credit' => Decimal::of( '50000' ) ),
					)
				);
				$cats = array();
				foreach ( array( 'Groceries', 'Beverages', 'Personal Care', 'Stationery' ) as $name ) {
					$cats[ $name ] = (int) $this->k->taxonomy->save( $ctx, 'categories', array( 'name' => $name ) )['id'];
				}
				$catalogue = array(
					array( 'Miniket Rice 5kg', 'Groceries', '380', '330', '40' ),
					array( 'Soybean Oil 1L', 'Groceries', '185', '165', '60' ),
					array( 'Red Lentils 1kg', 'Groceries', '135', '115', '50' ),
					array( 'Mineral Water 500ml', 'Beverages', '20', '14', '200' ),
					array( 'Mango Juice 250ml', 'Beverages', '30', '22', '120' ),
					array( 'Bath Soap', 'Personal Care', '55', '42', '80' ),
					array( 'Toothpaste 100g', 'Personal Care', '120', '95', '45' ),
					array( 'Ball Pen (Blue)', 'Stationery', '10', '6', '300' ),
					array( 'Exercise Book', 'Stationery', '60', '45', '100' ),
				);
				$products  = array();
				foreach ( $catalogue as $i => list( $name, $cat, $price, $cost, $qty ) ) {
					$products[] = (int) $this->k->products->create(
						$ctx,
						array(
							'name'           => $name,
							'sku'            => sprintf( 'DEMO-%03d', $i + 1 ),
							'category_id'    => $cats[ $cat ],
							'selling_price'  => $price,
							'purchase_price' => $cost,
							'opening_qty'    => $qty,
							'min_stock'      => '10',
							'auto_barcode'   => true,
						)
					)['id'];
				}
				$customer = (int) $this->k->contacts->create( $ctx, 'customer', array( 'name' => 'Rahim Uddin', 'phone' => '01711000001' ) )['id'];
				$this->k->contacts->create( $ctx, 'customer', array( 'name' => 'Karim Traders', 'phone' => '01811000002', 'company' => 'Karim Traders' ) );
				$supplier = (int) $this->k->contacts->create( $ctx, 'supplier', array( 'name' => 'City Wholesale', 'phone' => '01911000003' ) )['id'];

				$this->k->purchases->create(
					$ctx,
					array(
						'supplier_id' => $supplier,
						'items'       => array( array( 'product_id' => $products[0], 'qty' => '10', 'unit_price' => '330' ) ),
						'payments'    => array( array( 'amount' => '2000' ) ),
					)
				);
				$items = array(
					array( 'product_id' => $products[3], 'qty' => '6' ),
					array( 'product_id' => $products[5], 'qty' => '2' ),
				);
				// Pay exactly the quoted total (tax depends on the business settings).
				$total = $this->k->sales->quote( $ctx, array( 'items' => $items ) )['total'];
				$this->k->sales->create(
					$ctx,
					array(
						'items'    => $items,
						'payments' => array( array( 'amount' => $total ) ),
						'channel'  => 'pos',
					)
				);
				$this->k->sales->create(
					$ctx,
					array(
						'customer_id' => $customer,
						'items'       => array( array( 'product_id' => $products[0], 'qty' => '2' ), array( 'product_id' => $products[1], 'qty' => '3' ) ),
						'payments'    => array( array( 'amount' => '800' ) ),
					)
				);
				$rent = $this->k->accounts->list( $ctx, array( 'type' => 'expense', 'search' => 'Electricity' ) );
				if ( $rent ) {
					$this->k->finance->create( $ctx, 'expense', array( 'account_id' => $rent[0]['id'], 'amount' => '450', 'description' => 'Electricity bill (demo)' ) );
				}
			}
		);
	}
}
