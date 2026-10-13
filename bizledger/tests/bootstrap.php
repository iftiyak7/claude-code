<?php
/**
 * Test bootstrap: autoloader, minimal assertion framework, fixtures.
 *
 * Runs without WordPress or PHPUnit: `php tests/run.php`.
 *
 * @package BizLedger
 */

declare(strict_types=1);

require_once dirname( __DIR__ ) . '/src/autoload.php';

spl_autoload_register(
	static function ( string $class ): void {
		if ( str_starts_with( $class, 'BizLedger\\Tests\\' ) ) {
			$file = __DIR__ . '/' . str_replace( '\\', '/', substr( $class, strlen( 'BizLedger\\Tests\\' ) ) ) . '.php';
			if ( is_file( $file ) ) {
				require_once $file;
			}
		}
	}
);
