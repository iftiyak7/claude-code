<?php
/**
 * Hosted shops (SaaS): the site owner opens shops for clients and collects
 * monthly / yearly subscription payments.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Platform;

use GoriberHisab\Database\Database;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Support\Events;
use GoriberHisab\Support\NotFoundException;
use GoriberHisab\Support\PermissionException;
use GoriberHisab\Support\Service;
use GoriberHisab\Support\Text;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tenancy\BusinessContext;
use GoriberHisab\Tenancy\BusinessService;
use GoriberHisab\Tenancy\UserDirectory;

/**
 * A shop opened from the platform panel has a `paid_until` date. Shops the
 * site owner creates through the normal setup wizard have none and never
 * expire. When `paid_until` + grace days has passed, ContextFactory refuses
 * every request except the renewal screen.
 *
 * Payments are recorded manually (bKash / Nagad / bank / cash): either the
 * owner records one directly, or the client submits a renewal request with
 * the transaction id and the owner approves it.
 */
final class PlatformService extends Service {

	public const CYCLES = array(
		'monthly' => 1,
		'yearly'  => 12,
	);

	private BusinessService $businesses;
	private UserDirectory $users;

	/**
	 * @var callable():array<string,mixed>
	 */
	private $load;

	/**
	 * @var callable(array<string,mixed>):void
	 */
	private $save;

	/**
	 * @param callable():array<string,mixed>        $load Reads the stored config.
	 * @param callable(array<string,mixed>):void     $save Stores the config.
	 */
	public function __construct( Database $db, Clock $clock, Events $events, BusinessService $businesses, UserDirectory $users, callable $load, callable $save ) {
		parent::__construct( $db, $clock, $events );
		$this->businesses = $businesses;
		$this->users      = $users;
		$this->load       = $load;
		$this->save       = $save;
	}

	/* ------------------------------------------------------------- Config */

	/**
	 * @return array<string,mixed>
	 */
	public function config(): array {
		$stored = ( $this->load )();
		return array_merge(
			array(
				'brand'                => 'Goriber Hisab',
				'monthly_price'        => '300',
				'yearly_price'         => '3000',
				'currency'             => '৳',
				'trial_days'           => 7,
				'grace_days'           => 3,
				'payment_instructions' => '',
				'support_phone'        => '',
				'whatsapp'             => '',
				'landing'              => true,
				'signup'               => true,
				'pay_bkash'            => '',
				'pay_bkash_type'       => 'personal',
				'pay_nagad'            => '',
				'pay_nagad_type'       => 'personal',
				'pay_rocket'           => '',
				'pay_rocket_type'      => 'personal',
				'pay_bank'             => '',
				'ai_key'               => '',
			),
			is_array( $stored ) ? $stored : array()
		);
	}

	/**
	 * @param array<string,mixed> $data Partial config.
	 * @return array<string,mixed>
	 */
	public function saveConfig( array $data ): array {
		$c = $this->config();
		foreach ( array( 'landing', 'signup' ) as $k ) {
			if ( isset( $data[ $k ] ) ) {
				$c[ $k ] = Text::bool( $data[ $k ] );
			}
		}
		foreach ( array( 'bkash', 'nagad', 'rocket' ) as $w ) {
			if ( isset( $data[ 'pay_' . $w ] ) ) {
				$c[ 'pay_' . $w ] = Text::phone( $data[ 'pay_' . $w ] );
			}
			if ( isset( $data[ 'pay_' . $w . '_type' ] ) ) {
				$c[ 'pay_' . $w . '_type' ] = in_array( $data[ 'pay_' . $w . '_type' ], array( 'personal', 'merchant', 'agent' ), true ) ? (string) $data[ 'pay_' . $w . '_type' ] : 'personal';
			}
		}
		if ( isset( $data['pay_bank'] ) ) {
			$c['pay_bank'] = Text::multiline( $data['pay_bank'], 500 );
		}
		// Masked keys come back unchanged from the form: keep the stored one.
		if ( isset( $data['ai_key'] ) && ! str_contains( (string) $data['ai_key'], '•' ) ) {
			$c['ai_key'] = trim( Text::line( $data['ai_key'], 300 ) );
		}
		if ( isset( $data['whatsapp'] ) ) {
			$c['whatsapp'] = Text::phone( $data['whatsapp'] );
		}
		foreach ( array( 'brand', 'currency', 'support_phone' ) as $k ) {
			if ( isset( $data[ $k ] ) ) {
				$c[ $k ] = Text::line( $data[ $k ], 100 );
			}
		}
		foreach ( array( 'monthly_price', 'yearly_price' ) as $k ) {
			if ( isset( $data[ $k ] ) ) {
				$v = Decimal::of( $data[ $k ] );
				if ( $v < 0 ) {
					throw ValidationException::field( $k, 'Price cannot be negative.' );
				}
				$c[ $k ] = Decimal::toString( $v, 2 );
			}
		}
		foreach ( array( 'trial_days', 'grace_days' ) as $k ) {
			if ( isset( $data[ $k ] ) ) {
				$c[ $k ] = max( 0, min( 365, (int) $data[ $k ] ) );
			}
		}
		if ( isset( $data['payment_instructions'] ) ) {
			$c['payment_instructions'] = Text::multiline( $data['payment_instructions'], 2000 );
		}
		( $this->save )( $c );
		return $c;
	}

