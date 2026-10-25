<?php
/**
 * Blank-canvas landing page template. Renders its own <html> so the theme's
 * CSS/JS never loads (unless "load_wp_head" is switched on), keeping it fast.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$nsl_anim     = (bool) nsl_get( 'animations' );
$nsl_wp_head  = (bool) nsl_get( 'load_wp_head' );
$nsl_packages = nsl_packages();
$nsl_zones    = nsl_zones();
$nsl_wa       = preg_replace( '/[^0-9]/', '', nsl_to_en_digits( nsl_get( 'whatsapp' ) ) );
$nsl_phone    = preg_replace( '/[^0-9+]/', '', nsl_to_en_digits( nsl_get( 'phone' ) ) );
$nsl_wa_link  = $nsl_wa ? 'https://wa.me/' . $nsl_wa . '?text=' . rawurlencode( 'আসসালামু আলাইকুম, আমি সুক্কারি মুফাত্তাল খেজুর সম্পর্কে জানতে চাই।' ) : '';
$nsl_pixel    = preg_replace( '/[^0-9]/', '', nsl_get( 'fb_pixel' ) );
$nsl_gtm      = preg_replace( '/[^A-Z0-9-]/', '', strtoupper( nsl_get( 'gtm_id' ) ) );
$nsl_default  = max( 1, min( count( $nsl_packages ), (int) nsl_get( 'default_package' ) ) );
$nsl_min      = $nsl_packages ? min( wp_list_pluck( $nsl_packages, 'price' ) ) : 0;
$nsl_share    = nsl_img_url( 'share_image' ) ? nsl_img_url( 'share_image' ) : nsl_img_url( 'hero_image' );

$nsl_title = function ( $text, $sub = '' ) {
	echo '<div class="sec-head" data-r><h2 class="sec-title">' . esc_html( $text ) . '</h2>';
	if ( $sub ) {
		echo '<p class="sec-sub">' . esc_html( $sub ) . '</p>';
	}
	echo '</div>';
};

$nsl_cta = function ( $label = '', $extra = '' ) {
	$label = $label ? $label : nsl_get( 'hero_cta' );
	echo '<a href="#order" class="btn btn-cta ' . esc_attr( $extra ) . '" data-cta>' . esc_html( $label ) . ' <span class="arrow" aria-hidden="true">→</span></a>';
};

/** Fallback artwork so the page looks finished before real photos are uploaded. */
$nsl_dates_svg = function ( $class = '' ) {
	$dates = array(
		array( 150, 250, -20 ), array( 230, 240, 15 ), array( 310, 255, -8 ), array( 110, 300, 30 ),
		array( 195, 305, -12 ), array( 275, 300, 22 ), array( 350, 305, -25 ), array( 160, 350, 5 ),
		array( 240, 355, -18 ), array( 320, 352, 12 ), array( 200, 200, 40 ), array( 270, 195, -35 ),
	);
	echo '<svg class="dates-art ' . esc_attr( $class ) . '" viewBox="0 0 460 460" role="img" aria-label="সুক্কারি মুফাত্তাল খেজুর">';
	echo '<defs><radialGradient id="dg" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#e9a64b"/><stop offset=".45" stop-color="#b8661f"/><stop offset="1" stop-color="#5a2a0b"/></radialGradient>';
	echo '<linearGradient id="bowl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6d58b"/><stop offset="1" stop-color="#a87412"/></linearGradient>';
	echo '<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#2b1608" flood-opacity=".45"/></filter></defs>';
	echo '<ellipse cx="230" cy="420" rx="170" ry="18" fill="#000" opacity=".25"/>';
	echo '<path d="M50 300 Q230 470 410 300 Z" fill="url(#bowl)" filter="url(#sh)"/>';
	foreach ( $dates as $d ) {
		printf(
			'<g transform="translate(%1$d %2$d) rotate(%3$d)" filter="url(#sh)"><ellipse rx="44" ry="27" fill="url(#dg)"/><path d="M-30 -6 Q0 -14 28 -4 M-26 8 Q2 2 30 9" stroke="#3d1a05" stroke-width="2" fill="none" opacity=".35"/><ellipse cx="-14" cy="-10" rx="14" ry="5" fill="#fff" opacity=".28"/></g>',
			(int) $d[0], (int) $d[1], (int) $d[2]
		);
	}
	echo '<path d="M50 300 Q230 470 410 300 Q230 340 50 300 Z" fill="url(#bowl)"/>';
	echo '<path d="M70 312 Q230 350 390 312" stroke="#fff3c4" stroke-width="3" fill="none" opacity=".6"/>';
	echo '</svg>';
};

