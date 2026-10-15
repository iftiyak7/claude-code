<?php
/**
 * Public landing page.
 *
 * Variables: $lang, $config, $login, $app, $L(bn, en), $digits(), $whatsapp, $phone.
 *
 * @package GoriberHisab
 */

defined( 'ABSPATH' ) || exit;

$asset   = static fn( string $p ): string => GORIBER_HISAB_URL . 'assets/' . $p . '?v=' . GORIBER_HISAB_VERSION;
$money   = static fn( $v ): string => $digits( number_format( (float) $v, 0 ) );
$monthly = (float) $config['monthly_price'];
$yearly  = (float) $config['yearly_price'];
$save    = max( 0, $monthly * 12 - $yearly );
$trial   = (int) $config['trial_days'];
$cur     = (string) $config['currency'];
$other   = 'en' === $lang ? 'bn' : 'en';
$here    = home_url( '/' );

$c     = \GoriberHisab\Admin\LandingContent::load();
$T     = static function ( $pair ) use ( $L, $digits, $trial ): string {
	$pair = is_array( $pair ) ? $pair : array();
	$bn   = (string) ( $pair['bn'] ?? '' );
	$en   = (string) ( $pair['en'] ?? '' );
	$text = $L( '' !== $bn ? $bn : $en, '' !== $en ? $en : $bn );
	return str_replace( '{trial}', $digits( (string) $trial ), $text );
};
$H     = static function ( $pair ) use ( $T ): string {
	$html = nl2br( esc_html( $T( $pair ) ), false );
	return (string) preg_replace( '/\*(.+?)\*/u', '<em>$1</em>', $html );
};
$show  = $c['show'];
$signup_url = ! empty( $config['signup'] ) ? \GoriberHisab\Admin\AppRoute::signupUrl() : $whatsapp;

$icons = array(
	'pos'   => '<path d="M4 6h16v9H4z"/><path d="M8 19h8M12 15v4"/>',
	'due'   => '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
	'box'   => '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>',
	'truck' => '<path d="M2 6h11v9H2zM13 9h4l3 3v3h-7"/><circle cx="6" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
	'chart' => '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
	'users' => '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 4a3 3 0 010 6M18 15c2 .5 3 2.5 3 5"/>',
	'print' => '<path d="M6 9V3h12v6"/><path d="M6 18H4v-7h16v7h-2"/><path d="M6 14h12v7H6z"/>',
	'wifi'  => '<path d="M2 8a15 15 0 0120 0M5 12a10 10 0 0114 0M8.5 15.5a5 5 0 017 0"/><circle cx="12" cy="19" r="1"/>',
	'star'  => '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
	'shield' => '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
	'phone' => '<path d="M7 2h10v20H7z"/><path d="M11 18h2"/>',
	'cash'  => '<path d="M2 6h20v12H2z"/><circle cx="12" cy="12" r="3"/>',
);
$icon = static fn( string $k ): string => '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' . ( $icons[ $k ] ?? $icons['star'] ) . '</svg>';