	/**
	 * What a client sees on the renewal screen.
	 *
	 * @return array<string,mixed>
	 */
	public function publicConfig(): array {
		$c = $this->config();
		return array_intersect_key( $c, array_flip( array( 'brand', 'monthly_price', 'yearly_price', 'currency', 'payment_instructions', 'support_phone', 'whatsapp', 'trial_days', 'pay_bkash', 'pay_bkash_type', 'pay_nagad', 'pay_nagad_type', 'pay_rocket', 'pay_rocket_type', 'pay_bank' ) ) );
	}

	/**
	 * Config for the owner's settings screen: secrets masked.
	 *
	 * @return array<string,mixed>
	 */
	public function adminConfig(): array {
		$c                = $this->config();
		$c['ai_key']      = '' !== $c['ai_key'] ? substr( $c['ai_key'], 0, 7 ) . str_repeat( '•', 10 ) : '';
		$c['ai_enabled']  = '' !== $this->config()['ai_key'];
		unset( $c['landing_content'] );
		return $c;
	}

	/* ------------------------------------------------------- Subscription */

	/**
	 * Subscription state of a business row.
	 *
	 * @param array<string,mixed> $business Business row.
	 * @return array<string,mixed>
	 */
	public function subscription( array $business ): array {
		$until  = (string) ( $business['paid_until'] ?? '' );
		$status = (string) ( $business['status'] ?? 'active' );
		$out    = array(
			'managed'    => '' !== $until,
			'paid_until' => '' !== $until ? $until : null,
			'cycle'      => (string) ( $business['billing_cycle'] ?? '' ),
			'plan'       => (string) ( $business['plan'] ?? '' ),
			'days_left'  => null,
			'status'     => 'unlimited',
		);
		if ( 'suspended' === $status || 'pending' === $status ) {
			$out['status']  = $status;
			$out['managed'] = true;
			return $out;
		}
		if ( '' === $until ) {
			return $out;
		}
		$today            = $this->clock->today( (string) ( $business['timezone'] ?? '' ) ?: 'UTC' );
		$days             = self::daysBetween( $today, $until );
		$out['days_left'] = $days;
		$grace            = (int) $this->config()['grace_days'];
		if ( $days >= 0 ) {
			$out['status'] = 'trial' === $out['plan'] ? 'trial' : 'active';
		} elseif ( -$days <= $grace ) {
			$out['status']     = 'grace';
			$out['grace_left'] = $grace + $days;
		} else {
			$out['status'] = 'expired';
		}
		return $out;
	}

	/**
	 * Whether requests for this business must be refused.
	 *
	 * @param array<string,mixed> $sub Result of subscription().
	 */
	public static function blocked( array $sub ): bool {
		return in_array( $sub['status'], array( 'expired', 'suspended', 'pending' ), true );
	}

	/* -------------------------------------------------------------- Shops */