$nsl_stars = function ( $n ) {
	$n = max( 0, min( 5, (int) nsl_to_en_digits( $n ) ) );
	return '<span class="stars" aria-label="' . esc_attr( $n ) . ' / 5">' . str_repeat( '★', $n ) . '<i>' . str_repeat( '★', 5 - $n ) . '</i></span>';
};

?><!doctype html>
<html <?php language_attributes(); ?> class="no-js">
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script>document.documentElement.className='js';</script>
<?php if ( ! $nsl_wp_head ) : ?>
<title><?php echo esc_html( nsl_get( 'page_title' ) ); ?></title>
<?php endif; ?>
<meta name="description" content="<?php echo esc_attr( nsl_get( 'meta_desc' ) ); ?>">
<meta property="og:type" content="product">
<meta property="og:title" content="<?php echo esc_attr( nsl_get( 'page_title' ) ); ?>">
<meta property="og:description" content="<?php echo esc_attr( nsl_get( 'meta_desc' ) ); ?>">
<meta property="og:url" content="<?php echo esc_url( get_permalink() ); ?>">
<?php if ( $nsl_share ) : ?>
<meta property="og:image" content="<?php echo esc_url( $nsl_share ); ?>">
<?php endif; ?>
<meta name="theme-color" content="<?php echo esc_attr( nsl_get( 'color_dark' ) ); ?>">
<link rel="canonical" href="<?php echo esc_url( get_permalink() ); ?>">
<?php if ( nsl_get( 'hero_image' ) ) : ?>
<link rel="preload" as="image" href="<?php echo esc_url( nsl_img_url( 'hero_image', 'large' ) ); ?>" fetchpriority="high">
<?php endif; ?>
<?php if ( nsl_get( 'google_font' ) ) : ?>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'">
<?php endif; ?>
<style>
:root{--gold:<?php echo esc_html( nsl_get( 'color_primary' ) ); ?>;--accent:<?php echo esc_html( nsl_get( 'color_accent' ) ); ?>;--dark:<?php echo esc_html( nsl_get( 'color_dark' ) ); ?>;--cream:<?php echo esc_html( nsl_get( 'color_cream' ) ); ?>;--text:<?php echo esc_html( nsl_get( 'color_text' ) ); ?>}
<?php
// Critical CSS is inlined: one request less, no render-blocking stylesheet.
echo file_get_contents( NSL_DIR . 'assets/landing.css' ); // phpcs:ignore WordPress.Security.EscapeOutput
echo nsl_get( 'custom_css' ); // phpcs:ignore WordPress.Security.EscapeOutput
?>
</style>
<?php if ( $nsl_pixel ) : ?>
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','<?php echo esc_js( $nsl_pixel ); ?>');fbq('track','PageView');fbq('track','ViewContent',{content_name:'Sukkari Mufattal',currency:'BDT',value:<?php echo (float) $nsl_min; ?>});</script>
<?php endif; ?>
<?php if ( $nsl_gtm ) : ?>
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','<?php echo esc_js( $nsl_gtm ); ?>');</script>
<?php endif; ?>
<?php
if ( $nsl_wp_head ) {
	wp_head();
}
echo nsl_get( 'head_code' ); // phpcs:ignore WordPress.Security.EscapeOutput
?>
</head>
<body class="nsl<?php echo $nsl_anim ? ' anim' : ''; ?>">
<?php if ( $nsl_gtm ) : ?>
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=<?php echo esc_attr( $nsl_gtm ); ?>" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<?php endif; ?>

