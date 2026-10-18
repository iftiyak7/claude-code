<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Integration;

use GoriberHisab\Support\ConflictException;
use GoriberHisab\Support\PermissionException;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tests\IntegrationTestCase;

final class OrdersTest extends IntegrationTestCase {

	private function order( int $product, array $extra = array() ): array {
		return $this->k->orders->create(
			$this->ctx,
			$extra + array(
				'source'          => 'facebook',
				'customer_name'   => 'Nusrat',
				'phone'           => '01712345678',
				'address'         => 'House 5, Road 2, Mirpur',
				'area'            => 'Dhaka',
				'items'           => array( array( 'product_id' => $product, 'qty' => '2', 'unit_price' => '500' ) ),
				'delivery_charge' => '70',
				'discount'        => '20',
			)
		);
	}

	public function testPendingOrderTouchesNothingThenConfirmCreatesSale(): void {
		$p = $this->product( 'Saree', '500', '300', '10' );
		$e = $this->assertThrows( ValidationException::class, fn() => $this->k->orders->create( $this->ctx, array( 'items' => array() ) ) );
		$this->assertTrue( isset( $e->errors()['customer_name'], $e->errors()['phone'], $e->errors()['items'] ) );

		$o = $this->order( $p, array( 'advance' => '100' ) );
		$this->assertSame( 'pending', $o['status'] );
		$this->assertSame( '1050.00', $o['total'] );
		$this->assertSame( '950.00', $o['cod_amount'] );
		$this->assertSame( '10.0000', $this->qty( $p ), 'pending order does not move stock' );
		$this->assertSame( 0, $o['sale_id'] );

		$o = $this->k->orders->confirm( $this->ctx, $o['id'] );
		$this->assertSame( 'confirmed', $o['status'] );
		$this->assertSame( '8.0000', $this->qty( $p ) );
		$this->assertSame( 'online', $this->k->sales->get( $this->ctx, $o['sale_id'] )['channel'] );
		$this->assertMoney( '950', $o['sale']['due_amount'] );
		$this->assertMoney( '950', $this->balance( 'receivable', $o['customer_id'] ) );
		$this->assertMoney( '100', $this->balance( 'mobile' ), 'advance into mobile banking' );
		$this->assertMoney( '70', $this->balance( 'shipping_income' ) );
		// Second order from the same phone reuses the customer.
		$o2 = $this->k->orders->confirm( $this->ctx, $this->order( $p )['id'] );
		$this->assertSame( $o['customer_id'], $o2['customer_id'] );
		$this->assertBooksBalanced( 'confirmed' );
	}

	public function testShipDeliverCollectCodWithCourierFee(): void {
		$p  = $this->product( 'Shoes', '500', '250', '10' );
		$o  = $this->order( $p );
		$this->assertThrows( ValidationException::class, fn() => $this->k->orders->advance( $this->ctx, $o['id'], 'shipped', array( 'courier' => 'nope' ) ) );
		$o = $this->k->orders->advance( $this->ctx, $o['id'], 'packed' );
		$this->assertSame( 'packed', $o['status'] );
		$o = $this->k->orders->advance( $this->ctx, $o['id'], 'shipped', array( 'courier' => 'pathao', 'consignment_id' => 'PA123' ) );
		$this->assertSame( 'shipped', $o['status'] );
		$this->assertTrue( str_contains( $o['tracking_url'], 'PA123' ) );
		$this->assertThrows( ConflictException::class, fn() => $this->k->orders->advance( $this->ctx, $o['id'], 'packed' ) );

		$s = $this->k->orders->summary( $this->ctx );
		$this->assertSame( 1, $s['cod_pending']['orders'] );
		$this->assertMoney( '1050', $s['cod_pending']['amount'] );

		$bank = $this->account( 'bank' );
		$r    = $this->k->orders->collectCod( $this->ctx, array( $o['id'], $o['id'] ), array( 'account_id' => $bank, 'fees' => array( $o['id'] => '60' ) ) );
		$this->assertSame( 1, $r['orders'] );
		$this->assertMoney( '1050', $r['amount'] );
		$this->assertMoney( '990', $this->balance( 'bank' ), 'COD in, courier fee out' );
		$o = $this->k->orders->get( $this->ctx, $o['id'] );
		$this->assertSame( 'delivered', $o['status'] );
		$this->assertTrue( $o['cod_collected'] );
		$this->assertMoney( '0', $o['sale']['due_amount'] );
		$this->assertSame( 0, $this->k->orders->collectCod( $this->ctx, array( $o['id'] ), array( 'account_id' => $bank ) )['orders'], 'no double collection' );
		$this->assertThrows( ConflictException::class, fn() => $this->k->orders->close( $this->ctx, $o['id'], 'returned' ) );
		$this->assertBooksBalanced( 'cod' );
	}

