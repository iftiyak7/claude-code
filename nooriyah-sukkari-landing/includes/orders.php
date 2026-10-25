<?php
/**
 * Order storage (custom post type), AJAX submission, email and WooCommerce sync.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function nsl_order_statuses() {
	return array(
		'new'       => 'নতুন',
		'confirmed' => 'কনফার্মড',
		'shipped'   => 'পাঠানো হয়েছে',
		'delivered' => 'ডেলিভারড',
		'cancelled' => 'বাতিল',
	);
}

function nsl_register_order_cpt() {
	register_post_type( 'nsl_order', array(
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
		'show_in_menu'    => 'nsl-settings',
		'supports'        => array( 'title' ),
		'capability_type' => 'post',
		'capabilities'    => array( 'create_posts' => 'do_not_allow' ),
		'map_meta_cap'    => true,
	) );
}
add_action( 'init', 'nsl_register_order_cpt' );

/* ---------- Admin list & detail ---------- */

add_filter( 'manage_nsl_order_posts_columns', function () {
	return array(
		'cb'         => '<input type="checkbox">',
		'title'      => 'অর্ডার',
		'nsl_phone'  => 'ফোন',
		'nsl_pkg'    => 'প্যাকেজ',
		'nsl_total'  => 'মোট',
		'nsl_status' => 'স্ট্যাটাস',
		'date'       => 'তারিখ',
	);
} );

add_action( 'manage_nsl_order_posts_custom_column', function ( $col, $id ) {
	switch ( $col ) {
		case 'nsl_phone':
			$p = get_post_meta( $id, '_nsl_phone', true );
			echo '<a href="tel:' . esc_attr( $p ) . '">' . esc_html( $p ) . '</a>';
			break;
		case 'nsl_pkg':
			echo esc_html( get_post_meta( $id, '_nsl_package', true ) . ' × ' . get_post_meta( $id, '_nsl_qty', true ) );
			break;
		case 'nsl_total':
			echo esc_html( nsl_price( get_post_meta( $id, '_nsl_total', true ) ) );
			break;
		case 'nsl_status':
			$s   = get_post_meta( $id, '_nsl_status', true );
			$all = nsl_order_statuses();
			echo '<span class="nsl-status nsl-status-' . esc_attr( $s ) . '">' . esc_html( isset( $all[ $s ] ) ? $all[ $s ] : $s ) . '</span>';
			break;
	}
}, 10, 2 );

add_action( 'add_meta_boxes_nsl_order', function () {
	add_meta_box( 'nsl_order_details', 'অর্ডারের বিস্তারিত', 'nsl_order_metabox', 'nsl_order', 'normal', 'high' );
} );

