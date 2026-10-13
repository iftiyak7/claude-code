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

$features = array(
	array( 'pos', $L( 'দ্রুত বিক্রি (POS)', 'Fast checkout (POS)' ), $L( 'বারকোড স্ক্যান বা নাম লিখে খুঁজুন, গ্রাম/কেজিতে খোলা মাল বিক্রি করুন, ভাংতি টাকার হিসাব নিজে থেকেই।', 'Scan a barcode or type a name, sell loose items by gram or kg, and let it work out the change.' ) ),
	array( 'due', $L( 'বাকির খাতা', 'Credit (baki) book' ), $L( 'কার কাছে কত বাকি, কতদিনের পুরনো — এক নজরে। আংশিক জমা নিলেই হিসাব আপডেট।', 'Who owes how much and for how long, at a glance. Part payments update instantly.' ) ),
	array( 'box', $L( 'স্টক ও ক্রয়', 'Stock & purchases' ), $L( 'বিক্রি করলে স্টক কমে, কিনলে বাড়ে। মাল শেষ হওয়ার আগেই সতর্কবার্তা, মেয়াদ ও ব্যাচ ট্র্যাকিং।', 'Stock moves with every sale and purchase. Low-stock alerts, expiry and batch tracking.' ) ),
	array( 'truck', $L( 'অনলাইন অর্ডার ও কুরিয়ার', 'Online orders & courier' ), $L( 'ফেসবুক/হোয়াটসঅ্যাপের অর্ডার লিখে রাখুন, Steadfast-এ এক ক্লিকে পার্সেল বুক, ডেলিভারি আর ফেরত ট্র্যাক করুন।', 'Log Facebook/WhatsApp orders, book Steadfast parcels in one click, track delivery and returns.' ) ),
	array( 'chart', $L( 'লাভ-ক্ষতি ও রিপোর্ট', 'Profit & reports' ), $L( 'আজ কত লাভ, কোন মাল বেশি চলে, খরচ কোথায় যায় — ২৫টির বেশি রিপোর্ট, এক ক্লিকে সব ডাউনলোড।', 'Today\'s profit, best sellers, where the money goes — 25+ reports, download all in one click.' ) ),
	array( 'users', $L( 'কর্মী ও অনুমতি', 'Staff & permissions' ), $L( 'প্রত্যেক কর্মীর আলাদা লগইন। কে কী দেখবে, দাম বদলাতে পারবে কি না — আপনি ঠিক করবেন।', 'Separate logins for every staff member. You decide who sees what and who can change prices.' ) ),
	array( 'print', $L( 'রসিদ ও ইনভয়েস', 'Receipts & invoices' ), $L( 'A4, A5 বা ৫৮/৮০ মিমি থার্মাল প্রিন্টার — ব্লুটুথ প্রিন্টারেও বাংলায় রসিদ।', 'A4, A5 or 58/80 mm thermal — Bangla receipts even on Bluetooth printers.' ) ),
	array( 'wifi', $L( 'নেট না থাকলেও চলে', 'Works offline' ), $L( 'ইন্টারনেট চলে গেলেও বিক্রি থামবে না। নেট ফিরলে সব নিজে থেকেই সার্ভারে উঠে যাবে।', 'Keep selling when the internet drops. Everything syncs by itself when it is back.' ) ),
);

$icons = array(
	'pos'   => '<path d="M4 6h16v9H4z"/><path d="M8 19h8M12 15v4"/>',
	'due'   => '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
	'box'   => '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>',
	'truck' => '<path d="M2 6h11v9H2zM13 9h4l3 3v3h-7"/><circle cx="6" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
	'chart' => '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
	'users' => '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 4a3 3 0 010 6M18 15c2 .5 3 2.5 3 5"/>',
	'print' => '<path d="M6 9V3h12v6"/><path d="M6 18H4v-7h16v7h-2"/><path d="M6 14h12v7H6z"/>',
	'wifi'  => '<path d="M2 8a15 15 0 0120 0M5 12a10 10 0 0114 0M8.5 15.5a5 5 0 017 0"/><circle cx="12" cy="19" r="1"/>',
);
$icon = static fn( string $k ): string => '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' . $icons[ $k ] . '</svg>';