	/**
	 * Every business, newest first, with owner and subscription.
	 *
	 * @param array<string,mixed> $args search, status (active|expiring|expired|suspended|all), page, per_page.
	 * @return array<string,mixed>
	 */
	public function shops( array $args = array() ): array {
		$where  = array( 'b.deleted_at IS NULL' );
		$params = array();
		$q      = Text::line( $args['search'] ?? '', 100 );
		if ( '' !== $q ) {
			$where[]  = '(b.name LIKE %s OR b.phone LIKE %s OR b.email LIKE %s)';
			$like     = '%' . $this->db->escapeLike( $q ) . '%';
			$params[] = $like;
			$params[] = $like;
			$params[] = $like;
		}
		$rows  = $this->db->rows( $this->select() . ' WHERE ' . implode( ' AND ', $where ) . ' ORDER BY b.id DESC', $params );
		$items = array();
		$want  = (string) ( $args['status'] ?? 'all' );
		foreach ( $rows as $row ) {
			$shop = $this->present( $row );
			$s    = $shop['subscription']['status'];
			$left = $shop['subscription']['days_left'];
			if ( 'all' !== $want && ! (
				( 'expiring' === $want && null !== $left && $left >= 0 && $left <= 7 )
				|| ( 'expired' === $want && in_array( $s, array( 'expired', 'grace' ), true ) )
				|| ( 'active' === $want && in_array( $s, array( 'active', 'trial', 'unlimited' ), true ) )
				|| $want === $s
			) ) {
				continue;
			}
			$items[] = $shop;
		}
		list( $page, $per_page, $offset ) = $this->paging( $args, 500 );
		return $this->paged( array_slice( $items, $offset, $per_page ), count( $items ), $page, $per_page );
	}

	/**
	 * @return array<string,mixed>
	 */
	public function shop( int $business_id ): array {
		$row = $this->db->row( $this->select() . ' WHERE b.id = %d AND b.deleted_at IS NULL', array( $business_id ) );
		if ( null === $row ) {
			throw new NotFoundException( 'Shop not found.' );
		}
		$shop             = $this->present( $row );
		$shop['payments'] = $this->payments( array( 'business_id' => $business_id, 'per_page' => 100 ) )['items'];
		return $shop;
	}

	/**
	 * Open a shop for a client: login (email + password) + business + paid period.
	 *
	 * @param array<string,mixed> $data owner_name, email, phone, password, shop_name, business_type, cycle, trial (bool), paid_amount, method, reference.
	 * @return array<string,mixed>
	 */
	public function openShop( int $admin_id, array $data ): array {
		list( $user_id, $business, $cycle ) = $this->createAccount( $data, true );
		$config = $this->config();
		$row    = $this->businesses->get( $business );
		$today  = $this->clock->today( (string) $row['timezone'] ?: 'UTC' );
		$paid   = Decimal::of( $data['paid_amount'] ?? 0 );
		$this->db->update(
			$this->db->table( 'businesses' ),
			array(
				'plan'          => $paid > 0 ? $cycle : 'trial',
				'billing_cycle' => $cycle,
				'paid_until'    => self::addDays( $today, (int) $config['trial_days'] ),
				'platform_note' => Text::multiline( $data['note'] ?? '', 2000 ),
			),
			array( 'id' => $business )
		);
		if ( $paid > 0 ) {
			// Paid up front: the paid period starts today, replacing the trial.
			$this->db->update( $this->db->table( 'businesses' ), array( 'paid_until' => self::addDays( $today, -1 ) ), array( 'id' => $business ) );
			$this->recordPayment(
				$admin_id,
				$business,
				array(
					'amount'    => $data['paid_amount'],
					'cycle'     => $cycle,
					'method'    => $data['method'] ?? 'cash',
					'reference' => $data['reference'] ?? '',
				)
			);
		}
		$this->events->dispatch( 'goriber_hisab/platform/shop_opened', $business, $user_id );
		return $this->shop( $business );
	}

