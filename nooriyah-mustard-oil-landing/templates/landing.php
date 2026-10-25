<?php
/**
 * Blank-canvas landing page template. Renders its own <html> so the theme's
 * CSS/JS never loads (unless "load_wp_head" is switched on), keeping it fast.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$nmo_anim     = (bool) nmo_get( 'animations' );
$nmo_wp_head  = (bool) nmo_get( 'load_wp_head' );
$nmo_packages = nmo_packages();
$nmo_zones    = nmo_zones();
$nmo_wa       = preg_replace( '/[^0-9]/', '', nmo_to_en_digits( nmo_get( 'whatsapp' ) ) );
$nmo_phone    = preg_replace( '/[^0-9+]/', '', nmo_to_en_digits( nmo_get( 'phone' ) ) );
$nmo_wa_link  = $nmo_wa ? 'https://wa.me/' . $nmo_wa . '?text=' . rawurlencode( nmo_get( 'wa_message' ) ) : '';
$nmo_pixel    = preg_replace( '/[^0-9]/', '', nmo_get( 'fb_pixel' ) );
$nmo_gtm      = preg_replace( '/[^A-Z0-9-]/', '', strtoupper( nmo_get( 'gtm_id' ) ) );
$nmo_default  = max( 1, min( count( $nmo_packages ), (int) nmo_get( 'default_package' ) ) );
$nmo_min      = $nmo_packages ? min( wp_list_pluck( $nmo_packages, 'price' ) ) : 0;
$nmo_share    = nmo_img_url( 'share_image' ) ? nmo_img_url( 'share_image' ) : nmo_img_url( 'hero_image' );

$nmo_title = function ( $text, $sub = '' ) {
	echo '<div class="sec-head" data-r><h2 class="sec-title">' . esc_html( $text ) . '</h2>';
	if ( $sub ) {
		echo '<p class="sec-sub">' . esc_html( $sub ) . '</p>';
	}
	echo '</div>';
};

$nmo_cta = function ( $label = '', $extra = '' ) {
	$label = $label ? $label : nmo_get( 'hero_cta' );
	echo '<a href="#order" class="btn btn-cta ' . esc_attr( $extra ) . '" data-cta>' . esc_html( $label ) . ' <span class="arrow" aria-hidden="true">→</span></a>';
};

/** Fallback artwork so the page looks finished before real photos are uploaded. */
$nmo_jar_svg = function ( $class = '' ) {
	static $n = 0;
	$n++;
	$brand = nmo_get( 'jar_label_brand' ) ? nmo_get( 'jar_label_brand' ) : nmo_get( 'brand_name' );
	$oil   = nmo_get( 'jar_oil_color' );
	$cap   = nmo_get( 'jar_cap_color' );
	// Shrink a label line's font when the text is longer than the label is wide.
	$fit = function ( $text, $base, $chars ) {
		$len = max( 1, mb_strlen( $text ) );
		return $len <= $chars ? $base : max( 10, round( $base * $chars / $len, 1 ) );
	};
	ob_start();
	?>
<svg class="jar-art <?php echo esc_attr( $class ); ?>" viewBox="0 0 460 460" role="img" aria-label="<?php echo esc_attr( $brand . ' ' . nmo_get( 'jar_label_product' ) . ' ' . nmo_get( 'jar_label_size' ) ); ?>">
	<defs>
		<linearGradient id="oil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="<?php echo esc_attr( nmo_shade( $oil, 45 ) ); ?>"/><stop offset=".5" stop-color="<?php echo esc_attr( $oil ); ?>"/><stop offset="1" stop-color="<?php echo esc_attr( nmo_shade( $oil, -30 ) ); ?>"/></linearGradient>
		<linearGradient id="glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".25" stop-color="#fff" stop-opacity=".05"/><stop offset=".8" stop-color="#000" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>
		<linearGradient id="cap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="<?php echo esc_attr( nmo_shade( $cap, 20 ) ); ?>"/><stop offset="1" stop-color="<?php echo esc_attr( nmo_shade( $cap, -30 ) ); ?>"/></linearGradient>
		<clipPath id="jarClip"><path d="M140 150 Q140 128 168 124 L292 124 Q320 128 320 150 L330 380 Q330 410 300 410 L160 410 Q130 410 130 380 Z"/></clipPath>
		<filter id="jsh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity=".4"/></filter>
	</defs>
	<ellipse cx="230" cy="420" rx="150" ry="16" fill="#000" opacity=".28"/>
	<g filter="url(#jsh)">
		<?php if ( nmo_get( 'jar_handle' ) ) : ?>
		<path d="M318 150 Q372 150 372 210 Q372 262 326 262" fill="none" stroke="#e9e2cf" stroke-width="18" stroke-linecap="round" opacity=".9"/>
		<?php endif; ?>
		<path d="M140 150 Q140 128 168 124 L292 124 Q320 128 320 150 L330 380 Q330 410 300 410 L160 410 Q130 410 130 380 Z" fill="#fff8de" opacity=".55"/>
		<g clip-path="url(#jarClip)">
			<rect x="120" y="170" width="230" height="250" fill="url(#oil)"/>
			<path class="oil-wave" d="M60 172 Q90 160 120 172 T180 172 T240 172 T300 172 T360 172 T420 172 V200 H60 Z" fill="<?php echo esc_attr( nmo_shade( $oil, 55 ) ); ?>" opacity=".85"/>
			<circle class="bubble" cx="170" cy="390" r="4" fill="#fff" opacity=".5"/>
			<circle class="bubble b2" cx="290" cy="395" r="3" fill="#fff" opacity=".5"/>
			<circle class="bubble b3" cx="230" cy="400" r="5" fill="#fff" opacity=".4"/>
		</g>
		<path d="M140 150 Q140 128 168 124 L292 124 Q320 128 320 150 L330 380 Q330 410 300 410 L160 410 Q130 410 130 380 Z" fill="url(#glass)" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>
		<rect x="190" y="92" width="80" height="36" rx="6" fill="url(#cap)"/>
		<rect x="186" y="84" width="88" height="14" rx="5" fill="<?php echo esc_attr( $cap ); ?>"/>
		<path d="M196 92 V126 M210 92 V126 M224 92 V126 M238 92 V126 M252 92 V126 M264 92 V126" stroke="#000" stroke-width="2" opacity=".25"/>
		<rect x="152" y="210" width="156" height="150" rx="14" fill="<?php echo esc_attr( nmo_get( 'jar_label_bg' ) ); ?>" style="stroke:var(--dark)" stroke-width="3"/>
		<rect x="160" y="218" width="140" height="134" rx="10" fill="none" style="stroke:var(--gold)" stroke-width="2" stroke-dasharray="4 4"/>
		<text x="230" y="246" text-anchor="middle" font-size="<?php echo esc_attr( $fit( $brand, 19, 12 ) ); ?>" font-weight="700" style="fill:var(--dark)"><?php echo esc_html( $brand ); ?></text>
		<text x="230" y="272" text-anchor="middle" font-size="<?php echo esc_attr( $fit( nmo_get( 'jar_label_product' ), 17, 13 ) ); ?>" font-weight="600" style="fill:var(--accent)"><?php echo esc_html( nmo_get( 'jar_label_product' ) ); ?></text>
		<text x="230" y="312" text-anchor="middle" font-size="<?php echo esc_attr( $fit( nmo_get( 'jar_label_size' ), 34, 7 ) ); ?>" font-weight="700" style="fill:var(--accent)"><?php echo esc_html( nmo_get( 'jar_label_size' ) ); ?></text>
		<text x="230" y="338" text-anchor="middle" font-size="<?php echo esc_attr( $fit( nmo_get( 'jar_label_sub' ), 12.5, 20 ) ); ?>" font-weight="600" style="fill:var(--text)"><?php echo esc_html( nmo_get( 'jar_label_sub' ) ); ?></text>
		<rect x="146" y="140" width="10" height="250" rx="5" fill="#fff" opacity=".35"/>
	</g>
	<?php
	$flowers = nmo_get( 'jar_flowers' ) ? array( array( 90, 392, 1 ), array( 58, 360, .8 ), array( 380, 395, 1.1 ), array( 408, 358, .75 ), array( 110, 345, .6 ) ) : array();
	foreach ( $flowers as $i => $f ) {
		printf( '<g class="flower f%4$d" transform="translate(%1$d %2$d) scale(%3$s)"><g>', (int) $f[0], (int) $f[1], esc_attr( $f[2] ), (int) $i );
		for ( $p = 0; $p < 4; $p++ ) {
			printf( '<ellipse cx="0" cy="-13" rx="8" ry="13" fill="#ffd43b" stroke="#e6a700" stroke-width="1" transform="rotate(%d)"/>', (int) ( $p * 90 + 45 ) );
		}
		echo '<circle r="6" fill="#c77d00"/></g></g>';
	}
	?>
	<g fill="#7a4a12"><circle cx="150" cy="418" r="3.5"/><circle cx="162" cy="422" r="3"/><circle cx="300" cy="420" r="3.5"/><circle cx="318" cy="416" r="3"/><circle cx="330" cy="424" r="2.5"/><circle cx="140" cy="426" r="2.5"/></g>
</svg>
	<?php
	// Unique gradient/clip IDs so the artwork can appear twice on one page.
	echo preg_replace( '/(id="|url\(#)(oil|glass|cap|jarClip|jsh)\b/', '$1$2-' . $n, ob_get_clean() ); // phpcs:ignore WordPress.Security.EscapeOutput
};

