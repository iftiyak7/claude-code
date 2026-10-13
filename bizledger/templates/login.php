<?php
/**
 * Branded login page (shop owners and staff).
 *
 * Variables: $brand, $platform, $error, $login, $redirect.
 *
 * @package BizLedger
 */

defined( 'ABSPATH' ) || exit;

$icon = BIZLEDGER_URL . 'assets/img/icon.svg?v=' . BIZLEDGER_VERSION;
?>
<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#047857">
<meta name="robots" content="noindex, nofollow">
<title><?php echo esc_html( $brand ); ?> — Login</title>
<link rel="icon" href="<?php echo esc_url( $icon ); ?>" type="image/svg+xml">
<style>
:root { --brand: #047857; --text: #0f172a; --muted: #64748b; --border: #e2e8f0; --bg: #f0fdf4; --surface: #fff; --bad: #b91c1c; }
@media (prefers-color-scheme: dark) { :root { --text: #e2e8f0; --muted: #94a3b8; --border: #334155; --bg: #0b1220; --surface: #111a2e; --bad: #f87171; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", "Noto Sans Bengali", "Hind Siliguri", sans-serif; }
.card { width: 100%; max-width: 380px; background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 28px 22px; box-shadow: 0 10px 30px rgba(4, 120, 87, .08); }
.brand { display: grid; justify-items: center; gap: 6px; margin-bottom: 18px; text-align: center; }
.brand img { width: 56px; height: 56px; }
.brand h1 { margin: 0; font-size: 1.4rem; color: var(--brand); }
.brand p { margin: 0; color: var(--muted); font-size: .9rem; }
label { display: block; font-weight: 600; font-size: .9rem; margin: 12px 0 6px; }
input[type=email], input[type=text], input[type=password] { width: 100%; height: 48px; padding: 0 14px; border: 1px solid var(--border); border-radius: 12px; font: inherit; background: var(--surface); color: var(--text); }
input:focus { outline: 2px solid var(--brand); outline-offset: 1px; border-color: var(--brand); }
.pw { position: relative; }
.pw button { position: absolute; right: 6px; top: 6px; height: 36px; border: 0; background: none; color: var(--muted); cursor: pointer; font: inherit; font-size: .85rem; padding: 0 8px; }
.row { display: flex; justify-content: space-between; align-items: center; margin: 14px 0 18px; font-size: .9rem; }
.row label { margin: 0; font-weight: 400; display: flex; gap: 6px; align-items: center; }
a { color: var(--brand); }
.btn { width: 100%; height: 50px; border: 0; border-radius: 12px; background: var(--brand); color: #fff; font: inherit; font-weight: 700; font-size: 1.05rem; cursor: pointer; }
.btn:active { transform: scale(.99); }
.error { background: color-mix(in srgb, var(--bad) 10%, transparent); color: var(--bad); border-radius: 10px; padding: 10px 12px; font-size: .9rem; margin-bottom: 6px; }
.foot { margin-top: 18px; text-align: center; color: var(--muted); font-size: .85rem; }
</style>
</head>
<body>
<main class="card">
	<div class="brand">
		<img src="<?php echo esc_url( $icon ); ?>" alt="">
		<h1><?php echo esc_html( $brand ); ?></h1>
		<p>আপনার দোকানের হিসাবে লগইন করুন<br>Log in to your shop</p>
	</div>
	<?php if ( '' !== $error ) : ?>
		<div class="error" role="alert"><?php echo esc_html( $error ); ?></div>
	<?php endif; ?>
	<form method="post" action="<?php echo esc_url( \BizLedger\Admin\AppRoute::loginUrl() ); ?>">
		<label for="log">ইমেইল / Email</label>
		<input type="text" id="log" name="log" value="<?php echo esc_attr( $login ); ?>" autocomplete="username" inputmode="email" required autofocus>
		<label for="pwd">পাসওয়ার্ড / Password</label>
		<div class="pw">
			<input type="password" id="pwd" name="pwd" autocomplete="current-password" required>
			<button type="button" onclick="var i=document.getElementById('pwd');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'দেখুন':'লুকান';">দেখুন</button>
		</div>
		<div class="row">
			<label><input type="checkbox" name="rememberme" value="1" checked> মনে রাখুন</label>
			<a href="<?php echo esc_url( wp_lostpassword_url( \BizLedger\Admin\AppRoute::loginUrl() ) ); ?>">পাসওয়ার্ড ভুলে গেছেন?</a>
		</div>
		<input type="hidden" name="_gh" value="<?php echo esc_attr( wp_create_nonce( 'goriber_login' ) ); ?>">
		<input type="hidden" name="redirect_to" value="<?php echo esc_attr( $redirect ); ?>">
		<button class="btn" type="submit">লগইন / Log in</button>
	</form>
	<?php if ( '' !== (string) $platform['support_phone'] ) : ?>
		<p class="foot">সাহায্য / Help: <a href="tel:<?php echo esc_attr( preg_replace( '/[^0-9+]/', '', (string) $platform['support_phone'] ) ); ?>"><?php echo esc_html( (string) $platform['support_phone'] ); ?></a></p>
	<?php endif; ?>
</main>
</body>
</html>
