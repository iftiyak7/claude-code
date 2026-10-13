<?php
/**
 * Service container / composition root.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger;

use BizLedger\Accounting\AccountService;
use BizLedger\Accounting\JournalService;
use BizLedger\Audit\AuditLogger;
use BizLedger\Catalog\ProductService;
use BizLedger\Catalog\TaxonomyService;
use BizLedger\Catalog\TaxService;
use BizLedger\Contacts\ContactService;
use BizLedger\Data\DataService;
use BizLedger\Database\Database;
use BizLedger\Finance\FinanceService;
use BizLedger\Inventory\StockService;
use BizLedger\Notifications\NotificationService;
use BizLedger\Numbering\NumberingService;
use BizLedger\Payments\PaymentService;
use BizLedger\Platform\PlatformService;
use BizLedger\Purchases\PurchaseService;
use BizLedger\Reports\ReportService;
use BizLedger\Returns\ReturnService;
use BizLedger\Sales\SaleService;
use BizLedger\Security\Permissions;
use BizLedger\Security\RateLimiter;
use BizLedger\Settings\SettingsService;
use BizLedger\Support\Clock;
use BizLedger\Support\Events;
use BizLedger\Tenancy\BusinessService;
use BizLedger\Tenancy\ContextFactory;
use BizLedger\Tenancy\MemberService;
use BizLedger\Tenancy\UserDirectory;

/**
 * Lazily builds and shares every service. The same kernel runs inside
 * WordPress (wpdb driver) and in tests (PDO/SQLite driver).
 *
 * Services are exposed as read-only properties via __get, e.g.
 * $kernel->sales->create( $ctx, $data ).
 *
 * @property-read Permissions         $permissions
 * @property-read AuditLogger         $audit
 * @property-read SettingsService     $settings
 * @property-read NumberingService    $numbers
 * @property-read AccountService      $accounts
 * @property-read JournalService      $journal
 * @property-read StockService        $stock
 * @property-read TaxService          $taxes
 * @property-read TaxonomyService     $taxonomy
 * @property-read ProductService      $products
 * @property-read ContactService      $contacts
 * @property-read PaymentService      $payments
 * @property-read SaleService         $sales
 * @property-read PurchaseService     $purchases
 * @property-read ReturnService       $returns
 * @property-read FinanceService      $finance
 * @property-read ReportService       $reports
 * @property-read NotificationService $notifications
 * @property-read BusinessService     $businesses
 * @property-read MemberService       $members
 * @property-read ContextFactory      $contexts
 * @property-read RateLimiter         $limiter
 * @property-read DataService         $data
 * @property-read PlatformService     $platform
 */
final class Kernel {

	public Database $db;
	public Clock $clock;
	public Events $events;
	public UserDirectory $users;

	/**
	 * @var array<string,object>
	 */
	private array $instances = array();

	public function __construct( Database $db, Clock $clock, Events $events, UserDirectory $users ) {
		$this->db     = $db;
		$this->clock  = $clock;
		$this->events = $events;
		$this->users  = $users;
	}

	/**
	 * @return object
	 */
	public function __get( string $name ) {
		if ( ! isset( $this->instances[ $name ] ) ) {
			$this->instances[ $name ] = $this->make( $name );
		}
		return $this->instances[ $name ];
	}

	/**
	 * Replace a service (tests, add-ons decorating a service).
	 */
	public function set( string $name, object $service ): void {
		$this->instances[ $name ] = $service;
	}

	/**
	 * @return object
	 */
	private function make( string $name ) {
		$d = $this->db;
		$c = $this->clock;
		$e = $this->events;
		switch ( $name ) {
			case 'permissions':
				return new Permissions( $e );
			case 'audit':
				$audit = new AuditLogger( $d, $c );
				$audit->setIpPolicy( fn( int $business_id ) => (bool) ( $this->settings->forBusiness( $business_id )['audit.log_ip'] ?? true ) );
				return $audit;
			case 'settings':
				return new SettingsService( $d, $c, $e, $this->audit );
			case 'numbers':
				return new NumberingService( $d, $c, $this->settings );
			case 'accounts':
				return new AccountService( $d, $c, $e, $this->audit );
			case 'journal':
				return new JournalService( $d, $c, $e, $this->accounts, $this->settings, $this->audit );
			case 'stock':
				return new StockService( $d, $c, $e, $this->settings, $this->journal, $this->audit );
			case 'taxes':
				return new TaxService( $d, $c, $e, $this->audit );
			case 'taxonomy':
				return new TaxonomyService( $d, $c, $e, $this->audit );
			case 'products':
				return new ProductService( $d, $c, $e, $this->stock, $this->audit );
			case 'contacts':
				return new ContactService( $d, $c, $e, $this->journal, $this->accounts, $this->numbers, $this->audit );
			case 'payments':
				return new PaymentService( $d, $c, $e, $this->journal, $this->accounts, $this->contacts, $this->numbers, $this->audit );
			case 'sales':
				return new SaleService( $d, $c, $e, $this->settings, $this->products, $this->taxes, $this->contacts, $this->stock, $this->journal, $this->accounts, $this->payments, $this->numbers, $this->audit );
			case 'purchases':
				return new PurchaseService( $d, $c, $e, $this->settings, $this->products, $this->taxes, $this->contacts, $this->stock, $this->journal, $this->accounts, $this->payments, $this->numbers, $this->audit );
			case 'returns':
				return new ReturnService( $d, $c, $e, $this->settings, $this->stock, $this->journal, $this->payments, $this->numbers, $this->audit );
			case 'finance':
				return new FinanceService( $d, $c, $e, $this->accounts, $this->journal, $this->numbers, $this->audit );
			case 'reports':
				return new ReportService( $d, $c, $e, $this->accounts );
			case 'notifications':
				return new NotificationService( $d, $c, $e, $this->settings );
			case 'businesses':
				return new BusinessService( $d, $c, $e, $this->accounts, $this->taxonomy, $this->taxes, $this->settings, $this->permissions, $this->audit );
			case 'members':
				return new MemberService( $d, $c, $e, $this->permissions, $this->users, $this->audit );
			case 'contexts':
				$contexts = new ContextFactory( $d, $this->permissions );
				$contexts->setSubscriptionPolicy(
					fn( array $business ) => $this->platform->subscription( $business ),
					static fn( int $user_id ) => function_exists( 'user_can' ) && user_can( $user_id, 'manage_options' )
				);
				return $contexts;
			case 'platform':
				$memory = array();
				return new PlatformService(
					$d,
					$c,
					$e,
					$this->businesses,
					$this->users,
					static function () use ( &$memory ) {
						return function_exists( 'get_option' ) ? (array) get_option( 'bizledger_platform', array() ) : $memory;
					},
					static function ( array $config ) use ( &$memory ): void {
						if ( function_exists( 'update_option' ) ) {
							update_option( 'bizledger_platform', $config, false );
						}
						$memory = $config;
					}
				);
			case 'limiter':
				return new RateLimiter( $c );
			case 'data':
				return new DataService( $this );
		}
		throw new \LogicException( "Unknown service {$name}" );
	}
}