?>
<!doctype html>
<html lang="<?php echo esc_attr( $lang ); ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1a2e">
<title><?php echo esc_html( $T( $c['meta_title'] ) ); ?></title>
<meta name="description" content="<?php echo esc_attr( $T( $c['meta_desc'] ) ); ?>">
<link rel="icon" href="<?php echo esc_url( $asset( 'img/icon.svg' ) ); ?>" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="<?php echo esc_url( $asset( 'css/landing.css' ) ); ?>">
</head>
<body>
<header class="nav">
	<div class="wrap nav-in">
		<a class="logo" href="<?php echo esc_url( $here ); ?>"><img src="<?php echo esc_url( $asset( 'img/icon.svg' ) ); ?>" alt="" width="38" height="38"><span><b><?php echo esc_html( $L( 'গরিবের', 'Goriber' ) ); ?></b> <?php echo esc_html( $L( 'হিসাব', 'Hisab' ) ); ?></span></a>
		<nav class="links" aria-label="<?php echo esc_attr( $L( 'মেনু', 'Menu' ) ); ?>">
			<a href="#features"><?php echo esc_html( $L( 'সুবিধা', 'Features' ) ); ?></a>
			<a href="#how"><?php echo esc_html( $L( 'শুরু করবেন যেভাবে', 'How it works' ) ); ?></a>
			<a href="#price"><?php echo esc_html( $L( 'খরচ', 'Pricing' ) ); ?></a>
			<a href="#faq"><?php echo esc_html( $L( 'জিজ্ঞাসা', 'FAQ' ) ); ?></a>
		</nav>
		<div class="nav-cta">
			<a class="lang" href="<?php echo esc_url( add_query_arg( 'lang', $other, $here ) ); ?>" hreflang="<?php echo esc_attr( $other ); ?>"><?php echo 'en' === $lang ? 'বাংলা' : 'English'; ?></a>
			<a class="btn ghost" href="<?php echo esc_url( $app ?: $login ); ?>"><?php echo esc_html( $app ? $L( 'অ্যাপ খুলুন', 'Open app' ) : $L( 'লগইন', 'Log in' ) ); ?></a>
			<?php if ( ! $app && ! empty( $config['signup'] ) ) : ?><a class="btn primary hide-sm" href="<?php echo esc_url( $signup_url ); ?>"><?php echo esc_html( $L( 'সাইন আপ', 'Sign up' ) ); ?></a><?php endif; ?>
		</div>
	</div>
</header>

<section class="hero">
	<div class="wrap hero-in">
		<div class="hero-copy">
			<p class="eyebrow"><span class="dot"></span><?php echo esc_html( $T( $c['eyebrow'] ) ); ?></p>
			<h1><?php echo wp_kses( $H( $c['hero_title'] ), array( 'br' => array(), 'em' => array() ) ); ?></h1>
			<p class="lead"><?php echo esc_html( $T( $c['hero_lead'] ) ); ?></p>
			<div class="cta-row">
				<a class="btn primary big" href="<?php echo esc_url( ! empty( $config['signup'] ) ? add_query_arg( 'start', 'trial', $signup_url ) : $signup_url ); ?>"><?php if ( empty( $config['signup'] ) ) : ?><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.2 5.2 0 001.1 2.7 11.8 11.8 0 004.6 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2s.2-1.1.2-1.2-.2-.2-.4-.3z"/></svg><?php endif; ?><?php echo esc_html( $T( $c['cta_primary'] ) ); ?></a>
				<a class="btn light big" href="#features"><?php echo esc_html( $T( $c['cta_secondary'] ) ); ?></a>
			</div>
			<a class="apk-link" href="<?php echo esc_url( \GoriberHisab\Admin\AppRoute::downloadUrl() ); ?>" rel="nofollow"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M17.6 9.48l1.84-3.18a.38.38 0 10-.66-.38l-1.86 3.22a11.4 11.4 0 00-9.84 0L5.22 5.92a.38.38 0 10-.66.38L6.4 9.48A10.8 10.8 0 001 18h22a10.8 10.8 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z"/></svg><span><small><?php echo esc_html( $L( 'অফলাইনেও চলে', 'Works offline' ) ); ?></small><?php echo esc_html( $L( 'অ্যান্ড্রয়েড অ্যাপ ডাউনলোড', 'Download Android app' ) ); ?></span></a>
			<ul class="ticks">
				<?php foreach ( $c['ticks'] as $i ) : ?><li><?php echo esc_html( $T( $i['text'] ) ); ?></li><?php endforeach; ?>
			</ul>
			<?php \GoriberHisab\Admin\Landing::credit( $L, 'nooriyah-hero' ); ?>
		</div>
		<div class="hero-art" aria-hidden="true">
			<div class="phone">
				<div class="ph-top"><span><?php echo esc_html( $L( 'আজকের হিসাব', 'Today' ) ); ?></span><i></i></div>
				<div class="ph-stats">
					<div><small><?php echo esc_html( $L( 'বিক্রি', 'Sales' ) ); ?></small><b>৳<?php echo esc_html( $digits( '18,450' ) ); ?></b></div>
					<div class="g"><small><?php echo esc_html( $L( 'লাভ', 'Profit' ) ); ?></small><b>৳<?php echo esc_html( $digits( '3,920' ) ); ?></b></div>
					<div class="w"><small><?php echo esc_html( $L( 'বাকি আদায়', 'Credit collected' ) ); ?></small><b>৳<?php echo esc_html( $digits( '2,100' ) ); ?></b></div>
					<div><small><?php echo esc_html( $L( 'অর্ডার', 'Orders' ) ); ?></small><b><?php echo esc_html( $digits( '12' ) ); ?></b></div>
				</div>
				<div class="ph-chart"><?php foreach ( array( 38, 52, 45, 66, 58, 80, 92 ) as $h ) : ?><span style="height:<?php echo (int) $h; ?>%"></span><?php endforeach; ?></div>
				<div class="ph-list">
					<p><span><?php echo esc_html( $L( 'চিনিগুঁড়া চাল ৫ কেজি', 'Fine rice 5 kg' ) ); ?></span><b>৳<?php echo esc_html( $digits( '650' ) ); ?></b></p>
					<p><span><?php echo esc_html( $L( 'বাদাম ২৫০ গ্রাম', 'Peanuts 250 g' ) ); ?></span><b>৳<?php echo esc_html( $digits( '70' ) ); ?></b></p>
					<p><span><?php echo esc_html( $L( 'সয়াবিন তেল ১ লি.', 'Soybean oil 1 L' ) ); ?></span><b>৳<?php echo esc_html( $digits( '185' ) ); ?></b></p>
				</div>
				<div class="ph-btn"><?php echo esc_html( $L( 'টাকা নিন  ৳' . $digits( '905' ), 'Charge  ৳905' ) ); ?></div>
			</div>
			<div class="float f1"><b>✓</b> <?php echo esc_html( $L( 'পার্সেল বুক হয়েছে', 'Parcel booked' ) ); ?><small>Steadfast · #SF<?php echo esc_html( $digits( '48213' ) ); ?></small></div>
			<div class="float f2"><b>৳</b> <?php echo esc_html( $L( 'রহিম ভাই বাকি দিলেন', 'Rahim paid his dues' ) ); ?><small><?php echo esc_html( $L( '৳' . $digits( '1,200' ) . ' জমা', '৳1,200 received' ) ); ?></small></div>
		</div>
	</div>
