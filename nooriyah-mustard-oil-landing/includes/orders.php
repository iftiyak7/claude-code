<?php
/**
 * Order storage (custom post type), AJAX submission, email and WooCommerce sync.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function nmo_order_statuses() {
	return array(
		'new'       => 'নতুন',
		'confirmed' => 'কনফার্মড',
		'shipped'   => 'পাঠানো হয়েছে',
		'delivered' => 'ডেলিভারড',
		'cancelled' => 'বাতিল',
	);
}

function nmo_register_order_cpt() {
	register_post_type( 'nmo_order', array(
		'labels'          => array(
			'name'          => 'Landing Orders',
			'singular_name' => 'Order',
			'menu_name'     => 'অর্ডারসমূহ',
			'all_items'     => 'অর্ডারসমূহ',
			'edit_item'     => 'অর্ডার দেখুন',
			'search_items'  => 'অর্ডার খুঁজুন',
			'not_found'     => 'কোনো অর্ডার নেই',
		),
		'public'          => false,
		'show_ui'         => true,
		'show_in_menu'    => 'nmo-settings',
		'supports'        => array( 'title' ),
		'capability_type' => 'post',
		'capabilities'    => array( 'create_posts' => 'do_not_allow' ),
		'map_meta_cap'    => true,
	) );
}
add_action( 'init', 'nmo_register_order_cpt' );

/* ---------- Admin list & detail ---------- */

add_filter( 'manage_nmo_order_posts_columns', function () {
	return array(
		'cb'         => '<input type="checkbox">',
		'title'      => 'অর্ডার',
		'nmo_phone'  => 'ফোন',
		'nmo_pkg'    => 'প্যাকেজ',
		'nmo_total'  => 'মোট',
		'nmo_status' => 'স্ট্যাটাস',
		'date'       => 'তারিখ',
	);
} );

add_action( 'manage_nmo_order_posts_custom_column', function ( $col, $id ) {
	switch ( $col ) {
		case 'nmo_phone':
			$p = get_post_meta( $id, '_nmo_phone', true );
			echo '<a href="tel:' . esc_attr( $p ) . '">' . esc_html( $p ) . '</a>';
			break;
		case 'nmo_pkg':
			echo esc_html( get_post_meta( $id, '_nmo_package', true ) . ' × ' . get_post_meta( $id, '_nmo_qty', true ) );
			break;
		case 'nmo_total':
			echo esc_html( nmo_price( get_post_meta( $id, '_nmo_total', true ) ) );
			break;
		case 'nmo_status':
			$s   = get_post_meta( $id, '_nmo_status', true );
			$all = nmo_order_statuses();
			echo '<span class="nmo-status nmo-status-' . esc_attr( $s ) . '">' . esc_html( isset( $all[ $s ] ) ? $all[ $s ] : $s ) . '</span>';
			break;
	}
}, 10, 2 );

add_action( 'add_meta_boxes_nmo_order', function () {
	add_meta_box( 'nmo_order_details', 'অর্ডারের বিস্তারিত', 'nmo_order_metabox', 'nmo_order', 'normal', 'high' );
} );

function nmo_order_metabox( $post ) {
	wp_nonce_field( 'nmo_order_status', 'nmo_order_nonce' );
	$m    = function ( $k ) use ( $post ) {
		return get_post_meta( $post->ID, '_nmo_' . $k, true );
	};
	$rows = array(
		'নাম'            => $m( 'name' ),
		'ফোন'            => $m( 'phone' ),
		'ঠিকানা'         => $m( 'address' ),
		'ডেলিভারি এরিয়া' => $m( 'zone' ),
		'প্যাকেজ'        => $m( 'package' ) . ' (' . $m( 'weight' ) . ')',
		'পরিমাণ'         => $m( 'qty' ),
		'সাবটোটাল'       => nmo_price( $m( 'subtotal' ) ),
		'ডেলিভারি চার্জ'  => nmo_price( $m( 'shipping' ) ),
		'মোট'            => nmo_price( $m( 'total' ) ),
		'নোট'            => $m( 'note' ),
		'IP'             => $m( 'ip' ),
	);
	echo '<table class="widefat striped"><tbody>';
	foreach ( $rows as $label => $val ) {
		echo '<tr><th style="width:160px">' . esc_html( $label ) . '</th><td>' . nl2br( esc_html( $val ) ) . '</td></tr>';
	}
	$wc = (int) $m( 'wc_order' );
	if ( $wc ) {
		echo '<tr><th>WooCommerce</th><td><a href="' . esc_url( admin_url( 'post.php?post=' . $wc . '&action=edit' ) ) . '">#' . (int) $wc . ' দেখুন</a></td></tr>';
	}
	echo '</tbody></table><p><label><b>স্ট্যাটাস:</b> <select name="nmo_status">';
	foreach ( nmo_order_statuses() as $k => $label ) {
		echo '<option value="' . esc_attr( $k ) . '" ' . selected( $m( 'status' ), $k, false ) . '>' . esc_html( $label ) . '</option>';
	}
	echo '</select></label> — পরিবর্তনের পর “Update” চাপুন।</p>';
}