$nmo_stars = function ( $n ) {
	$n = max( 0, min( 5, (int) nmo_to_en_digits( $n ) ) );
	return '<span class="stars" aria-label="' . esc_attr( $n ) . ' / 5">' . str_repeat( '★', $n ) . '<i>' . str_repeat( '★', 5 - $n ) . '</i></span>';
};

?><!doctype html>
<html <?php language_attributes(); ?> class="no-js">
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script>document.documentElement.className='js';</script>
<?php if ( ! $nmo_wp_head ) : ?>
<title><?php echo esc_html( nmo_get( 'page_title' ) ); ?></title>
<?php endif; ?>
<meta name="description" content="<?php echo esc_attr( nmo_get( 'meta_desc' ) ); ?>">
<meta property="og:type" content="product">
<meta property="og:title" content="<?php echo esc_attr( nmo_get( 'page_title' ) ); ?>">
<meta property="og:description" content="<?php echo esc_attr( nmo_get( 'meta_desc' ) ); ?>">
<meta property="og:url" content="<?php echo esc_url( get_permalink() ); ?>">
<?php if ( $nmo_share ) : ?>
<meta property="og:image" content="<?php echo esc_url( $nmo_share ); ?>">
<?php endif; ?>
<meta name="theme-color" content="<?php echo esc_attr( nmo_get( 'color_dark' ) ); ?>">
<link rel="canonical" href="<?php echo esc_url( get_permalink() ); ?>">
<?php if ( nmo_get( 'hero_image' ) ) : ?>
<link rel="preload" as="image" href="<?php echo esc_url( nmo_img_url( 'hero_image', 'large' ) ); ?>" fetchpriority="high">
<?php endif; ?>
<?php if ( nmo_get( 'google_font' ) ) : ?>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'">
<?php endif; ?>
<style>
:root{--gold:<?php echo esc_html( nmo_get( 'color_primary' ) ); ?>;--accent:<?php echo esc_html( nmo_get( 'color_accent' ) ); ?>;--dark:<?php echo esc_html( nmo_get( 'color_dark' ) ); ?>;--cream:<?php echo esc_html( nmo_get( 'color_cream' ) ); ?>;--text:<?php echo esc_html( nmo_get( 'color_text' ) ); ?>}
<?php
// Critical CSS is inlined: one request less, no render-blocking stylesheet.
echo file_get_contents( NMO_DIR . 'assets/landing.css' ); // phpcs:ignore WordPress.Security.EscapeOutput
echo nmo_get( 'custom_css' ); // phpcs:ignore WordPress.Security.EscapeOutput
?>
</style>
<?php if ( $nmo_pixel ) : ?>
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','<?php echo esc_js( $nmo_pixel ); ?>');fbq('track','PageView');fbq('track','ViewContent',{content_name:'Ghani Mustard Oil 5L',currency:'BDT',value:<?php echo (float) $nmo_min; ?>});</script>
<?php endif; ?>
<?php if ( $nmo_gtm ) : ?>
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','<?php echo esc_js( $nmo_gtm ); ?>');</script>
<?php endif; ?>
<?php
if ( $nmo_wp_head ) {
	wp_head();
}
echo nmo_get( 'head_code' ); // phpcs:ignore WordPress.Security.EscapeOutput
?>
</head>
<body class="nmo<?php echo $nmo_anim ? ' anim' : ''; ?>">
<?php if ( $nmo_gtm ) : ?>
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=<?php echo esc_attr( $nmo_gtm ); ?>" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<?php endif; ?>