	public function testReturnAndCancelPutStockBack(): void {
		$p = $this->product( 'Panjabi', '500', '300', '10' );
		$o = $this->k->orders->advance( $this->ctx, $this->order( $p )['id'], 'shipped', array( 'courier' => 'redx', 'tracking_code' => 'RX1' ) );
		$this->assertSame( '8.0000', $this->qty( $p ) );
		$o = $this->k->orders->close( $this->ctx, $o['id'], 'returned', array( 'reason' => 'Customer refused', 'return_charge' => '50' ) );
		$this->assertSame( 'returned', $o['status'] );
		$this->assertSame( '10.0000', $this->qty( $p ) );
		$this->assertSame( 'void', $o['sale']['status'] );
		$this->assertMoney( '0', $this->balance( 'receivable', $o['customer_id'] ) );
		$this->assertMoney( '-50', $this->balance( 'cash' ), 'return charge paid from cash' );

		$c = $this->k->orders->close( $this->ctx, $this->order( $p )['id'], 'cancelled' );
		$this->assertSame( 'cancelled', $c['status'] );
		$this->assertSame( '10.0000', $this->qty( $p ) );
		$this->assertBooksBalanced( 'returns' );
	}

	public function testSteadfastBookingAndStatusAndPermissions(): void {
		$p     = $this->product( 'Bag', '500', '300', '10' );
		$calls = array();
		$this->k->setHttp(
			function ( $method, $url, $headers, $body ) use ( &$calls ) {
				$calls[] = array( $method, $url, $headers, $body );
				if ( str_ends_with( $url, '/create_order' ) ) {
					$b = json_decode( (string) $body, true );
					return array( 200, json_encode( array( 'status' => 200, 'consignment' => array( 'consignment_id' => 9911, 'tracking_code' => 'SFX1', 'status' => 'in_review', 'cod_amount' => $b['cod_amount'] ) ) ) );
				}
				if ( str_contains( $url, '/status_by_cid/' ) ) {
					return array( 200, '{"status":200,"delivery_status":"delivered"}' );
				}
				return array( 200, '{"status":200,"current_balance":1500}' );
			}
		);
		$o = $this->order( $p );
		$e = $this->assertThrows( ValidationException::class, fn() => $this->k->orders->bookSteadfast( $this->ctx, $o['id'] ) );
		$this->assertTrue( str_contains( $e->getMessage(), 'API key' ) );
		$this->assertSame( array(), $calls );

		$s = $this->k->orders->saveCourierSettings( $this->ctx, array( 'steadfast_key' => 'key1234567', 'steadfast_secret' => 'sec', 'charge_inside' => '60', 'test' => true ) );
		$this->assertTrue( $s['steadfast_connected'] );
		$this->assertSame( 'key1••••••••', $s['steadfast_key'] );
		$this->assertSame( '1500', $s['steadfast_balance'] );
		$this->assertSame( '60.00', $s['charge_inside'] );
		// Masked value posted back keeps the real key.
		$this->k->orders->saveCourierSettings( $this->ctx, array( 'steadfast_key' => $s['steadfast_key'] ) );
		$this->assertFalse( isset( $this->k->settings->all( $this->ctx )['secret.courier'] ), 'secrets never reach /me settings' );

		$o = $this->k->orders->bookSteadfast( $this->ctx, $o['id'] );
		$this->assertSame( 'shipped', $o['status'] );
		$this->assertSame( '9911', $o['consignment_id'] );
		$this->assertSame( 'https://steadfast.com.bd/t/SFX1', $o['tracking_url'] );
		$sent = json_decode( (string) $calls[1][3], true );
		$this->assertSame( 1050, (int) $sent['cod_amount'] );
		$this->assertSame( '01712345678', $sent['recipient_phone'] );
		$this->assertSame( 'key1234567', $calls[1][2]['Api-Key'] );

		$o = $this->k->orders->refreshCourier( $this->ctx, $o['id'] );
		$this->assertSame( 'delivered', $o['status'] );
		$this->assertSame( 'delivered', $o['courier_status'] );

		$staff = $this->users->add( 'Viewer', 'v@example.com' );
		$this->k->members->add( $this->ctx, array( 'user_id' => $staff, 'role' => 'staff' ) );
		$vctx = $this->k->contexts->forUser( $staff, $this->ctx->business_id );
		$this->assertThrows( PermissionException::class, fn() => $this->k->orders->list( $vctx ) );
		$sales = $this->users->add( 'Seller', 's@example.com' );
		$this->k->members->add( $this->ctx, array( 'user_id' => $sales, 'role' => 'sales' ) );
		$sctx = $this->k->contexts->forUser( $sales, $this->ctx->business_id );
		$this->assertSame( 1, $this->k->orders->list( $sctx, array( 'status' => 'all' ) )['total'] );
		$this->assertThrows( PermissionException::class, fn() => $this->k->orders->saveCourierSettings( $sctx, array( 'steadfast_key' => 'x' ) ) );
	}