add_action( 'save_post_nmo_order', function ( $post_id ) {
	if ( ! isset( $_POST['nmo_order_nonce'] ) || ! wp_verify_nonce( sanitize_key( $_POST['nmo_order_nonce'] ), 'nmo_order_status' ) ) {
		return;
	}
	if ( ! current_user_can( 'edit_post', $post_id ) || ! isset( $_POST['nmo_status'] ) ) {
		return;
	}
	$s = sanitize_key( $_POST['nmo_status'] );
	if ( isset( nmo_order_statuses()[ $s ] ) ) {
		update_post_meta( $post_id, '_nmo_status', $s );
	}
} );

add_action( 'admin_head', function () {
	$screen = get_current_screen();
	if ( $screen && 'nmo_order' === $screen->post_type ) {
		echo '<style>.nmo-status{padding:3px 8px;border-radius:10px;background:#eee;font-weight:600}.nmo-status-new{background:#fff3cd;color:#8a6d00}.nmo-status-confirmed{background:#d1ecf1;color:#0c5460}.nmo-status-shipped{background:#e2e3ff;color:#383d9e}.nmo-status-delivered{background:#d4edda;color:#155724}.nmo-status-cancelled{background:#f8d7da;color:#721c24}</style>';
	}
} );

/* ---------- Public order submission ---------- */

add_action( 'wp_ajax_nmo_order', 'nmo_handle_order' );
add_action( 'wp_ajax_nopriv_nmo_order', 'nmo_handle_order' );

/**
 * No nonce on purpose: landing pages are usually served from a full-page
 * cache, where a cached nonce expires and silently breaks orders. Abuse is
 * limited with a honeypot, a timing check and a per-IP rate limit instead.
 */