<?php if ( nmo_get( 'topbar_show' ) ) : ?>
<div class="topbar">
	<div class="wrap topbar-in">
		<span class="topbar-text"><?php echo esc_html( nmo_get( 'topbar_text' ) ); ?></span>
		<?php if ( nmo_get( 'countdown_show' ) ) : ?>
			<span class="countdown" data-hours="<?php echo esc_attr( (float) nmo_get( 'countdown_hours' ) ); ?>">
				<small><?php echo esc_html( nmo_get( 'countdown_label' ) ); ?></small>
				<b data-cd="h">00</b>:<b data-cd="m">00</b>:<b data-cd="s">00</b>
			</span>
		<?php endif; ?>
	</div>
</div>
<?php endif; ?>

<header class="site-head">
	<div class="wrap head-in">
		<a class="logo" href="<?php echo esc_url( home_url( '/' ) ); ?>">
			<?php
			$nmo_logo = nmo_img( 'logo', 'medium', array( 'loading' => 'eager', 'alt' => nmo_get( 'brand_name' ) ) );
			echo $nmo_logo ? $nmo_logo : '<span>' . esc_html( nmo_get( 'brand_name' ) ) . '</span>'; // phpcs:ignore WordPress.Security.EscapeOutput
			?>
		</a>
		<div class="head-actions">
			<?php if ( $nmo_phone ) : ?>
				<a class="head-call" href="tel:<?php echo esc_attr( $nmo_phone ); ?>"><span aria-hidden="true">📞</span> <span class="hide-sm"><?php echo esc_html( nmo_get( 'phone' ) ); ?></span></a>
			<?php endif; ?>
			<a href="#order" class="btn btn-sm" data-cta><?php echo esc_html( nmo_get( 'sticky_text' ) ); ?></a>
		</div>
	</div>