</section>

<?php if ( $show['who'] ) : ?>
<section class="who">
	<div class="wrap">
		<p><?php echo esc_html( $T( $c['who_title'] ) ); ?></p>
		<ul>
			<?php foreach ( $c['who_items'] as $w ) : ?><li><?php echo esc_html( $T( $w['text'] ) ); ?></li><?php endforeach; ?>
		</ul>
	</div>
</section>
<?php endif; ?>

<?php if ( $show['pain'] ) : ?>
<section class="pain">
	<div class="wrap pain-in">
		<div>
			<h2><?php echo esc_html( $T( $c['pain_title'] ) ); ?></h2>
			<p><?php echo esc_html( $T( $c['pain_text'] ) ); ?></p>
		</div>
		<table class="vs">
			<thead><tr><th></th><th><?php echo esc_html( $T( $c['vs_old'] ) ); ?></th><th><?php echo esc_html( $T( $c['vs_new'] ) ); ?></th></tr></thead>
			<tbody>
				<?php foreach ( $c['vs_rows'] as $r ) : ?>
					<tr><th><?php echo esc_html( $T( $r['label'] ) ); ?></th><td class="bad"><?php echo esc_html( $T( $r['old'] ) ); ?></td><td class="good"><?php echo esc_html( $T( $r['new'] ) ); ?></td></tr>
				<?php endforeach; ?>
			</tbody>
		</table>
	</div>
</section>
<?php endif; ?>