	public function testPasteToFillWithParserAndAi(): void {
		$kg    = (int) $this->db->value( 'SELECT id FROM ' . $this->db->table( 'units' ) . " WHERE business_id = %d AND short_name = 'kg'", array( $this->ctx->business_id ) );
		$badam = $this->product( 'Peanuts / Badam (loose)', '280', '200', '20', array( 'unit_id' => $kg ) );
		$saree = $this->product( 'Saree', '1200', '800', '5' );
		$this->assertThrows( ValidationException::class, fn() => $this->k->orders->parse( $this->ctx, '  ' ) );
		$r = $this->k->orders->parse( $this->ctx, "Rahim Uddin, ০১৭১২-৩৪৫৬৭৮, House 5 Road 2 Mirpur 10, 500g badam\nsaree 2 pcs" );
		$this->assertSame( 'parser', $r['reader'] );
		$this->assertSame( 'Rahim Uddin', $r['customer_name'] );
		$this->assertSame( '01712345678', $r['phone'] );
		$this->assertSame( 'inside', $r['zone'] );
		$this->assertSame( 2, count( $r['items'] ) );
		$byId = array_column( $r['items'], 'qty', 'product_id' );
		$this->assertSame( '2', $byId[ $saree ] );

		// Known customer is recognised by phone.
		$this->k->contacts->create( $this->ctx, 'customer', array( 'name' => 'Old Friend', 'phone' => '01912345678', 'address' => 'Khulna' ) );
		$r2 = $this->k->orders->parse( $this->ctx, '01912345678 saree' );
		$this->assertSame( 'Old Friend', $r2['customer_name'] );
		$this->assertSame( 'Khulna', $r2['address'] );

		// With a key, Claude reads it (stubbed); invalid ids are dropped; failures fall back.
		$sent = array();
		$this->k->setHttp(
			function ( $method, $url, $headers, $body ) use ( &$sent, $badam ) {
				$sent = array( $url, $headers, json_decode( (string) $body, true ) );
				$json = json_encode( array( 'customer_name' => 'Nusrat', 'phone' => '+8801712000000', 'address' => 'Agrabad', 'area' => 'Chattogram', 'zone' => 'outside', 'items' => array( array( 'product_id' => $badam, 'qty' => 0.25 ), array( 'product_id' => 999, 'qty' => 1 ) ), 'note' => 'after 5pm' ) );
				return array( 200, json_encode( array( 'stop_reason' => 'end_turn', 'content' => array( array( 'type' => 'thinking', 'thinking' => '' ), array( 'type' => 'text', 'text' => $json ) ) ) ) );
			}
		);
		$this->k->platform->saveConfig( array( 'ai_key' => 'sk-ant-test' ) );
		$this->assertTrue( $this->k->orders->aiAvailable() );
		$ai = $this->k->orders->parse( $this->ctx, 'আমি নুসরাত, আগ্রাবাদ, ২৫০ গ্রাম বাদাম দিন' );
		$this->assertSame( 'ai', $ai['reader'] );
		$this->assertSame( '01712000000', $ai['phone'] );
		$this->assertSame( 1, count( $ai['items'] ) );
		$this->assertSame( '0.25', $ai['items'][0]['qty'] );
		$this->assertSame( 'https://api.anthropic.com/v1/messages', $sent[0] );
		$this->assertSame( 'sk-ant-test', $sent[1]['x-api-key'] );
		$this->assertSame( 'claude-opus-5-5', $sent[2]['model'] );
		$this->assertSame( 'json_schema', $sent[2]['output_config']['format']['type'] );
		$this->assertTrue( str_contains( $sent[2]['messages'][0]['content'], 'Peanuts / Badam' ) );

		$this->k->setHttp( fn() => array( 529, '{"type":"error"}' ) );
		$this->k->orders->setAiKey( fn() => 'sk-ant-test' );
		$fb = $this->k->orders->parse( $this->ctx, 'Karim 01811111111 Bogura, saree' );
		$this->assertSame( 'parser', $fb['reader'] );
		$this->assertSame( 'outside', $fb['zone'] );
		$this->assertSame( 'parser', $this->k->orders->parse( $this->ctx, 'Karim 01811111111', false )['reader'] );
	}