</header>

<main>
<?php
foreach ( nmo_lines( 'section_order' ) as $nmo_section ) :
	switch ( $nmo_section ) :

		case 'hero':
			?>
<section class="hero" id="top">
	<div class="hero-bg" aria-hidden="true">
		<?php for ( $i = 0; $i < 10; $i++ ) : ?><span class="flo" style="--i:<?php echo (int) $i; ?>"></span><?php endfor; ?>
	</div>
	<div class="wrap hero-in">
		<div class="hero-copy">
			<?php if ( nmo_get( 'hero_badge' ) ) : ?><span class="badge" data-r><?php echo esc_html( nmo_get( 'hero_badge' ) ); ?></span><?php endif; ?>
			<h1 data-r style="--d:1"><?php echo esc_html( nmo_get( 'hero_title' ) ); ?> <span class="shine"><?php echo esc_html( nmo_get( 'hero_highlight' ) ); ?></span></h1>
			<p class="hero-sub" data-r style="--d:2"><?php echo esc_html( nmo_get( 'hero_sub' ) ); ?></p>
			<?php
			$nmo_hp = isset( $nmo_packages[ $nmo_default - 1 ] ) ? $nmo_packages[ $nmo_default - 1 ] : null;
			if ( $nmo_hp && nmo_get( 'hero_price_show' ) ) :
				?>
				<div class="hero-price" data-r style="--d:3">
					<span class="hprice-name"><?php echo esc_html( $nmo_hp['weight'] ); ?></span>
					<b class="hprice-now"><?php echo esc_html( nmo_price( $nmo_hp['price'] ) ); ?></b>
					<?php if ( $nmo_hp['old'] > $nmo_hp['price'] ) : ?>
						<del><?php echo esc_html( nmo_price( $nmo_hp['old'] ) ); ?></del>
						<span class="save"><?php echo esc_html( nmo_num( $nmo_hp['old'] - $nmo_hp['price'] ) . nmo_get( 'currency' ) ); ?> সাশ্রয়</span>
					<?php endif; ?>
				</div>
			<?php endif; ?>
			<ul class="ticks" data-r style="--d:3">
				<?php foreach ( nmo_lines( 'hero_points' ) as $pt ) : ?><li><?php echo esc_html( $pt ); ?></li><?php endforeach; ?>
			</ul>
			<div class="hero-btns" data-r style="--d:4">
				<?php $nmo_cta( '', 'btn-lg' ); ?>
				<?php if ( $nmo_wa_link && nmo_get( 'hero_cta2' ) ) : ?>
					<a class="btn btn-ghost btn-lg" href="<?php echo esc_url( $nmo_wa_link ); ?>" target="_blank" rel="noopener"><?php echo esc_html( nmo_get( 'hero_cta2' ) ); ?></a>
				<?php endif; ?>
			</div>
			<?php if ( nmo_get( 'stock_text' ) ) : ?>
				<div class="stock" data-r style="--d:5"><span class="dot"></span><?php echo esc_html( nmo_get( 'stock_text' ) ); ?><span class="stock-bar"><i></i></span></div>
			<?php endif; ?>
		</div>
		<div class="hero-visual" data-r style="--d:2">
			<?php if ( nmo_get( 'hero_ring' ) ) : ?>
				<div class="ring" aria-hidden="true"></div>
				<div class="glow" aria-hidden="true"></div>
			<?php endif; ?>
			<div class="hero-img" style="width:<?php echo esc_attr( max( 40, min( 100, (float) nmo_get( 'hero_img_width' ) ) ) ); ?>%">
				<?php
				$nmo_hero = nmo_img( 'hero_image', 'large', array( 'loading' => 'eager', 'fetchpriority' => 'high', 'alt' => nmo_get( 'hero_highlight' ) ) );
				if ( $nmo_hero ) {
					echo $nmo_hero; // phpcs:ignore WordPress.Security.EscapeOutput
				} else {
					$nmo_jar_svg();
				}
				?>
			</div>
			<?php if ( nmo_get( 'hero_price_tag' ) ) : ?><div class="price-tag"><?php echo esc_html( nmo_get( 'hero_price_tag' ) ); ?></div><?php endif; ?>
		</div>
	</div>
	<svg class="wave" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true"><path d="M0 40 C240 90 480 0 720 30 C960 60 1200 10 1440 40 V80 H0Z"/></svg>
