<?php
/**
 * Base REST controller.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Http\Controllers;

use BizLedger\Kernel;

/**
 * Controllers only translate HTTP ↔ service calls; all rules live in services.
 *
 * A route is: path, methods, handler(ctx, params, request), and optional
 * flags: context (default true), created (201 on POST).
 */
abstract class Controller {

	protected Kernel $k;

	public function __construct( Kernel $kernel ) {
		$this->k = $kernel;
	}

	/**
	 * @return array<int,array<string,mixed>>
	 */
	abstract public function routes(): array;

	/**
	 * @param array<string,mixed> $flags Extra flags.
	 * @return array<string,mixed>
	 */
	protected function route( string $methods, string $path, callable $handler, array $flags = array() ): array {
		return array_merge(
			array(
				'methods' => $methods,
				'path'    => $path,
				'handler' => $handler,
			),
			$flags
		);
	}

	/**
	 * Integer URL parameter.
	 */
	protected static function id( \WP_REST_Request $request, string $key = 'id' ): int {
		return (int) $request->get_param( $key );
	}
}