	public function testFraudCheckAcrossShopsAndCouriers(): void {
		$this->assertSame( '01712345678', \GoriberHisab\Orders\OrderService::phoneKey( '+880 1712-345678' ) );
		$this->assertSame( '', \GoriberHisab\Orders\OrderService::phoneKey( '12345' ) );
		$p = $this->product( 'Saree', '500', '300', '20' );
		$a = $this->order( $p, array( 'phone' => '+8801712345678' ) );
		$this->k->orders->advance( $this->ctx, $this->k->orders->advance( $this->ctx, $a['id'], 'shipped', array( 'courier' => 'redx' ) )['id'], 'delivered' );
		$b = $this->k->orders->advance( $this->ctx, $this->order( $p )['id'], 'shipped', array( 'courier' => 'redx' ) );
		$this->k->orders->close( $this->ctx, $b['id'], 'returned' );

		// Another shop on the same site.
		$other_user = $this->users->add( 'Other', 'other@example.com' );
		$other      = $this->k->contexts->forUser( $other_user, $this->k->businesses->create( $other_user, array( 'name' => 'Other Shop', 'currency_code' => 'BDT', 'decimals' => 2, 'timezone' => 'Asia/Dhaka', 'business_type' => 'retail' ) ) );
		$op         = $this->k->products->create( $other, array( 'name' => 'Item', 'selling_price' => '100' ) )['id'];
		$this->k->orders->close( $other, $this->k->orders->create( $other, array( 'customer_name' => 'N', 'phone' => '01712-345678', 'address' => 'Dhaka', 'items' => array( array( 'product_id' => $op, 'qty' => '1', 'unit_price' => '100' ) ) ) )['id'], 'cancelled' );

		$r = $this->k->orders->risk( $this->ctx, '01712345678' );
		$this->assertSame( 1, $r['shop']['delivered'] );
		$this->assertSame( 1, $r['shop']['returned'] );
		$this->assertSame( 1, $r['network']['cancelled'] );
		$this->assertSame( 1, $r['network']['shops'] );
		$this->assertSame( 33, $r['ratio'] );
		$this->assertSame( 'risky', $r['level'] );
		$this->assertSame( null, $r['couriers'] );
		$this->assertSame( 'new', $this->k->orders->risk( $this->ctx, '01999999999' )['level'] );
		$this->assertThrows( ValidationException::class, fn() => $this->k->orders->risk( $this->ctx, '123' ) );

		// Courier-check service: called once, then cached.
		$calls = 0;
		$this->k->setHttp(
			function ( $m, $url, $h, $body ) use ( &$calls ) {
				++$calls;
				$this->assertSame( 'Bearer bdc-key', $h['Authorization'] );
				$this->assertSame( '01712345678', json_decode( (string) $body, true )['phone'] );
				return array( 200, '{"status":"success","courierData":{"pathao":{"name":"Pathao","total_parcel":10,"success_parcel":9,"cancelled_parcel":1},"steadfast":{"name":"Steadfast","total_parcel":5,"success_parcel":5,"cancelled_parcel":0},"redx":{"name":"RedX","total_parcel":0,"success_parcel":0,"cancelled_parcel":0},"summary":{"total_parcel":15,"success_parcel":14,"cancelled_parcel":1}}}' );
			}
		);
		$this->k->platform->saveConfig( array( 'fraud_key' => 'bdc-key' ) );
		$r = $this->k->orders->risk( $this->ctx, '01712345678' );
		$this->assertSame( 2, count( $r['couriers'] ) );
		$this->assertSame( 'Pathao', $r['couriers'][0]['name'] );
		$this->assertSame( 14, $r['delivered'] );
		$this->assertSame( 93, $r['ratio'] );
		$this->assertSame( 'good', $r['level'] );
		$this->k->orders->risk( $this->ctx, '01712345678' );
		$this->assertSame( 1, $calls );
		$this->k->orders->risk( $this->ctx, '01712345678', true );
		$this->assertSame( 2, $calls );

		// Service down: falls back to the cached answer and says why.
		$this->k->setHttp( fn() => array( 401, '{"message":"Invalid API key"}' ) );
		$this->k->platform->saveConfig( array( 'fraud_key' => 'bdc-key' ) );
		$r = $this->k->orders->risk( $this->ctx, '01712345678', true );
		$this->assertTrue( str_contains( $r['error'], 'Invalid API key' ) );
		$this->assertSame( 2, count( $r['couriers'] ) );
		$this->assertSame( 'bdc-••••••••••', $this->k->platform->adminConfig()['fraud_key'] );

		$this->k->platform->saveConfig( array( 'fraud_network' => false, 'fraud_key' => '' ) );
		$this->assertSame( null, $this->k->orders->risk( $this->ctx, '01712345678' )['network'] );
	}