</section>
			<?php
			break;

		case 'trust':
			$nmo_marquee = nmo_lines( 'marquee' );
			$nmo_stats   = nmo_lines( 'stats', 3 );
			?>
<section class="trust">
	<?php if ( $nmo_marquee ) : ?>
	<div class="marquee" aria-label="<?php echo esc_attr( implode( ', ', $nmo_marquee ) ); ?>">
		<div class="marquee-track" aria-hidden="true">
			<?php for ( $r = 0; $r < 2; $r++ ) : foreach ( $nmo_marquee as $m ) : ?><span><?php echo esc_html( $m ); ?></span><?php endforeach; endfor; ?>
		</div>
	</div>
	<?php endif; ?>
	<?php if ( $nmo_stats ) : ?>
	<div class="wrap stats">
		<?php foreach ( $nmo_stats as $i => $s ) : ?>
			<div class="stat" data-r style="--d:<?php echo (int) $i; ?>">
				<b><span data-count="<?php echo esc_attr( nmo_to_en_digits( $s[0] ) ); ?>"><?php echo esc_html( nmo_get( 'bangla_digits' ) ? nmo_to_bn_digits( $s[0] ) : $s[0] ); ?></span><?php echo esc_html( $s[1] ); ?></b>
				<small><?php echo esc_html( $s[2] ); ?></small>
			</div>
		<?php endforeach; ?>
	</div>
	<?php endif; ?>
</section>
			<?php
			break;

		case 'about':
			?>
<section class="sec about" id="about">
	<div class="wrap about-in">
		<div class="about-media" data-r>
			<?php
			$nmo_about = nmo_img( 'about_image', 'large', array( 'alt' => nmo_get( 'about_title' ) ) );
			echo $nmo_about ? $nmo_about : ''; // phpcs:ignore WordPress.Security.EscapeOutput
			if ( ! $nmo_about ) {
				$nmo_jar_svg( 'alt' );
			}
			?>
			<span class="seal" aria-hidden="true"><b>100%</b>PURE</span>
		</div>
		<div class="about-copy">
			<?php $nmo_title( nmo_get( 'about_title' ) ); ?>
			<p class="lead" data-r><?php echo esc_html( nmo_get( 'about_text' ) ); ?></p>
			<div class="features">
				<?php foreach ( nmo_lines( 'features', 3 ) as $i => $f ) : ?>
					<div class="feature" data-r style="--d:<?php echo (int) $i; ?>">
						<span class="ico"><?php echo esc_html( $f[0] ); ?></span>
						<div><h3><?php echo esc_html( $f[1] ); ?></h3><p><?php echo esc_html( $f[2] ); ?></p></div>
					</div>
				<?php endforeach; ?>
			</div>
		</div>
	</div>
</section>
			<?php
			break;

		case 'benefits':
			?>
<section class="sec benefits dark">
	<div class="wrap">
		<?php $nmo_title( nmo_get( 'benefits_title' ) ); ?>
		<div class="grid-3">
			<?php foreach ( nmo_lines( 'benefits', 3 ) as $i => $b ) : ?>
				<div class="card benefit" data-r style="--d:<?php echo (int) ( $i % 3 ); ?>">
					<span class="ico big"><?php echo esc_html( $b[0] ); ?></span>
					<h3><?php echo esc_html( $b[1] ); ?></h3>
					<p><?php echo esc_html( $b[2] ); ?></p>
				</div>
			<?php endforeach; ?>
		</div>
		<div class="center" data-r><?php $nmo_cta(); ?></div>
	</div>
</section>
			<?php
			break;

		case 'gallery':
			$nmo_imgs = array();
			for ( $g = 1; $g <= 4; $g++ ) {
				$tag = nmo_img( 'gallery_' . $g, 'large', array( 'alt' => nmo_get( 'gallery_title' ) . ' ' . $g ) );
				if ( $tag ) {
					$nmo_imgs[] = $tag;
				}
			}
			$nmo_yt = nmo_youtube_id( nmo_get( 'video_url' ) );
			if ( ! $nmo_imgs && ! $nmo_yt ) {
				break;
			}
			?>
<section class="sec gallery">
	<div class="wrap">
		<?php $nmo_title( nmo_get( 'gallery_title' ) ); ?>
		<?php if ( $nmo_yt ) : ?>
			<div class="video" data-r data-yt="<?php echo esc_attr( $nmo_yt ); ?>" role="button" tabindex="0" aria-label="ভিডিও চালান">
				<img src="https://i.ytimg.com/vi/<?php echo esc_attr( $nmo_yt ); ?>/hqdefault.jpg" alt="" loading="lazy" decoding="async">
				<span class="play" aria-hidden="true"></span>
			</div>
		<?php endif; ?>
		<?php if ( $nmo_imgs ) : ?>
			<div class="gal-grid">
				<?php foreach ( $nmo_imgs as $i => $tag ) : ?>
					<figure data-r style="--d:<?php echo (int) $i; ?>"><?php echo $tag; // phpcs:ignore WordPress.Security.EscapeOutput ?></figure>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
	</div>