$faq = array(
	array( $L( 'আমার হিসাবের তথ্য কি নিরাপদ?', 'Is my data safe?' ), $L( 'হ্যাঁ। প্রতিটি দোকানের তথ্য আলাদা রাখা হয়, অন্য কেউ দেখতে পারে না। প্রতিটি হিসাবের রেকর্ড থাকে, আর আপনি নিজেও যেকোনো সময় সব ডেটা ও রিপোর্ট ডাউনলোড করে রাখতে পারবেন।', 'Yes. Every shop\'s data is kept separate and nobody else can see it. Every change is logged, and you can download all your data and reports any time.' ) ),
	array( $L( 'কম্পিউটার না থাকলে চলবে?', 'Do I need a computer?' ), $L( 'না। যেকোনো স্মার্টফোনের ব্রাউজার থেকেই পুরোটা চালানো যায়। চাইলে হোম স্ক্রিনে অ্যাপের মতো বসিয়ে নিতে পারবেন।', 'No. Everything works from any smartphone browser, and you can add it to your home screen like an app.' ) ),
	array( $L( 'ইন্টারনেট চলে গেলে কী হবে?', 'What if the internet goes down?' ), $L( 'বিক্রি চালিয়ে যেতে পারবেন। অফলাইনে করা বিক্রি নেট ফিরলে নিজে থেকেই জমা হয়ে যায়, একটাও হারায় না।', 'You can keep selling. Offline sales are saved and sent automatically when the connection returns.' ) ),
	array( $L( 'টাকা কীভাবে দেব?', 'How do I pay?' ), $L( 'বিকাশ, নগদ, রকেট বা ব্যাংকে। টাকা পাঠিয়ে অ্যাপের ভেতরেই ট্রানজেকশন আইডি দিলেই মেয়াদ বেড়ে যাবে।', 'By bKash, Nagad, Rocket or bank. Send the money and enter the transaction ID inside the app to extend your plan.' ) ),
	array( $L( 'পরে বন্ধ করতে চাইলে?', 'Can I stop later?' ), $L( 'যেকোনো সময়। কোনো চুক্তি নেই। বন্ধ করার আগে আপনার সব রিপোর্ট আর ডেটা ডাউনলোড করে নিতে পারবেন।', 'Any time — there is no contract. Download all your reports and data before you leave.' ) ),
	array( $L( 'চালানো শিখতে কি কষ্ট হবে?', 'Is it hard to learn?' ), $L( 'না। পুরোটা বাংলায়, বড় বড় বাটন। দোকান খুলে দেওয়ার সময় আমরা ফোনে দেখিয়ে দিই।', 'No. It is fully in Bangla with large buttons, and we walk you through it on the phone when we open your shop.' ) ),
);
?>
<!doctype html>
<html lang="<?php echo esc_attr( $lang ); ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1a2e">
<title><?php echo esc_html( $L( 'গরিবের হিসাব — দোকানের সহজ ও নিরাপদ হিসাব', 'Goriber Hisab — simple, safe bookkeeping for your shop' ) ); ?></title>
<meta name="description" content="<?php echo esc_attr( $L( 'বিক্রি, বাকি, স্টক, অনলাইন অর্ডার, কুরিয়ার আর লাভ-ক্ষতি — মোবাইল থেকেই, বাংলায়।', 'Sales, credit, stock, online orders, courier and profit — from your phone, in Bangla.' ) ); ?>">
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
		</div>
	</div>
</header>

<section class="hero">
	<div class="wrap hero-in">
		<div class="hero-copy">
			<p class="eyebrow"><span class="dot"></span><?php echo esc_html( $L( 'ছোট ও মাঝারি দোকানের জন্য বানানো', 'Built for small and growing shops' ) ); ?></p>
			<h1><?php echo wp_kses( $L( 'খাতা-কলমের দিন শেষ।<br><em>দোকানের পুরো হিসাব</em> এখন হাতের মুঠোয়।', 'Close the paper ledger.<br><em>Run your whole shop</em> from your phone.' ), array( 'br' => array(), 'em' => array() ) ); ?></h1>
			<p class="lead"><?php echo esc_html( $L( 'বিক্রি, বাকি, স্টক, অনলাইন অর্ডার আর কুরিয়ার — সব এক জায়গায়। দিন শেষে এক ট্যাপে জানুন আজ আসল লাভ কত হলো।', 'Sales, credit, stock, online orders and courier in one place. At the end of the day, one tap shows what you really earned.' ) ); ?></p>
			<div class="cta-row">
				<a class="btn primary big" href="<?php echo esc_url( $whatsapp ); ?>" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.2 5.2 0 001.1 2.7 11.8 11.8 0 004.6 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2s.2-1.1.2-1.2-.2-.2-.4-.3z"/></svg><?php echo esc_html( $trial ? $L( $digits( (string) $trial ) . ' দিন ফ্রি চালিয়ে দেখুন', 'Try it free for ' . $trial . ' days' ) : $L( 'আজই শুরু করুন', 'Get started today' ) ); ?></a>
				<a class="btn light big" href="#features"><?php echo esc_html( $L( 'কী কী আছে দেখুন', 'See what\'s inside' ) ); ?></a>
			</div>
			<ul class="ticks">
				<li><?php echo esc_html( $L( 'কোনো সেটআপ খরচ নেই', 'No setup fee' ) ); ?></li>
				<li><?php echo esc_html( $L( 'বাংলা ও ইংরেজি', 'Bangla & English' ) ); ?></li>
				<li><?php echo esc_html( $L( 'যেকোনো সময় বন্ধ করা যায়', 'Cancel any time' ) ); ?></li>
			</ul>
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

