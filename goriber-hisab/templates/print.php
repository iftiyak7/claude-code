<?php
/**
 * Printable documents: invoices, receipts (58/80 mm thermal, A4, A5),
 * purchases, returns, money receipts and statements.
 *
 * Variables: $view = [type, doc, business, settings, paper, auto, ctx].
 * Every dynamic value is escaped at output. Override the whole template
 * with the "goriber_hisab/print_template" filter.
 *
 * @package GoriberHisab
 */

defined( 'ABSPATH' ) || exit;

use GoriberHisab\Admin\Landing;
use GoriberHisab\Support\Barcode;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Support\NumberWords;

$type     = $view['type'];
$doc      = $view['doc'];
$biz      = $view['business'];
$settings = $view['settings'];
$paper    = $view['paper'];
$ctx      = $view['ctx'];
$thermal  = in_array( $paper, array( '58mm', '80mm' ), true );
$narrow   = '58mm' === $paper;
$places   = (int) $biz['decimals'];
$color    = preg_match( '/^#[0-9a-f]{6}$/i', (string) $settings['invoice.color'] ) ? $settings['invoice.color'] : '#16a34a';
$lang     = Landing::lang();
$L        = static fn( string $bn, string $en ): string => 'bn' === $lang ? $bn : $en;
$digits   = static fn( string $s ): string => 'bn' === $lang ? strtr( $s, array( '0' => '০', '1' => '১', '2' => '২', '3' => '৩', '4' => '৪', '5' => '৫', '6' => '৬', '7' => '৭', '8' => '৮', '9' => '৯' ) ) : $s;

$money = static function ( $value ) use ( $biz, $places, $settings, $digits ): string {
	$n   = Decimal::toString( Decimal::of( $value ), $places );
	$neg = str_starts_with( $n, '-' );
	$n   = ltrim( $n, '-' );
	list( $int, $frac ) = array_pad( explode( '.', $n ), 2, '' );
	$int = preg_replace( '/\B(?=(\d{3})+(?!\d))/', (string) $settings['general.thousand_sep'], $int );
	$n   = $int . ( '' !== $frac ? $settings['general.decimal_sep'] . $frac : '' );
	$sym = (string) $biz['currency_symbol'];
	$out = match ( $biz['currency_position'] ) {
		'after'        => $n . $sym,
		'after_space'  => $n . ' ' . $sym,
		'before_space' => $sym . ' ' . $n,
		default        => $sym . $n,
	};
	return $digits( ( $neg ? '-' : '' ) . $out );
};
$qty  = static fn( $v ) => $digits( rtrim( rtrim( Decimal::toString( Decimal::of( $v ), 4 ), '0' ), '.' ) );
$date = static fn( $d ) => $d ? $digits( wp_date( (string) $settings['general.date_format'], strtotime( (string) $d . ' 12:00:00' ) ) ) : '';
$tz   = new DateTimeZone( $ctx->timezone() );
$time = static function ( $utc ) use ( $tz, $digits ): string {
	if ( ! $utc ) {
		return '';
	}
	$d = new DateTimeImmutable( (string) $utc, new DateTimeZone( 'UTC' ) );
	return $digits( $d->setTimezone( $tz )->format( 'h:i A' ) );
};
$now_local = ( new DateTimeImmutable( 'now', $tz ) );