	public function testCourierBoardAndRider(): void {
		$p = $this->product( 'Saree', '500', '300', '20' );
		$a = $this->k->orders->advance( $this->ctx, $this->order( $p )['id'], 'shipped', array( 'courier' => 'redx', 'rider_name' => 'Kamal', 'rider_phone' => '01812345678' ) );
		$this->assertSame( 'Kamal', $a['rider_name'] );
		$b = $this->k->orders->advance( $this->ctx, $this->order( $p )['id'], 'shipped', array( 'courier' => 'redx' ) );
		$this->k->orders->advance( $this->ctx, $b['id'], 'delivered' );
		$c = $this->k->orders->advance( $this->ctx, $this->order( $p )['id'], 'shipped', array( 'courier' => 'pathao' ) );
		$this->k->orders->close( $this->ctx, $c['id'], 'returned' );
		$this->k->orders->update( $this->ctx, $a['id'], array( 'rider_name' => 'Jamal', 'courier_status' => 'Out for delivery' ) );

		$board = $this->k->orders->courierBoard( $this->ctx );
		$this->assertSame( 1, $board['status']['shipped'] );
		$this->assertSame( 1, $board['status']['delivered'] );
		$this->assertSame( 1, $board['status']['returned'] );
		$this->assertSame( 50, $board['success'] );
		$this->assertSame( 'redx', $board['couriers'][0]['courier'] );
		$this->assertSame( 1, $board['couriers'][0]['in_transit'] );
		$this->assertSame( 100, $board['couriers'][0]['success'] );
		$this->assertSame( 'Jamal', $board['on_the_road'][0]['rider_name'] );
		$this->assertSame( 'Out for delivery', $board['on_the_road'][0]['courier_status'] );
		$this->assertSame( array( 'checked' => 0, 'delivered' => 0, 'errors' => 0 ), $this->k->orders->refreshAll( $this->ctx ) );
	}