function nmo_handle_order() {
	$req = wp_unslash( $_POST );

	if ( ! empty( $req['website'] ) ) { // Honeypot.
		wp_send_json_error( array( 'message' => 'Invalid request.' ), 400 );
	}
	$started = isset( $req['ts'] ) ? (int) $req['ts'] : 0;
	if ( $started && ( time() * 1000 - $started ) < 2500 ) {
		wp_send_json_error( array( 'message' => 'অনুগ্রহ করে আবার চেষ্টা করুন।' ), 400 );
	}

	$ip       = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	$rate_key = 'nmo_rl_' . md5( $ip );
	$hits     = (int) get_transient( $rate_key );
	if ( $hits >= 5 ) {
		wp_send_json_error( array( 'message' => 'অল্প সময়ে অনেকগুলো অর্ডার এসেছে। কিছুক্ষণ পর চেষ্টা করুন অথবা আমাদের কল করুন।' ), 429 );
	}

	$name    = sanitize_text_field( isset( $req['name'] ) ? $req['name'] : '' );
	$phone   = nmo_normalize_phone( isset( $req['phone'] ) ? $req['phone'] : '' );
	$address = sanitize_textarea_field( isset( $req['address'] ) ? $req['address'] : '' );
	$note    = sanitize_textarea_field( isset( $req['note'] ) ? $req['note'] : '' );
	$qty     = max( 1, min( 50, absint( isset( $req['qty'] ) ? $req['qty'] : 1 ) ) );
	$pkg_id  = absint( isset( $req['package'] ) ? $req['package'] : 0 );
	$zone_id = absint( isset( $req['zone'] ) ? $req['zone'] : 0 );

	$errors = array();
	if ( mb_strlen( $name ) < 2 ) {
		$errors['name'] = 'আপনার নাম লিখুন';
	}
	if ( ! $phone ) {
		$errors['phone'] = 'সঠিক ১১ ডিজিটের মোবাইল নম্বর লিখুন';
	}
	if ( mb_strlen( $address ) < 8 ) {
		$errors['address'] = 'সম্পূর্ণ ঠিকানা লিখুন (বাসা, রোড, থানা, জেলা)';
	}

	$pkg = null;
	foreach ( nmo_packages() as $p ) {
		if ( $p['id'] === $pkg_id ) {
			$pkg = $p;
		}
	}
	$zone = null;
	foreach ( nmo_zones() as $z ) {
		if ( $z['id'] === $zone_id ) {
			$zone = $z;
		}
	}
	if ( ! $pkg ) {
		$errors['package'] = 'একটি প্যাকেজ বাছাই করুন';
	}
	if ( ! $zone ) {
		$errors['zone'] = 'ডেলিভারি এরিয়া বাছাই করুন';
	}
	if ( $errors ) {
		wp_send_json_error( array( 'message' => 'অনুগ্রহ করে লাল চিহ্নিত ঘরগুলো ঠিক করুন।', 'fields' => $errors ), 422 );
	}

	// Prices always come from the server-side settings, never from the browser.
	$subtotal  = $pkg['price'] * $qty;
	$free_from = (float) nmo_get( 'free_ship_from' );
	$shipping  = ( $free_from > 0 && $subtotal >= $free_from ) ? 0 : $zone['charge'];
	$total     = $subtotal + $shipping;

	$order_id = wp_insert_post( array(
		'post_type'   => 'nmo_order',
		'post_status' => 'publish',
		'post_title'  => $name . ' — ' . $phone,
	), true );
	if ( is_wp_error( $order_id ) ) {
		wp_send_json_error( array( 'message' => 'অর্ডার সেভ করা যায়নি। অনুগ্রহ করে আমাদের কল করুন।' ), 500 );
	}

	$meta = array(
		'name'     => $name,
		'phone'    => $phone,
		'address'  => $address,
		'note'     => $note,
		'zone'     => $zone['name'],
		'package'  => $pkg['name'],
		'weight'   => $pkg['weight'],
		'qty'      => $qty,
		'subtotal' => $subtotal,
		'shipping' => $shipping,
		'total'    => $total,
		'status'   => 'new',
		'ip'       => $ip,
		'wc_product' => $pkg['wc'],
	);
	foreach ( $meta as $k => $v ) {
		update_post_meta( $order_id, '_nmo_' . $k, $v );
	}
	set_transient( $rate_key, $hits + 1, 10 * MINUTE_IN_SECONDS );

	$wc_id = nmo_create_wc_order( $meta );
	if ( $wc_id ) {
		update_post_meta( $order_id, '_nmo_wc_order', $wc_id );
	}

	nmo_notify_admin( $order_id, $meta );

	wp_send_json_success( array(
		'order'    => $wc_id ? $wc_id : $order_id,
		'total'    => $total,
		'redirect' => esc_url_raw( nmo_get( 'thankyou_url' ) ),
	) );
}

/**
 * Mirror a landing order into WooCommerce (Cash on Delivery).
 * Linked to the real product when the package has a WooCommerce product ID,
 * otherwise added as a named line item so the order still appears there.
 */