<?php if ( nsl_get( 'topbar_show' ) ) : ?>
<div class="topbar">
	<div class="wrap topbar-in">
		<span class="topbar-text"><?php echo esc_html( nsl_get( 'topbar_text' ) ); ?></span>
		<?php if ( nsl_get( 'countdown_show' ) ) : ?>
			<span class="countdown" data-hours="<?php echo esc_attr( (float) nsl_get( 'countdown_hours' ) ); ?>">
				<small><?php echo esc_html( nsl_get( 'countdown_label' ) ); ?></small>
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
			$nsl_logo = nsl_img( 'logo', 'medium', array( 'loading' => 'eager', 'alt' => nsl_get( 'brand_name' ) ) );
			echo $nsl_logo ? $nsl_logo : '<span>' . esc_html( nsl_get( 'brand_name' ) ) . '</span>'; // phpcs:ignore WordPress.Security.EscapeOutput
			?>
		</a>
		<div class="head-actions">
			<?php if ( $nsl_phone ) : ?>
				<a class="head-call" href="tel:<?php echo esc_attr( $nsl_phone ); ?>"><span aria-hidden="true">📞</span> <span class="hide-sm"><?php echo esc_html( nsl_get( 'phone' ) ); ?></span></a>
			<?php endif; ?>
			<a href="#order" class="btn btn-sm" data-cta><?php echo esc_html( nsl_get( 'sticky_text' ) ); ?></a>
		</div>
	</div>
</header>

<main>
<?php
foreach ( nsl_lines( 'section_order' ) as $nsl_section ) :
	switch ( $nsl_section ) :

		case 'hero':
			?>
<section class="hero" id="top">
	<div class="hero-bg" aria-hidden="true">
		<?php for ( $i = 0; $i < 10; $i++ ) : ?><span class="flo" style="--i:<?php echo (int) $i; ?>"></span><?php endfor; ?>
	</div>
	<div class="wrap hero-in">
		<div class="hero-copy">
			<?php if ( nsl_get( 'hero_badge' ) ) : ?><span class="badge" data-r><?php echo esc_html( nsl_get( 'hero_badge' ) ); ?></span><?php endif; ?>
			<h1 data-r style="--d:1"><?php echo esc_html( nsl_get( 'hero_title' ) ); ?> <span class="shine"><?php echo esc_html( nsl_get( 'hero_highlight' ) ); ?></span></h1>
			<p class="hero-sub" data-r style="--d:2"><?php echo esc_html( nsl_get( 'hero_sub' ) ); ?></p>
			<?php
			$nsl_hp = isset( $nsl_packages[ $nsl_default - 1 ] ) ? $nsl_packages[ $nsl_default - 1 ] : null;
			if ( $nsl_hp && nsl_get( 'hero_price_show' ) ) :
				?>
				<div class="hero-price" data-r style="--d:3">
					<span class="hprice-name"><?php echo esc_html( $nsl_hp['weight'] ); ?></span>
					<b class="hprice-now"><?php echo esc_html( nsl_price( $nsl_hp['price'] ) ); ?></b>
					<?php if ( $nsl_hp['old'] > $nsl_hp['price'] ) : ?>
						<del><?php echo esc_html( nsl_price( $nsl_hp['old'] ) ); ?></del>
						<span class="save"><?php echo esc_html( nsl_num( $nsl_hp['old'] - $nsl_hp['price'] ) . nsl_get( 'currency' ) ); ?> সাশ্রয়</span>
					<?php endif; ?>
				</div>
			<?php endif; ?>
			<ul class="ticks" data-r style="--d:3">
				<?php foreach ( nsl_lines( 'hero_points' ) as $pt ) : ?><li><?php echo esc_html( $pt ); ?></li><?php endforeach; ?>
			</ul>
			<div class="hero-btns" data-r style="--d:4">
				<?php $nsl_cta( '', 'btn-lg' ); ?>
				<?php if ( $nsl_wa_link && nsl_get( 'hero_cta2' ) ) : ?>
					<a class="btn btn-ghost btn-lg" href="<?php echo esc_url( $nsl_wa_link ); ?>" target="_blank" rel="noopener"><?php echo esc_html( nsl_get( 'hero_cta2' ) ); ?></a>
				<?php endif; ?>
			</div>
			<?php if ( nsl_get( 'stock_text' ) ) : ?>
				<div class="stock" data-r style="--d:5"><span class="dot"></span><?php echo esc_html( nsl_get( 'stock_text' ) ); ?><span class="stock-bar"><i></i></span></div>
			<?php endif; ?>
		</div>
		<div class="hero-visual" data-r style="--d:2">
			<div class="ring" aria-hidden="true"></div>
			<div class="glow" aria-hidden="true"></div>
			<div class="hero-img">
				<?php
				$nsl_hero = nsl_img( 'hero_image', 'large', array( 'loading' => 'eager', 'fetchpriority' => 'high', 'alt' => nsl_get( 'hero_highlight' ) ) );
				if ( $nsl_hero ) {
					echo $nsl_hero; // phpcs:ignore WordPress.Security.EscapeOutput
				} else {
					$nsl_dates_svg();
				}
				?>
			</div>
			<?php if ( nsl_get( 'hero_price_tag' ) ) : ?><div class="price-tag"><?php echo esc_html( nsl_get( 'hero_price_tag' ) ); ?></div><?php endif; ?>
		</div>
	</div>
	<svg class="wave" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true"><path d="M0 40 C240 90 480 0 720 30 C960 60 1200 10 1440 40 V80 H0Z"/></svg>
