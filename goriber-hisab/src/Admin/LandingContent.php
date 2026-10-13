<?php
/**
 * Editable texts of the public home page.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Admin;

use GoriberHisab\Support\Text;

/**
 * Every text exists in Bangla and English: ['bn' => …, 'en' => …]. Lists
 * (features, FAQ, …) are lists of such items. The owner edits them in
 * Shops → Home page; what is stored overrides the defaults below, and a list
 * that was saved replaces the default list as a whole.
 *
 * In titles, a new line starts a new line and *stars* highlight words.
 * {trial} is replaced by the free-trial days.
 */
final class LandingContent {

	public const OPTION = 'goriber_hisab_landing';
	public const ICONS  = array( 'pos', 'due', 'box', 'truck', 'chart', 'users', 'print', 'wifi', 'star', 'shield', 'phone', 'cash' );

	/**
	 * @param string $bn Bangla.
	 * @param string $en English.
	 * @return array{bn:string,en:string}
	 */
	private static function t( string $bn, string $en ): array {
		return array(
			'bn' => $bn,
			'en' => $en,
		);
	}

	/**
	 * @return array<string,mixed>
	 */
	public static function defaults(): array {
		$t = array( self::class, 't' );
		return array(
			'show'          => array(
				'who'      => true,
				'pain'     => true,
				'features' => true,
				'how'      => true,
				'price'    => true,
				'faq'      => true,
				'band'     => true,
			),
			'meta_title'    => $t( 'গরিবের হিসাব — দোকানের সহজ ও নিরাপদ হিসাব', 'Goriber Hisab — simple, safe bookkeeping for your shop' ),
			'meta_desc'     => $t( 'বিক্রি, বাকি, স্টক, অনলাইন অর্ডার, কুরিয়ার আর লাভ-ক্ষতি — মোবাইল থেকেই, বাংলায়।', 'Sales, credit, stock, online orders, courier and profit — from your phone, in Bangla.' ),
			'eyebrow'       => $t( 'ছোট ও মাঝারি দোকানের জন্য বানানো', 'Built for small and growing shops' ),
			'hero_title'    => $t( "খাতা-কলমের দিন শেষ।\n*দোকানের পুরো হিসাব* এখন হাতের মুঠোয়।", "Close the paper ledger.\n*Run your whole shop* from your phone." ),
			'hero_lead'     => $t( 'বিক্রি, বাকি, স্টক, অনলাইন অর্ডার আর কুরিয়ার — সব এক জায়গায়। দিন শেষে এক ট্যাপে জানুন আজ আসল লাভ কত হলো।', 'Sales, credit, stock, online orders and courier in one place. At the end of the day, one tap shows what you really earned.' ),
			'cta_primary'   => $t( '{trial} দিন ফ্রি চালিয়ে দেখুন', 'Try it free for {trial} days' ),
			'cta_secondary' => $t( 'কী কী আছে দেখুন', "See what's inside" ),
			'ticks'         => array(
				array( 'text' => $t( 'কোনো সেটআপ খরচ নেই', 'No setup fee' ) ),
				array( 'text' => $t( 'বাংলা ও ইংরেজি', 'Bangla & English' ) ),
				array( 'text' => $t( 'যেকোনো সময় বন্ধ করা যায়', 'Cancel any time' ) ),
			),
			'who_title'     => $t( 'যে কোনো দোকানে মানিয়ে যায়', 'Fits every kind of shop' ),
			'who_items'     => array_map(
				static fn( $p ) => array( 'text' => $t( $p[0], $p[1] ) ),
				array( array( 'মুদি দোকান', 'Grocery' ), array( 'ফার্মেসি', 'Pharmacy' ), array( 'কাপড়ের দোকান', 'Clothing' ), array( 'মোবাইল ও ইলেকট্রনিক্স', 'Mobile & electronics' ), array( 'ফেসবুক পেজ / অনলাইন শপ', 'Facebook / online shop' ), array( 'পাইকারি ব্যবসা', 'Wholesale' ), array( 'রেস্টুরেন্ট', 'Restaurant' ) )
			),
			'pain_title'    => $t( 'দিন শেষে ক্যাশ মেলে না?', 'Cash never adds up at night?' ),
			'pain_text'     => $t( 'খাতার পাতা হারায়, বাকির হিসাব মনে থাকে না, কোন মাল শেষ সেটা বোঝা যায় মাল চাইতে এসে খালি হাতে ফিরলে। গরিবের হিসাব এই ঝামেলাগুলো সরিয়ে দেয় — আপনি শুধু বিক্রিতে মন দিন।', 'Pages go missing, credit is forgotten, and you notice an item ran out only when a customer leaves empty-handed. Goriber Hisab takes that worry away so you can focus on selling.' ),
			'vs_old'        => $t( 'খাতা-কলম', 'Paper ledger' ),
			'vs_new'        => $t( 'গরিবের হিসাব', 'Goriber Hisab' ),
			'vs_rows'       => array_map(
				static fn( $r ) => array(
					'label' => $t( $r[0], $r[1] ),
					'old'   => $t( $r[2], $r[3] ),
					'new'   => $t( $r[4], $r[5] ),
				),
				array(
					array( 'আজকের লাভ জানা', "Knowing today's profit", 'রাতে বসে যোগ-বিয়োগ', 'Adding up at night', 'সাথে সাথে', 'Instantly' ),
					array( 'বাকির হিসাব', 'Credit tracking', 'পাতা উল্টে খোঁজা', 'Flipping pages', 'নাম লিখলেই', 'Type a name' ),
					array( 'স্টক শেষ', 'Out of stock', 'কাস্টমার ফেরত গেলে', 'When a customer leaves', 'আগেই সতর্কবার্তা', 'Warned in advance' ),
					array( 'কর্মীর বিক্রি', 'Staff sales', 'বিশ্বাসের উপর', 'Trust only', 'প্রতিটি বিক্রির রেকর্ড', 'Every sale recorded' ),
					array( 'কুরিয়ারের টাকা', 'Courier COD', 'মেলানো কঠিন', 'Hard to reconcile', 'অর্ডার ধরে হিসাব', 'Matched per order' ),
				)
			),
			'features_kicker' => $t( 'যা যা পাবেন', 'What you get' ),
			'features_title'  => $t( 'একটি অ্যাপ, দোকানের সব কাজ', 'One app for everything in your shop' ),
			'features'        => array_map(
				static fn( $f ) => array(
					'icon'  => $f[0],
					'title' => $t( $f[1], $f[2] ),
					'text'  => $t( $f[3], $f[4] ),
				),
				array(
					array( 'pos', 'দ্রুত বিক্রি (POS)', 'Fast checkout (POS)', 'বারকোড স্ক্যান বা নাম লিখে খুঁজুন, গ্রাম/কেজিতে খোলা মাল বিক্রি করুন, ভাংতি টাকার হিসাব নিজে থেকেই।', 'Scan a barcode or type a name, sell loose items by gram or kg, and let it work out the change.' ),
					array( 'due', 'বাকির খাতা', 'Credit (baki) book', 'কার কাছে কত বাকি, কতদিনের পুরনো — এক নজরে। আংশিক জমা নিলেই হিসাব আপডেট।', 'Who owes how much and for how long, at a glance. Part payments update instantly.' ),
					array( 'box', 'স্টক ও ক্রয়', 'Stock & purchases', 'বিক্রি করলে স্টক কমে, কিনলে বাড়ে। মাল শেষ হওয়ার আগেই সতর্কবার্তা।', 'Stock moves with every sale and purchase, with low-stock alerts.' ),
					array( 'truck', 'অনলাইন অর্ডার ও কুরিয়ার', 'Online orders & courier', 'গ্রাহকের মেসেজ পেস্ট করলেই অর্ডার তৈরি, Steadfast-এ এক ক্লিকে পার্সেল বুক, ডেলিভারি আর ফেরত ট্র্যাক।', 'Paste a customer message to create the order, book Steadfast parcels in one click, track delivery and returns.' ),
					array( 'chart', 'লাভ-ক্ষতি ও রিপোর্ট', 'Profit & reports', 'আজ কত লাভ, কোন মাল বেশি চলে, খরচ কোথায় যায় — ২৫টির বেশি রিপোর্ট, এক ক্লিকে সব ডাউনলোড।', "Today's profit, best sellers, where the money goes — 25+ reports, download all in one click." ),
					array( 'users', 'কর্মী ও অনুমতি', 'Staff & permissions', 'প্রত্যেক কর্মীর আলাদা লগইন। কে কী দেখবে, দাম বদলাতে পারবে কি না — আপনি ঠিক করবেন।', 'Separate logins for every staff member. You decide who sees what and who can change prices.' ),
					array( 'print', 'রসিদ ও ইনভয়েস', 'Receipts & invoices', 'A4, A5 বা ৫৮/৮০ মিমি থার্মাল প্রিন্টার — ব্লুটুথ প্রিন্টারেও বাংলায় রসিদ।', 'A4, A5 or 58/80 mm thermal — Bangla receipts even on Bluetooth printers.' ),
					array( 'wifi', 'নেট না থাকলেও চলে', 'Works offline', 'ইন্টারনেট চলে গেলেও বিক্রি থামবে না। নেট ফিরলে সব নিজে থেকেই সার্ভারে উঠে যাবে।', 'Keep selling when the internet drops. Everything syncs by itself when it is back.' ),
				)
			),
			'how_kicker'    => $t( 'শুরু করা একদম সহজ', 'Getting started is easy' ),
			'how_title'     => $t( 'আজ সাইন আপ করুন, আজই বিক্রি শুরু', 'Sign up today, start selling today' ),
			'steps'         => array(
				array(
					'title' => $t( 'সাইন আপ করুন', 'Sign up' ),
					'text'  => $t( 'দোকানের নাম, ফোন আর ইমেইল দিয়ে ২ মিনিটে অ্যাকাউন্ট খুলুন।', 'Create your account in 2 minutes with your shop name, phone and email.' ),
				),
				array(
					'title' => $t( 'বিকাশ/নগদে পেমেন্ট', 'Pay by bKash/Nagad' ),
					'text'  => $t( 'টাকা পাঠিয়ে ট্রানজেকশন আইডি দিন। আমরা যাচাই করে দোকান চালু করে দেব।', 'Send the money and enter the transaction ID. We check it and open your shop.' ),
				),
				array(
					'title' => $t( 'লগইন করে বিক্রি', 'Log in and sell' ),
					'text'  => $t( 'মাল যোগ করুন, প্রথম বিক্রি করুন। আটকে গেলে ফোন দিন, আমরা আছি।', "Add your products and make the first sale. Stuck? Call us — we're here." ),
				),
			),
			'price_kicker'  => $t( 'সহজ দাম', 'Simple pricing' ),
			'price_title'   => $t( 'সব সুবিধা, একটাই প্যাকেজ', 'Every feature, one plan' ),
			'plan_cta'      => $t( 'এখনই সাইন আপ করুন', 'Sign up now' ),
			'plan_items'    => array_map(
				static fn( $p ) => array( 'text' => $t( $p[0], $p[1] ) ),
				array(
					array( 'সীমাহীন বিক্রি, পণ্য ও গ্রাহক', 'Unlimited sales, products & customers' ),
					array( 'POS, বারকোড ও খোলা মাল', 'POS, barcode & loose items' ),
					array( 'বাকির খাতা ও আদায়', 'Credit book & collections' ),
					array( 'স্টক, ক্রয় ও সাপ্লায়ার', 'Stock, purchases & suppliers' ),
					array( 'অনলাইন অর্ডার ও কুরিয়ার', 'Online orders & courier' ),
					array( 'লাভ-ক্ষতি, ব্যালান্স শিট ও ২৫+ রিপোর্ট', 'P&L, balance sheet & 25+ reports' ),
					array( 'কর্মীদের আলাদা লগইন', 'Separate staff logins' ),
					array( 'রসিদ প্রিন্ট ও অফলাইন মোড', 'Receipt printing & offline mode' ),
					array( 'ফোনে সাহায্য ও প্রশিক্ষণ', 'Phone support & training' ),
				)
			),
			'pay_note'      => $t( 'বিকাশ, নগদ, রকেট বা ব্যাংকে পেমেন্ট। কোনো লুকানো খরচ নেই।', 'Pay by bKash, Nagad, Rocket or bank. No hidden charges.' ),
			'faq_kicker'    => $t( 'প্রশ্ন ও উত্তর', 'Questions & answers' ),
			'faq_title'     => $t( 'শুরু করার আগে যা জানতে চান', 'Before you start' ),
			'faq'           => array_map(
				static fn( $q ) => array(
					'q' => $t( $q[0], $q[1] ),
					'a' => $t( $q[2], $q[3] ),
				),
				array(
					array( 'আমার হিসাবের তথ্য কি নিরাপদ?', 'Is my data safe?', 'হ্যাঁ। প্রতিটি দোকানের তথ্য আলাদা রাখা হয়, অন্য কেউ দেখতে পারে না। প্রতিটি হিসাবের রেকর্ড থাকে, আর আপনি নিজেও যেকোনো সময় সব ডেটা ও রিপোর্ট ডাউনলোড করে রাখতে পারবেন।', "Yes. Every shop's data is kept separate and nobody else can see it. Every change is logged, and you can download all your data and reports any time." ),
					array( 'কম্পিউটার না থাকলে চলবে?', 'Do I need a computer?', 'না। যেকোনো স্মার্টফোনের ব্রাউজার থেকেই পুরোটা চালানো যায়। চাইলে হোম স্ক্রিনে অ্যাপের মতো বসিয়ে নিতে পারবেন।', 'No. Everything works from any smartphone browser, and you can add it to your home screen like an app.' ),
					array( 'ইন্টারনেট চলে গেলে কী হবে?', 'What if the internet goes down?', 'বিক্রি চালিয়ে যেতে পারবেন। অফলাইনে করা বিক্রি নেট ফিরলে নিজে থেকেই জমা হয়ে যায়, একটাও হারায় না।', 'You can keep selling. Offline sales are saved and sent automatically when the connection returns.' ),
					array( 'টাকা কীভাবে দেব?', 'How do I pay?', 'বিকাশ, নগদ, রকেট বা ব্যাংকে। টাকা পাঠিয়ে অ্যাপের ভেতরেই ট্রানজেকশন আইডি দিলেই মেয়াদ বেড়ে যাবে।', 'By bKash, Nagad, Rocket or bank. Send the money and enter the transaction ID inside the app to extend your plan.' ),
					array( 'পরে বন্ধ করতে চাইলে?', 'Can I stop later?', 'যেকোনো সময়। কোনো চুক্তি নেই। বন্ধ করার আগে আপনার সব রিপোর্ট আর ডেটা ডাউনলোড করে নিতে পারবেন।', 'Any time — there is no contract. Download all your reports and data before you leave.' ),
					array( 'চালানো শিখতে কি কষ্ট হবে?', 'Is it hard to learn?', 'না। পুরোটা বাংলায়, বড় বড় বাটন। দোকান খুলে দেওয়ার সময় আমরা ফোনে দেখিয়ে দিই।', 'No. It is fully in Bangla with large buttons, and we walk you through it on the phone.' ),
				)
			),
			'band_title'    => $t( 'আপনার দোকানের হিসাব আজই গুছিয়ে নিন', "Get your shop's books in order today" ),
			'band_text'     => $t( 'সাইন আপ করুন, অথবা একটা মেসেজ পাঠান — বাকিটা আমরা করে দেব।', "Sign up, or send one message — we'll handle the rest." ),
			'band_cta'      => $t( 'হোয়াটসঅ্যাপে কথা বলুন', 'Chat on WhatsApp' ),
			'footer_tag'    => $t( 'সহজ ও নিরাপদ হিসাব', 'Simple, safe bookkeeping' ),
			'credit'        => $t( 'NOORIYAH Group-এর একটি পণ্য', 'A product of NOORIYAH Group' ),
		);
	}

