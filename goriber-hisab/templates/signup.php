<?php
/**
 * Public sign-up page.
 *
 * Variables: $platform, $errors, $error, $old, $lang, $L(bn, en).
 *
 * @package GoriberHisab
 */

defined( 'ABSPATH' ) || exit;

$asset = static fn( string $p ): string => GORIBER_HISAB_URL . 'assets/' . $p . '?v=' . GORIBER_HISAB_VERSION;
$other = 'en' === $lang ? 'bn' : 'en';
$self  = \GoriberHisab\Admin\AppRoute::signupUrl();
$v     = static fn( string $k ): string => (string) ( $old[ $k ] ?? '' );
$err   = static function ( string $k ) use ( $errors ): void {
	if ( ! empty( $errors[ $k ] ) ) {
		echo '<span class="ferr" role="alert">' . esc_html( $errors[ $k ] ) . '</span>';
	}
};
$types = array(
	'retail'      => array( 'খুচরা দোকান', 'Retail shop' ),
	'grocery'     => array( 'মুদি দোকান', 'Grocery' ),
	'pharmacy'    => array( 'ফার্মেসি', 'Pharmacy' ),
	'clothing'    => array( 'কাপড়ের দোকান', 'Clothing' ),
	'electronics' => array( 'মোবাইল ও ইলেকট্রনিক্স', 'Mobile & electronics' ),
	'ecommerce'   => array( 'অনলাইন / ফেসবুক শপ', 'Online / Facebook shop' ),
	'wholesale'   => array( 'পাইকারি', 'Wholesale' ),
	'restaurant'  => array( 'রেস্টুরেন্ট', 'Restaurant' ),
	'service'     => array( 'সার্ভিস ব্যবসা', 'Service business' ),
	'general'     => array( 'অন্যান্য', 'Other' ),
);
$trial = (int) $platform['trial_days'];
?>
<!doctype html>
<html lang="<?php echo esc_attr( $lang ); ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1a2e">
<meta name="robots" content="noindex, nofollow">
<title><?php echo esc_html( $L( 'সাইন আপ — গরিবের হিসাব', 'Sign up — Goriber Hisab' ) ); ?></title>
<link rel="icon" href="<?php echo esc_url( $asset( 'img/icon.svg' ) ); ?>" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="<?php echo esc_url( $asset( 'css/auth.css' ) ); ?>">
</head>
<body>
<aside class="side">
	<a class="brand" href="<?php echo esc_url( home_url( '/' ) ); ?>"><img src="<?php echo esc_url( $asset( 'img/icon.svg' ) ); ?>" alt="" width="42" height="42"><span><b><?php echo esc_html( $L( 'গরিবের', 'Goriber' ) ); ?></b> <?php echo esc_html( $L( 'হিসাব', 'Hisab' ) ); ?></span></a>
	<div>
		<h2><?php echo wp_kses( $L( 'আজই আপনার দোকান<br><em>অনলাইনে নিয়ে আসুন।</em>', 'Bring your shop<br><em>online today.</em>' ), array( 'br' => array(), 'em' => array() ) ); ?></h2>
		<ul>
			<li><?php echo esc_html( $L( '২ মিনিটে অ্যাকাউন্ট খুলুন', 'Create your account in 2 minutes' ) ); ?></li>
			<li><?php echo esc_html( $L( 'বিকাশ/নগদে পেমেন্ট করে TrxID দিন', 'Pay by bKash/Nagad and enter the TrxID' ) ); ?></li>
			<li><?php echo esc_html( $L( 'অনুমোদনের পরই পুরো সফটওয়্যার চালু', 'Full access as soon as you are approved' ) ); ?></li>
		</ul>
	</div>
	<?php \GoriberHisab\Admin\Landing::credit( $L ); ?>
