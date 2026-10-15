<?php
/**
 * Branded login page (shop owners and staff).
 *
 * Variables: $platform, $error, $login, $redirect, $lang, $L(bn, en).
 *
 * @package GoriberHisab
 */

defined( 'ABSPATH' ) || exit;

$asset = static fn( string $p ): string => GORIBER_HISAB_URL . 'assets/' . $p . '?v=' . GORIBER_HISAB_VERSION;
$other = 'en' === $lang ? 'bn' : 'en';
$self  = \GoriberHisab\Admin\AppRoute::loginUrl();
$phone = (string) ( $platform['support_phone'] ?: $platform['whatsapp'] );
?>
<!doctype html>
<html lang="<?php echo esc_attr( $lang ); ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1a2e">
<meta name="robots" content="noindex, nofollow">
<title><?php echo esc_html( $L( 'লগইন — গরিবের হিসাব', 'Log in — Goriber Hisab' ) ); ?></title>
<link rel="icon" href="<?php echo esc_url( $asset( 'img/icon.svg' ) ); ?>" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="<?php echo esc_url( $asset( 'css/auth.css' ) ); ?>">
</head>
<body>
<aside class="side">
	<a class="brand" href="<?php echo esc_url( home_url( '/' ) ); ?>"><img src="<?php echo esc_url( $asset( 'img/icon.svg' ) ); ?>" alt="" width="42" height="42"><span><b><?php echo esc_html( $L( 'গরিবের', 'Goriber' ) ); ?></b> <?php echo esc_html( $L( 'হিসাব', 'Hisab' ) ); ?></span></a>
	<div>
		<h2><?php echo wp_kses( $L( 'আপনার দোকানের হিসাব,<br><em>সহজ ও নিরাপদ।</em>', 'Your shop\'s books,<br><em>simple and safe.</em>' ), array( 'br' => array(), 'em' => array() ) ); ?></h2>
		<ul>
			<li><?php echo esc_html( $L( 'বিক্রি, বাকি আর স্টক এক জায়গায়', 'Sales, credit and stock in one place' ) ); ?></li>
			<li><?php echo esc_html( $L( 'অনলাইন অর্ডার ও কুরিয়ার ট্র্যাকিং', 'Online orders and courier tracking' ) ); ?></li>
			<li><?php echo esc_html( $L( 'প্রতিদিনের লাভ-ক্ষতি এক ট্যাপে', 'Daily profit in one tap' ) ); ?></li>
		</ul>
	</div>
	<?php \GoriberHisab\Admin\Landing::credit( $L ); ?>
</aside>
<main>
	<div class="top">
		<a href="<?php echo esc_url( add_query_arg( 'lang', $other, $self ) ); ?>"><?php echo 'en' === $lang ? 'বাংলা' : 'English'; ?></a>
		<a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php echo esc_html( $L( 'হোম', 'Home' ) ); ?></a>
	</div>
	<div class="card">
		<a class="brand m-brand" href="<?php echo esc_url( home_url( '/' ) ); ?>"><img src="<?php echo esc_url( $asset( 'img/icon.svg' ) ); ?>" alt="" width="40" height="40"><span><b><?php echo esc_html( $L( 'গরিবের', 'Goriber' ) ); ?></b> <?php echo esc_html( $L( 'হিসাব', 'Hisab' ) ); ?></span></a>
		<h1><?php echo esc_html( $L( 'আবার স্বাগতম 👋', 'Welcome back 👋' ) ); ?></h1>
		<p class="sub"><?php echo esc_html( $L( 'আপনার দোকানে ঢুকতে লগইন করুন।', 'Log in to open your shop.' ) ); ?></p>
		<?php if ( '' !== $error ) : ?>
			<div class="error" role="alert"><span aria-hidden="true">⚠</span><span><?php echo esc_html( $error ); ?></span></div>
		<?php endif; ?>
		<form method="post" action="<?php echo esc_url( $self ); ?>">
			<label for="log"><?php echo esc_html( $L( 'ইমেইল', 'Email' ) ); ?></label>
			<input type="text" id="log" name="log" value="<?php echo esc_attr( $login ); ?>" autocomplete="username" inputmode="email" placeholder="you@gmail.com" required autofocus>
			<label for="pwd"><?php echo esc_html( $L( 'পাসওয়ার্ড', 'Password' ) ); ?></label>
			<div class="pw">
				<input type="password" id="pwd" name="pwd" autocomplete="current-password" required>
				<button type="button" data-show="<?php echo esc_attr( $L( 'দেখুন', 'Show' ) ); ?>" data-hide="<?php echo esc_attr( $L( 'লুকান', 'Hide' ) ); ?>" onclick="var i=document.getElementById('pwd');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?this.dataset.show:this.dataset.hide;"><?php echo esc_html( $L( 'দেখুন', 'Show' ) ); ?></button>
			</div>
			<div class="row">
				<label><input type="checkbox" name="rememberme" value="1" checked> <?php echo esc_html( $L( 'মনে রাখুন', 'Remember me' ) ); ?></label>
				<a href="<?php echo esc_url( wp_lostpassword_url( $self ) ); ?>"><?php echo esc_html( $L( 'পাসওয়ার্ড ভুলে গেছেন?', 'Forgot password?' ) ); ?></a>
			</div>
			<input type="hidden" name="_gh" value="<?php echo esc_attr( wp_create_nonce( 'goriber_login' ) ); ?>">
			<input type="hidden" name="redirect_to" value="<?php echo esc_attr( $redirect ); ?>">
			<button class="btn" type="submit"><?php echo esc_html( $L( 'লগইন করুন', 'Log in' ) ); ?></button>
		</form>
		<?php if ( ! empty( $platform['signup'] ) ) : ?>
			<p class="help"><?php echo esc_html( $L( 'নতুন দোকান খুলতে চান?', 'Want to open a new shop?' ) ); ?> <a href="<?php echo esc_url( \GoriberHisab\Admin\AppRoute::signupUrl() ); ?>"><?php echo esc_html( $L( 'সাইন আপ করুন', 'Sign up' ) ); ?></a></p>
		<?php endif; ?>
		<?php if ( ! str_contains( (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' ), 'GoriberHisabApp' ) ) : // phpcs:ignore WordPress.Security.ValidatedSanitizedInput ?>
			<p class="help"><a href="<?php echo esc_url( \GoriberHisab\Admin\AppRoute::downloadUrl() ); ?>" rel="nofollow">📱 <?php echo esc_html( $L( 'অ্যান্ড্রয়েড অ্যাপ ডাউনলোড করুন (অফলাইনেও চলে)', 'Download the Android app (works offline)' ) ); ?></a></p>
		<?php endif; ?>
		<?php if ( '' !== $phone ) : ?>
			<p class="help"><?php echo esc_html( $L( 'অ্যাকাউন্ট নেই বা সমস্যা হচ্ছে?', 'No account yet or need help?' ) ); ?> <a href="tel:<?php echo esc_attr( preg_replace( '/[^0-9+]/', '', $phone ) ); ?>"><?php echo esc_html( $phone ); ?></a></p>
		<?php endif; ?>
	</div>
</main>
</body>
</html>