	/**
	 * Editor layout: sections → fields. Types: text, textarea, list.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public static function schema(): array {
		$f    = static fn( string $key, string $label, string $type = 'text', array $extra = array() ) => array( 'key' => $key, 'label' => $label, 'type' => $type ) + $extra;
		$list = static fn( string $key, string $label, array $item ) => array( 'key' => $key, 'label' => $label, 'type' => 'list', 'item' => $item );
		return array(
			array( 'key' => 'hero', 'title' => 'Top of the page', 'fields' => array( $f( 'eyebrow', 'Small label above the title' ), $f( 'hero_title', 'Big title (new line = new line, *stars* = green words)', 'textarea' ), $f( 'hero_lead', 'Text under the title', 'textarea' ), $f( 'cta_primary', 'Main button ({trial} = free days)' ), $f( 'cta_secondary', 'Second button' ), $list( 'ticks', 'Small ticks under the buttons', array( $f( 'text', 'Text' ) ) ) ) ),
			array( 'key' => 'who', 'title' => 'Kinds of shops', 'fields' => array( $f( 'who_title', 'Title' ), $list( 'who_items', 'Shop types', array( $f( 'text', 'Text' ) ) ) ) ),
			array( 'key' => 'pain', 'title' => 'Problem & comparison', 'fields' => array( $f( 'pain_title', 'Title' ), $f( 'pain_text', 'Text', 'textarea' ), $f( 'vs_old', 'Left column' ), $f( 'vs_new', 'Right column' ), $list( 'vs_rows', 'Rows', array( $f( 'label', 'Row' ), $f( 'old', 'Old way' ), $f( 'new', 'With Goriber Hisab' ) ) ) ) ),
			array( 'key' => 'features', 'title' => 'Features', 'fields' => array( $f( 'features_kicker', 'Small label' ), $f( 'features_title', 'Title' ), $list( 'features', 'Feature cards', array( $f( 'icon', 'Icon', 'icon' ), $f( 'title', 'Title' ), $f( 'text', 'Text', 'textarea' ) ) ) ) ),
			array( 'key' => 'how', 'title' => 'How to start', 'fields' => array( $f( 'how_kicker', 'Small label' ), $f( 'how_title', 'Title' ), $list( 'steps', 'Steps', array( $f( 'title', 'Title' ), $f( 'text', 'Text', 'textarea' ) ) ) ) ),
			array( 'key' => 'price', 'title' => 'Pricing (prices come from Prices & settings)', 'fields' => array( $f( 'price_kicker', 'Small label' ), $f( 'price_title', 'Title' ), $f( 'plan_cta', 'Button' ), $list( 'plan_items', 'What is included', array( $f( 'text', 'Text' ) ) ), $f( 'pay_note', 'Note under the price' ) ) ),
			array( 'key' => 'faq', 'title' => 'Questions & answers', 'fields' => array( $f( 'faq_kicker', 'Small label' ), $f( 'faq_title', 'Title' ), $list( 'faq', 'Questions', array( $f( 'q', 'Question' ), $f( 'a', 'Answer', 'textarea' ) ) ) ) ),
			array( 'key' => 'band', 'title' => 'Last call to action', 'fields' => array( $f( 'band_title', 'Title' ), $f( 'band_text', 'Text' ), $f( 'band_cta', 'Button' ) ) ),
			array( 'key' => 'footer', 'title' => 'Footer & page title', 'fields' => array( $f( 'footer_tag', 'Tagline' ), $f( 'credit', 'Company credit (shown with the NOORIYAH logo)' ), $f( 'meta_title', 'Browser tab / Google title' ), $f( 'meta_desc', 'Google description', 'textarea' ) ) ),
		);
	}

	/**
	 * Stored content merged over the defaults.
	 *
	 * @return array<string,mixed>
	 */
	public static function load(): array {
		$stored = function_exists( 'get_option' ) ? get_option( self::OPTION, array() ) : array();
		$c      = self::defaults();
		if ( is_array( $stored ) ) {
			foreach ( $stored as $k => $v ) {
				if ( array_key_exists( $k, $c ) ) {
					$c[ $k ] = 'show' === $k && is_array( $v ) ? array_merge( $c['show'], $v ) : $v;
				}
			}
		}
		return $c;
	}