	/**
	 * Public sign-up: the shop is created "pending" and stays locked until the
	 * site owner approves it (directly, or by approving its first payment).
	 *
	 * @param array<string,mixed> $data owner_name, email, phone, address, password, shop_name, business_type.
	 * @return array{user_id:int,business_id:int}
	 */
	public function signup( array $data ): array {
		if ( empty( $this->config()['signup'] ) ) {
			throw new PermissionException( 'Sign-up is closed. Please contact us.' );
		}
		list( $user_id, $business ) = $this->createAccount( $data, false );
		$this->db->update(
			$this->db->table( 'businesses' ),
			array(
				'status'        => 'pending',
				'plan'          => 'pending',
				'billing_cycle' => 'monthly',
				'paid_until'    => null,
				'platform_note' => 'Signed up online',
			),
			array( 'id' => $business )
		);
		$this->events->dispatch( 'goriber_hisab/platform/signup', $business, $user_id );
		return array(
			'user_id'     => $user_id,
			'business_id' => $business,
		);
	}

	/**
	 * Validate and create the login + business.
	 *
	 * @param array<string,mixed> $data Form.
	 * @return array{0:int,1:int,2:string} user id, business id, cycle.
	 */
	private function createAccount( array $data, bool $by_owner ): array {
		$errors = array();
		$name   = Text::line( $data['owner_name'] ?? '' );
		$email  = Text::email( $data['email'] ?? '' );
		$phone  = Text::phone( $data['phone'] ?? '' );
		$pass   = (string) ( $data['password'] ?? '' );
		$shop   = Text::line( $data['shop_name'] ?? '' );
		$cycle  = (string) ( $data['cycle'] ?? 'monthly' );
		if ( '' === $name ) {
			$errors['owner_name'] = 'Owner name is required.';
		}
		if ( '' === $email ) {
			$errors['email'] = 'A valid email is required.';
		} elseif ( $this->users->findByEmail( $email ) ) {
			$errors['email'] = 'This email already has an account.';
		}
		if ( ! $by_owner && strlen( preg_replace( '/[^0-9]/', '', $phone ) ) < 10 ) {
			$errors['phone'] = 'Enter your mobile number.';
		}
		if ( strlen( $pass ) < 8 ) {
			$errors['password'] = 'Password must be at least 8 characters.';
		}
		if ( '' === $shop ) {
			$errors['shop_name'] = 'Shop name is required.';
		}
		if ( ! isset( self::CYCLES[ $cycle ] ) ) {
			$errors['cycle'] = 'Choose monthly or yearly.';
		}
		$type = (string) ( $data['business_type'] ?? 'retail' );
		if ( ! isset( BusinessService::TYPES[ $type ] ) ) {
			$type = 'retail';
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}
		$user_id  = $this->users->createClient( $email, $name, $pass, $phone );
		$business = $this->businesses->create(
			$user_id,
			array(
				'name'          => $shop,
				'business_type' => $type,
				'phone'         => $phone,
				'email'         => $email,
				'address'       => Text::multiline( $data['address'] ?? '', 500 ),
				'currency_code' => $data['currency_code'] ?? 'BDT',
				'decimals'      => 2,
				'timezone'      => $data['timezone'] ?? 'Asia/Dhaka',
			)
		);
		return array( $user_id, $business, $cycle );
	}