<?php if ( $show['features'] ) : ?>
<section class="features" id="features">
	<div class="wrap">
		<p class="kicker"><?php echo esc_html( $T( $c['features_kicker'] ) ); ?></p>
		<h2><?php echo esc_html( $T( $c['features_title'] ) ); ?></h2>
		<div class="grid">
			<?php foreach ( $c['features'] as $f ) : ?>
				<article class="feat">
					<span class="ic"><?php echo $icon( (string) $f['icon'] ); // phpcs:ignore WordPress.Security.EscapeOutput -- static SVG. ?></span>
					<h3><?php echo esc_html( $T( $f['title'] ) ); ?></h3>
					<p><?php echo esc_html( $T( $f['text'] ) ); ?></p>
				</article>
			<?php endforeach; ?>
		</div>
	</div>
</section>
<?php endif; ?>

<?php if ( $show['how'] ) : ?>
<section class="how" id="how">
	<div class="wrap">
		<p class="kicker"><?php echo esc_html( $T( $c['how_kicker'] ) ); ?></p>
		<h2><?php echo esc_html( $T( $c['how_title'] ) ); ?></h2>
		<ol class="steps">
			<?php foreach ( $c['steps'] as $n => $st ) : ?>
				<li><b><?php echo esc_html( $digits( (string) ( $n + 1 ) ) ); ?></b><h3><?php echo esc_html( $T( $st['title'] ) ); ?></h3><p><?php echo esc_html( $T( $st['text'] ) ); ?></p></li>
			<?php endforeach; ?>
		</ol>
	</div>
</section>
<?php endif; ?>

<?php if ( $show['price'] ) : ?>
<section class="price" id="price">
	<div class="wrap">
		<p class="kicker"><?php echo esc_html( $T( $c['price_kicker'] ) ); ?></p>
		<h2><?php echo esc_html( $T( $c['price_title'] ) ); ?></h2>
		<div class="toggle" role="tablist">
			<button type="button" class="on" data-cycle="m" role="tab" aria-selected="true"><?php echo esc_html( $L( 'মাসিক', 'Monthly' ) ); ?></button>
			<button type="button" data-cycle="y" role="tab" aria-selected="false"><?php echo esc_html( $L( 'বাৎসরিক', 'Yearly' ) ); ?><?php if ( $save > 0 ) : ?> <em><?php echo esc_html( $L( $cur . $money( $save ) . ' সাশ্রয়', 'save ' . $cur . $money( $save ) ) ); ?></em><?php endif; ?></button>
		</div>
		<div class="plan">
			<div class="plan-head">
				<?php if ( $trial ) : ?><span class="badge"><?php echo esc_html( $L( 'প্রথম ' . $digits( (string) $trial ) . ' দিন ফ্রি', 'First ' . $trial . ' days free' ) ); ?></span><?php endif; ?>
				<p class="amount" data-m="<?php echo esc_attr( $cur . $money( $monthly ) ); ?>" data-y="<?php echo esc_attr( $cur . $money( $yearly ) ); ?>"><b><?php echo esc_html( $cur . $money( $monthly ) ); ?></b><span data-m="<?php echo esc_attr( $L( '/ মাস', '/ month' ) ); ?>" data-y="<?php echo esc_attr( $L( '/ বছর', '/ year' ) ); ?>"><?php echo esc_html( $L( '/ মাস', '/ month' ) ); ?></span></p>
				<p class="per" data-m="<?php echo esc_attr( $L( 'দিনে মাত্র ' . $cur . $money( $monthly / 30 ), 'Only ' . $cur . $money( $monthly / 30 ) . ' a day' ) ); ?>" data-y="<?php echo esc_attr( $L( 'মাসে পড়ে ' . $cur . $money( $yearly / 12 ), 'Works out to ' . $cur . $money( $yearly / 12 ) . ' a month' ) ); ?>"><?php echo esc_html( $L( 'দিনে মাত্র ' . $cur . $money( $monthly / 30 ), 'Only ' . $cur . $money( $monthly / 30 ) . ' a day' ) ); ?></p>
				<a class="btn primary big" href="<?php echo esc_url( $signup_url ); ?>"><?php echo esc_html( $T( $c['plan_cta'] ) ); ?></a>
			</div>
			<ul class="incl">
				<?php foreach ( $c['plan_items'] as $i ) : ?><li><?php echo esc_html( $T( $i['text'] ) ); ?></li><?php endforeach; ?>
			</ul>
		</div>
		<p class="pay-note"><?php echo esc_html( $T( $c['pay_note'] ) ); ?></p>
	</div>
