<?php
/**
 * Simple fixed-window rate limiter.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Security;

use GoriberHisab\Support\Clock;
use GoriberHisab\Support\RateLimitException;

/**
 * Counts hits per key in a fixed window. Uses the object cache / transients
 * in WordPress and an in-memory array elsewhere.
 */
final class RateLimiter {

	private Clock $clock;

	/**
	 * @var array<string,array{0:int,1:int}>
	 */
	private array $memory = array();

	public function __construct( Clock $clock ) {
		$this->clock = $clock;
	}

	/**
	 * @throws RateLimitException When the limit is exceeded.
	 */
	public function hit( string $key, int $limit, int $window_seconds ): void {
		$now    = $this->clock->now()->getTimestamp();
		$bucket = intdiv( $now, max( 1, $window_seconds ) );
		$name   = 'bzl_rl_' . md5( $key . '|' . $bucket );

		if ( function_exists( 'get_transient' ) ) {
			$count = (int) get_transient( $name );
			if ( $count >= $limit ) {
				throw new RateLimitException( 'Too many requests. Please wait a moment and try again.' );
			}
			set_transient( $name, $count + 1, $window_seconds );
			return;
		}
		$count = $this->memory[ $name ][0] ?? 0;
		if ( $count >= $limit ) {
			throw new RateLimitException( 'Too many requests. Please wait a moment and try again.' );
		}
		$this->memory[ $name ] = array( $count + 1, $now );
	}
}