</aside>
<main>
	<div class="top">
		<a href="<?php echo esc_url( add_query_arg( 'lang', $other, $self ) ); ?>"><?php echo 'en' === $lang ? 'বাংলা' : 'English'; ?></a>
		<a href="<?php echo esc_url( \GoriberHisab\Admin\AppRoute::loginUrl() ); ?>"><?php echo esc_html( $L( 'লগইন', 'Log in' ) ); ?></a>
	</div>
	<div class="card wide">
		<a class="brand m-brand" href="<?php echo esc_url( home_url( '/' ) ); ?>"><img src="<?php echo esc_url( $asset( 'img/icon.svg' ) ); ?>" alt="" width="40" height="40"><span><b><?php echo esc_html( $L( 'গরিবের', 'Goriber' ) ); ?></b> <?php echo esc_html( $L( 'হিসাব', 'Hisab' ) ); ?></span></a>
		<ol class="steps">
			<li class="on"><b>১</b><?php echo esc_html( $L( 'তথ্য দিন', 'Your details' ) ); ?></li>
			<li><b>২</b><?php echo esc_html( $L( 'পেমেন্ট', 'Payment' ) ); ?></li>
			<li><b>৩</b><?php echo esc_html( $L( 'অনুমোদন', 'Approval' ) ); ?></li>
		</ol>
		<h1><?php echo esc_html( $L( 'নতুন দোকান খুলুন', 'Open your shop' ) ); ?></h1>
		<p class="sub"><?php echo esc_html( $L( 'নিচের তথ্যগুলো দিন। পরের ধাপে পেমেন্টের নিয়ম দেখাবে।', 'Fill in your details. Payment instructions come next.' ) ); ?></p>
		<?php if ( empty( $platform['signup'] ) ) : ?>
			<div class="error" role="alert"><span aria-hidden="true">⚠</span><span><?php echo esc_html( $L( 'এখন নতুন সাইন আপ বন্ধ আছে। আমাদের সাথে যোগাযোগ করুন।', 'Sign-up is closed. Please contact us.' ) ); ?></span></div>
		<?php else : ?>
			<?php if ( '' !== $error && ! $errors ) : ?>
				<div class="error" role="alert"><span aria-hidden="true">⚠</span><span><?php echo esc_html( $error ); ?></span></div>
			<?php endif; ?>
			<form method="post" action="<?php echo esc_url( $self ); ?>" novalidate>
				<label for="shop_name"><?php echo esc_html( $L( 'দোকান / ব্যবসার নাম', 'Shop / business name' ) ); ?></label>
				<input type="text" id="shop_name" name="shop_name" value="<?php echo esc_attr( $v( 'shop_name' ) ); ?>" required autofocus>
				<?php $err( 'shop_name' ); ?>
				<div class="grid2">
					<div>
						<label for="owner_name"><?php echo esc_html( $L( 'আপনার নাম', 'Your name' ) ); ?></label>
						<input type="text" id="owner_name" name="owner_name" value="<?php echo esc_attr( $v( 'owner_name' ) ); ?>" autocomplete="name" required>
						<?php $err( 'owner_name' ); ?>
					</div>
					<div>
						<label for="phone"><?php echo esc_html( $L( 'মোবাইল নম্বর', 'Mobile number' ) ); ?></label>
						<input type="text" id="phone" name="phone" value="<?php echo esc_attr( $v( 'phone' ) ); ?>" inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX" required>
						<?php $err( 'phone' ); ?>
					</div>
				</div>
				<label for="email"><?php echo esc_html( $L( 'ইমেইল (লগইনের জন্য)', 'Email (for login)' ) ); ?></label>
				<input type="text" id="email" name="email" value="<?php echo esc_attr( $v( 'email' ) ); ?>" inputmode="email" autocomplete="email" placeholder="you@gmail.com" required>
				<?php $err( 'email' ); ?>
				<label for="address"><?php echo esc_html( $L( 'ঠিকানা', 'Address' ) ); ?></label>
				<textarea id="address" name="address" rows="2" autocomplete="street-address"><?php echo esc_textarea( $v( 'address' ) ); ?></textarea>
				<div class="grid2">
					<div>
						<label for="business_type"><?php echo esc_html( $L( 'ব্যবসার ধরন', 'Type of business' ) ); ?></label>
						<select id="business_type" name="business_type">
							<?php foreach ( $types as $k => $t ) : ?>
								<option value="<?php echo esc_attr( $k ); ?>" <?php selected( $v( 'business_type' ), $k ); ?>><?php echo esc_html( $L( $t[0], $t[1] ) ); ?></option>
							<?php endforeach; ?>
						</select>
					</div>
					<div>
						<label for="password"><?php echo esc_html( $L( 'পাসওয়ার্ড', 'Password' ) ); ?></label>
						<input type="password" id="password" name="password" autocomplete="new-password" minlength="8" placeholder="<?php echo esc_attr( $L( 'কমপক্ষে ৮ অক্ষর', 'At least 8 characters' ) ); ?>" required>
						<?php $err( 'password' ); ?>
					</div>
				</div>
				<input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
				<input type="hidden" name="_gh" value="<?php echo esc_attr( wp_create_nonce( 'goriber_signup' ) ); ?>">
				<p class="sub" style="margin:16px 0"><?php echo esc_html( $L( 'মাসিক ' . $platform['currency'] . number_format( (float) $platform['monthly_price'] ) . ' অথবা বাৎসরিক ' . $platform['currency'] . number_format( (float) $platform['yearly_price'] ) . '।', 'Monthly ' . $platform['currency'] . number_format( (float) $platform['monthly_price'] ) . ' or yearly ' . $platform['currency'] . number_format( (float) $platform['yearly_price'] ) . '.' ) ); ?></p>
				<button class="btn" type="submit"><?php echo esc_html( $L( 'অ্যাকাউন্ট খুলুন ও পেমেন্টে যান', 'Create account & continue to payment' ) ); ?></button>
			</form>
		<?php endif; ?>
		<p class="help"><?php echo esc_html( $L( 'আগেই অ্যাকাউন্ট আছে?', 'Already have an account?' ) ); ?> <a href="<?php echo esc_url( \GoriberHisab\Admin\AppRoute::loginUrl() ); ?>"><?php echo esc_html( $L( 'লগইন করুন', 'Log in' ) ); ?></a></p>
	</div>
</main>
</body>
</html>