</section>
<?php endif; ?>

<?php if ( $show['faq'] ) : ?>
<section class="faq" id="faq">
	<div class="wrap narrow">
		<p class="kicker"><?php echo esc_html( $T( $c['faq_kicker'] ) ); ?></p>
		<h2><?php echo esc_html( $T( $c['faq_title'] ) ); ?></h2>
		<?php foreach ( $c['faq'] as $i => $q ) : ?>
			<details<?php echo 0 === $i ? ' open' : ''; ?>><summary><?php echo esc_html( $T( $q['q'] ) ); ?></summary><p><?php echo esc_html( $T( $q['a'] ) ); ?></p></details>
		<?php endforeach; ?>
	</div>
</section>
<?php endif; ?>

<?php if ( $show['band'] ) : ?>
<section class="band">
	<div class="wrap band-in">
		<div>
			<h2><?php echo esc_html( $T( $c['band_title'] ) ); ?></h2>
			<p><?php echo esc_html( $T( $c['band_text'] ) ); ?></p>
		</div>
		<div class="band-cta">
			<?php if ( ! empty( $config['signup'] ) ) : ?><a class="btn primary big" href="<?php echo esc_url( $signup_url ); ?>"><?php echo esc_html( $T( $c['plan_cta'] ) ); ?></a><?php endif; ?>
			<a class="btn light big" href="<?php echo esc_url( $whatsapp ); ?>" target="_blank" rel="noopener"><?php echo esc_html( $T( $c['band_cta'] ) ); ?></a>
		</div>
	</div>
</section>
<?php endif; ?>

<footer class="foot">
	<div class="wrap foot-in">
		<a class="logo" href="<?php echo esc_url( $here ); ?>"><img src="<?php echo esc_url( $asset( 'img/icon.svg' ) ); ?>" alt="" width="32" height="32"><span><b><?php echo esc_html( $L( 'গরিবের', 'Goriber' ) ); ?></b> <?php echo esc_html( $L( 'হিসাব', 'Hisab' ) ); ?></span></a>
		<p class="tag"><?php echo esc_html( $T( $c['footer_tag'] ) ); ?></p>
		<?php \GoriberHisab\Admin\Landing::credit( $L, 'nooriyah-foot' ); ?>
		<p>
			<?php if ( $phone ) : ?><a href="tel:<?php echo esc_attr( preg_replace( '/[^0-9+]/', '', $phone ) ); ?>"><?php echo esc_html( $digits( $phone ) ); ?></a> · <?php endif; ?>
			<a href="<?php echo esc_url( $login ); ?>"><?php echo esc_html( $L( 'লগইন', 'Log in' ) ); ?></a> ·
			<a href="<?php echo esc_url( add_query_arg( 'lang', $other, $here ) ); ?>"><?php echo 'en' === $lang ? 'বাংলা' : 'English'; ?></a>
		</p>
		<p class="copy">© <?php echo esc_html( $digits( gmdate( 'Y' ) ) ); ?> <?php echo esc_html( $L( 'গরিবের হিসাব', 'Goriber Hisab' ) ); ?></p>
	</div>
</footer>

<?php if ( '' !== $phone ) : ?>
<a class="wa-float" href="<?php echo esc_url( $whatsapp ); ?>" target="_blank" rel="noopener" aria-label="WhatsApp"><svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm4.5 12.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.2 5.2 0 001.1 2.7 11.8 11.8 0 004.6 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2s.2-1.1.2-1.2-.2-.2-.4-.3z"/></svg></a>
<?php endif; ?>
<script>
document.querySelectorAll('.toggle button').forEach(function (b) {
	b.addEventListener('click', function () {
		var c = b.dataset.cycle;
		document.querySelectorAll('.toggle button').forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
		document.querySelectorAll('[data-' + c + ']').forEach(function (el) {
			if (el.classList.contains('amount')) { el.querySelector('b').textContent = el.dataset[c]; } else { el.textContent = el.dataset[c]; }
		});
	});
});
</script>
</body>
</html>
