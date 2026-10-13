<?php
/**
 * REST API registration and dispatch.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Http;

use BizLedger\Http\Controllers\AccountingController;
use BizLedger\Http\Controllers\CatalogController;
use BizLedger\Http\Controllers\ContactsController;
use BizLedger\Http\Controllers\CoreController;
use BizLedger\Http\Controllers\DataController;
use BizLedger\Http\Controllers\InventoryController;
use BizLedger\Http\Controllers\PurchasesController;
use BizLedger\Http\Controllers\ReportsController;
use BizLedger\Http\Controllers\SalesController;
use BizLedger\Kernel;
use BizLedger\Support\BizLedgerException;
use BizLedger\Tenancy\BusinessContext;

/**
 * Registers every route under /wp-json/bizledger/v1.
 *
 * Authentication: WordPress cookie + X-WP-Nonce (the web app) or
 * Application Passwords / any WP REST auth plugin (mobile apps, POS
 * terminals, integrations).
 *
 * Tenant selection: X-BizLedger-Business / X-BizLedger-Branch headers (or
 * business_id / branch_id query args). Every route resolves a
 * BusinessContext through ContextFactory, which refuses non-members.
 * Fine-grained permissions are enforced again inside each service.
 */
final class Api {

	public const NAMESPACE = 'bizledger/v1';

	private Kernel $k;

	public function __construct( Kernel $kernel ) {
		$this->k = $kernel;
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'routes' ) );
	}

	/**
	 * Route definition list.
	 *
	 * @return array<int,Controllers\Controller>
	 */
	private function controllers(): array {
		$controllers = array(
			new CoreController( $this->k ),
			new CatalogController( $this->k ),
			new ContactsController( $this->k ),
			new SalesController( $this->k ),
			new PurchasesController( $this->k ),
			new AccountingController( $this->k ),
			new InventoryController( $this->k ),
			new ReportsController( $this->k ),
			new DataController( $this->k ),
		);
		return (array) apply_filters( 'bizledger/rest_controllers', $controllers, $this->k );
	}

	public function routes(): void {
		foreach ( $this->controllers() as $controller ) {
			foreach ( $controller->routes() as $route ) {
				register_rest_route(
					self::NAMESPACE,
					$route['path'],
					array(
						'methods'             => $route['methods'],
						'callback'            => fn( \WP_REST_Request $request ) => $this->dispatch( $route, $request ),
						'permission_callback' => static fn() => is_user_logged_in(),
						'args'                => $route['args'] ?? array(),
					)
				);
			}
		}
	}

	/**
	 * @param array<string,mixed> $route Route definition.
	 * @return \WP_REST_Response|\WP_Error
	 */
	private function dispatch( array $route, \WP_REST_Request $request ) {
		try {
			$user_id = get_current_user_id();
			$write   = 'GET' !== $request->get_method();
			if ( $write ) {
				$this->k->limiter->hit( 'write:' . $user_id, (int) apply_filters( 'bizledger/rate_limit_writes', 240 ), 60 );
			} else {
				$this->k->limiter->hit( 'read:' . $user_id, (int) apply_filters( 'bizledger/rate_limit_reads', 900 ), 60 );
			}

			$ctx = null;
			if ( $route['context'] ?? true ) {
				$ctx = $this->context( $request, $user_id );
			}

			$params = $request->get_params();
			// Tenant ids never come from the payload; the context owns them.
			unset( $params['business_id'], $params['_locale'] );

			$result = ( $route['handler'] )( $ctx, $params, $request );
			if ( $result instanceof \WP_REST_Response ) {
				return $result;
			}
			$status = 'POST' === $request->get_method() && ! empty( $route['created'] ) ? 201 : 200;
			return new \WP_REST_Response( $result, $status );
		} catch ( BizLedgerException $e ) {
			return new \WP_Error( $e->errorCode(), $e->getMessage(), array_merge( array( 'status' => $e->status() ), $e->data() ) );
		} catch ( \Throwable $e ) {
			error_log( 'BizLedger API error: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() ); // phpcs:ignore
			return new \WP_Error( 'bizledger_error', __( 'Something went wrong. Please try again; if it keeps happening, contact support.', 'bizledger' ), array( 'status' => 500 ) );
		}
	}

	private function context( \WP_REST_Request $request, int $user_id ): BusinessContext {
		$business = (int) ( $request->get_header( 'x_bizledger_business' ) ?: $request->get_param( 'business_id' ) );
		$branch   = (int) ( $request->get_header( 'x_bizledger_branch' ) ?: $request->get_param( 'branch_id_ctx' ) );
		$ctx      = $this->k->contexts->forUser( $user_id, $business, $branch );
		$ctx->ip  = self::clientIp();
		$ctx->user_agent = isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '';
		$this->k->contexts->touch( $ctx, $this->k->clock->mysql() );
		return $ctx;
	}

	/**
	 * Client IP. Proxy headers are ignored unless a site opts in, because
	 * they are trivially spoofable.
	 */
	public static function clientIp(): string {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$ip = (string) apply_filters( 'bizledger/client_ip', $ip );
		return false !== filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : '';
	}
}
