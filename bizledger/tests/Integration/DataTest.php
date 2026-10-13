<?php
declare(strict_types=1);

namespace BizLedger\Tests\Integration;

use BizLedger\Data\DataService;
use BizLedger\Tests\IntegrationTestCase;

final class DataTest extends IntegrationTestCase {

	public function testImportDryRunThenReal(): void {
		$rows = array(
			array( 'Name' => 'Imported A', 'SKU' => 'A-1', 'Category' => 'Snacks', 'Selling Price' => '25', 'Purchase Price' => '15', 'Opening Qty' => '10' ),
			array( 'Name' => 'Imported B', 'SKU' => 'A-1', 'Selling Price' => '30' ), // duplicate SKU
			array( 'Name' => 'Imported C', 'Category' => 'snacks', 'Selling Price' => 'abc' ),
			array( 'Name' => '' ), // skipped
		);
		$dry = $this->k->data->import( $this->ctx, 'products', $rows, true );
		$this->assertSame( 1, $dry['created'] );
		$this->assertSame( 2, count( $dry['errors'] ) );
		$this->assertSame( 3, $dry['errors'][0]['row'] );
		$this->assertSame( 0, $this->k->products->list( $this->ctx )['total'], 'dry run writes nothing' );
		$this->assertSame( 0, count( $this->k->taxonomy->list( $this->ctx, 'categories' ) ) );

		$real = $this->k->data->import( $this->ctx, 'products', $rows, false );
		$this->assertSame( 1, $real['created'] );
		$this->assertSame( 1, $this->k->products->list( $this->ctx )['total'], 'failed rows rolled back individually' );
		$this->assertSame( 1, count( $this->k->taxonomy->list( $this->ctx, 'categories' ) ) );
		$this->assertMoney( '150', $this->balance( 'inventory' ) );
		$this->assertBooksBalanced( 'import' );

		$c = $this->k->data->import( $this->ctx, 'customers', array( array( 'name' => 'Imported Cust', 'phone' => '01711', 'opening_balance' => '75' ) ), false );
		$this->assertSame( 1, $c['created'] );
		$this->assertBooksBalanced( 'customer import' );
	}

	public function testImportWithoutSavepoints(): void {
		$this->db->savepoints = false; // e.g. WordPress SQLite integration.
		$rows = array(
			array( 'Name' => 'A', 'SKU' => 'X1', 'Opening Qty' => '2', 'Purchase Price' => '5', 'Selling Price' => '9' ),
			array( 'Name' => 'B', 'Selling Price' => 'oops' ),
		);
		$dry = $this->k->data->import( $this->ctx, 'products', $rows, true );
		$this->assertSame( 1, $dry['created'] );
		$this->assertSame( 0, $this->k->products->list( $this->ctx )['total'] );
		$real = $this->k->data->import( $this->ctx, 'products', $rows, false );
		$this->assertSame( 1, $real['created'] );
		$this->assertSame( 1, count( $real['errors'] ) );
		$this->assertBooksBalanced( 'import without savepoints' );
	}

	public function testDemoDataWithTaxKeepsBooksBalanced(): void {
		$this->k->settings->update( $this->ctx, array( 'tax.enabled' => true ) );
		$this->k->taxes->save( $this->ctx, array( 'name' => 'VAT', 'rate' => '5', 'is_default' => true ) );
		( new \BizLedger\Data\DemoData( $this->k ) )->seed( $this->ctx );
		$this->assertSame( 10, $this->k->products->list( $this->ctx )['total'] );
		$this->assertBooksBalanced( 'demo data' );
	}

	public function testExportAndCsvInjection(): void {
		$this->k->contacts->create( $this->ctx, 'customer', array( 'name' => '=HYPERLINK("http://evil")', 'phone' => '0199' ) );
		$out = $this->k->data->export( $this->ctx, 'customers', array() );
		$this->assertSame( 1, $out['rows'] );
		$this->assertTrue( str_contains( $out['csv'], "'=HYPERLINK" ), 'formula neutralised' );
		$this->assertTrue( str_starts_with( DataService::toCsv( array( array( 'a' => '-5' ) ) ), "\xEF\xBB\xBF" ) );
		$this->assertTrue( str_contains( DataService::toCsv( array( array( 'a' => '-5' ) ) ), "\n-5" ), 'negative numbers untouched' );
	}

	public function testBackupContainsOnlyThisBusiness(): void {
		$this->product( 'Mine', '10', '5', '1' );
		$other_user = $this->users->add( 'O', 'o@example.com' );
		$other      = $this->k->contexts->forUser( $other_user, $this->k->businesses->create( $other_user, array( 'name' => 'Other' ) ) );
		$this->k->products->create( $other, array( 'name' => 'Theirs', 'selling_price' => '1' ) );

		$backup = $this->k->data->backup( $this->ctx );
		$this->assertSame( 1, count( $backup['tables']['products'] ) );
		$this->assertSame( 'Mine', $backup['tables']['products'][0]['name'] );
		$this->assertSame( 1, count( $backup['tables']['businesses'] ) );
		$this->assertTrue( count( $backup['tables']['accounts'] ) > 20 );
	}
}