function nmo_create_wc_order( $meta ) {
	if ( ! nmo_get( 'wc_orders' ) || ! function_exists( 'wc_create_order' ) ) {
		return 0;
	}
	$qty      = max( 1, (int) $meta['qty'] );
	$subtotal = (float) $meta['subtotal'];
	$name     = trim( $meta['package'] . ( $meta['weight'] ? ' (' . $meta['weight'] . ')' : '' ) );
	$product  = ! empty( $meta['wc_product'] ) ? wc_get_product( (int) $meta['wc_product'] ) : null;

	try {
		$order = wc_create_order( array( 'created_via' => 'nmo-landing' ) );
		if ( $product ) {
			$order->add_product( $product, $qty, array(
				'subtotal' => $subtotal,
				'total'    => $subtotal,
			) );
		} else {
			$item = new WC_Order_Item_Product();
			$item->set_name( $name );
			$item->set_quantity( $qty );
			$item->set_subtotal( $subtotal );
			$item->set_total( $subtotal );
			$order->add_item( $item );
		}

		$address = array(
			'first_name' => $meta['name'],
			'phone'      => $meta['phone'],
			'address_1'  => $meta['address'],
			'city'       => $meta['zone'],
			'country'    => 'BD',
		);
		$order->set_address( $address, 'billing' );
		$order->set_address( $address, 'shipping' );

		$ship = new WC_Order_Item_Shipping();
		$ship->set_method_title( 'ডেলিভারি: ' . $meta['zone'] );
		$ship->set_method_id( 'flat_rate' );
		$ship->set_total( (float) $meta['shipping'] );
		$order->add_item( $ship );

		$order->set_payment_method( 'cod' );
		$order->set_payment_method_title( 'Cash on Delivery' );
		if ( ! empty( $meta['note'] ) ) {
			$order->set_customer_note( $meta['note'] );
		}
		$order->calculate_totals( false );
		$order->update_status( 'processing', 'Landing page order.' );
		return $order->get_id();
	} catch ( Exception $e ) {
		return 0;
	}
}

/* ---------- Send existing landing orders to WooCommerce ---------- */

add_filter( 'bulk_actions-edit-nmo_order', function ( $actions ) {
	if ( function_exists( 'wc_create_order' ) ) {
		$actions['nmo_to_wc'] = 'WooCommerce এ পাঠান';
	}
	return $actions;
} );

add_filter( 'handle_bulk_actions-edit-nmo_order', function ( $redirect, $action, $ids ) {
	if ( 'nmo_to_wc' !== $action || ! current_user_can( 'edit_posts' ) ) {
		return $redirect;
	}
	$sent = 0;
	foreach ( $ids as $id ) {
		if ( get_post_meta( $id, '_nmo_wc_order', true ) ) {
			continue; // Already in WooCommerce.
		}
		$meta = array();
		foreach ( array( 'name', 'phone', 'address', 'note', 'zone', 'package', 'weight', 'qty', 'subtotal', 'shipping', 'wc_product' ) as $k ) {
			$meta[ $k ] = get_post_meta( $id, '_nmo_' . $k, true );
		}
		if ( ! $meta['wc_product'] ) {
			foreach ( nmo_packages() as $p ) {
				if ( $p['name'] === $meta['package'] ) {
					$meta['wc_product'] = $p['wc'];
				}
			}
		}
		$wc_id = nmo_create_wc_order( $meta );
		if ( $wc_id ) {
			update_post_meta( $id, '_nmo_wc_order', $wc_id );
			$sent++;
		}
	}
	return add_query_arg( 'nmo_wc_sent', $sent, $redirect );
}, 10, 3 );

add_action( 'admin_notices', function () {
	if ( isset( $_GET['nmo_wc_sent'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
		printf( '<div class="notice notice-success is-dismissible"><p>%d টি অর্ডার WooCommerce এ পাঠানো হয়েছে। (আগে থেকে পাঠানো অর্ডার আবার পাঠানো হয় না।)</p></div>', absint( $_GET['nmo_wc_sent'] ) ); // phpcs:ignore WordPress.Security.NonceVerification
	}
} );

function nmo_notify_admin( $order_id, $meta ) {
	$to = nmo_get( 'notify_email' );
	$to = is_email( $to ) ? $to : get_option( 'admin_email' );

	$body  = "নতুন অর্ডার #{$order_id}\n\n";
	$body .= "নাম: {$meta['name']}\nফোন: {$meta['phone']}\nঠিকানা: {$meta['address']}\nএরিয়া: {$meta['zone']}\n";
	$body .= "প্যাকেজ: {$meta['package']} ({$meta['weight']}) × {$meta['qty']}\n";
	$body .= 'মোট: ' . nmo_price( $meta['total'] ) . ' (ডেলিভারি ' . nmo_price( $meta['shipping'] ) . ")\n";
	if ( $meta['note'] ) {
		$body .= "নোট: {$meta['note']}\n";
	}
	$body .= "\n" . admin_url( 'post.php?post=' . $order_id . '&action=edit' );

	wp_mail( $to, '🛒 নতুন অর্ডার: ' . $meta['name'] . ' — ' . nmo_price( $meta['total'] ), $body );
}
