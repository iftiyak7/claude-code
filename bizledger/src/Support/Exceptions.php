<?php
/**
 * Domain exception types.
 *
 * Kept in one file for discoverability; each maps to an HTTP status in the
 * REST layer.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Support;

/**
 * Base class of every exception thrown deliberately by BizLedger.
 */
class BizLedgerException extends \RuntimeException {

	/**
	 * Machine readable error code.
	 *
	 * @var string
	 */
	protected string $error_code = 'bizledger_error';

	/**
	 * HTTP status the REST layer should use.
	 *
	 * @var int
	 */
	protected int $status = 400;

	public function errorCode(): string {
		return $this->error_code;
	}

	public function status(): int {
		return $this->status;
	}

	/**
	 * Extra data for the API response.
	 *
	 * @return array<string,mixed>
	 */
	public function data(): array {
		return array();
	}
}

/**
 * Input failed validation. Carries per-field messages.
 */
class ValidationException extends BizLedgerException {

	protected string $error_code = 'bizledger_validation';
	protected int $status        = 422;

	/**
	 * Field => message.
	 *
	 * @var array<string,string>
	 */
	private array $errors;

	/**
	 * @param array<string,string> $errors  Field errors.
	 * @param string               $message Summary.
	 */
	public function __construct( array $errors, string $message = '' ) {
		$this->errors = $errors;
		parent::__construct( '' !== $message ? $message : ( reset( $errors ) ?: 'Invalid input.' ) );
	}

	/**
	 * Single-field shortcut.
	 */
	public static function field( string $field, string $message ): self {
		return new self( array( $field => $message ), $message );
	}

	/**
	 * @return array<string,string>
	 */
	public function errors(): array {
		return $this->errors;
	}

	public function data(): array {
		return array( 'errors' => $this->errors );
	}
}

/**
 * Requested record does not exist in the current business.
 */
class NotFoundException extends BizLedgerException {
	protected string $error_code = 'bizledger_not_found';
	protected int $status        = 404;
}

/**
 * The current user lacks a permission.
 */
class PermissionException extends BizLedgerException {
	protected string $error_code = 'bizledger_forbidden';
	protected int $status        = 403;
}

/**
 * State conflict (e.g. voiding a sale that has returns).
 */
class ConflictException extends BizLedgerException {
	protected string $error_code = 'bizledger_conflict';
	protected int $status        = 409;
}

/**
 * Too many requests.
 */
class RateLimitException extends BizLedgerException {
	protected string $error_code = 'bizledger_rate_limited';
	protected int $status        = 429;
}

/**
 * Database failure.
 */
class DatabaseException extends BizLedgerException {
	protected string $error_code = 'bizledger_db_error';
	protected int $status        = 500;
}