	/**
	 * Change dates, cycle, status or the private note.
	 *
	 * @param array<string,mixed> $data paid_until, cycle, status, note.
	 * @return array<string,mixed>
	 */
	public function updateShop( int $business_id, array $data ): array {
		$this->shop( $business_id );
		$set = array();
		if ( array_key_exists( 'paid_until', $data ) ) {
			$date = Text::date( $data['paid_until'] );
			if ( null === $date && '' !== (string) $data['paid_until'] ) {
				throw ValidationException::field( 'paid_until', 'Invalid date.' );
			}
			$set['paid_until'] = $date;
		}
		$current = $this->db->row( 'SELECT plan, billing_cycle FROM ' . $this->db->table( 'businesses' ) . ' WHERE id = %d', array( $business_id ) );
		if ( isset( $set['paid_until'] ) && 'trial' === ( $current['plan'] ?? '' ) ) {
			// A date set by hand ends the trial.
			$set['plan'] = (string) ( $data['cycle'] ?? $current['billing_cycle'] ) ?: 'monthly';
		}
		if ( isset( $data['cycle'] ) ) {
			if ( ! isset( self::CYCLES[ $data['cycle'] ] ) ) {
				throw ValidationException::field( 'cycle', 'Choose monthly or yearly.' );
			}
			$set['billing_cycle'] = $data['cycle'];
		}
		if ( isset( $data['status'] ) ) {
			if ( ! in_array( $data['status'], array( 'active', 'suspended' ), true ) ) {
				throw ValidationException::field( 'status', 'Invalid status.' );
			}
			$set['status'] = $data['status'];
			$current_row   = $this->db->row( 'SELECT status, paid_until, timezone FROM ' . $this->db->table( 'businesses' ) . ' WHERE id = %d', array( $business_id ) );
			if ( 'active' === $data['status'] && 'pending' === ( $current_row['status'] ?? '' ) && empty( $current_row['paid_until'] ) && ! array_key_exists( 'paid_until', $set ) ) {
				// Approving a sign-up without a payment starts the free trial.
				$set['paid_until'] = self::addDays( $this->clock->today( (string) $current_row['timezone'] ?: 'UTC' ), (int) $this->config()['trial_days'] );
				$set['plan']       = 'trial';
			}
		}
		if ( isset( $data['note'] ) ) {
			$set['platform_note'] = Text::multiline( $data['note'], 2000 );
		}
		if ( $set ) {
			$set['updated_at'] = $this->now();
			$this->db->update( $this->db->table( 'businesses' ), $set, array( 'id' => $business_id ) );
		}
		return $this->shop( $business_id );
	}

	public function resetPassword( int $business_id, string $password ): void {
		if ( strlen( $password ) < 8 ) {
			throw ValidationException::field( 'password', 'Password must be at least 8 characters.' );
		}
		$shop = $this->shop( $business_id );
		$this->users->setPassword( (int) $shop['owner_id'], $password );
	}

	/* ----------------------------------------------------------- Payments */

	/**
	 * Owner received money: record it and extend the shop.
	 *
	 * @param array<string,mixed> $data amount, cycle|months, method, reference, note.
	 * @return array<string,mixed> The payment.
	 */
	public function recordPayment( int $admin_id, int $business_id, array $data ): array {
		$this->shop( $business_id );
		$row = $this->paymentRow( $business_id, $data, 'approved' );
		$id  = $this->db->transaction(
			function () use ( $admin_id, $business_id, $row ) {
				$row['created_by'] = $admin_id;
				$row['updated_by'] = $admin_id;
				$id                = $this->db->insert( $this->db->table( 'subscription_payments' ), $row );
				$this->apply( $admin_id, $id );
				return $id;
			}
		);
		return $this->payment( $id );
	}

	/**
	 * Client sent money (bKash etc.) and asks for renewal.
	 *
	 * @param array<string,mixed> $data cycle, method, reference, payer_phone, note.
	 * @return array<string,mixed>
	 */
	public function requestRenewal( BusinessContext $ctx, array $data ): array {
		if ( 'owner' !== $ctx->role && ! $ctx->can( 'business.manage' ) ) {
			throw new PermissionException( 'Only the shop owner can renew.' );
		}
		if ( '' === Text::line( $data['reference'] ?? '', 100 ) ) {
			throw ValidationException::field( 'reference', 'Enter the transaction ID (TrxID) of your payment.' );
		}
		$pt = $this->db->table( 'subscription_payments' );
		if ( (int) $this->db->value( "SELECT COUNT(*) FROM {$pt} WHERE business_id = %d AND status = 'pending'", array( $ctx->business_id ) ) >= 3 ) {
			throw new ValidationException( array(), 'You already have requests waiting for approval.' );
		}
		$config         = $this->config();
		$cycle          = isset( self::CYCLES[ $data['cycle'] ?? '' ] ) ? (string) $data['cycle'] : 'monthly';
		$data['amount'] = $config[ $cycle . '_price' ];
		$row            = $this->paymentRow( $ctx->business_id, $data, 'pending' );
		$row['created_by'] = $ctx->user_id;
		$row['updated_by'] = $ctx->user_id;
		$id             = $this->db->insert( $pt, $row );
		$this->events->dispatch( 'goriber_hisab/platform/renewal_requested', $id, $ctx->business_id );
		return $this->payment( $id );
	}

