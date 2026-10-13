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
<style>
:root { --navy: #0b1a2e; --green: #16a34a; --ink: #0f1d2f; --muted: #5b6b80; --line: #dde5ee; --bad: #b91c1c; --grad: linear-gradient(120deg, #a3e635, #22c55e 45%, #22d3ee); }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr; font: 16px/1.55 "Hind Siliguri", "Inter", system-ui, sans-serif; color: var(--ink); background: #f6faf8; }
html[lang="en"] body { font-family: "Inter", "Hind Siliguri", system-ui, sans-serif; }
.side { position: relative; overflow: hidden; padding: 48px; display: flex; flex-direction: column; justify-content: space-between; color: #dbe7f3; background: radial-gradient(600px 400px at 100% 0, rgba(34, 211, 238, .22), transparent 60%), radial-gradient(500px 400px at 0 100%, rgba(163, 230, 53, .16), transparent 60%), var(--navy); }
.brand { display: flex; align-items: center; gap: 12px; color: #fff; text-decoration: none; font-size: 1.35rem; }
.brand b { background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.side h2 { font-size: clamp(1.6rem, 2.6vw, 2.3rem); line-height: 1.25; color: #fff; margin: 0 0 14px; }
.side h2 em { font-style: normal; background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
.side ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; color: #b8c7d9; }
.side li::before { content: "✓"; color: #a3e635; font-weight: 700; margin-right: 8px; }
.side small { color: #7f93aa; }
main { display: grid; place-items: center; padding: 32px 20px; position: relative; }
.top { position: absolute; top: 18px; right: 20px; display: flex; gap: 10px; }
.top a { font-size: .9rem; text-decoration: none; color: var(--muted); padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: #fff; }
.top a:hover { color: var(--green); border-color: var(--green); }
.card { width: 100%; max-width: 400px; }
.card .m-brand { display: none; }
h1 { font-size: 1.7rem; margin: 0 0 4px; color: var(--navy); }
.sub { color: var(--muted); margin: 0 0 24px; }
label { display: block; font-weight: 600; font-size: .92rem; margin: 14px 0 6px; }
input[type=text], input[type=password] { width: 100%; height: 50px; padding: 0 14px; border: 1px solid var(--line); border-radius: 12px; font: inherit; background: #fff; color: var(--ink); transition: border-color .15s, box-shadow .15s; }
input:focus { outline: none; border-color: var(--green); box-shadow: 0 0 0 4px rgba(22, 163, 74, .15); }
.pw { position: relative; }
.pw input { padding-right: 72px; }
.pw button { position: absolute; right: 6px; top: 7px; height: 36px; border: 0; background: none; color: var(--muted); cursor: pointer; font: inherit; font-size: .88rem; padding: 0 10px; border-radius: 8px; }
.pw button:hover { background: #f1f5f9; }
.row { display: flex; justify-content: space-between; align-items: center; margin: 14px 0 22px; font-size: .92rem; }
.row label { margin: 0; font-weight: 400; display: flex; gap: 8px; align-items: center; }
.row a { color: var(--green); }
.btn { width: 100%; height: 52px; border: 0; border-radius: 12px; background: var(--green); color: #fff; font: inherit; font-weight: 700; font-size: 1.05rem; cursor: pointer; box-shadow: 0 12px 24px -12px rgba(22, 163, 74, .8); }
.btn:hover { background: #15803d; }
.error { display: flex; gap: 10px; align-items: flex-start; background: #fef2f2; color: var(--bad); border: 1px solid #fecaca; border-radius: 12px; padding: 10px 12px; font-size: .93rem; margin-bottom: 4px; }
.help { margin-top: 22px; text-align: center; color: var(--muted); font-size: .92rem; }
.help a { color: var(--green); font-weight: 600; }
@media (max-width: 860px) {
  body { grid-template-columns: 1fr; }
  .side { display: none; }
  .card .m-brand { display: flex; margin-bottom: 26px; color: var(--navy); }
  main { place-items: start center; padding-top: 80px; }
}
</style>
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
	<small>© <?php echo esc_html( gmdate( 'Y' ) ); ?> <?php echo esc_html( $L( 'গরিবের হিসাব', 'Goriber Hisab' ) ); ?></small>
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
		<?php if ( '' !== $phone ) : ?>
			<p class="help"><?php echo esc_html( $L( 'অ্যাকাউন্ট নেই বা সমস্যা হচ্ছে?', 'No account yet or need help?' ) ); ?> <a href="tel:<?php echo esc_attr( preg_replace( '/[^0-9+]/', '', $phone ) ); ?>"><?php echo esc_html( $phone ); ?></a></p>
		<?php endif; ?>
	</div>
</main>
</body>
</html>
