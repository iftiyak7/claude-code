<?php
/**
 * Settings page: Dashboard > Sukkari Landing.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'admin_menu', function () {
	add_menu_page(
		'Sukkari Landing',
		'Sukkari Landing',
		'manage_options',
		'nsl-settings',
		'nsl_render_settings',
		'dashicons-store',
		56
	);
	add_submenu_page( 'nsl-settings', 'Landing Settings', 'সেটিংস', 'manage_options', 'nsl-settings', 'nsl_render_settings' );
} );

add_action( 'admin_init', function () {
	register_setting( 'nsl_settings_group', NSL_OPTION, array(
		'type'              => 'array',
		'sanitize_callback' => 'nsl_sanitize_settings',
	) );
} );

function nsl_sanitize_settings( $input ) {
	$input = is_array( $input ) ? wp_unslash( $input ) : array();

	if ( ! empty( $input['__reset'] ) ) {
		return nsl_defaults();
	}

	$out = array();
	foreach ( nsl_fields() as $section ) {
		foreach ( $section['fields'] as $key => $f ) {
			$type = $f[0];
			$val  = isset( $input[ $key ] ) ? $input[ $key ] : '';
			switch ( $type ) {
				case 'toggle':
					$val = empty( $val ) ? '0' : '1';
					break;
				case 'color':
					$val = sanitize_hex_color( $val ) ? sanitize_hex_color( $val ) : $f[2];
					break;
				case 'number':
					$val = (string) ( 0 + nsl_to_en_digits( $val ) );
					break;
				case 'image':
					$val = is_numeric( $val ) ? (string) absint( $val ) : esc_url_raw( $val );
					break;
				case 'html':
					// Tracking scripts need raw HTML; only trusted admins may store it unfiltered.
					$val = current_user_can( 'unfiltered_html' ) ? (string) $val : wp_kses_post( $val );
					break;
				case 'textarea':
				case 'lines':
					$val = sanitize_textarea_field( $val );
					break;
				default:
					$val = sanitize_text_field( $val );
			}
			$out[ $key ] = $val;
		}
	}
	return $out;
}

add_action( 'admin_enqueue_scripts', function ( $hook ) {
	if ( 'toplevel_page_nsl-settings' !== $hook ) {
		return;
	}
	wp_enqueue_media();
	wp_enqueue_style( 'wp-color-picker' );
	wp_enqueue_style( 'nsl-admin', NSL_URL . 'assets/admin.css', array(), NSL_VERSION );
	wp_enqueue_script( 'nsl-admin', NSL_URL . 'assets/admin.js', array( 'jquery', 'wp-color-picker' ), NSL_VERSION, true );
} );

function nsl_landing_page_url() {
	$pages = get_posts( array(
		'post_type'   => 'page',
		'meta_key'    => '_wp_page_template',
		'meta_value'  => NSL_TEMPLATE,
		'numberposts' => 1,
	) );
	return $pages ? get_permalink( $pages[0] ) : '';
}

function nsl_render_settings() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$sections = nsl_fields();
	$view     = nsl_landing_page_url();
	?>
	<div class="wrap nsl-wrap">
		<h1>🌴 Sukkari Landing Page — সেটিংস
			<?php if ( $view ) : ?>
				<a href="<?php echo esc_url( $view ); ?>" target="_blank" class="page-title-action">ল্যান্ডিং পেজ দেখুন ↗</a>
			<?php endif; ?>
		</h1>
		<p class="nsl-help">
			যেকোনো পেজ এডিট করে <b>Template → “Sukkari Landing (Nooriyah)”</b> সিলেক্ট করলেই সেই পেজে ল্যান্ডিং পেজ দেখাবে।
			“লাইন” ফিল্ডে প্রতি লাইনে একটি আইটেম লিখুন, কলামগুলো <code> | </code> দিয়ে আলাদা করুন।
			কোনো সেকশন লুকাতে <b>ট্র্যাকিং ও কাস্টম কোড → সেকশনের ক্রম</b> থেকে লাইনটি মুছে দিন।
		</p>

		<form method="post" action="options.php">
			<?php settings_fields( 'nsl_settings_group' ); ?>
			<div class="nsl-tabs">
				<nav class="nsl-tab-nav">
					<?php $i = 0; foreach ( $sections as $sid => $section ) : ?>
						<a href="#nsl-<?php echo esc_attr( $sid ); ?>" class="<?php echo 0 === $i++ ? 'active' : ''; ?>"><?php echo esc_html( $section['title'] ); ?></a>
					<?php endforeach; ?>
				</nav>
				<div class="nsl-tab-panels">
					<?php $i = 0; foreach ( $sections as $sid => $section ) : ?>
						<section id="nsl-<?php echo esc_attr( $sid ); ?>" class="nsl-panel <?php echo 0 === $i++ ? 'active' : ''; ?>">
							<h2><?php echo esc_html( $section['title'] ); ?></h2>
							<table class="form-table" role="presentation">
								<?php foreach ( $section['fields'] as $key => $f ) : ?>
									<tr>
										<th scope="row"><label for="nsl-<?php echo esc_attr( $key ); ?>"><?php echo esc_html( $f[1] ); ?></label></th>
										<td><?php nsl_render_field( $key, $f ); ?></td>
									</tr>
								<?php endforeach; ?>
							</table>
						</section>
					<?php endforeach; ?>
				</div>
			</div>
			<p class="submit nsl-submit">
				<?php submit_button( 'সেভ করুন', 'primary large', 'submit', false ); ?>
				<label class="nsl-reset"><input type="checkbox" name="<?php echo esc_attr( NSL_OPTION ); ?>[__reset]" value="1"> সব সেটিংস ডিফল্টে রিসেট করুন</label>
			</p>
		</form>
	</div>
	<?php
}

function nsl_render_field( $key, $f ) {
	$type  = $f[0];
	$name  = NSL_OPTION . '[' . $key . ']';
	$id    = 'nsl-' . $key;
	$value = nsl_get( $key );

	switch ( $type ) {
		case 'toggle':
			printf(
				'<label class="nsl-switch"><input type="checkbox" id="%s" name="%s" value="1" %s><span></span></label>',
				esc_attr( $id ), esc_attr( $name ), checked( '1', $value, false )
			);
			break;
		case 'color':
			printf( '<input type="text" class="nsl-color" id="%s" name="%s" value="%s" data-default-color="%s">', esc_attr( $id ), esc_attr( $name ), esc_attr( $value ), esc_attr( $f[2] ) );
			break;
		case 'number':
			printf( '<input type="number" step="any" class="small-text" id="%s" name="%s" value="%s">', esc_attr( $id ), esc_attr( $name ), esc_attr( $value ) );
			break;
		case 'image':
			$preview = nsl_img_url( $key, 'thumbnail' );
			printf(
				'<div class="nsl-image"><input type="hidden" id="%1$s" name="%2$s" value="%3$s"><img src="%4$s" class="%5$s" alt=""><button type="button" class="button nsl-image-pick">ছবি বাছুন</button> <button type="button" class="button-link-delete nsl-image-clear">মুছুন</button></div>',
				esc_attr( $id ), esc_attr( $name ), esc_attr( $value ), esc_url( $preview ), $preview ? '' : 'hidden'
			);
			break;
		case 'textarea':
			printf( '<textarea class="large-text" rows="3" id="%s" name="%s">%s</textarea>', esc_attr( $id ), esc_attr( $name ), esc_textarea( $value ) );
			break;
		case 'lines':
		case 'html':
			$rows = max( 4, min( 12, substr_count( $value, "\n" ) + 2 ) );
			printf( '<textarea class="large-text code" rows="%d" id="%s" name="%s">%s</textarea>', (int) $rows, esc_attr( $id ), esc_attr( $name ), esc_textarea( $value ) );
			break;
		default:
			printf( '<input type="text" class="regular-text" id="%s" name="%s" value="%s">', esc_attr( $id ), esc_attr( $name ), esc_attr( $value ) );
	}
}
