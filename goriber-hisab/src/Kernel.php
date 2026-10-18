<?php
/**
 * Service container / composition root.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab;

use GoriberHisab\Accounting\AccountService;
use GoriberHisab\Accounting\JournalService;
use GoriberHisab\Audit\AuditLogger;
use GoriberHisab\Catalog\ProductService;
use GoriberHisab\Catalog\TaxonomyService;
use GoriberHisab\Catalog\TaxService;
use GoriberHisab\Contacts\ContactService;
use GoriberHisab\Data\DataService;
use GoriberHisab\Database\Database;
use GoriberHisab\Finance\CashService;
use GoriberHisab\Notifications\SmsService;
use GoriberHisab\Finance\FinanceService;
use GoriberHisab\Inventory\StockService;
use GoriberHisab\Notifications\NotificationService;
use GoriberHisab\Numbering\NumberingService;
use GoriberHisab\Orders\OrderService;
use GoriberHisab\Payments\PaymentService;
use GoriberHisab\Platform\PlatformService;
use GoriberHisab\Purchases\PurchaseService;
use GoriberHisab\Reports\ReportService;
use GoriberHisab\Returns\ReturnService;
use GoriberHisab\Sales\SaleService;
use GoriberHisab\Security\Permissions;
use GoriberHisab\Security\RateLimiter;
use GoriberHisab\Settings\SettingsService;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\Events;
use GoriberHisab\Tenancy\BusinessService;
use GoriberHisab\Tenancy\ContextFactory;
use GoriberHisab\Tenancy\MemberService;
use GoriberHisab\Tenancy\UserDirectory;

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
 * @property-read CashService         $cash
 * @property-read SmsService          $sms
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
 * @property-read OrderService        $orders
 */
final class Kernel {

	public Database $db;
	public Clock $clock;
	public Events $events;
	public UserDirectory $users;

	/**
	 * @var callable|null
	 */
	private $http = null;

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
	 * HTTP transport for outside APIs (couriers). Replaceable in tests via
	 * setHttp().
	 *
	 * @return callable(string,string,array<string,string>,?string):array{0:int,1:string}
	 */
	public function http(): callable {
		if ( null !== $this->http ) {
			return $this->http;
		}
		return static function ( string $method, string $url, array $headers, ?string $body ): array {
			if ( ! function_exists( 'wp_remote_request' ) ) {
				return array( 0, '' );
			}
			$res = wp_remote_request(
				$url,
				array(
					'method'  => $method,
					'headers' => $headers,
					'body'    => $body,
					'timeout' => 20,
				)
			);
			if ( is_wp_error( $res ) ) {
				return array( 0, (string) wp_json_encode( array( 'message' => $res->get_error_message() ) ) );
			}
			return array( (int) wp_remote_retrieve_response_code( $res ), (string) wp_remote_retrieve_body( $res ) );
		};
	}

	/**
	 * @param callable(string,string,array<string,string>,?string):array{0:int,1:string} $http Transport.
	 */
	public function setHttp( callable $http ): void {
		$this->http = $http;
		unset( $this->instances['orders'] );
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
				$sales = new SaleService( $d, $c, $e, $this->settings, $this->products, $this->taxes, $this->contacts, $this->stock, $this->journal, $this->accounts, $this->payments, $this->numbers, $this->audit );
				$sales->setUserNames( fn( int $id ): string => (string) ( $this->users->get( $id )['name'] ?? '' ) );
				return $sales;
			case 'purchases':
				return new PurchaseService( $d, $c, $e, $this->settings, $this->products, $this->taxes, $this->contacts, $this->stock, $this->journal, $this->accounts, $this->payments, $this->numbers, $this->audit );
			case 'returns':
				return new ReturnService( $d, $c, $e, $this->settings, $this->stock, $this->journal, $this->payments, $this->numbers, $this->audit );
			case 'finance':
				return new FinanceService( $d, $c, $e, $this->accounts, $this->journal, $this->numbers, $this->audit );
			case 'sms':
				return new SmsService(
					$d,
					$c,
					$e,
					$this->settings,
					fn( ...$a ) => ( $this->http() )( ...$a ),
					function (): array {
						$p = $this->platform->config();
						return array( 'url' => (string) $p['sms_url'], 'key' => (string) $p['sms_key'], 'sender' => (string) $p['sms_sender'] );
					}
				);
			case 'cash':
				return new CashService( $d, $c, $e, $this->accounts, $this->journal, $this->numbers, $this->audit );
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
			case 'orders':
				$orders = new OrderService( $d, $c, $e, $this->sales, $this->contacts, $this->payments, $this->finance, $this->accounts, $this->products, $this->numbers, $this->audit, $this->http() );
				$orders->setAiKey( fn() => (string) $this->platform->config()['ai_key'] );
				$orders->setRiskConfig(
					function (): array {
						$c = $this->platform->config();
						return array( 'url' => (string) $c['fraud_url'], 'key' => (string) $c['fraud_key'], 'network' => ! empty( $c['fraud_network'] ) );
					}
				);
				return $orders;
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