$titles = array(
	'sale'      => $L( 'বিক্রয় রসিদ', 'Invoice' ),
	'purchase'  => $L( 'ক্রয় রসিদ', 'Purchase' ),
	'return'    => 'sale' === ( $doc['return_type'] ?? '' ) ? $L( 'বিক্রয় ফেরত', 'Sales Return' ) : $L( 'ক্রয় ফেরত', 'Purchase Return' ),
	'payment'   => 'in' === ( $doc['direction'] ?? '' ) ? $L( 'টাকা প্রাপ্তির রসিদ', 'Money Receipt' ) : $L( 'পেমেন্ট ভাউচার', 'Payment Voucher' ),
	'statement' => $L( 'হিসাব বিবরণী', 'Account Statement' ),
);
$party = match ( $type ) {
	'sale'      => $doc['customer'] ?? null,
	'purchase'  => $doc['supplier'] ?? null,
	'return', 'payment' => $doc['contact'] ?? null,
	'statement' => $doc['contact'] ?? null,
};
$branch    = $doc['branch'] ?? null;
$logo_url  = ! empty( $biz['logo_url'] ) && $settings['invoice.show_logo'] ? $biz['logo_url'] : '';
$number    = (string) ( $doc['number'] ?? '' );
$is_void   = 'void' === ( $doc['status'] ?? '' );
$doc_date  = $doc['sale_date'] ?? $doc['purchase_date'] ?? $doc['return_date'] ?? $doc['payment_date'] ?? $doc['to'] ?? '';
$doc_time  = $time( $doc['created_at'] ?? '' );
$address   = $branch && ! empty( $branch['address'] ) ? $branch['address'] : (string) $biz['address'];
$seller    = (string) ( $doc['salesperson_name'] ?? '' );
$order     = $view['order'] ?? null;
$delivery  = '';
if ( $order && '' !== (string) $order['courier'] ) {
	$couriers = \GoriberHisab\Orders\OrderService::COURIERS;
	$delivery = 'self' === $order['courier']
		? $L( 'নিজস্ব ডেলিভারি', 'Own delivery' ) . ( $order['rider_name'] ? ' (' . $order['rider_name'] . ')' : '' )
		: ( $couriers[ $order['courier'] ] ?? (string) $order['courier'] ) . ( $order['consignment_id'] ? ' · ' . $order['consignment_id'] : '' );
}
$cashier   = (string) ( $doc['cashier_name'] ?? '' );
$footer    = (string) $settings['invoice.footer'];
$footer    = 'Thank you for your business!' === $footer ? $L( 'আমাদের সাথে কেনাকাটার জন্য ধন্যবাদ!', $footer ) : $footer;
$sign      = (string) $settings['invoice.signature_label'];
$sign      = 'Authorized Signature' === $sign ? $L( 'অনুমোদিত স্বাক্ষর', $sign ) : $sign;
$status_tx = array(
	'paid'    => $L( 'পরিশোধিত', 'PAID' ),
	'partial' => $L( 'আংশিক পরিশোধ', 'PARTIALLY PAID' ),
	'due'     => $L( 'বাকি', 'DUE' ),
);
$items       = $doc['items'] ?? array();
$item_count  = count( $items );
$qty_total   = Decimal::sum( array_map( static fn( $i ) => Decimal::of( $i['qty'] ), $items ) );
$line_disc   = Decimal::sum( array_map( static fn( $i ) => Decimal::of( $i['discount_amount'] ?? 0 ), $items ) );
$saved       = $line_disc + Decimal::of( $doc['discount_amount'] ?? 0 );
$customer_due = ( 'sale' === $type && $party && isset( $party['balance'] ) ) ? Decimal::of( $party['balance'] ) : 0;
$this_due     = Decimal::of( $doc['due_amount'] ?? 0 );
$previous_due = max( 0, $customer_due - $this_due );
$tendered     = ! empty( $doc['meta']['tendered'] ) ? Decimal::of( $doc['meta']['tendered'] ) : 0;
$change       = $tendered > Decimal::of( $doc['paid_amount'] ?? 0 ) ? $tendered - Decimal::of( $doc['paid_amount'] ?? 0 ) : 0;
$words        = isset( $doc['total'] ) ? NumberWords::money( Decimal::toString( Decimal::of( $doc['total'] ) ), $lang ) : '';
$font         = 'serif' === $settings['invoice.font'] ? 'Georgia, "Noto Serif Bengali", serif' : ( 'mono' === $settings['invoice.font'] ? 'ui-monospace, Menlo, monospace' : 'system-ui, -apple-system, "Segoe UI", "Noto Sans Bengali", "Hind Siliguri", Roboto, sans-serif' );
?>
<!doctype html>
<html lang="<?php echo esc_attr( $lang ); ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?php echo esc_html( $titles[ $type ] . ( $number ? ' ' . $number : '' ) ); ?></title>
<style>
	@page { size: <?php echo esc_html( $thermal ? $paper . ' auto' : strtoupper( $paper ) ); ?>; margin: <?php echo $thermal ? '2mm' : '10mm'; ?>; }
	:root { --c: <?php echo esc_html( $color ); ?>; --ink: #0f172a; --mut: #64748b; --line: #e2e8f0; --soft: color-mix(in srgb, var(--c) 8%, white); }
	* { box-sizing: border-box; }
	html { background: #e5e7eb; }
	body { margin: 0; color: var(--ink); font: <?php echo $thermal ? ( $narrow ? '11px/1.35' : '12px/1.4' ) : '12.5px/1.5'; ?> <?php echo $font; // phpcs:ignore WordPress.Security.EscapeOutput -- fixed list. ?>; }
	.sheet { background: #fff; max-width: <?php echo esc_html( array( 'a4' => '210mm', 'a5' => '148mm', '80mm' => '80mm', '58mm' => '58mm' )[ $paper ] ); ?>; margin: 16px auto 80px; padding: <?php echo $thermal ? '4mm 3mm' : '12mm 12mm 10mm'; ?>; box-shadow: 0 6px 24px rgba(0,0,0,.12); position: relative; }
	.muted { color: var(--mut); }
	.num { text-align: right; white-space: nowrap; }
	.void { position: absolute; top: 38%; left: 0; right: 0; text-align: center; font-size: <?php echo $thermal ? '40px' : '96px'; ?>; color: rgba(220,38,38,.16); transform: rotate(-18deg); font-weight: 900; pointer-events: none; letter-spacing: .1em; }
	.toolbar { position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; z-index: 9; }
	.toolbar button { font: 600 14px system-ui, sans-serif; padding: 10px 18px; border-radius: 999px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.12); }
	.toolbar .primary { background: var(--c); color: #fff; border-color: var(--c); }
	.barcode svg { max-width: 100%; height: <?php echo $thermal ? '34px' : '38px'; ?>; }

	/* ---------------- Thermal receipt */
	.r-center { text-align: center; }
	.r-logo { max-height: 46px; max-width: 70%; filter: grayscale(1) contrast(1.2); margin-bottom: 2px; }
	.r-shop { font-size: <?php echo $narrow ? '14px' : '17px'; ?>; font-weight: 800; letter-spacing: .02em; }
	.r-band { background: #000; color: #fff; text-align: center; font-weight: 800; letter-spacing: .12em; padding: 3px 0; margin: 6px 0; text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
	.r-rule { border-top: 1px dashed #000; margin: 6px 0; }
	.r-rule2 { border-top: 2px solid #000; margin: 6px 0; }
	.r-row { display: flex; justify-content: space-between; gap: 6px; }
	.r-row span:last-child { text-align: right; white-space: nowrap; }
	.r-kv { display: grid; grid-template-columns: auto 1fr; gap: 0 6px; }
	.r-kv b { font-weight: 600; }
	.r-head { display: flex; justify-content: space-between; font-weight: 700; border-bottom: 1px solid #000; padding-bottom: 2px; margin-bottom: 3px; }
	.r-item { margin-bottom: 4px; }
	.r-item .n { font-weight: 600; }
	.r-total { display: flex; justify-content: space-between; align-items: center; border: 2px solid #000; padding: 4px 6px; margin: 6px 0; font-size: <?php echo $narrow ? '14px' : '16px'; ?>; font-weight: 900; }
	.r-words { font-style: italic; font-size: .92em; margin-bottom: 4px; }
	.r-due { font-weight: 800; }
	.r-saved { text-align: center; border: 1px dashed #000; padding: 3px; margin: 6px 0; font-weight: 700; }
	.r-small { font-size: .85em; }

	/* ---------------- A4 / A5 invoice */
	.inv-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; padding-bottom: 14px; border-bottom: 3px solid var(--c); }
	.inv-brand { display: flex; gap: 12px; align-items: flex-start; }
	.inv-brand img { max-height: 64px; max-width: 140px; object-fit: contain; }
	.inv-brand h1 { margin: 0 0 2px; font-size: 22px; letter-spacing: .01em; }
	.inv-title { text-align: right; }
	.inv-title h2 { margin: 0; font-size: 26px; letter-spacing: .08em; text-transform: uppercase; color: var(--c); font-weight: 900; }
	.pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-weight: 800; font-size: 11px; letter-spacing: .06em; margin-top: 6px; }
	.pill.paid { background: #dcfce7; color: #166534; } .pill.partial { background: #fef9c3; color: #854d0e; } .pill.due { background: #fee2e2; color: #991b1b; }
	.meta { display: grid; grid-template-columns: repeat(<?php echo 'a5' === $paper ? 2 : 3; ?>, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin: 14px 0; }
	.meta div { background: #fff; padding: 7px 10px; }
	.meta small { display: block; color: var(--mut); font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; }
	.meta strong { font-size: 13px; }
	.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
	.box { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
	.box .lbl { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--c); font-weight: 800; margin-bottom: 4px; }
	table.items { width: 100%; border-collapse: collapse; }
	table.items th { background: var(--c); color: #fff; text-align: left; font-weight: 700; padding: 8px; font-size: 11.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
	table.items th:first-child { border-radius: 6px 0 0 6px; } table.items th:last-child { border-radius: 0 6px 6px 0; }
	table.items td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
	table.items tbody tr:nth-child(even) td { background: #f8fafc; }
	.after { display: grid; grid-template-columns: 1fr 44%; gap: 18px; margin-top: 12px; align-items: start; }
	.totals { width: 100%; border-collapse: collapse; }
	.totals td { padding: 5px 8px; }
	.totals .grand td { background: var(--c); color: #fff; font-size: 16px; font-weight: 900; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
	.totals .due td { font-weight: 800; color: #b91c1c; border-top: 1px solid var(--line); }
	.words { background: var(--soft); border-left: 4px solid var(--c); padding: 8px 10px; border-radius: 6px; margin-bottom: 10px; }
	.words small { display: block; color: var(--mut); text-transform: uppercase; font-size: 10px; letter-spacing: .06em; }
	.pay-table { width: 100%; border-collapse: collapse; font-size: 12px; }
	.pay-table td { padding: 4px 0; border-bottom: 1px dotted var(--line); }
	.acct { margin-top: 10px; }
	.foot { margin-top: 26px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: end; }
	.sign { border-top: 1px solid var(--ink); text-align: center; padding-top: 4px; font-size: 11.5px; }
	.thanks { text-align: center; margin-top: 18px; padding-top: 10px; border-top: 1px dashed var(--line); }
	.powered { text-align: center; color: var(--mut); font-size: 10px; margin-top: 6px; }
	table.plain { width: 100%; border-collapse: collapse; }
	table.plain th { text-align: left; background: var(--soft); padding: 7px 8px; font-size: 11.5px; }
	table.plain td { padding: 7px 8px; border-bottom: 1px solid var(--line); }
	/* Templates */
	body.tpl-modern .inv-top { background: var(--c); color: #fff; border: 0; padding: 16px; border-radius: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
	body.tpl-modern .inv-top .muted, body.tpl-modern .inv-title h2 { color: #fff; }
	body.tpl-modern .inv-top .barcode svg g { fill: #fff; }
	body.tpl-compact { font-size: 11px; }
	body.tpl-compact table.items td, body.tpl-compact table.items th { padding: 4px 6px; }
	body.tpl-compact .meta div { padding: 4px 8px; }
	@media print {
		html { background: #fff; }
		.toolbar { display: none; }
		.sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; }
		body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
	}
	@media (max-width: 600px) { .sheet { margin: 0 0 80px; box-shadow: none; } .meta { grid-template-columns: 1fr 1fr; } .parties, .after { grid-template-columns: 1fr; } }
</style>
<script>
function ghPrint(){var n=window.GoriberHisabNative;if(n&&n.printPage){n.printPage();}else{window.print();}}
function ghClose(){if(window.GoriberHisabNative){history.back();}else{window.close();}}
</script>
</head>
<body class="tpl-<?php echo esc_attr( sanitize_key( (string) $settings['invoice.template'] ) ); ?>">
<div class="toolbar">
	<button type="button" class="primary" onclick="ghPrint()"><?php echo esc_html( $L( 'প্রিন্ট / PDF', 'Print / PDF' ) ); ?></button>
	<button type="button" onclick="ghClose()"><?php echo esc_html( $L( 'বন্ধ করুন', 'Close' ) ); ?></button>
</div>
<div class="sheet">
<?php if ( $is_void ) : ?>
	<div class="void"><?php echo esc_html( $L( 'বাতিল', 'VOID' ) ); ?></div>
<?php endif; ?>

<?php if ( $thermal && in_array( $type, array( 'sale', 'return', 'payment', 'purchase' ), true ) ) : ?>
	<!-- ============================ THERMAL RECEIPT ============================ -->
	<div class="r-center">
		<?php if ( $logo_url ) : ?>
			<img class="r-logo" src="<?php echo esc_url( $logo_url ); ?>" alt=""><br>
		<?php endif; ?>
		<div class="r-shop"><?php echo esc_html( $biz['name'] ); ?></div>
		<?php if ( $branch && ! empty( $branch['name'] ) && ! empty( $ctx->branch_ids ) ) : ?>
			<div><?php echo esc_html( $branch['name'] ); ?></div>
		<?php endif; ?>
		<?php if ( '' !== $address ) : ?>
			<div class="r-small"><?php echo esc_html( $address ); ?></div>
		<?php endif; ?>
		<div class="r-small"><?php echo esc_html( $digits( trim( (string) ( $branch['phone'] ?? '' ) ?: (string) $biz['phone'] ) ) ); ?><?php echo $biz['email'] ? ' · ' . esc_html( $biz['email'] ) : ''; ?></div>
		<?php if ( $biz['tax_number'] ) : ?>
			<div class="r-small"><?php echo esc_html( $settings['tax.label'] . ': ' . $biz['tax_number'] ); ?></div>
		<?php endif; ?>
	</div>
	<div class="r-band"><?php echo esc_html( $titles[ $type ] ); ?></div>
	<div class="r-kv">
		<b><?php echo esc_html( $L( 'নং', 'No' ) ); ?>:</b><span><?php echo esc_html( $number ); ?></span>
		<b><?php echo esc_html( $L( 'তারিখ', 'Date' ) ); ?>:</b><span><?php echo esc_html( $date( $doc_date ) . ( $doc_time ? '  ' . $doc_time : '' ) ); ?></span>
		<?php if ( $order ) : ?>
			<b><?php echo esc_html( $L( 'অর্ডার', 'Order' ) ); ?>:</b><span><?php echo esc_html( $order['number'] ); ?></span>
			<?php if ( $delivery ) : ?>
				<b><?php echo esc_html( $L( 'ডেলিভারি', 'Delivery' ) ); ?>:</b><span><?php echo esc_html( $delivery ); ?></span>
			<?php endif; ?>
		<?php endif; ?>
		<?php if ( $seller ) : ?>
			<b><?php echo esc_html( $L( 'বিক্রেতা', 'Sold by' ) ); ?>:</b><span><?php echo esc_html( $seller ); ?></span>
		<?php endif; ?>
		<?php if ( $cashier && $cashier !== $seller ) : ?>
			<b><?php echo esc_html( $L( 'ক্যাশিয়ার', 'Cashier' ) ); ?>:</b><span><?php echo esc_html( $cashier ); ?></span>
		<?php endif; ?>
		<?php if ( $party ) : ?>
			<b><?php echo esc_html( 'purchase' === $type ? $L( 'সাপ্লায়ার', 'Supplier' ) : $L( 'গ্রাহক', 'Customer' ) ); ?>:</b><span><?php echo esc_html( $party['name'] ); ?></span>
			<?php if ( ! empty( $party['phone'] ) ) : ?>
				<b><?php echo esc_html( $L( 'ফোন', 'Phone' ) ); ?>:</b><span><?php echo esc_html( $digits( (string) $party['phone'] ) ); ?></span>
			<?php endif; ?>
		<?php elseif ( 'sale' === $type ) : ?>
			<b><?php echo esc_html( $L( 'গ্রাহক', 'Customer' ) ); ?>:</b><span><?php echo esc_html( $L( 'সাধারণ ক্রেতা', 'Walk-in' ) ); ?></span>
		<?php endif; ?>
	</div>
	<div class="r-rule"></div>

	<?php if ( 'payment' === $type ) : ?>
		<div class="r-total"><span><?php echo esc_html( $L( 'টাকা', 'AMOUNT' ) ); ?></span><span><?php echo esc_html( $money( $doc['amount'] ) ); ?></span></div>
		<div class="r-words"><?php echo esc_html( NumberWords::money( Decimal::toString( Decimal::of( $doc['amount'] ) ), $lang ) ); ?></div>
		<div class="r-row"><span><?php echo esc_html( $L( 'মাধ্যম', 'Method' ) ); ?></span><span><?php echo esc_html( $doc['account']['name'] ?? '' ); ?></span></div>
		<?php if ( ! empty( $doc['reference'] ) ) : ?>
			<div class="r-row"><span><?php echo esc_html( $L( 'রেফারেন্স', 'Reference' ) ); ?></span><span><?php echo esc_html( $doc['reference'] ); ?></span></div>
		<?php endif; ?>
		<?php foreach ( $doc['allocations'] as $a ) : ?>
			<div class="r-row"><span><?php echo esc_html( (string) $a['number'] ); ?></span><span><?php echo esc_html( $money( $a['amount'] ) ); ?></span></div>
		<?php endforeach; ?>
	<?php else : ?>
		<div class="r-head"><span><?php echo esc_html( $L( 'পণ্য', 'Item' ) ); ?></span><span><?php echo esc_html( $L( 'মোট', 'Amount' ) ); ?></span></div>
		<?php foreach ( $items as $n => $item ) : ?>
			<div class="r-item">
				<div class="n"><?php echo esc_html( $digits( (string) ( $n + 1 ) ) . '. ' . $item['name'] ); ?></div>
				<div class="r-row"><span><?php echo esc_html( $qty( $item['qty'] ) . ' × ' . $money( $item['unit_price'] ) ); ?></span><span><?php echo esc_html( $money( $item['total'] ) ); ?></span></div>
				<?php if ( Decimal::of( $item['discount_amount'] ?? 0 ) ) : ?>
					<div class="r-row r-small"><span><?php echo esc_html( $L( 'ছাড়', 'Discount' ) ); ?></span><span>-<?php echo esc_html( $money( $item['discount_amount'] ) ); ?></span></div>
				<?php endif; ?>
			</div>
		<?php endforeach; ?>
		<div class="r-rule"></div>
		<div class="r-row r-small"><span><?php echo esc_html( $L( 'পণ্য', 'Items' ) . ': ' . $digits( (string) $item_count ) ); ?></span><span><?php echo esc_html( $L( 'মোট পরিমাণ', 'Total qty' ) . ': ' . $qty( Decimal::toString( $qty_total ) ) ); ?></span></div>
		<?php if ( isset( $doc['subtotal'] ) ) : ?>
			<div class="r-row"><span><?php echo esc_html( $L( 'সাবটোটাল', 'Subtotal' ) ); ?></span><span><?php echo esc_html( $money( $doc['subtotal'] ) ); ?></span></div>
		<?php endif; ?>
		<?php if ( Decimal::of( $doc['discount_amount'] ?? 0 ) ) : ?>
			<div class="r-row"><span><?php echo esc_html( $L( 'ছাড়', 'Discount' ) ); ?></span><span>-<?php echo esc_html( $money( $doc['discount_amount'] ) ); ?></span></div>
		<?php endif; ?>
		<?php if ( Decimal::of( $doc['tax_amount'] ?? 0 ) ) : ?>
			<div class="r-row"><span><?php echo esc_html( $settings['tax.label'] ); ?></span><span><?php echo esc_html( $money( $doc['tax_amount'] ) ); ?></span></div>
		<?php endif; ?>
		<?php if ( Decimal::of( $doc['shipping_amount'] ?? 0 ) ) : ?>
			<div class="r-row"><span><?php echo esc_html( $L( 'ডেলিভারি চার্জ', 'Delivery' ) ); ?></span><span><?php echo esc_html( $money( $doc['shipping_amount'] ) ); ?></span></div>
		<?php endif; ?>
		<?php if ( Decimal::of( $doc['round_off'] ?? 0 ) ) : ?>
			<div class="r-row"><span><?php echo esc_html( $L( 'রাউন্ড', 'Round off' ) ); ?></span><span><?php echo esc_html( $money( $doc['round_off'] ) ); ?></span></div>
		<?php endif; ?>
		<div class="r-total"><span><?php echo esc_html( $L( 'সর্বমোট', 'TOTAL' ) ); ?></span><span><?php echo esc_html( $money( $doc['total'] ) ); ?></span></div>
		<div class="r-words"><?php echo esc_html( $words ); ?></div>
		<?php if ( 'sale' === $type ) : ?>
			<?php foreach ( $doc['payments'] as $p ) : ?>
				<div class="r-row"><span><?php echo esc_html( $L( 'পরিশোধ', 'Paid' ) . ' (' . $p['account_name'] . ')' ); ?></span><span><?php echo esc_html( $money( $p['amount'] ) ); ?></span></div>
			<?php endforeach; ?>
			<?php if ( $change > 0 ) : ?>
				<div class="r-row"><span><?php echo esc_html( $L( 'নগদ দিয়েছেন', 'Cash given' ) ); ?></span><span><?php echo esc_html( $money( Decimal::toString( $tendered ) ) ); ?></span></div>
				<div class="r-row"><span><?php echo esc_html( $L( 'ফেরত', 'Change' ) ); ?></span><span><?php echo esc_html( $money( Decimal::toString( $change ) ) ); ?></span></div>
			<?php endif; ?>
			<?php if ( $this_due > 0 ) : ?>
				<div class="r-row r-due"><span><?php echo esc_html( $L( 'এই রসিদে বাকি', 'Due on this bill' ) ); ?></span><span><?php echo esc_html( $money( Decimal::toString( $this_due ) ) ); ?></span></div>
			<?php endif; ?>
			<?php if ( $previous_due > 0 ) : ?>
				<div class="r-row"><span><?php echo esc_html( $L( 'আগের বাকি', 'Previous due' ) ); ?></span><span><?php echo esc_html( $money( Decimal::toString( $previous_due ) ) ); ?></span></div>
			<?php endif; ?>
			<?php if ( $customer_due > 0 && $previous_due > 0 ) : ?>
				<div class="r-row r-due"><span><?php echo esc_html( $L( 'মোট বাকি', 'Total due' ) ); ?></span><span><?php echo esc_html( $money( Decimal::toString( $customer_due ) ) ); ?></span></div>
			<?php endif; ?>
			<?php if ( $saved > 0 ) : ?>
				<div class="r-saved"><?php echo esc_html( sprintf( $L( 'আপনি সাশ্রয় করেছেন %s', 'You saved %s' ), $money( Decimal::toString( $saved ) ) ) ); ?></div>
			<?php endif; ?>
		<?php endif; ?>
	<?php endif; ?>
	<div class="r-rule2"></div>
	<div class="r-center barcode"><?php echo Barcode::svg( $number, 34, 1 ); // phpcs:ignore WordPress.Security.EscapeOutput -- generated SVG from printable ASCII. ?></div>
	<?php if ( '' !== $footer ) : ?>
		<div class="r-center" style="font-weight:700;margin-top:4px"><?php echo nl2br( esc_html( $footer ) ); ?></div>
	<?php endif; ?>
	<?php if ( 'sale' === $type && $settings['invoice.terms'] ) : ?>
		<div class="r-center r-small" style="margin-top:3px"><?php echo nl2br( esc_html( $settings['invoice.terms'] ) ); ?></div>
	<?php endif; ?>
	<div class="r-center r-small muted" style="margin-top:6px"><?php echo esc_html( $L( 'প্রিন্ট', 'Printed' ) . ': ' . $digits( $now_local->format( 'd/m/Y h:i A' ) ) ); ?></div>

<?php else : ?>
	<!-- ============================ A4 / A5 DOCUMENT ============================ -->
	<div class="inv-top">
		<div class="inv-brand">
			<?php if ( $logo_url ) : ?>
				<img src="<?php echo esc_url( $logo_url ); ?>" alt="<?php echo esc_attr( $biz['name'] ); ?>">
			<?php endif; ?>
			<div>
				<h1><?php echo esc_html( $biz['name'] ); ?></h1>
				<div class="muted">
					<?php echo nl2br( esc_html( $address ) ); ?><br>
					<?php echo esc_html( $digits( trim( (string) ( $branch['phone'] ?? '' ) ?: (string) $biz['phone'] ) ) ); ?><?php echo $biz['email'] ? ' · ' . esc_html( $biz['email'] ) : ''; ?>
					<?php if ( $biz['website'] ) : ?>
						<br><?php echo esc_html( $biz['website'] ); ?>
					<?php endif; ?>
					<?php if ( $biz['tax_number'] ) : ?>
						<br><?php echo esc_html( $settings['tax.label'] . ': ' . $biz['tax_number'] ); ?>
					<?php endif; ?>
				</div>
			</div>
		</div>
		<div class="inv-title">
			<h2><?php echo esc_html( $titles[ $type ] ); ?></h2>
			<?php if ( $number ) : ?>
				<div><strong># <?php echo esc_html( $number ); ?></strong></div>
				<div class="barcode"><?php echo Barcode::svg( $number ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
			<?php endif; ?>
			<?php if ( isset( $doc['payment_status'] ) && ! $is_void && isset( $status_tx[ $doc['payment_status'] ] ) ) : ?>
				<span class="pill <?php echo esc_attr( $doc['payment_status'] ); ?>"><?php echo esc_html( $status_tx[ $doc['payment_status'] ] ); ?></span>
			<?php endif; ?>
		</div>
	</div>

	<?php if ( 'statement' !== $type ) : ?>
	<div class="meta">
		<div><small><?php echo esc_html( $L( 'নম্বর', 'Number' ) ); ?></small><strong><?php echo esc_html( $number ); ?></strong></div>
		<div><small><?php echo esc_html( $L( 'তারিখ', 'Date' ) ); ?></small><strong><?php echo esc_html( $date( $doc_date ) ); ?></strong></div>
		<div><small><?php echo esc_html( $L( 'সময়', 'Time' ) ); ?></small><strong><?php echo esc_html( $doc_time ?: '—' ); ?></strong></div>
		<?php if ( $order ) : ?>
			<div><small><?php echo esc_html( $L( 'অর্ডার', 'Order' ) ); ?></small><strong><?php echo esc_html( $order['number'] ); ?></strong></div>
			<?php if ( $delivery ) : ?>
				<div><small><?php echo esc_html( $L( 'ডেলিভারি', 'Delivery' ) ); ?></small><strong><?php echo esc_html( $delivery ); ?></strong></div>
			<?php endif; ?>
		<?php endif; ?>
		<?php if ( 'sale' === $type ) : ?>
			<div><small><?php echo esc_html( $L( 'বিক্রেতা', 'Sold by' ) ); ?></small><strong><?php echo esc_html( $seller ?: '—' ); ?></strong></div>
		<?php endif; ?>
		<?php if ( $cashier && $cashier !== $seller ) : ?>
			<div><small><?php echo esc_html( $L( 'ক্যাশিয়ার', 'Cashier' ) ); ?></small><strong><?php echo esc_html( $cashier ); ?></strong></div>
		<?php endif; ?>
		<?php if ( ! empty( $doc['due_date'] ) ) : ?>
			<div><small><?php echo esc_html( $L( 'পরিশোধের শেষ তারিখ', 'Due date' ) ); ?></small><strong><?php echo esc_html( $date( $doc['due_date'] ) ); ?></strong></div>
		<?php endif; ?>
		<?php if ( 'purchase' === $type && ! empty( $doc['supplier_invoice'] ) ) : ?>
			<div><small><?php echo esc_html( $L( 'সাপ্লায়ারের ইনভয়েস', 'Supplier invoice' ) ); ?></small><strong><?php echo esc_html( $doc['supplier_invoice'] ); ?></strong></div>
		<?php endif; ?>
		<?php if ( 'return' === $type && ! empty( $doc['document'] ) ) : ?>
			<div><small><?php echo esc_html( $L( 'যে রসিদের বিপরীতে', 'Against' ) ); ?></small><strong><?php echo esc_html( $doc['document']['number'] ); ?></strong></div>
		<?php endif; ?>
		<?php if ( $branch && ! empty( $branch['name'] ) ) : ?>
			<div><small><?php echo esc_html( $L( 'শাখা', 'Branch' ) ); ?></small><strong><?php echo esc_html( $branch['name'] ); ?></strong></div>
		<?php endif; ?>
	</div>
	<?php endif; ?>

	<div class="parties">
		<div class="box">
			<div class="lbl"><?php echo esc_html( 'purchase' === $type ? $L( 'সাপ্লায়ার', 'Supplier' ) : ( 'statement' === $type ? $L( 'হিসাবধারী', 'Account' ) : $L( 'ক্রেতা', 'Bill to' ) ) ); ?></div>
			<?php if ( $party ) : ?>
				<strong><?php echo esc_html( $party['name'] ); ?></strong><br>
				<?php echo ! empty( $party['company'] ) && $party['company'] !== $party['name'] ? esc_html( $party['company'] ) . '<br>' : ''; ?>
				<?php echo ! empty( $party['address'] ) ? nl2br( esc_html( $party['address'] ) ) . '<br>' : ''; ?>
				<?php echo esc_html( $digits( (string) ( $party['phone'] ?? '' ) ) ); ?>
			<?php else : ?>
				<strong><?php echo esc_html( $L( 'সাধারণ ক্রেতা', 'Walk-in customer' ) ); ?></strong>
			<?php endif; ?>
		</div>
		<?php if ( 'sale' === $type && $party && $customer_due > 0 && $settings['invoice.show_due'] ) : ?>
			<div class="box">
				<div class="lbl"><?php echo esc_html( $L( 'গ্রাহকের হিসাব', 'Customer account' ) ); ?></div>
				<table class="pay-table">
					<tr><td><?php echo esc_html( $L( 'আগের বাকি', 'Previous due' ) ); ?></td><td class="num"><?php echo esc_html( $money( Decimal::toString( $previous_due ) ) ); ?></td></tr>
					<tr><td><?php echo esc_html( $L( 'এই রসিদে বাকি', 'This bill due' ) ); ?></td><td class="num"><?php echo esc_html( $money( Decimal::toString( $this_due ) ) ); ?></td></tr>
					<tr><td><strong><?php echo esc_html( $L( 'মোট বাকি', 'Total due' ) ); ?></strong></td><td class="num"><strong style="color:#b91c1c"><?php echo esc_html( $money( Decimal::toString( $customer_due ) ) ); ?></strong></td></tr>
				</table>
			</div>
		<?php elseif ( 'statement' === $type ) : ?>
			<div class="box">
				<div class="lbl"><?php echo esc_html( $L( 'সময়কাল', 'Period' ) ); ?></div>
				<strong><?php echo esc_html( ( $doc['from'] ? $date( $doc['from'] ) : $L( 'শুরু থেকে', 'Beginning' ) ) . ' – ' . $date( $doc['to'] ) ); ?></strong>
			</div>
		<?php endif; ?>
	</div>

	<?php if ( 'statement' === $type ) : ?>
		<table class="items">
			<thead><tr><th><?php echo esc_html( $L( 'তারিখ', 'Date' ) ); ?></th><th><?php echo esc_html( $L( 'রেফারেন্স', 'Reference' ) ); ?></th><th><?php echo esc_html( $L( 'বিবরণ', 'Description' ) ); ?></th><th class="num"><?php echo esc_html( $L( 'ডেবিট', 'Debit' ) ); ?></th><th class="num"><?php echo esc_html( $L( 'ক্রেডিট', 'Credit' ) ); ?></th><th class="num"><?php echo esc_html( $L( 'ব্যালেন্স', 'Balance' ) ); ?></th></tr></thead>
			<tbody>
				<tr><td colspan="5"><em><?php echo esc_html( $L( 'প্রারম্ভিক ব্যালেন্স', 'Opening balance' ) ); ?></em></td><td class="num"><?php echo esc_html( $money( $doc['opening_balance'] ) ); ?></td></tr>
				<?php foreach ( $doc['lines'] as $l ) : ?>
					<tr>
						<td><?php echo esc_html( $date( $l['date'] ) ); ?></td>
						<td><?php echo esc_html( $l['reference_no'] ); ?></td>
						<td><?php echo esc_html( $l['description'] ); ?></td>
						<td class="num"><?php echo Decimal::of( $l['debit'] ) ? esc_html( $money( $l['debit'] ) ) : ''; ?></td>
						<td class="num"><?php echo Decimal::of( $l['credit'] ) ? esc_html( $money( $l['credit'] ) ) : ''; ?></td>
						<td class="num"><?php echo esc_html( $money( $l['balance'] ) ); ?></td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
		<div class="after"><div></div>
			<table class="totals"><tr class="grand"><td><?php echo esc_html( $L( 'সমাপনী ব্যালেন্স', 'Closing balance' ) ); ?></td><td class="num"><?php echo esc_html( $money( $doc['closing_balance'] ) ); ?></td></tr></table>
		</div>
	<?php elseif ( 'payment' === $type ) : ?>
		<table class="plain">
			<tr><th><?php echo esc_html( $L( 'টাকার পরিমাণ', 'Amount' ) ); ?></th><td class="num"><strong style="font-size:16px"><?php echo esc_html( $money( $doc['amount'] ) ); ?></strong></td></tr>
			<tr><th><?php echo esc_html( $L( 'পরিশোধের মাধ্যম', 'Payment method' ) ); ?></th><td class="num"><?php echo esc_html( $doc['account']['name'] ?? '' ); ?></td></tr>
			<?php if ( $doc['reference'] ) : ?>
				<tr><th><?php echo esc_html( $L( 'রেফারেন্স', 'Reference' ) ); ?></th><td class="num"><?php echo esc_html( $doc['reference'] ); ?></td></tr>
			<?php endif; ?>
			<?php foreach ( $doc['allocations'] as $a ) : ?>
				<tr><th><?php echo esc_html( sprintf( $L( '%s এর বিপরীতে', 'Applied to %s' ), (string) $a['number'] ) ); ?></th><td class="num"><?php echo esc_html( $money( $a['amount'] ) ); ?></td></tr>
			<?php endforeach; ?>
		</table>
		<div class="words" style="margin-top:12px"><small><?php echo esc_html( $L( 'কথায়', 'In words' ) ); ?></small><?php echo esc_html( NumberWords::money( Decimal::toString( Decimal::of( $doc['amount'] ) ), $lang ) ); ?></div>
		<?php if ( $doc['note'] ) : ?>
			<p><?php echo nl2br( esc_html( $doc['note'] ) ); ?></p>
		<?php endif; ?>
	<?php else : ?>
		<table class="items">
			<thead>
				<tr>
					<th style="width:28px">#</th>
					<th><?php echo esc_html( $L( 'পণ্যের বিবরণ', 'Description' ) ); ?></th>
					<th class="num"><?php echo esc_html( $L( 'পরিমাণ', 'Qty' ) ); ?></th>
					<th class="num"><?php echo esc_html( $L( 'দর', 'Rate' ) ); ?></th>
					<?php if ( 'return' !== $type && $line_disc > 0 ) : ?>
						<th class="num"><?php echo esc_html( $L( 'ছাড়', 'Discount' ) ); ?></th>
					<?php endif; ?>
					<?php if ( Decimal::of( $doc['tax_amount'] ?? 0 ) ) : ?>
						<th class="num"><?php echo esc_html( $settings['tax.label'] ); ?></th>
					<?php endif; ?>
					<th class="num"><?php echo esc_html( $L( 'মোট', 'Amount' ) ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $items as $i => $item ) : ?>
					<tr>
						<td><?php echo esc_html( $digits( (string) ( (int) $i + 1 ) ) ); ?></td>
						<td><strong><?php echo esc_html( $item['name'] ); ?></strong><?php echo ! empty( $item['sku'] ) ? '<br><small class="muted">' . esc_html( $item['sku'] ) . '</small>' : ''; ?></td>
						<td class="num"><?php echo esc_html( $qty( $item['qty'] ) ); ?></td>
						<td class="num"><?php echo esc_html( $money( $item['unit_price'] ) ); ?></td>
						<?php if ( 'return' !== $type && $line_disc > 0 ) : ?>
							<td class="num"><?php echo Decimal::of( $item['discount_amount'] ) ? esc_html( $money( $item['discount_amount'] ) ) : '—'; ?></td>
						<?php endif; ?>
						<?php if ( Decimal::of( $doc['tax_amount'] ?? 0 ) ) : ?>
							<td class="num"><?php echo Decimal::of( $item['tax_amount'] ) ? esc_html( $money( $item['tax_amount'] ) ) : '—'; ?></td>
						<?php endif; ?>
						<td class="num"><strong><?php echo esc_html( $money( $item['total'] ) ); ?></strong></td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>

		<div class="after">
			<div>
				<div class="words"><small><?php echo esc_html( $L( 'কথায়', 'In words' ) ); ?></small><?php echo esc_html( $words ); ?></div>
				<?php if ( ! empty( $doc['payments'] ) ) : ?>
					<div class="box">
						<div class="lbl"><?php echo esc_html( $L( 'পরিশোধের বিবরণ', 'Payments' ) ); ?></div>
						<table class="pay-table">
							<?php foreach ( $doc['payments'] as $p ) : ?>
								<tr><td><?php echo esc_html( $p['account_name'] . ( ! empty( $p['reference'] ) ? ' (' . $p['reference'] . ')' : '' ) ); ?></td><td class="num"><?php echo esc_html( $money( $p['amount'] ) ); ?></td></tr>
							<?php endforeach; ?>
							<?php if ( $change > 0 ) : ?>
								<tr><td class="muted"><?php echo esc_html( $L( 'নগদ দিয়েছেন / ফেরত', 'Cash given / change' ) ); ?></td><td class="num muted"><?php echo esc_html( $money( Decimal::toString( $tendered ) ) . ' / ' . $money( Decimal::toString( $change ) ) ); ?></td></tr>
							<?php endif; ?>
						</table>
					</div>
				<?php endif; ?>
				<?php if ( ! empty( $doc['notes'] ) || ! empty( $doc['reason'] ) ) : ?>
					<p><strong><?php echo esc_html( $L( 'নোট', 'Notes' ) ); ?>:</strong> <?php echo nl2br( esc_html( (string) ( $doc['notes'] ?? $doc['reason'] ) ) ); ?></p>
				<?php endif; ?>
			</div>
			<table class="totals">
				<tr><td class="muted"><?php echo esc_html( $L( 'মোট পণ্য', 'Items' ) ); ?></td><td class="num muted"><?php echo esc_html( $digits( (string) $item_count ) . ' · ' . $L( 'পরিমাণ', 'qty' ) . ' ' . $qty( Decimal::toString( $qty_total ) ) ); ?></td></tr>
				<?php if ( isset( $doc['subtotal'] ) ) : ?>
					<tr><td><?php echo esc_html( $L( 'সাবটোটাল', 'Subtotal' ) ); ?></td><td class="num"><?php echo esc_html( $money( $doc['subtotal'] ) ); ?></td></tr>
				<?php endif; ?>
				<?php if ( Decimal::of( $doc['discount_amount'] ?? 0 ) ) : ?>
					<tr><td><?php echo esc_html( $L( 'ছাড়', 'Discount' ) ); ?></td><td class="num">-<?php echo esc_html( $money( $doc['discount_amount'] ) ); ?></td></tr>
				<?php endif; ?>
				<?php if ( Decimal::of( $doc['tax_amount'] ?? 0 ) ) : ?>
					<tr><td><?php echo esc_html( $settings['tax.label'] ); ?></td><td class="num"><?php echo esc_html( $money( $doc['tax_amount'] ) ); ?></td></tr>
				<?php endif; ?>
				<?php if ( Decimal::of( $doc['shipping_amount'] ?? 0 ) ) : ?>
					<tr><td><?php echo esc_html( $L( 'ডেলিভারি চার্জ', 'Delivery' ) ); ?></td><td class="num"><?php echo esc_html( $money( $doc['shipping_amount'] ) ); ?></td></tr>
				<?php endif; ?>
				<?php if ( Decimal::of( $doc['other_cost'] ?? 0 ) ) : ?>
					<tr><td><?php echo esc_html( $L( 'অন্যান্য খরচ', 'Other costs' ) ); ?></td><td class="num"><?php echo esc_html( $money( $doc['other_cost'] ) ); ?></td></tr>
				<?php endif; ?>
				<?php if ( Decimal::of( $doc['round_off'] ?? 0 ) ) : ?>
					<tr><td><?php echo esc_html( $L( 'রাউন্ড', 'Round off' ) ); ?></td><td class="num"><?php echo esc_html( $money( $doc['round_off'] ) ); ?></td></tr>
				<?php endif; ?>
				<tr class="grand"><td><?php echo esc_html( $L( 'সর্বমোট', 'Total' ) ); ?></td><td class="num"><?php echo esc_html( $money( $doc['total'] ) ); ?></td></tr>
				<?php if ( isset( $doc['paid_amount'] ) ) : ?>
					<tr><td><?php echo esc_html( $L( 'পরিশোধিত', 'Paid' ) ); ?></td><td class="num"><?php echo esc_html( $money( $doc['paid_amount'] ) ); ?></td></tr>
					<?php if ( Decimal::of( $doc['return_amount'] ?? 0 ) ) : ?>
						<tr><td><?php echo esc_html( $L( 'ফেরত', 'Returned' ) ); ?></td><td class="num"><?php echo esc_html( $money( $doc['return_amount'] ) ); ?></td></tr>
					<?php endif; ?>
					<?php if ( $settings['invoice.show_due'] ) : ?>
						<tr class="due"><td><?php echo esc_html( $L( 'বাকি', 'Balance due' ) ); ?></td><td class="num"><?php echo esc_html( $money( $doc['due_amount'] ) ); ?></td></tr>
					<?php endif; ?>
				<?php endif; ?>
				<?php if ( 'return' === $type && Decimal::of( $doc['refund_amount'] ) ) : ?>
					<tr><td><?php echo esc_html( $L( 'ফেরত দেওয়া হয়েছে', 'Refunded' ) ); ?></td><td class="num"><?php echo esc_html( $money( $doc['refund_amount'] ) ); ?></td></tr>
				<?php endif; ?>
				<?php if ( 'sale' === $type && $saved > 0 ) : ?>
					<tr><td colspan="2" class="num" style="color:var(--c);font-weight:700"><?php echo esc_html( sprintf( $L( 'আপনি সাশ্রয় করেছেন %s', 'You saved %s' ), $money( Decimal::toString( $saved ) ) ) ); ?></td></tr>
				<?php endif; ?>
			</table>
		</div>
	<?php endif; ?>

	<?php if ( 'sale' === $type && $settings['invoice.terms'] ) : ?>
		<div class="box" style="margin-top:14px">
			<div class="lbl"><?php echo esc_html( $L( 'শর্তাবলী', 'Terms & conditions' ) ); ?></div>
			<div class="muted"><?php echo nl2br( esc_html( $settings['invoice.terms'] ) ); ?></div>
		</div>
	<?php endif; ?>

	<?php if ( $settings['invoice.show_signature'] && 'statement' !== $type ) : ?>
		<div class="foot">
			<div class="sign"><?php echo esc_html( 'purchase' === $type ? $L( 'সাপ্লায়ারের স্বাক্ষর', 'Supplier signature' ) : $L( 'ক্রেতার স্বাক্ষর', 'Customer signature' ) ); ?></div>
			<div class="sign"><?php echo esc_html( $sign ); ?></div>
		</div>
	<?php endif; ?>
	<?php if ( '' !== $footer ) : ?>
		<div class="thanks"><strong><?php echo nl2br( esc_html( $footer ) ); ?></strong></div>
	<?php endif; ?>
	<div class="powered"><?php echo esc_html( $L( 'প্রিন্ট', 'Printed' ) . ': ' . $digits( $now_local->format( 'd/m/Y h:i A' ) ) ); ?></div>
<?php endif; ?>
</div>
<?php if ( $view['auto'] ) : ?>
<script>window.addEventListener('load',function(){setTimeout(ghPrint,250);});</script>
<?php endif; ?>
</body>
</html>