</section>
			<?php
			break;

		case 'trust':
			$nsl_marquee = nsl_lines( 'marquee' );
			$nsl_stats   = nsl_lines( 'stats', 3 );
			?>
<section class="trust">
	<?php if ( $nsl_marquee ) : ?>
	<div class="marquee" aria-label="<?php echo esc_attr( implode( ', ', $nsl_marquee ) ); ?>">
		<div class="marquee-track" aria-hidden="true">
			<?php for ( $r = 0; $r < 2; $r++ ) : foreach ( $nsl_marquee as $m ) : ?><span><?php echo esc_html( $m ); ?></span><?php endforeach; endfor; ?>
		</div>
	</div>
	<?php endif; ?>
	<?php if ( $nsl_stats ) : ?>
	<div class="wrap stats">
		<?php foreach ( $nsl_stats as $i => $s ) : ?>
			<div class="stat" data-r style="--d:<?php echo (int) $i; ?>">
				<b><span data-count="<?php echo esc_attr( nsl_to_en_digits( $s[0] ) ); ?>"><?php echo esc_html( nsl_get( 'bangla_digits' ) ? nsl_to_bn_digits( $s[0] ) : $s[0] ); ?></span><?php echo esc_html( $s[1] ); ?></b>
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
			$nsl_about = nsl_img( 'about_image', 'large', array( 'alt' => nsl_get( 'about_title' ) ) );
			echo $nsl_about ? $nsl_about : ''; // phpcs:ignore WordPress.Security.EscapeOutput
			if ( ! $nsl_about ) {
				$nsl_dates_svg( 'alt' );
			}
			?>
			<span class="seal" aria-hidden="true"><b>100%</b>ORIGINAL</span>
		</div>
		<div class="about-copy">
			<?php $nsl_title( nsl_get( 'about_title' ) ); ?>
			<p class="lead" data-r><?php echo esc_html( nsl_get( 'about_text' ) ); ?></p>
			<div class="features">
				<?php foreach ( nsl_lines( 'features', 3 ) as $i => $f ) : ?>
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
		<?php $nsl_title( nsl_get( 'benefits_title' ) ); ?>
		<div class="grid-3">
			<?php foreach ( nsl_lines( 'benefits', 3 ) as $i => $b ) : ?>
				<div class="card benefit" data-r style="--d:<?php echo (int) ( $i % 3 ); ?>">
					<span class="ico big"><?php echo esc_html( $b[0] ); ?></span>
					<h3><?php echo esc_html( $b[1] ); ?></h3>
					<p><?php echo esc_html( $b[2] ); ?></p>
				</div>
			<?php endforeach; ?>
		</div>
		<div class="center" data-r><?php $nsl_cta(); ?></div>
	</div>
