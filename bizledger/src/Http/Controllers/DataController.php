<?php
/**
 * Import, export, backup and uploads.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Http\Controllers;

use BizLedger\Data\DataService;
use BizLedger\Support\PermissionException;
use BizLedger\Support\ValidationException;
use BizLedger\Tenancy\BusinessContext;

/**
 * Data routes.
 */
final class DataController extends Controller {

	/**
	 * Allowed upload types (extension => mime).
	 */
	private const MIMES = array(
		'jpg|jpeg' => 'image/jpeg',
		'png'      => 'image/png',
		'webp'     => 'image/webp',
		'pdf'      => 'application/pdf',
	);

	public function routes(): array {
		return array(
			$this->route( 'GET', '/export/(?P<type>[a-z]+)', fn( BusinessContext $c, array $a, $r ) => $this->k->data->export( $c, (string) $r->get_param( 'type' ), $a ) ),
			$this->route( 'GET', '/import/templates', fn() => DataService::templates() ),
			$this->route( 'POST', '/import/(?P<type>[a-z]+)', fn( BusinessContext $c, array $a, $r ) => $this->k->data->import( $c, (string) $r->get_param( 'type' ), (array) ( $a['rows'] ?? array() ), ! empty( $a['dry_run'] ) ) ),
			$this->route( 'GET', '/backup', array( $this, 'backup' ) ),
			$this->route( 'POST', '/uploads', array( $this, 'upload' ), array( 'created' => true ) ),
		);
	}

	public function backup( BusinessContext $ctx ): \WP_REST_Response {
		$data     = $this->k->data->backup( $ctx );
		$response = new \WP_REST_Response( $data );
		$response->header( 'Content-Disposition', 'attachment; filename="bizledger-backup-' . $ctx->business_id . '-' . gmdate( 'Ymd-His' ) . '.json"' );
		return $response;
	}

	/**
	 * Secure upload for logos, receipts and product images.
	 *
	 * Staff often don't have the WordPress upload_files capability, so the
	 * check is a BizLedger permission instead; the file itself is validated
	 * by extension, real MIME type and size.
	 *
	 * @param array<string,mixed> $args purpose (logo|receipt|product).
	 * @return array<string,mixed>
	 */
	public function upload( BusinessContext $ctx, array $args, \WP_REST_Request $request ): array {
		$purpose = (string) ( $args['purpose'] ?? 'receipt' );
		$needed  = array(
			'logo'    => 'business.manage',
			'product' => 'products.edit',
			'receipt' => 'expenses.create',
		)[ $purpose ] ?? null;
		if ( null === $needed || ( ! $ctx->can( $needed ) && ! ( 'receipt' === $purpose && $ctx->can( 'purchases.create' ) ) && ! ( 'product' === $purpose && $ctx->can( 'products.create' ) ) ) ) {
			throw new PermissionException( 'You cannot upload this file.' );
		}
		$files = $request->get_file_params();
		if ( empty( $files['file'] ) || ! is_array( $files['file'] ) ) {
			throw ValidationException::field( 'file', 'Choose a file to upload.' );
		}
		$file = $files['file'];
		$max  = (int) apply_filters( 'bizledger/max_upload_bytes', 5 * MB_IN_BYTES );
		if ( (int) $file['size'] > $max ) {
			throw ValidationException::field( 'file', sprintf( 'File is too large (max %s).', size_format( $max ) ) );
		}
		$check = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'], self::MIMES );
		if ( empty( $check['type'] ) || ( 'logo' === $purpose || 'product' === $purpose ) && ! str_starts_with( (string) $check['type'], 'image/' ) ) {
			throw ValidationException::field( 'file', 'Only JPG, PNG, WebP images or PDF receipts are allowed.' );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		$moved = wp_handle_upload(
			$file,
			array(
				'test_form' => false,
				'mimes'     => self::MIMES,
			)
		);
		if ( isset( $moved['error'] ) ) {
			throw ValidationException::field( 'file', (string) $moved['error'] );
		}
		$attachment = wp_insert_attachment(
			array(
				'post_mime_type' => $moved['type'],
				'post_title'     => sanitize_file_name( pathinfo( $file['name'], PATHINFO_FILENAME ) ),
				'post_status'    => 'private',
				'post_author'    => $ctx->user_id,
			),
			$moved['file']
		);
		if ( is_wp_error( $attachment ) ) {
			throw ValidationException::field( 'file', $attachment->get_error_message() );
		}
		wp_update_attachment_metadata( $attachment, wp_generate_attachment_metadata( $attachment, $moved['file'] ) );
		update_post_meta( $attachment, '_bizledger_business', $ctx->business_id );
		$this->k->audit->log( $ctx, 'upload', 'file', (int) $attachment, 'File uploaded (' . $purpose . ')' );
		return array(
			'id'  => (int) $attachment,
			'url' => (string) wp_get_attachment_url( $attachment ),
		);
	}
}