	/**
	 * @return array<string,mixed>
	 */
	public function approve( int $admin_id, int $payment_id ): array {
		$p = $this->payment( $payment_id );
		if ( 'pending' !== $p['status'] ) {
			throw new ValidationException( array(), 'This request was already handled.' );
		}
		$this->db->transaction( fn() => $this->apply( $admin_id, $payment_id ) );
		return $this->payment( $payment_id );
	}

	/**
	 * @return array<string,mixed>
	 */
	public function reject( int $admin_id, int $payment_id, string $reason = '' ): array {
		$p = $this->payment( $payment_id );
		if ( 'pending' !== $p['status'] ) {
			throw new ValidationException( array(), 'This request was already handled.' );
		}
		$this->db->update(
			$this->db->table( 'subscription_payments' ),
			array(
				'status'     => 'rejected',
				'note'       => trim( $p['note'] . "\n" . Text::multiline( $reason, 500 ) ),
				'decided_by' => $admin_id,
				'decided_at' => $this->now(),
				'updated_at' => $this->now(),
			),
			array( 'id' => $payment_id )
		);
		return $this->payment( $payment_id );
	}

	/**
	 * @param array<string,mixed> $args business_id, status, page, per_page.
	 * @return array<string,mixed>
	 */
	public function payments( array $args = array() ): array {
		$pt     = $this->db->table( 'subscription_payments' );
		$bt     = $this->db->table( 'businesses' );
		$where  = array( '1=1' );
		$params = array();
		if ( ! empty( $args['business_id'] ) ) {
			$where[]  = 'p.business_id = %d';
			$params[] = (int) $args['business_id'];
		}
		if ( ! empty( $args['status'] ) && 'all' !== $args['status'] ) {
			$where[]  = 'p.status = %s';
			$params[] = (string) $args['status'];
		}
		list( $page, $per_page, $offset ) = $this->paging( $args );
		$w     = implode( ' AND ', $where );
		$total = (int) $this->db->value( "SELECT COUNT(*) FROM {$pt} p WHERE {$w}", $params );
		$rows  = $this->db->rows( "SELECT p.*, b.name AS shop_name FROM {$pt} p LEFT JOIN {$bt} b ON b.id = p.business_id WHERE {$w} ORDER BY p.id DESC LIMIT %d OFFSET %d", array_merge( $params, array( $per_page, $offset ) ) );
		$sum   = (string) $this->db->value( "SELECT COALESCE(SUM(p.amount),0) FROM {$pt} p WHERE {$w} AND p.status = 'approved'", $params );
		$out   = $this->paged( array_map( array( $this, 'presentPayment' ), $rows ), $total, $page, $per_page );
		$out['collected'] = Decimal::toString( Decimal::of( $sum ), 2 );
		return $out;
	}

	/**
	 * Payments of the caller's own business (client view).
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public function ownPayments( BusinessContext $ctx ): array {
		return $this->payments( array( 'business_id' => $ctx->business_id, 'per_page' => 50 ) )['items'];
	}

	/**
	 * Headline numbers for the platform dashboard.
	 *
	 * @return array<string,mixed>
	 */
	public function stats(): array {
		$counts = array(
			'shops'     => 0,
			'active'    => 0,
			'trial'     => 0,
			'expiring'  => 0,
			'expired'   => 0,
			'suspended' => 0,
			'signups'   => 0,
		);
		foreach ( $this->shops( array( 'per_page' => 500 ) )['items'] as $s ) {
			if ( ! $s['subscription']['managed'] && 'suspended' !== $s['subscription']['status'] ) {
				continue;
			}
			++$counts['shops'];
			$st = $s['subscription']['status'];
			if ( 'grace' === $st ) {
				$st = 'expired';
			}
			if ( 'pending' === $st ) {
				$st = 'signups';
			}
			if ( isset( $counts[ $st ] ) ) {
				++$counts[ $st ];
			}
			$left = $s['subscription']['days_left'];
			if ( null !== $left && $left >= 0 && $left <= 7 ) {
				++$counts['expiring'];
			}
		}
		$pt    = $this->db->table( 'subscription_payments' );
		$month = substr( $this->clock->today( 'Asia/Dhaka' ), 0, 7 );
		return $counts + array(
			'pending'          => (int) $this->db->value( "SELECT COUNT(*) FROM {$pt} WHERE status = 'pending'" ),
			'collected_month'  => Decimal::toString( Decimal::of( (string) $this->db->value( "SELECT COALESCE(SUM(amount),0) FROM {$pt} WHERE status = 'approved' AND decided_at >= %s", array( $month . '-01 00:00:00' ) ) ), 2 ),
			'collected_total'  => Decimal::toString( Decimal::of( (string) $this->db->value( "SELECT COALESCE(SUM(amount),0) FROM {$pt} WHERE status = 'approved'" ) ), 2 ),
		);
	}