<section class="who">
	<div class="wrap">
		<p><?php echo esc_html( $L( 'যে কোনো দোকানে মানিয়ে যায়', 'Fits every kind of shop' ) ); ?></p>
		<ul>
			<?php foreach ( array( array( 'মুদি দোকান', 'Grocery' ), array( 'ফার্মেসি', 'Pharmacy' ), array( 'কাপড়ের দোকান', 'Clothing' ), array( 'মোবাইল ও ইলেকট্রনিক্স', 'Mobile & electronics' ), array( 'ফেসবুক পেজ / অনলাইন শপ', 'Facebook / online shop' ), array( 'পাইকারি ব্যবসা', 'Wholesale' ), array( 'রেস্টুরেন্ট', 'Restaurant' ) ) as $w ) : ?>
				<li><?php echo esc_html( $L( $w[0], $w[1] ) ); ?></li>
			<?php endforeach; ?>
		</ul>
	</div>
</section>

<section class="pain">
	<div class="wrap pain-in">
		<div>
			<h2><?php echo esc_html( $L( 'দিন শেষে ক্যাশ মেলে না?', 'Cash never adds up at night?' ) ); ?></h2>
			<p><?php echo esc_html( $L( 'খাতার পাতা হারায়, বাকির হিসাব মনে থাকে না, কোন মাল শেষ সেটা বোঝা যায় মাল চাইতে এসে খালি হাতে ফিরলে। গরিবের হিসাব এই ঝামেলাগুলো সরিয়ে দেয় — আপনি শুধু বিক্রিতে মন দিন।', 'Pages go missing, credit is forgotten, and you notice an item ran out only when a customer leaves empty-handed. Goriber Hisab takes that worry away so you can focus on selling.' ) ); ?></p>
		</div>
		<table class="vs">
			<thead><tr><th></th><th><?php echo esc_html( $L( 'খাতা-কলম', 'Paper ledger' ) ); ?></th><th><?php echo esc_html( $L( 'গরিবের হিসাব', 'Goriber Hisab' ) ); ?></th></tr></thead>
			<tbody>
				<?php
				foreach ( array(
					array( 'আজকের লাভ জানা', 'Knowing today\'s profit', 'রাতে বসে যোগ-বিয়োগ', 'Adding up at night', 'সাথে সাথে', 'Instantly' ),
					array( 'বাকির হিসাব', 'Credit tracking', 'পাতা উল্টে খোঁজা', 'Flipping pages', 'নাম লিখলেই', 'Type a name' ),
					array( 'স্টক শেষ', 'Out of stock', 'কাস্টমার ফেরত গেলে', 'When a customer leaves', 'আগেই সতর্কবার্তা', 'Warned in advance' ),
					array( 'কর্মীর বিক্রি', 'Staff sales', 'বিশ্বাসের উপর', 'Trust only', 'প্রতিটি বিক্রির রেকর্ড', 'Every sale recorded' ),
					array( 'কুরিয়ারের টাকা', 'Courier COD', 'মেলানো কঠিন', 'Hard to reconcile', 'অর্ডার ধরে হিসাব', 'Matched per order' ),
				) as $r ) :
					?>
					<tr><th><?php echo esc_html( $L( $r[0], $r[1] ) ); ?></th><td class="bad"><?php echo esc_html( $L( $r[2], $r[3] ) ); ?></td><td class="good"><?php echo esc_html( $L( $r[4], $r[5] ) ); ?></td></tr>
				<?php endforeach; ?>
			</tbody>
		</table>
	</div>
</section>

