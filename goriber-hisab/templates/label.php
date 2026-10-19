<?php
/**
 * Parcel stickers for online orders — courier (Steadfast, Pathao…) or the
 * shop's own delivery man. Each sticker: shop, customer, products, bill, the
 * cash to collect, and a barcode that opens the order when scanned in the app.
 *
 * Variables: $view = [orders, business, settings, size, auto, ctx].
 * Sizes: 100x150 (4×6 in courier sticker), 75x100, 80mm thermal roll, a4 (4 per page).
 * Override with the "goriber_hisab/label_template" filter.
 *
 * @package GoriberHisab
 */

defined( 'ABSPATH' ) || exit;

use GoriberHisab\Admin\Landing;
use GoriberHisab\Orders\OrderService;
use GoriberHisab\Support\Barcode;
use GoriberHisab\Support\Decimal;

$orders   = $view['orders'];
$biz      = $view['business'];
$settings = $view['settings'];
$size     = $view['size'];
$places   = (int) $biz['decimals'];
$lang     = Landing::lang();
$L        = static fn( string $bn, string $en ): string => 'bn' === $lang ? $bn : $en;
$digits   = static fn( string $s ): string => 'bn' === $lang ? strtr( $s, array( '0' => '০', '1' => '১', '2' => '২', '3' => '৩', '4' => '৪', '5' => '৫', '6' => '৬', '7' => '৭', '8' => '৮', '9' => '৯' ) ) : $s;
$money    = static function ( $value ) use ( $biz, $places, $settings, $digits ): string {
	$n   = Decimal::toString( Decimal::of( $value ), $places );
	$n   = preg_replace( '/\.0+$/', '', $n );
	list( $int, $frac ) = array_pad( explode( '.', ltrim( $n, '-' ) ), 2, '' );
	$int = preg_replace( '/\B(?=(\d{3})+(?!\d))/', (string) $settings['general.thousand_sep'], $int );
	return $digits( ( str_starts_with( $n, '-' ) ? '-' : '' ) . (string) $biz['currency_symbol'] . $int . ( '' !== $frac ? $settings['general.decimal_sep'] . $frac : '' ) );
};
$qty      = static fn( $v ) => $digits( rtrim( rtrim( Decimal::toString( Decimal::of( $v ), 4 ), '0' ), '.' ) );
$date     = static fn( $d ) => $d ? $digits( wp_date( (string) $settings['general.date_format'], strtotime( (string) $d . ' 12:00:00' ) ) ) : '';
$couriers = OrderService::COURIERS;
$logo_url = ! empty( $biz['logo_url'] ) && $settings['invoice.show_logo'] ? $biz['logo_url'] : '';
$color    = preg_match( '/^#[0-9a-f]{6}$/i', (string) $settings['invoice.color'] ) ? $settings['invoice.color'] : '#16a34a';