	/* ------------------------------------------------------------ Helpers */

	/**
	 * Business rows with activity and payment aggregates.
	 */
	private function select(): string {
		$bt = $this->db->table( 'businesses' );
		$mt = $this->db->table( 'business_users' );
		$pt = $this->db->table( 'subscription_payments' );
		return "SELECT b.*,
				(SELECT MAX(m.last_seen_at) FROM {$mt} m WHERE m.business_id = b.id) AS last_seen_at,
				(SELECT COUNT(*) FROM {$mt} m WHERE m.business_id = b.id AND m.status = 'active') AS users,
				(SELECT COUNT(*) FROM {$pt} p WHERE p.business_id = b.id AND p.status = 'pending') AS pending,
				(SELECT COALESCE(SUM(p.amount),0) FROM {$pt} p WHERE p.business_id = b.id AND p.status = 'approved') AS collected
			FROM {$bt} b";
	}

	/**
	 * Mark a payment approved and push the shop's paid_until forward.
	 */
	private function apply( int $admin_id, int $payment_id ): void {
		$p     = $this->payment( $payment_id );
		$bt    = $this->db->table( 'businesses' );
		$row   = $this->db->row( "SELECT * FROM {$bt} WHERE id = %d", array( $p['business_id'] ) );
		$today = $this->clock->today( (string) ( $row['timezone'] ?? '' ) ?: 'UTC' );
		$until = (string) ( $row['paid_until'] ?? '' );
		// Renewing early keeps the remaining days; renewing late starts today.
		$from = '' !== $until && $until >= $today ? self::addDays( $until, 1 ) : $today;
		$to   = self::addDays( self::addMonths( $from, (int) $p['months'] ), -1 );
		$this->db->update(
			$bt,
			array(
				'paid_until'    => $to,
				'plan'          => $p['cycle'],
				'billing_cycle' => $p['cycle'],
				'status'        => 'pending' === ( $row['status'] ?? '' ) ? 'active' : $row['status'],
				'updated_at'    => $this->now(),
			),
			array( 'id' => $p['business_id'] )
		);
		$this->db->update(
			$this->db->table( 'subscription_payments' ),
			array(
				'status'      => 'approved',
				'period_from' => $from,
				'period_to'   => $to,
				'decided_by'  => $admin_id,
				'decided_at'  => $this->now(),
				'updated_at'  => $this->now(),
			),
			array( 'id' => $payment_id )
		);
		$this->events->dispatch( 'goriber_hisab/platform/payment_approved', $payment_id, (int) $p['business_id'] );
	}