<section class="features" id="features">
	<div class="wrap">
		<p class="kicker"><?php echo esc_html( $L( 'যা যা পাবেন', 'What you get' ) ); ?></p>
		<h2><?php echo esc_html( $L( 'একটি অ্যাপ, দোকানের সব কাজ', 'One app for everything in your shop' ) ); ?></h2>
		<div class="grid">
			<?php foreach ( $features as $f ) : ?>
				<article class="feat">
					<span class="ic"><?php echo $icon( $f[0] ); // phpcs:ignore WordPress.Security.EscapeOutput -- static SVG. ?></span>
					<h3><?php echo esc_html( $f[1] ); ?></h3>
					<p><?php echo esc_html( $f[2] ); ?></p>
				</article>
			<?php endforeach; ?>
		</div>
	</div>
</section>

<section class="how" id="how">
	<div class="wrap">
		<p class="kicker"><?php echo esc_html( $L( 'শুরু করা একদম সহজ', 'Getting started is easy' ) ); ?></p>
		<h2><?php echo esc_html( $L( 'আজ যোগাযোগ করুন, আজই বিক্রি শুরু', 'Message us today, start selling today' ) ); ?></h2>
		<ol class="steps">
			<li><b><?php echo esc_html( $digits( '1' ) ); ?></b><h3><?php echo esc_html( $L( 'হোয়াটসঅ্যাপে জানান', 'Message us on WhatsApp' ) ); ?></h3><p><?php echo esc_html( $L( 'দোকানের নাম আর কী ধরনের ব্যবসা — এটুকু বললেই হবে।', 'Just tell us your shop name and what you sell.' ) ); ?></p></li>
			<li><b><?php echo esc_html( $digits( '2' ) ); ?></b><h3><?php echo esc_html( $L( 'আপনার দোকান তৈরি', 'We open your shop' ) ); ?></h3><p><?php echo esc_html( $L( 'আমরা আপনার নামে দোকান খুলে ইমেইল আর পাসওয়ার্ড পাঠিয়ে দেব।', 'We set up your shop and send you an email and password.' ) ); ?></p></li>
			<li><b><?php echo esc_html( $digits( '3' ) ); ?></b><h3><?php echo esc_html( $L( 'লগইন করে বিক্রি', 'Log in and sell' ) ); ?></h3><p><?php echo esc_html( $L( 'মাল যোগ করুন, প্রথম বিক্রি করুন। আটকে গেলে ফোন দিন, আমরা আছি।', 'Add your products and make the first sale. Stuck? Call us — we\'re here.' ) ); ?></p></li>
		</ol>
	</div>
</section>

