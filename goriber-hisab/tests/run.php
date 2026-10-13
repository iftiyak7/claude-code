<?php
/**
 * Dependency-free test runner.
 *
 * Usage: php tests/run.php [filter]
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$filter = $argv[1] ?? '';
$files  = array_merge( glob( __DIR__ . '/Unit/*Test.php' ) ?: array(), glob( __DIR__ . '/Integration/*Test.php' ) ?: array() );
$passed = 0;
$failed = array();
$asserts = 0;
$start  = microtime( true );

foreach ( $files as $file ) {
	require_once $file;
	$group = basename( dirname( $file ) );
	$class = 'GoriberHisab\\Tests\\' . $group . '\\' . basename( $file, '.php' );
	foreach ( get_class_methods( $class ) as $method ) {
		if ( ! str_starts_with( $method, 'test' ) ) {
			continue;
		}
		$name = basename( $file, '.php' ) . '::' . $method;
		if ( '' !== $filter && ! str_contains( $name, $filter ) ) {
			continue;
		}
		$test = new $class();
		try {
			$test->setUp();
			$test->$method();
			++$passed;
			echo '.';
		} catch ( \Throwable $e ) {
			$failed[] = array( $name, $e );
			echo 'F';
		}
		$asserts += $test->assertions;
	}
}

printf( "\n\n%d passed, %d failed, %d assertions (%.2fs)\n", $passed, count( $failed ), $asserts, microtime( true ) - $start );
foreach ( $failed as list( $name, $e ) ) {
	printf( "\n✗ %s\n  %s: %s\n  at %s:%d\n", $name, get_class( $e ), $e->getMessage(), $e->getFile(), $e->getLine() );
	foreach ( array_slice( $e->getTrace(), 0, 4 ) as $t ) {
		printf( "    %s:%s %s()\n", basename( $t['file'] ?? '?' ), $t['line'] ?? '?', $t['function'] );
	}
}
exit( $failed ? 1 : 0 );