	public function testSmsAfterSale(): void {
		$p    = $this->product( 'Honey', '300', '200', '20' );
		$cust = $this->k->contacts->create( $this->ctx, 'customer', array( 'name' => 'Karim', 'phone' => '01712345678' ) )['id'];
		$sale = fn() => $this->k->sales->get( $this->ctx, $this->k->sales->create( $this->ctx, array( 'customer_id' => $cust, 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '250' ) ) ) )['id'] );

		// Off by default / no gateway: nothing is sent.
		$this->assertFalse( $this->k->sms->afterSale( $this->ctx, $sale() ) );
		$urls = array();
		$this->k->setHttp( function ( $m, $url ) use ( &$urls ) { $urls[] = $url; return array( 200, '{"response_code":202}' ); } );
		$this->assertThrows( ValidationException::class, fn() => $this->k->platform->saveConfig( array( 'sms_url' => 'https://x.test/send?to={phone}' ) ) );
		$this->k->platform->saveConfig( array( 'sms_url' => \GoriberHisab\Notifications\SmsService::PRESETS['bulksmsbd'], 'sms_key' => 'KEY1', 'sms_sender' => '8809600' ) );
		$this->assertFalse( $this->k->sms->afterSale( $this->ctx, $sale() ), 'shop has not turned it on' );

		$this->k->settings->update( $this->ctx, array( 'sms.after_sale' => true, 'general.language' => 'bn' ) );
		$this->assertTrue( $this->k->sms->afterSale( $this->ctx, $sale() ) );
		$this->assertSame( 1, count( $urls ) );
		$this->assertTrue( str_contains( $urls[0], 'number=8801712345678' ) && str_contains( $urls[0], 'api_key=KEY1' ) && str_contains( $urls[0], 'senderid=8809600' ) );
		$msg = rawurldecode( explode( '&message=', $urls[0] )[1] );
		$this->assertTrue( str_contains( $msg, 'ধন্যবাদ Karim' ) && str_contains( $msg, 'মোট Tk 300' ) && str_contains( $msg, 'মোট বাকি Tk 150' ), $msg );

		// Gateway refuses: logged as failed, sale unaffected.
		$this->k->setHttp( fn() => array( 200, '{"error":"invalid api key"}' ) );
		$this->assertFalse( $this->k->sms->afterSale( $this->ctx, $sale() ) );
		$u = $this->k->sms->usage( $this->ctx );
		$this->assertSame( 1, $u['month'] );
		$this->assertSame( 1, $u['failed'] );
		$this->assertThrows( ValidationException::class, fn() => $this->k->sms->send( $this->ctx, '123', 'Hi' ) );
		$this->assertSame( 'KEY1••••••••••', $this->k->platform->adminConfig()['sms_key'] );
	}

	public function testCustomerHistory(): void {
		$p    = $this->product( 'Honey', '300', '200', '20' );
		$cust = $this->k->contacts->create( $this->ctx, 'customer', array( 'name' => 'Rahim', 'phone' => '01712345678' ) )['id'];
		$this->k->sales->create( $this->ctx, array( 'customer_id' => $cust, 'channel' => 'pos', 'items' => array( array( 'product_id' => $p, 'qty' => '2', 'discount_type' => 'fixed', 'discount_value' => '20' ) ), 'payments' => array( array( 'amount' => '580' ) ) ) );
		$o = $this->order( $p, array( 'customer_id' => $cust, 'zone' => 'outside', 'area' => 'Khulna' ) );
		$this->k->orders->confirm( $this->ctx, $o['id'] );
		$this->order( $p, array( 'customer_id' => $cust, 'zone' => 'inside' ) ); // still pending

		$h = $this->k->reports->customerHistory( $this->ctx, $cust );
		$this->assertSame( 2, $h['summary']['visits'] );
		$this->assertSame( 1, $h['summary']['shop'] );
		$this->assertSame( 1, $h['summary']['online'] );
		$this->assertSame( 1, $h['summary']['outside'] );
		$this->assertMoney( '40', $h['summary']['discount'] ); // 20 on the POS line + 20 order discount
		$this->assertSame( 'Honey', $h['favourites'][0]['name'] );
		$this->assertMoney( '4', $h['favourites'][0]['qty'] );
		$online = array_values( array_filter( $h['sales'], fn( $s ) => $s['online'] ) )[0];
		$this->assertSame( 'outside', $online['zone'] );
		$this->assertSame( 'facebook', $online['source'] );
		$this->assertSame( 1, count( $h['orders'] ) );
		$this->assertSame( 'pending', $h['orders'][0]['status'] );
	}

	public function testZoneFollowsShopCity(): void {
		$this->k->orders->saveCourierSettings( $this->ctx, array( 'city' => 'Jashore, যশোর' ) );
		$this->assertSame( 'Jashore, যশোর', $this->k->orders->courierSettings( $this->ctx )['city'] );
		$a = $this->k->orders->parse( $this->ctx, "Rahim\n01712345678\nHouse 4, Rail Road, Jashore", false );
		$this->assertSame( 'inside', $a['zone'] );
		$b = $this->k->orders->parse( $this->ctx, "Karim\n01812345678\nমিরপুর ১০, ঢাকা", false );
		$this->assertSame( 'outside', $b['zone'] );
		$c = $this->k->orders->parse( $this->ctx, "Jamal\n01912345678\nবকচর, যশোর", false );
		$this->assertSame( 'inside', $c['zone'] );
	}

	public function testCustomerFilters(): void {
		$p   = $this->product( 'Honey', '300', '200', '50' );
		$big = $this->k->contacts->create( $this->ctx, 'customer', array( 'name' => 'Big Buyer', 'phone' => '01711111111', 'address' => 'Rail Road, Jashore' ) )['id'];
		$small = $this->k->contacts->create( $this->ctx, 'customer', array( 'name' => 'Small Buyer', 'phone' => '01722222222' ) )['id'];
		$this->k->contacts->create( $this->ctx, 'customer', array( 'name' => 'Never Bought' ) );
		$this->k->sales->create( $this->ctx, array( 'customer_id' => $big, 'items' => array( array( 'product_id' => $p, 'qty' => '10' ) ), 'payments' => array( array( 'amount' => '3000' ) ) ) );
		$this->k->sales->create( $this->ctx, array( 'customer_id' => $small, 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '300' ) ) ) );
		$o = $this->order( $p, array( 'customer_id' => $small, 'zone' => 'outside', 'area' => 'Khulna' ) );
		$this->k->orders->confirm( $this->ctx, $o['id'] );

		$c    = $this->k->contacts;
		$name = static fn( $r ) => array_map( static fn( $x ) => $x['name'], $r['items'] );
		$this->assertSame( array( 'Big Buyer' ), $name( $c->list( $this->ctx, 'customer', array( 'min_bought' => '2000' ) ) ) );
		$this->assertSame( array( 'Never Bought' ), $name( $c->list( $this->ctx, 'customer', array( 'max_bought' => '0' ) ) ) );
		$this->assertSame( array( 'Big Buyer' ), $name( $c->list( $this->ctx, 'customer', array( 'location' => 'jashore' ) ) ) );
		$this->assertSame( array( 'Small Buyer' ), $name( $c->list( $this->ctx, 'customer', array( 'location' => 'Khulna' ) ) ) );
		$this->assertSame( array( 'Small Buyer' ), $name( $c->list( $this->ctx, 'customer', array( 'zone' => 'outside' ) ) ) );
		$this->assertSame( array( 'Small Buyer' ), $name( $c->list( $this->ctx, 'customer', array( 'channel' => 'online' ) ) ) );
		$all = $c->list( $this->ctx, 'customer', array( 'orderby' => 'bought' ) );
		$this->assertSame( 'Big Buyer', $all['items'][0]['name'] );
		$this->assertMoney( '3000', $all['items'][0]['bought'] );
		$this->assertSame( 2, $all['items'][1]['invoices'] );
		$this->assertSame( array( 'Never Bought' ), $name( $c->list( $this->ctx, 'customer', array( 'inactive_days' => '30' ) ) ) );
	}
}