<section class="price" id="price">
	<div class="wrap">
		<p class="kicker"><?php echo esc_html( $L( 'সহজ দাম', 'Simple pricing' ) ); ?></p>
		<h2><?php echo esc_html( $L( 'সব সুবিধা, একটাই প্যাকেজ', 'Every feature, one plan' ) ); ?></h2>
		<div class="toggle" role="tablist">
			<button type="button" class="on" data-cycle="m" role="tab" aria-selected="true"><?php echo esc_html( $L( 'মাসিক', 'Monthly' ) ); ?></button>
			<button type="button" data-cycle="y" role="tab" aria-selected="false"><?php echo esc_html( $L( 'বাৎসরিক', 'Yearly' ) ); ?><?php if ( $save > 0 ) : ?> <em><?php echo esc_html( $L( $cur . $money( $save ) . ' সাশ্রয়', 'save ' . $cur . $money( $save ) ) ); ?></em><?php endif; ?></button>
		</div>
		<div class="plan">
			<div class="plan-head">
				<?php if ( $trial ) : ?><span class="badge"><?php echo esc_html( $L( 'প্রথম ' . $digits( (string) $trial ) . ' দিন ফ্রি', 'First ' . $trial . ' days free' ) ); ?></span><?php endif; ?>
				<p class="amount" data-m="<?php echo esc_attr( $cur . $money( $monthly ) ); ?>" data-y="<?php echo esc_attr( $cur . $money( $yearly ) ); ?>"><b><?php echo esc_html( $cur . $money( $monthly ) ); ?></b><span data-m="<?php echo esc_attr( $L( '/ মাস', '/ month' ) ); ?>" data-y="<?php echo esc_attr( $L( '/ বছর', '/ year' ) ); ?>"><?php echo esc_html( $L( '/ মাস', '/ month' ) ); ?></span></p>
				<p class="per" data-m="<?php echo esc_attr( $L( 'দিনে মাত্র ' . $cur . $money( $monthly / 30 ), 'Only ' . $cur . $money( $monthly / 30 ) . ' a day' ) ); ?>" data-y="<?php echo esc_attr( $L( 'মাসে পড়ে ' . $cur . $money( $yearly / 12 ), 'Works out to ' . $cur . $money( $yearly / 12 ) . ' a month' ) ); ?>"><?php echo esc_html( $L( 'দিনে মাত্র ' . $cur . $money( $monthly / 30 ), 'Only ' . $cur . $money( $monthly / 30 ) . ' a day' ) ); ?></p>
				<a class="btn primary big" href="<?php echo esc_url( $whatsapp ); ?>" target="_blank" rel="noopener"><?php echo esc_html( $L( 'দোকান খুলে দিন', 'Open my shop' ) ); ?></a>
			</div>
			<ul class="incl">
				<?php
				foreach ( array(
					array( 'সীমাহীন বিক্রি, পণ্য ও গ্রাহক', 'Unlimited sales, products & customers' ),
					array( 'POS, বারকোড ও খোলা মাল', 'POS, barcode & loose items' ),
					array( 'বাকির খাতা ও আদায়', 'Credit book & collections' ),
					array( 'স্টক, ক্রয় ও সাপ্লায়ার', 'Stock, purchases & suppliers' ),
					array( 'অনলাইন অর্ডার ও কুরিয়ার', 'Online orders & courier' ),
					array( 'লাভ-ক্ষতি, ব্যালান্স শিট ও ২৫+ রিপোর্ট', 'P&L, balance sheet & 25+ reports' ),
					array( 'কর্মীদের আলাদা লগইন', 'Separate staff logins' ),
					array( 'রসিদ প্রিন্ট ও অফলাইন মোড', 'Receipt printing & offline mode' ),
					array( 'ফোনে সাহায্য ও প্রশিক্ষণ', 'Phone support & training' ),
				) as $i ) :
					?>
					<li><?php echo esc_html( $L( $i[0], $i[1] ) ); ?></li>
				<?php endforeach; ?>
			</ul>
		</div>
		<p class="pay-note"><?php echo esc_html( $L( 'বিকাশ, নগদ, রকেট বা ব্যাংকে পেমেন্ট। কোনো লুকানো খরচ নেই।', 'Pay by bKash, Nagad, Rocket or bank. No hidden charges.' ) ); ?></p>
	</div>
</section>

<section class="faq" id="faq">
	<div class="wrap narrow">
		<p class="kicker"><?php echo esc_html( $L( 'প্রশ্ন ও উত্তর', 'Questions & answers' ) ); ?></p>
		<h2><?php echo esc_html( $L( 'শুরু করার আগে যা জানতে চান', 'Before you start' ) ); ?></h2>
		<?php foreach ( $faq as $i => $q ) : ?>
			<details<?php echo 0 === $i ? ' open' : ''; ?>><summary><?php echo esc_html( $q[0] ); ?></summary><p><?php echo esc_html( $q[1] ); ?></p></details>
		<?php endforeach; ?>
	</div>
</section>

<section class="band">
	<div class="wrap band-in">
		<div>
			<h2><?php echo esc_html( $L( 'আপনার দোকানের হিসাব আজই গুছিয়ে নিন', 'Get your shop\'s books in order today' ) ); ?></h2>
			<p><?php echo esc_html( $L( 'একটা মেসেজ পাঠান — বাকিটা আমরা করে দেব।', 'Send one message — we\'ll handle the rest.' ) ); ?></p>
		</div>
		<a class="btn primary big" href="<?php echo esc_url( $whatsapp ); ?>" target="_blank" rel="noopener"><?php echo esc_html( $L( 'হোয়াটসঅ্যাপে কথা বলুন', 'Chat on WhatsApp' ) ); ?></a>
	</div>
</section>

<footer class="foot">
	<div class="wrap foot-in">
		<a class="logo" href="<?php echo esc_url( $here ); ?>"><img src="<?php echo esc_url( $asset( 'img/icon.svg' ) ); ?>" alt="" width="32" height="32"><span><b><?php echo esc_html( $L( 'গরিবের', 'Goriber' ) ); ?></b> <?php echo esc_html( $L( 'হিসাব', 'Hisab' ) ); ?></span></a>
		<p class="tag"><?php echo esc_html( $L( 'সহজ ও নিরাপদ হিসাব', 'Simple, safe bookkeeping' ) ); ?></p>
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
