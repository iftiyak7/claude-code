<?php
/**
 * Clock abstraction.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Support;

/**
 * Supplies "now". Domain code never calls time()/current_time() directly so
 * tests can freeze time and businesses can use their own timezone.
 */
class Clock {

	private ?\DateTimeImmutable $fixed;

	public function __construct( ?\DateTimeImmutable $fixed = null ) {
		$this->fixed = $fixed;
	}

	/**
	 * Current UTC time.
	 */
	public function now(): \DateTimeImmutable {
		return $this->fixed ?? new \DateTimeImmutable( 'now', new \DateTimeZone( 'UTC' ) );
	}

	/**
	 * UTC timestamp formatted for DATETIME columns.
	 */
	public function mysql(): string {
		return $this->now()->format( 'Y-m-d H:i:s' );
	}

	/**
	 * Today's date in a given timezone (business local date).
	 */
	public function today( string $timezone = 'UTC' ): string {
		try {
			$tz = new \DateTimeZone( $timezone );
		} catch ( \Exception $e ) {
			$tz = new \DateTimeZone( 'UTC' );
		}
		return $this->now()->setTimezone( $tz )->format( 'Y-m-d' );
	}

	public function set( \DateTimeImmutable $time ): void {
		$this->fixed = $time;
	}
}