	/**
	 * @param array<string,mixed> $data Raw.
	 * @return array<string,mixed>
	 */
	private function paymentRow( int $business_id, array $data, string $status ): array {
		$cycle  = isset( self::CYCLES[ $data['cycle'] ?? '' ] ) ? (string) $data['cycle'] : 'monthly';
		$months = isset( $data['months'] ) && (int) $data['months'] > 0 ? min( 60, (int) $data['months'] ) : self::CYCLES[ $cycle ];
		$amount = Decimal::of( $data['amount'] ?? 0 );
		if ( $amount < 0 ) {
			throw ValidationException::field( 'amount', 'Amount cannot be negative.' );
		}
		return array(
			'business_id' => $business_id,
			'amount'      => Decimal::toString( $amount ),
			'cycle'       => $cycle,
			'months'      => $months,
			'method'      => Text::line( $data['method'] ?? 'cash', 40 ) ?: 'cash',
			'reference'   => Text::line( $data['reference'] ?? '', 100 ),
			'payer_phone' => Text::phone( $data['payer_phone'] ?? '' ),
			'note'        => Text::multiline( $data['note'] ?? '', 1000 ),
			'status'      => $status,
			'created_at'  => $this->now(),
			'updated_at'  => $this->now(),
		);
	}

	/**
	 * @return array<string,mixed>
	 */
	private function payment( int $id ): array {
		$pt  = $this->db->table( 'subscription_payments' );
		$bt  = $this->db->table( 'businesses' );
		$row = $this->db->row( "SELECT p.*, b.name AS shop_name FROM {$pt} p LEFT JOIN {$bt} b ON b.id = p.business_id WHERE p.id = %d", array( $id ) );
		if ( null === $row ) {
			throw new NotFoundException( 'Payment not found.' );
		}
		return $this->presentPayment( $row );
	}

	/**
	 * @param array<string,mixed> $row Row.
	 * @return array<string,mixed>
	 */
	private function presentPayment( array $row ): array {
		$row['id']          = (int) $row['id'];
		$row['business_id'] = (int) $row['business_id'];
		$row['months']      = (int) $row['months'];
		$row['amount']      = Decimal::toString( Decimal::of( $row['amount'] ), 2 );
		return $row;
	}

	/**
	 * @param array<string,mixed> $row Business row (+ aggregates).
	 * @return array<string,mixed>
	 */
	private function present( array $row ): array {
		$owner = $this->users->get( (int) $row['owner_id'] );
		return array(
			'id'           => (int) $row['id'],
			'name'         => (string) $row['name'],
			'phone'        => (string) $row['phone'],
			'email'        => (string) $row['email'],
			'business_type' => (string) $row['business_type'],
			'status'       => (string) $row['status'],
			'owner_id'     => (int) $row['owner_id'],
			'owner'        => $owner ? array( 'name' => $owner['name'], 'email' => $owner['email'], 'login' => $owner['login'] ) : null,
			'created_at'   => (string) $row['created_at'],
			'last_seen_at' => $row['last_seen_at'] ?? null,
			'users'        => (int) ( $row['users'] ?? 0 ),
			'pending'      => (int) ( $row['pending'] ?? 0 ),
			'collected'    => Decimal::toString( Decimal::of( $row['collected'] ?? 0 ), 2 ),
			'note'         => (string) ( $row['platform_note'] ?? '' ),
			'subscription' => $this->subscription( $row ),
		);
	}

	public static function addDays( string $date, int $days ): string {
		return ( new \DateTimeImmutable( $date . ' 00:00:00', new \DateTimeZone( 'UTC' ) ) )->modify( sprintf( '%+d days', $days ) )->format( 'Y-m-d' );
	}

	/**
	 * Calendar months, clamped to month end (Jan 31 + 1 month = Feb 28/29).
	 */
	public static function addMonths( string $date, int $months ): string {
		$d    = new \DateTimeImmutable( $date . ' 00:00:00', new \DateTimeZone( 'UTC' ) );
		$day  = (int) $d->format( 'j' );
		$first = $d->modify( 'first day of this month' )->modify( sprintf( '%+d months', $months ) );
		$last  = (int) $first->format( 't' );
		return $first->setDate( (int) $first->format( 'Y' ), (int) $first->format( 'n' ), min( $day, $last ) )->format( 'Y-m-d' );
	}

	private static function daysBetween( string $from, string $to ): int {
		$a = new \DateTimeImmutable( $from . ' 00:00:00', new \DateTimeZone( 'UTC' ) );
		$b = new \DateTimeImmutable( $to . ' 00:00:00', new \DateTimeZone( 'UTC' ) );
		return (int) $a->diff( $b )->format( '%r%a' );
	}
}
