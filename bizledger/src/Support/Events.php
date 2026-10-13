<?php
/**
 * Event dispatcher.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Support;

/**
 * Thin wrapper over WordPress actions/filters. Outside WordPress (tests,
 * CLI) it falls back to an in-memory listener list with the same API.
 */
class Events {

	/**
	 * Fallback listeners: hook => list of callables.
	 *
	 * @var array<string,array<int,callable>>
	 */
	private array $listeners = array();

	/**
	 * Recorded dispatches (useful for tests and debugging).
	 *
	 * @var array<int,string>
	 */
	public array $fired = array();

	public function dispatch( string $hook, ...$args ): void {
		$this->fired[] = $hook;
		if ( function_exists( 'do_action' ) ) {
			do_action( $hook, ...$args );
			return;
		}
		foreach ( $this->listeners[ $hook ] ?? array() as $listener ) {
			$listener( ...$args );
		}
	}

	/**
	 * @param mixed $value Value to filter.
	 * @param mixed ...$args Extra arguments.
	 * @return mixed
	 */
	public function filter( string $hook, $value, ...$args ) {
		if ( function_exists( 'apply_filters' ) ) {
			return apply_filters( $hook, $value, ...$args );
		}
		foreach ( $this->listeners[ $hook ] ?? array() as $listener ) {
			$value = $listener( $value, ...$args );
		}
		return $value;
	}

	public function listen( string $hook, callable $listener ): void {
		if ( function_exists( 'add_filter' ) ) {
			add_filter( $hook, $listener, 10, 10 );
			return;
		}
		$this->listeners[ $hook ][] = $listener;
	}
}