</section>
			<?php
			break;

		case 'gallery':
			$nsl_imgs = array();
			for ( $g = 1; $g <= 4; $g++ ) {
				$tag = nsl_img( 'gallery_' . $g, 'large', array( 'alt' => nsl_get( 'gallery_title' ) . ' ' . $g ) );
				if ( $tag ) {
					$nsl_imgs[] = $tag;
				}
			}
			$nsl_yt = nsl_youtube_id( nsl_get( 'video_url' ) );
			if ( ! $nsl_imgs && ! $nsl_yt ) {
				break;
			}
			?>
<section class="sec gallery">
	<div class="wrap">
		<?php $nsl_title( nsl_get( 'gallery_title' ) ); ?>
		<?php if ( $nsl_yt ) : ?>
			<div class="video" data-r data-yt="<?php echo esc_attr( $nsl_yt ); ?>" role="button" tabindex="0" aria-label="ভিডিও চালান">
				<img src="https://i.ytimg.com/vi/<?php echo esc_attr( $nsl_yt ); ?>/hqdefault.jpg" alt="" loading="lazy" decoding="async">
				<span class="play" aria-hidden="true"></span>
			</div>
		<?php endif; ?>
		<?php if ( $nsl_imgs ) : ?>
			<div class="gal-grid">
				<?php foreach ( $nsl_imgs as $i => $tag ) : ?>
					<figure data-r style="--d:<?php echo (int) $i; ?>"><?php echo $tag; // phpcs:ignore WordPress.Security.EscapeOutput ?></figure>
				<?php endforeach; ?>
			</div>
		<?php endif; ?>
	</div>
</section>
			<?php
			break;

		case 'compare':
			$nsl_rows = nsl_lines( 'compare_rows', 3 );
			if ( ! $nsl_rows ) {
				break;
			}
			?>
<section class="sec compare">
	<div class="wrap narrow">
		<?php $nsl_title( nsl_get( 'compare_title' ) ); ?>
		<div class="cmp" data-r>
			<div class="cmp-row cmp-head"><span></span><span class="us"><?php echo esc_html( nsl_get( 'compare_us' ) ); ?></span><span><?php echo esc_html( nsl_get( 'compare_them' ) ); ?></span></div>
			<?php foreach ( $nsl_rows as $row ) : ?>
				<div class="cmp-row"><span><?php echo esc_html( $row[0] ); ?></span><span class="us" data-l="<?php echo esc_attr( nsl_get( 'compare_us' ) ); ?>">✔ <?php echo esc_html( $row[1] ); ?></span><span class="them" data-l="<?php echo esc_attr( nsl_get( 'compare_them' ) ); ?>">✖ <?php echo esc_html( $row[2] ); ?></span></div>
			<?php endforeach; ?>
		</div>
	</div>
</section>
			<?php
			break;

		case 'packages':
			if ( ! $nsl_packages ) {
				break;
			}
			?>
<section class="sec packages" id="packages">
	<div class="wrap">
		<?php $nsl_title( nsl_get( 'packages_title' ), nsl_get( 'packages_sub' ) ); ?>
		<div class="pk-grid">
			<?php foreach ( $nsl_packages as $i => $p ) : ?>
				<div class="pk<?php echo $p['id'] === $nsl_default ? ' pop' : ''; ?>" data-r style="--d:<?php echo (int) $i; ?>">
					<?php if ( $p['badge'] ) : ?><span class="pk-badge"><?php echo esc_html( $p['badge'] ); ?></span><?php endif; ?>
					<h3><?php echo esc_html( $p['name'] ); ?></h3>
					<div class="pk-weight"><?php echo esc_html( $p['weight'] ); ?></div>
					<div class="pk-price">
						<b><?php echo esc_html( nsl_price( $p['price'] ) ); ?></b>
						<?php if ( $p['old'] > $p['price'] ) : ?>
							<del><?php echo esc_html( nsl_price( $p['old'] ) ); ?></del>
							<span class="save"><?php echo esc_html( nsl_num( round( ( $p['old'] - $p['price'] ) / $p['old'] * 100 ) ) ); ?>% ছাড়</span>
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
			$nsl_reviews = nsl_lines( 'reviews', 4 );
			?>
