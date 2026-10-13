<?php
/**
 * PSR-4 autoloader for the Goriber Hisab namespace (no Composer required).
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

spl_autoload_register(
	static function ( string $class ): void {
		if ( ! str_starts_with( $class, 'GoriberHisab\\' ) ) {
			return;
		}
		$relative = substr( $class, strlen( 'GoriberHisab\\' ) );
		$file     = __DIR__ . '/' . str_replace( '\\', '/', $relative ) . '.php';
		if ( is_file( $file ) ) {
			require_once $file;
			return;
		}
		// Exception classes share one file.
		if ( str_starts_with( $relative, 'Support\\' ) && str_ends_with( $relative, 'Exception' ) ) {
			require_once __DIR__ . '/Support/Exceptions.php';
		}
	}
);