</section>
			<?php
			break;

		case 'compare':
			$nmo_rows = nmo_lines( 'compare_rows', 3 );
			if ( ! $nmo_rows ) {
				break;
			}
			?>
<section class="sec compare">
	<div class="wrap narrow">
		<?php $nmo_title( nmo_get( 'compare_title' ) ); ?>
		<div class="cmp" data-r>
			<div class="cmp-row cmp-head"><span></span><span class="us"><?php echo esc_html( nmo_get( 'compare_us' ) ); ?></span><span><?php echo esc_html( nmo_get( 'compare_them' ) ); ?></span></div>
			<?php foreach ( $nmo_rows as $row ) : ?>
				<div class="cmp-row"><span><?php echo esc_html( $row[0] ); ?></span><span class="us" data-l="<?php echo esc_attr( nmo_get( 'compare_us' ) ); ?>">✔ <?php echo esc_html( $row[1] ); ?></span><span class="them" data-l="<?php echo esc_attr( nmo_get( 'compare_them' ) ); ?>">✖ <?php echo esc_html( $row[2] ); ?></span></div>
			<?php endforeach; ?>
		</div>
	</div>
</section>
			<?php
			break;

		case 'packages':
			if ( ! $nmo_packages ) {
				break;
			}
			?>
<section class="sec packages" id="packages">
	<div class="wrap">
		<?php $nmo_title( nmo_get( 'packages_title' ), nmo_get( 'packages_sub' ) ); ?>
		<div class="pk-grid">
			<?php foreach ( $nmo_packages as $i => $p ) : ?>
				<div class="pk<?php echo $p['id'] === $nmo_default ? ' pop' : ''; ?>" data-r style="--d:<?php echo (int) $i; ?>">
					<?php if ( $p['badge'] ) : ?><span class="pk-badge"><?php echo esc_html( $p['badge'] ); ?></span><?php endif; ?>
					<h3><?php echo esc_html( $p['name'] ); ?></h3>
					<div class="pk-weight"><?php echo esc_html( $p['weight'] ); ?></div>
					<div class="pk-price">
						<b><?php echo esc_html( nmo_price( $p['price'] ) ); ?></b>
						<?php if ( $p['old'] > $p['price'] ) : ?>
							<del><?php echo esc_html( nmo_price( $p['old'] ) ); ?></del>
							<span class="save"><?php echo esc_html( nmo_num( round( ( $p['old'] - $p['price'] ) / $p['old'] * 100 ) ) ); ?>% ছাড়</span>
						<?php endif; ?>
					</div>
					<a href="#order" class="btn btn-cta btn-block" data-pick="<?php echo (int) $p['id']; ?>" data-cta>এটি অর্ডার করুন</a>
				</div>
			<?php endforeach; ?>
		</div>
	</div>
</section>
			<?php
			break;

		case 'reviews':
			$nmo_reviews = nmo_lines( 'reviews', 4 );
			?>