function nsl_order_metabox( $post ) {
	wp_nonce_field( 'nsl_order_status', 'nsl_order_nonce' );
	$m    = function ( $k ) use ( $post ) {
		return get_post_meta( $post->ID, '_nsl_' . $k, true );
	};
	$rows = array(
		'নাম'            => $m( 'name' ),
		'ফোন'            => $m( 'phone' ),
		'ঠিকানা'         => $m( 'address' ),
		'ডেলিভারি এরিয়া' => $m( 'zone' ),
		'প্যাকেজ'        => $m( 'package' ) . ' (' . $m( 'weight' ) . ')',
		'পরিমাণ'         => $m( 'qty' ),
		'সাবটোটাল'       => nsl_price( $m( 'subtotal' ) ),
		'ডেলিভারি চার্জ'  => nsl_price( $m( 'shipping' ) ),
		'মোট'            => nsl_price( $m( 'total' ) ),
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
	echo '</tbody></table><p><label><b>স্ট্যাটাস:</b> <select name="nsl_status">';
	foreach ( nsl_order_statuses() as $k => $label ) {
		echo '<option value="' . esc_attr( $k ) . '" ' . selected( $m( 'status' ), $k, false ) . '>' . esc_html( $label ) . '</option>';
	}
	echo '</select></label> — পরিবর্তনের পর “Update” চাপুন।</p>';
}

add_action( 'save_post_nsl_order', function ( $post_id ) {
	if ( ! isset( $_POST['nsl_order_nonce'] ) || ! wp_verify_nonce( sanitize_key( $_POST['nsl_order_nonce'] ), 'nsl_order_status' ) ) {
		return;
	}
	if ( ! current_user_can( 'edit_post', $post_id ) || ! isset( $_POST['nsl_status'] ) ) {
		return;
	}
	$s = sanitize_key( $_POST['nsl_status'] );
	if ( isset( nsl_order_statuses()[ $s ] ) ) {
		update_post_meta( $post_id, '_nsl_status', $s );
	}
} );

add_action( 'admin_head', function () {
	$screen = get_current_screen();
	if ( $screen && 'nsl_order' === $screen->post_type ) {
		echo '<style>.nsl-status{padding:3px 8px;border-radius:10px;background:#eee;font-weight:600}.nsl-status-new{background:#fff3cd;color:#8a6d00}.nsl-status-confirmed{background:#d1ecf1;color:#0c5460}.nsl-status-shipped{background:#e2e3ff;color:#383d9e}.nsl-status-delivered{background:#d4edda;color:#155724}.nsl-status-cancelled{background:#f8d7da;color:#721c24}</style>';
	}
} );

/* ---------- Public order submission ---------- */

add_action( 'wp_ajax_nsl_order', 'nsl_handle_order' );
add_action( 'wp_ajax_nopriv_nsl_order', 'nsl_handle_order' );

/**
 * No nonce on purpose: landing pages are usually served from a full-page
 * cache, where a cached nonce expires and silently breaks orders. Abuse is
 * limited with a honeypot, a timing check and a per-IP rate limit instead.
 */
function nsl_handle_order() {
	$req = wp_unslash( $_POST );

	if ( ! empty( $req['website'] ) ) { // Honeypot.
		wp_send_json_error( array( 'message' => 'Invalid request.' ), 400 );
	}
	$started = isset( $req['ts'] ) ? (int) $req['ts'] : 0;
	if ( $started && ( time() * 1000 - $started ) < 2500 ) {
		wp_send_json_error( array( 'message' => 'অনুগ্রহ করে আবার চেষ্টা করুন।' ), 400 );
	}

	$ip       = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	$rate_key = 'nsl_rl_' . md5( $ip );
	$hits     = (int) get_transient( $rate_key );
	if ( $hits >= 5 ) {
		wp_send_json_error( array( 'message' => 'অল্প সময়ে অনেকগুলো অর্ডার এসেছে। কিছুক্ষণ পর চেষ্টা করুন অথবা আমাদের কল করুন।' ), 429 );
	}

	$name    = sanitize_text_field( isset( $req['name'] ) ? $req['name'] : '' );
	$phone   = nsl_normalize_phone( isset( $req['phone'] ) ? $req['phone'] : '' );
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
	foreach ( nsl_packages() as $p ) {
		if ( $p['id'] === $pkg_id ) {
			$pkg = $p;
		}
	}
	$zone = null;
	foreach ( nsl_zones() as $z ) {
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
	$free_from = (float) nsl_get( 'free_ship_from' );
	$shipping  = ( $free_from > 0 && $subtotal >= $free_from ) ? 0 : $zone['charge'];
	$total     = $subtotal + $shipping;

	$order_id = wp_insert_post( array(
		'post_type'   => 'nsl_order',
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
	);
	foreach ( $meta as $k => $v ) {
		update_post_meta( $order_id, '_nsl_' . $k, $v );
	}
	set_transient( $rate_key, $hits + 1, 10 * MINUTE_IN_SECONDS );

	$wc_id = nsl_maybe_create_wc_order( $pkg, $qty, $zone, $shipping, $meta );
	if ( $wc_id ) {
		update_post_meta( $order_id, '_nsl_wc_order', $wc_id );
	}

	nsl_notify_admin( $order_id, $meta );

	wp_send_json_success( array(
		'order'    => $wc_id ? $wc_id : $order_id,
		'total'    => $total,
		'redirect' => esc_url_raw( nsl_get( 'thankyou_url' ) ),
	) );
}

function nsl_maybe_create_wc_order( $pkg, $qty, $zone, $shipping, $meta ) {
	if ( ! nsl_get( 'wc_orders' ) || ! $pkg['wc'] || ! function_exists( 'wc_create_order' ) ) {
		return 0;
	}
	$product = wc_get_product( $pkg['wc'] );
	if ( ! $product ) {
		return 0;
	}
	try {
		$order = wc_create_order();
		$order->add_product( $product, $qty, array(
			'subtotal' => $pkg['price'] * $qty,
			'total'    => $pkg['price'] * $qty,
		) );
		$address = array(
			'first_name' => $meta['name'],
			'phone'      => $meta['phone'],
			'address_1'  => $meta['address'],
			'city'       => $zone['name'],
			'country'    => 'BD',
		);
		$order->set_address( $address, 'billing' );
		$order->set_address( $address, 'shipping' );

		$ship = new WC_Order_Item_Shipping();
		$ship->set_method_title( 'ডেলিভারি: ' . $zone['name'] );
		$ship->set_total( $shipping );
		$order->add_item( $ship );

		$order->set_payment_method( 'cod' );
		$order->set_payment_method_title( 'Cash on Delivery' );
		if ( $meta['note'] ) {
			$order->set_customer_note( $meta['note'] );
		}
		$order->calculate_totals( false );
		$order->update_status( 'processing', 'Sukkari landing page order.' );
		return $order->get_id();
	} catch ( Exception $e ) {
		return 0;
	}
}

function nsl_notify_admin( $order_id, $meta ) {
	$to = nsl_get( 'notify_email' );
	$to = is_email( $to ) ? $to : get_option( 'admin_email' );

	$body  = "নতুন অর্ডার #{$order_id}\n\n";
	$body .= "নাম: {$meta['name']}\nফোন: {$meta['phone']}\nঠিকানা: {$meta['address']}\nএরিয়া: {$meta['zone']}\n";
	$body .= "প্যাকেজ: {$meta['package']} ({$meta['weight']}) × {$meta['qty']}\n";
	$body .= 'মোট: ' . nsl_price( $meta['total'] ) . ' (ডেলিভারি ' . nsl_price( $meta['shipping'] ) . ")\n";
	if ( $meta['note'] ) {
		$body .= "নোট: {$meta['note']}\n";
	}
	$body .= "\n" . admin_url( 'post.php?post=' . $order_id . '&action=edit' );

	wp_mail( $to, '🛒 নতুন অর্ডার: ' . $meta['name'] . ' — ' . nsl_price( $meta['total'] ), $body );
}