	/**
	 * Validate and store; returns the merged content.
	 *
	 * @param array<string,mixed> $data Content from the editor.
	 * @return array<string,mixed>
	 */
	public static function save( array $data ): array {
		$defaults = self::defaults();
		$clean    = array();
		foreach ( $data as $k => $v ) {
			if ( ! array_key_exists( $k, $defaults ) ) {
				continue;
			}
			if ( 'show' === $k ) {
				$clean['show'] = array();
				foreach ( $defaults['show'] as $s => $on ) {
					$clean['show'][ $s ] = isset( $v[ $s ] ) ? Text::bool( $v[ $s ] ) : $on;
				}
			} elseif ( isset( $defaults[ $k ]['bn'] ) ) {
				$clean[ $k ] = self::pair( $v );
			} elseif ( is_array( $defaults[ $k ] ) && is_array( $v ) ) {
				$items = array();
				foreach ( array_slice( array_values( $v ), 0, 30 ) as $item ) {
					if ( ! is_array( $item ) ) {
						continue;
					}
					$row = array();
					foreach ( $defaults[ $k ][0] as $field => $sample ) {
						$row[ $field ] = 'icon' === $field ? ( in_array( $item['icon'] ?? '', self::ICONS, true ) ? $item['icon'] : 'star' ) : self::pair( $item[ $field ] ?? array() );
					}
					$items[] = $row;
				}
				$clean[ $k ] = $items;
			}
		}
		if ( function_exists( 'update_option' ) ) {
			update_option( self::OPTION, $clean, false );
		}
		return self::load();
	}

	public static function reset(): void {
		if ( function_exists( 'delete_option' ) ) {
			delete_option( self::OPTION );
		}
	}

	/**
	 * @param mixed $v Raw {bn, en}.
	 * @return array{bn:string,en:string}
	 */
	private static function pair( $v ): array {
		$v = is_array( $v ) ? $v : array();
		return array(
			'bn' => Text::multiline( $v['bn'] ?? '', 2000 ),
			'en' => Text::multiline( $v['en'] ?? '', 2000 ),
		);
	}
}