<section class="sec reviews dark">
	<div class="wrap">
		<?php $nmo_title( nmo_get( 'reviews_title' ) ); ?>
		<div class="grid-2">
			<?php foreach ( $nmo_reviews as $i => $rv ) : ?>
				<blockquote class="card review" data-r style="--d:<?php echo (int) ( $i % 2 ); ?>">
					<?php echo $nmo_stars( $rv[3] ? $rv[3] : 5 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					<p>“<?php echo esc_html( $rv[2] ); ?>”</p>
					<footer><span class="avatar"><?php echo esc_html( mb_substr( $rv[0], 0, 1 ) ); ?></span><span><b><?php echo esc_html( $rv[0] ); ?></b><small><?php echo esc_html( $rv[1] ); ?></small></span></footer>
				</blockquote>
			<?php endforeach; ?>
		</div>
		<div class="shots">
			<?php
			for ( $s = 1; $s <= 3; $s++ ) {
				$tag = nmo_img( 'review_shots_' . $s, 'medium_large', array( 'alt' => 'Customer review ' . $s ) );
				if ( $tag ) {
					echo '<figure data-r style="--d:' . (int) $s . '">' . $tag . '</figure>'; // phpcs:ignore WordPress.Security.EscapeOutput
				}
			}
			?>
		</div>
	</div>
</section>
			<?php
			break;

		case 'order':
			if ( ! $nmo_packages ) {
				break;
			}
			?>
<section class="sec order" id="order">
	<div class="wrap narrow">
		<?php $nmo_title( nmo_get( 'order_title' ), nmo_get( 'order_sub' ) ); ?>
		<form class="order-form" id="nmo-form" novalidate data-r>
			<fieldset>
				<legend><span class="step">১</span> প্যাকেজ বাছাই করুন</legend>
				<div class="opt-list">
					<?php foreach ( $nmo_packages as $p ) : ?>
						<label class="opt">
							<input type="radio" name="package" value="<?php echo (int) $p['id']; ?>" <?php checked( $p['id'], $nmo_default ); ?>>
							<span class="opt-box">
								<span class="opt-name"><b><?php echo esc_html( $p['name'] ); ?></b> <small><?php echo esc_html( $p['weight'] ); ?></small></span>
								<span class="opt-price"><?php echo esc_html( nmo_price( $p['price'] ) ); ?><?php if ( $p['old'] > $p['price'] ) : ?> <del><?php echo esc_html( nmo_price( $p['old'] ) ); ?></del><?php endif; ?></span>
							</span>
						</label>
					<?php endforeach; ?>
				</div>
				<div class="qty-row">
					<span>পরিমাণ</span>
					<div class="qty"><button type="button" data-q="-1" aria-label="কমান">−</button><input type="number" name="qty" value="1" min="1" max="50" inputmode="numeric" aria-label="পরিমাণ"><button type="button" data-q="1" aria-label="বাড়ান">+</button></div>
				</div>
			</fieldset>

			<fieldset>
				<legend><span class="step">২</span> আপনার তথ্য দিন</legend>
				<div class="field"><label for="f-name">আপনার নাম *</label><input id="f-name" name="name" type="text" autocomplete="name" placeholder="যেমন: আব্দুল্লাহ" required></div>
				<div class="field"><label for="f-phone">মোবাইল নম্বর *</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX" required></div>
				<div class="field"><label for="f-address">সম্পূর্ণ ঠিকানা *</label><textarea id="f-address" name="address" rows="2" autocomplete="street-address" placeholder="বাসা/রোড, এলাকা, থানা, জেলা" required></textarea></div>
				<div class="field">
					<label>ডেলিভারি এরিয়া *</label>
					<div class="zones">
						<?php foreach ( $nmo_zones as $z ) : ?>
							<label class="zone"><input type="radio" name="zone" value="<?php echo (int) $z['id']; ?>" <?php checked( $z['id'], 1 ); ?>><span><?php echo esc_html( $z['name'] ); ?> <small><?php echo esc_html( nmo_price( $z['charge'] ) ); ?></small></span></label>
						<?php endforeach; ?>
					</div>
				</div>
				<div class="field"><label for="f-note">অতিরিক্ত নোট (ঐচ্ছিক)</label><input id="f-note" name="note" type="text" placeholder="যেমন: বিকেলে ডেলিভারি দিন"></div>
				<input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
			</fieldset>

			<div class="summary">
				<div><span>সাবটোটাল</span><b data-sum="sub">—</b></div>
				<div><span>ডেলিভারি চার্জ</span><b data-sum="ship">—</b></div>
				<div class="total"><span>সর্বমোট</span><b data-sum="total">—</b></div>
				<p class="cod">💵 ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন</p>
			</div>

			<button type="submit" class="btn btn-cta btn-lg btn-block submit"><span><?php echo esc_html( nmo_get( 'order_button' ) ); ?></span> <b data-sum="total"></b></button>
			<p class="form-msg" role="alert" aria-live="polite"></p>
			<p class="form-note"><?php echo esc_html( nmo_get( 'order_note' ) ); ?></p>
		</form>
		<div class="success" id="nmo-success" hidden tabindex="-1">
			<div class="check" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M14 27l8 8 16-17"/></svg></div>
			<h3><?php echo esc_html( nmo_get( 'success_title' ) ); ?></h3>
			<p class="order-no"></p>
			<p><?php echo esc_html( nmo_get( 'success_text' ) ); ?></p>
			<?php if ( $nmo_wa_link ) : ?><a class="btn btn-ghost" href="<?php echo esc_url( $nmo_wa_link ); ?>" target="_blank" rel="noopener">WhatsApp এ যোগাযোগ</a><?php endif; ?>
		</div>
	</div>
</section>
			<?php
			break;

		case 'faq':
			?>
<section class="sec faq">
	<div class="wrap narrow">
		<?php $nmo_title( nmo_get( 'faq_title' ) ); ?>
		<?php foreach ( nmo_lines( 'faqs', 2 ) as $i => $q ) : ?>
			<details data-r style="--d:<?php echo (int) min( $i, 4 ); ?>"<?php echo 0 === $i ? ' open' : ''; ?>>
				<summary><?php echo esc_html( $q[0] ); ?></summary>
				<p><?php echo esc_html( $q[1] ); ?></p>
			</details>
		<?php endforeach; ?>
	</div>
</section>
			<?php
			break;

		case 'final':
			?>
<section class="final">
	<div class="hero-bg" aria-hidden="true">
		<?php for ( $i = 0; $i < 6; $i++ ) : ?><span class="flo" style="--i:<?php echo (int) $i; ?>"></span><?php endfor; ?>
	</div>
	<div class="wrap center">
		<h2 data-r><?php echo esc_html( nmo_get( 'final_title' ) ); ?></h2>
		<p data-r style="--d:1"><?php echo esc_html( nmo_get( 'final_text' ) ); ?></p>
		<div data-r style="--d:2"><?php $nmo_cta( '', 'btn-lg' ); ?></div>
	</div>
</section>
			<?php
			break;

	endswitch;
endforeach;
?>
</main>

<footer class="site-foot">
	<div class="wrap foot-in">
		<p><?php echo esc_html( nmo_get( 'footer_text' ) ); ?></p>
		<nav>
			<?php foreach ( nmo_lines( 'footer_links', 2 ) as $l ) : ?>
				<a href="<?php echo esc_url( $l[1] ); ?>"><?php echo esc_html( $l[0] ); ?></a>
			<?php endforeach; ?>
		</nav>
	</div>
</footer>

<?php if ( $nmo_wa_link ) : ?>
<a class="wa-float<?php echo nmo_get( 'sticky_bar' ) ? ' has-sticky' : ''; ?>" href="<?php echo esc_url( $nmo_wa_link ); ?>" target="_blank" rel="noopener" aria-label="WhatsApp">
	<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#fff" d="M16 3a13 13 0 0 0-11.1 19.7L3 29l6.5-1.7A13 13 0 1 0 16 3zm0 23.7c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.7 10.7 0 1 1 16 26.7zm5.9-8c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.8 8.8 0 0 1-4.4-3.8c-.3-.6.3-.5 1-1.7.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.3 1.4 3.5c.2.2 2.4 3.7 5.8 5.1 2.2.9 3 1 4.1.8.7-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5-.1-.2-.3-.2-.6-.4z"/></svg>
</a>
<?php endif; ?>

<?php if ( nmo_get( 'sticky_bar' ) ) : ?>
<div class="sticky-bar" aria-hidden="true">
	<?php if ( $nmo_phone ) : ?><a class="sb-call" href="tel:<?php echo esc_attr( $nmo_phone ); ?>" tabindex="-1" aria-label="কল করুন">📞</a><?php endif; ?>
	<?php if ( $nmo_wa_link ) : ?><a class="sb-wa" href="<?php echo esc_url( $nmo_wa_link ); ?>" target="_blank" rel="noopener" tabindex="-1" aria-label="WhatsApp"><svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#fff" d="M16 3a13 13 0 0 0-11.1 19.7L3 29l6.5-1.7A13 13 0 1 0 16 3zm5.9 15.7c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.8 8.8 0 0 1-4.4-3.8c-.3-.6.3-.5 1-1.7.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.3 1.4 3.5c.2.2 2.4 3.7 5.8 5.1 2.2.9 3 1 4.1.8.7-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5-.1-.2-.3-.2-.6-.4z"/></svg></a><?php endif; ?>
	<a class="btn btn-cta sb-order" href="#order" tabindex="-1" data-cta><?php echo esc_html( nmo_get( 'sticky_text' ) ); ?> — <?php echo esc_html( nmo_price( $nmo_min ) ); ?> থেকে</a>
</div>
<?php endif; ?>

<script>window.NMO=<?php echo wp_json_encode( array(
	'ajax'      => admin_url( 'admin-ajax.php' ),
	'packages'  => array_map( function ( $p ) { return array( 'id' => $p['id'], 'price' => $p['price'], 'name' => $p['name'] ); }, $nmo_packages ),
	'zones'     => array_map( function ( $z ) { return array( 'id' => $z['id'], 'charge' => $z['charge'] ); }, $nmo_zones ),
	'freeFrom'  => (float) nmo_get( 'free_ship_from' ),
	'currency'  => nmo_get( 'currency' ),
	'bn'        => (bool) nmo_get( 'bangla_digits' ),
	'pixel'     => (bool) $nmo_pixel,
	'freeLabel' => 'ফ্রি',
) ); ?>;</script>
<script src="<?php echo esc_url( NMO_URL . 'assets/landing.js?v=' . NMO_VERSION ); ?>" defer></script>
<?php
if ( $nmo_wp_head ) {
	wp_footer();
}
echo nmo_get( 'footer_code' ); // phpcs:ignore WordPress.Security.EscapeOutput
?>
</body>
</html>