<section class="sec reviews dark">
	<div class="wrap">
		<?php $nsl_title( nsl_get( 'reviews_title' ) ); ?>
		<div class="grid-2">
			<?php foreach ( $nsl_reviews as $i => $rv ) : ?>
				<blockquote class="card review" data-r style="--d:<?php echo (int) ( $i % 2 ); ?>">
					<?php echo $nsl_stars( $rv[3] ? $rv[3] : 5 ); // phpcs:ignore WordPress.Security.EscapeOutput ?>
					<p>“<?php echo esc_html( $rv[2] ); ?>”</p>
					<footer><span class="avatar"><?php echo esc_html( mb_substr( $rv[0], 0, 1 ) ); ?></span><span><b><?php echo esc_html( $rv[0] ); ?></b><small><?php echo esc_html( $rv[1] ); ?></small></span></footer>
				</blockquote>
			<?php endforeach; ?>
		</div>
		<div class="shots">
			<?php
			for ( $s = 1; $s <= 3; $s++ ) {
				$tag = nsl_img( 'review_shots_' . $s, 'medium_large', array( 'alt' => 'Customer review ' . $s ) );
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
			if ( ! $nsl_packages ) {
				break;
			}
			?>
<section class="sec order" id="order">
	<div class="wrap narrow">
		<?php $nsl_title( nsl_get( 'order_title' ), nsl_get( 'order_sub' ) ); ?>
		<form class="order-form" id="nsl-form" novalidate data-r>
			<fieldset>
				<legend><span class="step">১</span> প্যাকেজ বাছাই করুন</legend>
				<div class="opt-list">
					<?php foreach ( $nsl_packages as $p ) : ?>
						<label class="opt">
							<input type="radio" name="package" value="<?php echo (int) $p['id']; ?>" <?php checked( $p['id'], $nsl_default ); ?>>
							<span class="opt-box">
								<span class="opt-name"><b><?php echo esc_html( $p['name'] ); ?></b> <small><?php echo esc_html( $p['weight'] ); ?></small></span>
								<span class="opt-price"><?php echo esc_html( nsl_price( $p['price'] ) ); ?><?php if ( $p['old'] > $p['price'] ) : ?> <del><?php echo esc_html( nsl_price( $p['old'] ) ); ?></del><?php endif; ?></span>
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
						<?php foreach ( $nsl_zones as $z ) : ?>
							<label class="zone"><input type="radio" name="zone" value="<?php echo (int) $z['id']; ?>" <?php checked( $z['id'], 1 ); ?>><span><?php echo esc_html( $z['name'] ); ?> <small><?php echo esc_html( nsl_price( $z['charge'] ) ); ?></small></span></label>
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

			<button type="submit" class="btn btn-cta btn-lg btn-block submit"><span><?php echo esc_html( nsl_get( 'order_button' ) ); ?></span> <b data-sum="total"></b></button>
			<p class="form-msg" role="alert" aria-live="polite"></p>
			<p class="form-note"><?php echo esc_html( nsl_get( 'order_note' ) ); ?></p>
		</form>
		<div class="success" id="nsl-success" hidden tabindex="-1">
			<div class="check" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M14 27l8 8 16-17"/></svg></div>
			<h3><?php echo esc_html( nsl_get( 'success_title' ) ); ?></h3>
			<p class="order-no"></p>
			<p><?php echo esc_html( nsl_get( 'success_text' ) ); ?></p>
			<?php if ( $nsl_wa_link ) : ?><a class="btn btn-ghost" href="<?php echo esc_url( $nsl_wa_link ); ?>" target="_blank" rel="noopener">WhatsApp এ যোগাযোগ</a><?php endif; ?>
		</div>
	</div>
</section>
			<?php
			break;

		case 'faq':
			?>
<section class="sec faq">
	<div class="wrap narrow">
		<?php $nsl_title( nsl_get( 'faq_title' ) ); ?>
		<?php foreach ( nsl_lines( 'faqs', 2 ) as $i => $q ) : ?>
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
		<h2 data-r><?php echo esc_html( nsl_get( 'final_title' ) ); ?></h2>
		<p data-r style="--d:1"><?php echo esc_html( nsl_get( 'final_text' ) ); ?></p>
		<div data-r style="--d:2"><?php $nsl_cta( '', 'btn-lg' ); ?></div>
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
		<p><?php echo esc_html( nsl_get( 'footer_text' ) ); ?></p>
		<nav>
			<?php foreach ( nsl_lines( 'footer_links', 2 ) as $l ) : ?>
				<a href="<?php echo esc_url( $l[1] ); ?>"><?php echo esc_html( $l[0] ); ?></a>
			<?php endforeach; ?>
		</nav>
	</div>
</footer>

<?php if ( $nsl_wa_link ) : ?>
<a class="wa-float<?php echo nsl_get( 'sticky_bar' ) ? ' has-sticky' : ''; ?>" href="<?php echo esc_url( $nsl_wa_link ); ?>" target="_blank" rel="noopener" aria-label="WhatsApp">
	<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#fff" d="M16 3a13 13 0 0 0-11.1 19.7L3 29l6.5-1.7A13 13 0 1 0 16 3zm0 23.7c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.7 10.7 0 1 1 16 26.7zm5.9-8c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.8 8.8 0 0 1-4.4-3.8c-.3-.6.3-.5 1-1.7.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.3 1.4 3.5c.2.2 2.4 3.7 5.8 5.1 2.2.9 3 1 4.1.8.7-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5-.1-.2-.3-.2-.6-.4z"/></svg>
</a>
<?php endif; ?>

<?php if ( nsl_get( 'sticky_bar' ) ) : ?>
<div class="sticky-bar" aria-hidden="true">
	<?php if ( $nsl_phone ) : ?><a class="sb-call" href="tel:<?php echo esc_attr( $nsl_phone ); ?>" tabindex="-1" aria-label="কল করুন">📞</a><?php endif; ?>
	<?php if ( $nsl_wa_link ) : ?><a class="sb-wa" href="<?php echo esc_url( $nsl_wa_link ); ?>" target="_blank" rel="noopener" tabindex="-1" aria-label="WhatsApp"><svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#fff" d="M16 3a13 13 0 0 0-11.1 19.7L3 29l6.5-1.7A13 13 0 1 0 16 3zm5.9 15.7c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.8 8.8 0 0 1-4.4-3.8c-.3-.6.3-.5 1-1.7.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.3 1.4 3.5c.2.2 2.4 3.7 5.8 5.1 2.2.9 3 1 4.1.8.7-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5-.1-.2-.3-.2-.6-.4z"/></svg></a><?php endif; ?>
	<a class="btn btn-cta sb-order" href="#order" tabindex="-1" data-cta><?php echo esc_html( nsl_get( 'sticky_text' ) ); ?> — <?php echo esc_html( nsl_price( $nsl_min ) ); ?> থেকে</a>
</div>
<?php endif; ?>

<script>window.NSL=<?php echo wp_json_encode( array(
	'ajax'      => admin_url( 'admin-ajax.php' ),
	'packages'  => array_map( function ( $p ) { return array( 'id' => $p['id'], 'price' => $p['price'], 'name' => $p['name'] ); }, $nsl_packages ),
	'zones'     => array_map( function ( $z ) { return array( 'id' => $z['id'], 'charge' => $z['charge'] ); }, $nsl_zones ),
	'freeFrom'  => (float) nsl_get( 'free_ship_from' ),
	'currency'  => nsl_get( 'currency' ),
	'bn'        => (bool) nsl_get( 'bangla_digits' ),
	'pixel'     => (bool) $nsl_pixel,
	'freeLabel' => 'ফ্রি',
) ); ?>;</script>
<script src="<?php echo esc_url( NSL_URL . 'assets/landing.js?v=' . NSL_VERSION ); ?>" defer></script>
<?php
if ( $nsl_wp_head ) {
	wp_footer();
}
echo nsl_get( 'footer_code' ); // phpcs:ignore WordPress.Security.EscapeOutput
?>
</body>
</html>