// Sticker geometry per size.
$geo = array(
	'100x150' => array( 'page' => '100mm 150mm', 'w' => '100mm', 'h' => '150mm', 'font' => '12px', 'max' => 8, 'per' => 1 ),
	'75x100'  => array( 'page' => '75mm 100mm', 'w' => '75mm', 'h' => '100mm', 'font' => '9.5px', 'max' => 4, 'per' => 1 ),
	'80mm'    => array( 'page' => '80mm auto', 'w' => '76mm', 'h' => 'auto', 'font' => '11px', 'max' => 12, 'per' => 1 ),
	'a4'      => array( 'page' => 'A4', 'w' => '98mm', 'h' => '140mm', 'font' => '11.5px', 'max' => 7, 'per' => 4 ),
)[ $size ];
$pdf_name = ( count( $orders ) === 1 ? 'sticker-' . $orders[0]['number'] : 'stickers-' . gmdate( 'Y-m-d' ) . '-' . count( $orders ) ) . '.pdf';
$title = count( $orders ) === 1 ? $L( 'পার্সেল স্টিকার', 'Parcel sticker' ) . ' ' . $orders[0]['number'] : sprintf( $L( '%d টি পার্সেল স্টিকার', '%d parcel stickers' ), count( $orders ) );
?>
<!doctype html>
<html lang="<?php echo esc_attr( $lang ); ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?php echo esc_html( $title ); ?></title>
<style>
	@page { size: <?php echo esc_html( $geo['page'] ); ?>; margin: <?php echo 'a4' === $size ? '4mm' : '0'; ?>; }
	* { box-sizing: border-box; }
	html { background: #e5e7eb; }
	body { margin: 0; color: #000; font: <?php echo esc_html( $geo['font'] ); ?>/1.3 system-ui, -apple-system, "Segoe UI", "Noto Sans Bengali", "Hind Siliguri", Roboto, sans-serif; }
	.sheet { display: flex; flex-wrap: wrap; gap: 6mm; justify-content: center; padding: 16px 8px 90px; }
	.lbl { width: <?php echo esc_html( $geo['w'] ); ?>; height: <?php echo esc_html( $geo['h'] ); ?>; background: #fff; border: 1.5px solid #000; border-radius: 2mm; padding: 2.5mm 3mm; display: flex; flex-direction: column; gap: 1.6mm; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,.12); break-inside: avoid; page-break-inside: avoid; }
	.top { display: flex; align-items: center; gap: 2mm; border-bottom: 1.5px solid #000; padding-bottom: 1.6mm; }
	.top img { width: 9mm; height: 9mm; object-fit: contain; }
	.top .shop { flex: 1; min-width: 0; }
	.top .shop strong { display: block; font-size: 1.2em; line-height: 1.15; }
	.top .shop small { font-size: .85em; }
	.via { text-align: right; font-weight: 800; font-size: 1em; line-height: 1.15; }
	.via small { display: block; font-weight: 600; font-size: .78em; }
	.to { border: 1.5px solid #000; border-radius: 1.5mm; padding: 1.6mm 2mm; }
	.cap { font-size: .72em; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #333; }
	.to .name { font-size: 1.3em; font-weight: 800; line-height: 1.15; }
	.to .phone { font-size: 1.45em; font-weight: 900; letter-spacing: .02em; }
	.to .addr { font-size: 1em; line-height: 1.25; }
	.tag { display: inline-block; border: 1px solid #000; border-radius: 99px; padding: 0 2mm; font-size: .78em; font-weight: 700; margin-top: .6mm; }
	.cod { display: flex; justify-content: space-between; align-items: center; background: #000; color: #fff; border-radius: 1.5mm; padding: 1.4mm 2.5mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
	.cod span { font-weight: 700; font-size: .95em; }
	.cod strong { font-size: 1.8em; font-weight: 900; line-height: 1.05; }
	.cod.paid { background: #fff; color: #000; border: 1.5px dashed #000; }
	table { width: 100%; border-collapse: collapse; }
	td { padding: .25mm 0; vertical-align: top; }
	td.n { text-align: right; white-space: nowrap; padding-left: 2mm; }
	.items td:first-child { overflow: hidden; text-overflow: ellipsis; }
	.items { border-bottom: 1px dashed #000; }
	.sum td { font-size: .95em; }
	.sum .grand td { font-weight: 800; border-top: 1px solid #000; }
	.foot { margin-top: auto; text-align: center; }
	.foot svg { width: 100%; height: <?php echo '75x100' === $size ? '9mm' : '12mm'; ?>; }
	.foot .ids { font-size: .85em; font-weight: 700; }
	.note { font-size: .88em; border-left: 2px solid #000; padding-left: 1.5mm; }
	.more { font-size: .85em; font-style: italic; }
	.toolbar { position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; z-index: 9; }
	.toolbar button { font: 600 14px system-ui, sans-serif; padding: 10px 18px; border-radius: 999px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.12); }
	.toolbar .primary { background: <?php echo esc_html( $color ); ?>; color: #fff; border-color: <?php echo esc_html( $color ); ?>; }
	@media print {
		html { background: #fff; }
		.toolbar { display: none; }
		.sheet { padding: 0; gap: <?php echo 'a4' === $size ? '3mm' : '0'; ?>; justify-content: flex-start; }
		.lbl { box-shadow: none; border-radius: 0; <?php echo 'a4' === $size ? '' : 'border: 0; break-after: page; page-break-after: always;'; ?> }
		<?php if ( '80mm' === $size ) : ?>.lbl { border-bottom: 1.5px dashed #000; break-after: auto; page-break-after: auto; }<?php endif; ?>
		.lbl:last-child { break-after: auto; page-break-after: auto; }
	}
</style>
<script>
function ghPrint(){var n=window.GoriberHisabNative;if(n&&n.printPage){n.printPage();}else{window.print();}}
function ghClose(){if(window.GoriberHisabNative){history.back();}else{window.close();}}
</script>
</head>
<body>
<div class="toolbar">
	<button type="button" class="primary" onclick="ghPrint()"><?php echo esc_html( $L( 'প্রিন্ট', 'Print' ) ); ?></button>
	<button type="button" class="primary" id="gh-pdf" onclick="ghDownloadPdf(<?php echo esc_attr( wp_json_encode( $pdf_name ) ); ?>, this)">⬇ <?php echo esc_html( $L( 'PDF ডাউনলোড', 'Download PDF' ) ); ?></button>
	<button type="button" onclick="ghClose()"><?php echo esc_html( $L( 'বন্ধ করুন', 'Close' ) ); ?></button>
</div>
<div class="sheet">
<?php
foreach ( $orders as $o ) :
	$items   = is_array( $o['items'] ) ? $o['items'] : array();
	$shown   = array_slice( $items, 0, $geo['max'] );
	$hidden  = count( $items ) - count( $shown );
	$cod     = Decimal::of( $o['cod_amount'] );
	$own     = 'self' === $o['courier'];
	$via     = '' === (string) $o['courier'] ? '' : ( $own ? $L( 'নিজস্ব ডেলিভারি', 'Own delivery' ) : ( $couriers[ $o['courier'] ] ?? (string) $o['courier'] ) );
	$via_sub = $own ? trim( $o['rider_name'] . ( $o['rider_phone'] ? ' · ' . $digits( (string) $o['rider_phone'] ) : '' ), ' ·' ) : (string) $o['consignment_id'];
	$zone    = 'inside' === ( $o['zone'] ?? '' ) ? $L( 'শহরের ভিতরে', 'Inside city' ) : ( 'outside' === ( $o['zone'] ?? '' ) ? $L( 'শহরের বাইরে', 'Outside city' ) : '' );
	?>
	<div class="lbl">
		<div class="top">
			<?php if ( $logo_url ) : ?>
				<img src="<?php echo esc_url( $logo_url ); ?>" alt="">
			<?php endif; ?>
			<div class="shop">
				<strong><?php echo esc_html( $biz['name'] ); ?></strong>
				<small><?php echo esc_html( $digits( (string) $biz['phone'] ) ); ?></small>
			</div>
			<?php if ( $via ) : ?>
				<div class="via"><?php echo esc_html( $via ); ?><?php echo $via_sub ? '<small>' . esc_html( $via_sub ) . '</small>' : ''; ?></div>
			<?php endif; ?>
		</div>

		<div class="to">
			<div class="cap"><?php echo esc_html( $L( 'প্রাপক', 'Deliver to' ) ); ?></div>
			<div class="name"><?php echo esc_html( $o['customer_name'] ); ?></div>
			<div class="phone"><?php echo esc_html( $digits( (string) $o['phone'] ) ); ?></div>
			<div class="addr"><?php echo esc_html( trim( (string) $o['address'] . ( $o['area'] && false === stripos( (string) $o['address'], (string) $o['area'] ) ? ', ' . $o['area'] : '' ), ', ' ) ); ?></div>
			<?php if ( $zone ) : ?>
				<span class="tag"><?php echo esc_html( $zone ); ?></span>
			<?php endif; ?>
		</div>

		<div class="cod <?php echo $cod > 0 ? '' : 'paid'; ?>">
			<span><?php echo esc_html( $cod > 0 ? $L( 'ক্যাশ নিতে হবে (COD)', 'Collect cash (COD)' ) : $L( 'টাকা পরিশোধিত — কিছু নিতে হবে না', 'Paid — collect nothing' ) ); ?></span>
			<strong><?php echo esc_html( $money( $o['cod_amount'] ) ); ?></strong>
		</div>

		<table class="items">
			<?php foreach ( $shown as $it ) : ?>
				<tr>
					<td><?php echo esc_html( $it['name'] ); ?> <b>× <?php echo esc_html( $qty( $it['qty'] ) ); ?></b></td>
					<td class="n"><?php echo esc_html( $money( $it['total'] ?? Decimal::toString( Decimal::mul( Decimal::of( $it['qty'] ), Decimal::of( $it['unit_price'] ) ) ) ) ); ?></td>
				</tr>
			<?php endforeach; ?>
			<?php if ( $hidden > 0 ) : ?>
				<tr><td colspan="2" class="more"><?php echo esc_html( sprintf( $L( '+ আরও %s টি পণ্য', '+ %s more items' ), $digits( (string) $hidden ) ) ); ?></td></tr>
			<?php endif; ?>
		</table>

		<table class="sum">
			<tr><td><?php echo esc_html( $L( 'পণ্যের দাম', 'Products' ) ); ?></td><td class="n"><?php echo esc_html( $money( $o['subtotal'] ) ); ?></td></tr>
			<?php if ( Decimal::of( $o['discount'] ) > 0 ) : ?>
				<tr><td><?php echo esc_html( $L( 'ছাড়', 'Discount' ) ); ?></td><td class="n">− <?php echo esc_html( $money( $o['discount'] ) ); ?></td></tr>
			<?php endif; ?>
			<tr><td><?php echo esc_html( $L( 'ডেলিভারি চার্জ', 'Delivery charge' ) ); ?></td><td class="n"><?php echo esc_html( $money( $o['delivery_charge'] ) ); ?></td></tr>
			<tr class="grand"><td><?php echo esc_html( $L( 'মোট বিল', 'Total bill' ) ); ?></td><td class="n"><?php echo esc_html( $money( $o['total'] ) ); ?></td></tr>
			<?php if ( Decimal::of( $o['advance'] ) > 0 ) : ?>
				<tr><td><?php echo esc_html( $L( 'অগ্রিম পরিশোধ', 'Advance paid' ) ); ?></td><td class="n">− <?php echo esc_html( $money( $o['advance'] ) ); ?></td></tr>
			<?php endif; ?>
		</table>

		<?php if ( '' !== trim( (string) $o['note'] ) && '75x100' !== $size ) : ?>
			<div class="note"><?php echo esc_html( mb_substr( trim( (string) $o['note'] ), 0, 120 ) ); ?></div>
		<?php endif; ?>

		<div class="foot">
			<?php echo Barcode::svg( (string) $o['number'], 40, 1.2 ); // phpcs:ignore WordPress.Security.EscapeOutput -- generated SVG from printable ASCII. ?>
			<div class="ids"><?php echo esc_html( implode( ' · ', array_filter( array( $o['number'], $o['invoice_number'] ?? '', $date( $o['order_date'] ) ) ) ) ); ?></div>
		</div>
	</div>
<?php endforeach; ?>
</div>
<script src="<?php echo esc_url( GORIBER_HISAB_URL . 'assets/vendor/html2canvas.min.js?v=' . GORIBER_HISAB_VERSION ); ?>"></script>
<script src="<?php echo esc_url( GORIBER_HISAB_URL . 'assets/js/sticker-pdf.js?v=' . GORIBER_HISAB_VERSION ); ?>"></script>
<?php if ( ! empty( $view['download'] ) ) : ?>
<script>window.addEventListener('load',function(){setTimeout(function(){ghDownloadPdf(<?php echo wp_json_encode( $pdf_name ); ?>,document.getElementById('gh-pdf'));},400);});</script>
<?php elseif ( $view['auto'] ) : ?>
<script>window.addEventListener('load',function(){setTimeout(ghPrint,300);});</script>
<?php endif; ?>
</body>
</html>
