<?php
/**
 * Customer SMS: the shop's own gateway (Automas, …), the four events, the queue.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Tests\Integration;

use GoriberHisab\Notifications\SmsService;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tests\IntegrationTestCase;

final class SmsTest extends IntegrationTestCase {

	/** @var array<int,array{0:string,1:string,2:?string}> */
	private array $calls = array();

	private string $reply = '{"status":"SUCCESS","id":"m1"}';

	public function setUp(): void {
		parent::setUp();
		$this->k->setHttp(
			function ( $method, $url, $headers, $body ) {
				$this->calls[] = array( $method, $url, $body );
				return array( 200, $this->reply );
			}
		);
	}

	private function connect( string $provider = 'automas' ): void {
		$this->k->sms->saveShopGateway( $this->ctx, array( 'provider' => $provider, 'key' => 'SECRETKEY1', 'sender' => 'NOORIYAH' ) );
		$this->k->settings->update( $this->ctx, array( 'general.language' => 'bn' ) );
	}

	private function msg( int $i = 0 ): string {
		parse_str( (string) parse_url( $this->calls[ $i ][1], PHP_URL_QUERY ), $q );
		return (string) ( $q['smstext'] ?? $q['message'] ?? '' );
	}

	private function sale( int $customer, string $paid = '250' ): array {
		$p = $this->product( 'Honey', '300', '200', '20' );
		return $this->k->sales->create( $this->ctx, array( 'customer_id' => $customer, 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => $paid ) ) ) );
	}

	public function testOwnAutomasAccountSendsSaleSmsAfterTheRequest(): void {
		$cust = $this->k->contacts->create( $this->ctx, 'customer', array( 'name' => 'Karim', 'phone' => '01712345678' ) )['id'];

		// Nothing set up: no SMS, sale fine.
		$this->sale( $cust );
		$this->assertSame( 0, $this->k->sms->flush() );

		$this->assertThrows( ValidationException::class, fn() => $this->k->sms->saveShopGateway( $this->ctx, array( 'provider' => 'automas', 'key' => '', 'sender' => 'NOORIYAH' ) ) );
		$this->assertThrows( ValidationException::class, fn() => $this->k->sms->saveShopGateway( $this->ctx, array( 'provider' => 'automas', 'key' => 'K', 'sender' => '' ) ) );
		$this->connect();
		$g = $this->k->sms->shopGateway( $this->ctx );
		$this->assertTrue( $g['connected'] );
		$this->assertSame( 'SECR••••••••••', $g['key'] );
		$this->assertSame( 'NOORIYAH', $g['sender'] );
		$this->assertFalse( isset( $this->k->settings->all( $this->ctx )['secret.sms'] ), 'the key never travels with the settings' );

		// Connected but the switch is off.
		$this->sale( $cust );
		$this->assertSame( 0, $this->k->sms->flush() );

		$this->k->settings->update( $this->ctx, array( 'sms.after_sale' => true, 'general.language' => 'bn' ) );
		$sale = $this->sale( $cust );
		$this->assertSame( array(), $this->calls, 'queued, not sent while the sale is being saved' );
		$this->assertTrue( $this->k->sms->queuedFor( $this->ctx, 'sale', (int) $sale['id'] ) );
		$this->assertSame( 1, $this->k->sms->flush() );
		$this->assertSame( 1, count( $this->calls ) );
		$url = $this->calls[0][1];
		$this->assertTrue( str_starts_with( $url, 'https://api.automas.com.bd/smsapiv3?' ), $url );
		$this->assertTrue( str_contains( $url, 'apikey=SECRETKEY1' ) && str_contains( $url, 'sender=NOORIYAH' ) && str_contains( $url, 'msisdn=8801712345678' ), $url );
		$this->assertTrue( str_contains( $url, 'smsformat=8' ), 'Bangla goes as unicode' );
		$msg = $this->msg();
		$this->assertTrue( str_contains( $msg, 'Test Shop' ) && str_contains( $msg, $sale['number'] ) && str_contains( $msg, 'মোট Tk 300' ), $msg );

		// Sent once: a flush, a restore or a sync retry never texts twice.
		$this->assertSame( 0, $this->k->sms->flush( true ) );
		$this->k->sales->void( $this->ctx, (int) $sale['id'], 'test' );
		$this->k->sales->restore( $this->ctx, (int) $sale['id'], array() );
		$this->assertSame( 0, $this->k->sms->flush() );
		$this->assertSame( 1, count( $this->calls ) );

		// English text: no unicode flag at all.
		$this->k->settings->update( $this->ctx, array( 'sms.sale_template' => '{shop}: Bill {invoice} total {total}' ) );
		$s2 = $this->sale( $cust );
		$this->k->sms->flush();
		$this->assertFalse( str_contains( $this->calls[1][1], 'smsformat' ), $this->calls[1][1] );
		$this->assertSame( 'Test Shop: Bill ' . $s2['number'] . ' total Tk 300', $this->msg( 1 ) );

		$u = $this->k->sms->usage( $this->ctx );
		$this->assertSame( 2, $u['month'] );
		$this->assertTrue( $u['own'] );
	}

	public function testRolledBackSaleSendsNothing(): void {
		$this->connect();
		$this->k->settings->update( $this->ctx, array( 'sms.payment_received' => true ) );
		$cust = $this->k->contacts->create( $this->ctx, 'customer', array( 'name' => 'Rahim', 'phone' => '01812345678', 'opening_balance' => '500' ) )['id'];
		try {
			$this->db->transaction(
				function () use ( $cust ) {
					$this->k->payments->receive( $this->ctx, array( 'contact_id' => $cust, 'account_id' => $this->account( 'cash' ), 'amount' => '100' ) );
					throw new \RuntimeException( 'boom' );
				}
			);
		} catch ( \RuntimeException $e ) {
			// expected
		}
		$this->assertSame( 0, $this->k->sms->flush() );
		$this->assertSame( array(), $this->calls );
	}

	public function testDueCollectedSmsShowsWhatIsLeft(): void {
		$this->connect();
		$this->k->settings->update( $this->ctx, array( 'sms.payment_received' => true, 'sms.after_sale' => false ) );
		$cust = $this->k->contacts->create( $this->ctx, 'customer', array( 'name' => 'Rahim', 'phone' => '01812345678' ) )['id'];
		$this->sale( $cust, '100' ); // 200 due; the sale's own payment is not a "due collected" SMS
		$this->assertSame( 0, $this->k->sms->flush() );

		$pay = $this->k->payments->receive( $this->ctx, array( 'contact_id' => $cust, 'account_id' => $this->account( 'cash' ), 'amount' => '150' ) );
		$this->assertSame( 1, $this->k->sms->flush() );
		$msg = $this->msg();
		$this->assertTrue( str_contains( $msg, 'Tk 150 জমা পেয়েছি' ) && str_contains( $msg, $pay['number'] ) && str_contains( $msg, 'এখন বাকি Tk 50' ), $msg );

		$this->k->payments->receive( $this->ctx, array( 'contact_id' => $cust, 'account_id' => $this->account( 'cash' ), 'amount' => '50' ) );
		$this->k->sms->flush();
		$this->assertTrue( str_contains( $this->msg( 1 ), 'আর কোনো বাকি নেই' ), $this->msg( 1 ) );
	}

	public function testOrderPlacedAndShippedSms(): void {
		$this->connect();
		$this->k->settings->update( $this->ctx, array( 'sms.order_placed' => true, 'sms.order_shipped' => true, 'sms.after_sale' => true ) );
		$p = $this->product( 'Saree', '500', '300', '10' );
		$o = $this->k->orders->create(
			$this->ctx,
			array(
				'source'          => 'facebook',
				'customer_name'   => 'Nusrat',
				'phone'           => '01712345678',
				'address'         => 'House 5, Road 2, Mirpur',
				'area'            => 'Dhaka',
				'items'           => array( array( 'product_id' => $p, 'qty' => '2', 'unit_price' => '500' ) ),
				'delivery_charge' => '70',
			)
		);
		$this->assertSame( 1, $this->k->sms->flush() );
		$this->assertTrue( str_contains( $this->msg(), $o['number'] ) && str_contains( $this->msg(), 'গ্রহণ করা হয়েছে' ), $this->msg() );

		// Confirming makes a sale: no second "thank you" SMS for the same order.
		$this->k->orders->confirm( $this->ctx, (int) $o['id'] );
		$this->assertSame( 0, $this->k->sms->flush() );

		$this->k->orders->advance( $this->ctx, (int) $o['id'], 'shipped', array( 'courier' => 'pathao', 'consignment_id' => 'DT123' ) );
		$this->assertSame( 1, $this->k->sms->flush() );
		$msg = $this->msg( 1 );
		$this->assertTrue( str_contains( $msg, 'Pathao' ) && str_contains( $msg, 'DT123' ) && str_contains( $msg, 'ডেলিভারিতে দিতে হবে Tk 1070' ), $msg );
		$this->assertSame( 2, count( $this->calls ) );

		// COD handed over by the courier later is not a "we received your payment" SMS.
		$this->k->settings->update( $this->ctx, array( 'sms.payment_received' => true ) );
		$this->k->orders->advance( $this->ctx, (int) $o['id'], 'delivered' );
		$this->k->orders->collectCod( $this->ctx, array( (int) $o['id'] ), array( 'account_id' => $this->account( 'cash' ) ) );
		$this->assertMoney( '0', $this->k->sales->get( $this->ctx, (int) $this->k->orders->get( $this->ctx, (int) $o['id'] )['sale_id'] )['due_amount'] );
		$this->assertSame( 0, $this->k->sms->flush() );
	}

	public function testGatewayRefusalIsLoggedWithItsReply(): void {
		$this->connect();
		$this->reply = '{"status":"106","message":"Incorrect API key"}';
		$r = $this->k->sms->test( $this->ctx, '01712345678' );
		$this->assertFalse( $r['ok'] );
		$this->assertTrue( str_contains( $r['response'], 'Incorrect API key' ) );
		$this->assertSame( 'failed', $this->k->sms->log( $this->ctx )[0]['status'] );
		$this->assertThrows( ValidationException::class, fn() => $this->k->sms->test( $this->ctx, '123' ) );

		$this->reply = '{"status":"SUCCESS"}';
		$this->assertTrue( $this->k->sms->test( $this->ctx, '01712345678' )['ok'] );
		$this->assertTrue( str_contains( rawurldecode( $this->calls[1][1] ), 'পরীক্ষামূলক' ) );
	}

	public function testReplyShapesOfBangladeshiGateways(): void {
		$this->assertTrue( SmsService::accepted( 200, '{"response_code":202,"success_message":"SMS Submitted Successfully"}' ) ); // BulkSMSBD
		$this->assertFalse( SmsService::accepted( 200, '{"response_code":1007,"error_message":"Balance Insufficient"}' ) );
		$this->assertTrue( SmsService::accepted( 200, '{"error":0,"msg":"Request successfully submitted"}' ) ); // Alpha
		$this->assertFalse( SmsService::accepted( 200, '{"error":405,"msg":"Authorization required"}' ) );
		$this->assertFalse( SmsService::accepted( 200, '{"error":"invalid api key"}' ) );
		$this->assertTrue( SmsService::accepted( 200, '{"response":[{"status":"SUCCESS","id":"1"}]}' ) );
		$this->assertTrue( SmsService::accepted( 200, '{"status":"0"}' ) );
		$this->assertFalse( SmsService::accepted( 200, '{"status":"109"}' ) );
		$this->assertTrue( SmsService::accepted( 200, 'Ok: SMS Sent Successfully' ) ); // GreenWeb
		$this->assertFalse( SmsService::accepted( 200, 'Error: Invalid Number' ) );
		$this->assertFalse( SmsService::accepted( 500, '{"status":"SUCCESS"}' ) );
	}

	public function testPostTemplateAndSiteGatewayFallback(): void {
		// No own account: the site owner's gateway is used.
		$this->k->platform->saveConfig( array( 'sms_url' => SmsService::PRESETS['bulksmsbd'], 'sms_key' => 'SITEKEY', 'sms_sender' => '8809600' ) );
		$this->assertTrue( $this->k->sms->test( $this->ctx, '01712345678' )['ok'] );
		$this->assertTrue( str_contains( $this->calls[0][1], 'api_key=SITEKEY' ) );
		$this->assertFalse( $this->k->sms->usage( $this->ctx )['own'] );

		$this->k->sms->saveShopGateway( $this->ctx, array( 'provider' => 'custom', 'url' => 'POST https://gw.test/send?key={api_key}&to={phone_local}&text={message}', 'key' => 'MINE' ) );
		$this->k->sms->test( $this->ctx, '01712345678' );
		$this->assertSame( 'POST', $this->calls[1][0] );
		$this->assertSame( 'https://gw.test/send', $this->calls[1][1] );
		$this->assertTrue( str_contains( (string) $this->calls[1][2], 'key=MINE' ) && str_contains( (string) $this->calls[1][2], 'to=01712345678' ) );

		$this->k->sms->saveShopGateway( $this->ctx, array( 'remove' => true ) );
		$this->assertFalse( $this->k->sms->shopGateway( $this->ctx )['connected'] );
		$this->assertThrows( ValidationException::class, fn() => $this->k->sms->saveShopGateway( $this->ctx, array( 'provider' => 'custom', 'url' => 'https://x.test/send?to={phone}', 'key' => 'K' ) ) );
	}
}
