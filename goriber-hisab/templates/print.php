<?php
/**
 * Printable documents.
 *
 * Variables: $view = [type, doc, business, settings, paper, auto, ctx].
 * Every dynamic value is escaped at output. Override the whole template
 * with the "goriber_hisab/print_template" filter.
 *
 * @package GoriberHisab
 */

defined( 'ABSPATH' ) || exit;

use GoriberHisab\Support\Barcode;
use GoriberHisab\Support\Decimal;

$type     = $view['type'];
$doc      = $view['doc'];
$biz      = $view['business'];
$settings = $view['settings'];
$paper    = $view['paper'];
$thermal  = in_array( $paper, array( '58mm', '80mm' ), true );
$places   = (int) $biz['decimals'];
$color    = preg_match( '/^#[0-9a-f]{6}$/i', (string) $settings['invoice.color'] ) ? $settings['invoice.color'] : '#2563eb';

$money = static function ( $value ) use ( $biz, $places, $settings ): string {
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
	return ( $neg ? '-' : '' ) . $out;
};
$qty  = static fn( $v ) => rtrim( rtrim( Decimal::toString( Decimal::of( $v ), 4 ), '0' ), '.' );
$date = static fn( $d ) => $d ? wp_date( (string) $settings['general.date_format'], strtotime( (string) $d . ' 12:00:00' ) ) : '';

$titles = array(
	'sale'      => __( 'Invoice', 'goriber-hisab' ),
	'purchase'  => __( 'Purchase', 'goriber-hisab' ),
	'return'    => 'sale' === ( $doc['return_type'] ?? '' ) ? __( 'Sales Return', 'goriber-hisab' ) : __( 'Purchase Return', 'goriber-hisab' ),
	'payment'   => 'in' === ( $doc['direction'] ?? '' ) ? __( 'Money Receipt', 'goriber-hisab' ) : __( 'Payment Voucher', 'goriber-hisab' ),
	'statement' => __( 'Account Statement', 'goriber-hisab' ),
);
$party = match ( $type ) {
	'sale'      => $doc['customer'] ?? null,
	'purchase'  => $doc['supplier'] ?? null,
	'return', 'payment' => $doc['contact'] ?? null,
	'statement' => $doc['contact'] ?? null,
};
$branch   = $doc['branch'] ?? null;
$logo_url = ! empty( $biz['logo_url'] ) && $settings['invoice.show_logo'] ? $biz['logo_url'] : '';
$number   = (string) ( $doc['number'] ?? '' );
$is_void  = 'void' === ( $doc['status'] ?? '' );
?>
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?php echo esc_html( $titles[ $type ] . ( $number ? ' ' . $number : '' ) ); ?></title>
<style>
	@page { size: <?php echo esc_html( $thermal ? $paper . ' auto' : strtoupper( $paper ) ); ?>; margin: <?php echo $thermal ? '2mm' : '12mm'; ?>; }
	:root { --c: <?php echo esc_html( $color ); ?>; }
	* { box-sizing: border-box; }
	body { margin: 0; color: #111827; font: <?php echo $thermal ? '12px/1.35' : '13px/1.5'; ?> <?php echo 'serif' === $settings['invoice.font'] ? 'Georgia, serif' : ( 'mono' === $settings['invoice.font'] ? 'ui-monospace, Menlo, monospace' : 'system-ui, -apple-system, "Segoe UI", "Noto Sans Bengali", Roboto, sans-serif' ); ?>; }
	.page { max-width: <?php echo esc_html( array( 'a4' => '190mm', 'a5' => '128mm', '80mm' => '72mm', '58mm' => '48mm' )[ $paper ] ); ?>; margin: 0 auto; padding: <?php echo $thermal ? '0' : '8px'; ?>; position: relative; }
	h1 { font-size: <?php echo $thermal ? '15px' : '22px'; ?>; margin: 0; }
	.muted { color: #6b7280; }
	.head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; border-bottom: 3px solid var(--c); padding-bottom: 10px; margin-bottom: 12px; }
	.head img { max-height: 64px; max-width: 160px; }
	.doc-title { text-align: right; }
	.doc-title h2 { color: var(--c); margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: .04em; }
	.parties { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
	table { width: 100%; border-collapse: collapse; }
	th { text-align: left; background: color-mix(in srgb, var(--c) 10%, white); color: #111827; font-weight: 600; }
	th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
	.num { text-align: right; white-space: nowrap; }
	.totals { margin-left: auto; width: 46%; margin-top: 8px; }
	.totals td { border: 0; padding: 3px 8px; }
	.totals .grand td { border-top: 2px solid #111827; font-weight: 700; font-size: 15px; }
	.foot { margin-top: 24px; display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; }
	.sign { border-top: 1px solid #111827; min-width: 180px; text-align: center; padding-top: 4px; }
	.void { position: absolute; top: 35%; left: 0; right: 0; text-align: center; font-size: 72px; color: rgba(220,38,38,.18); transform: rotate(-20deg); font-weight: 800; pointer-events: none; }
	.barcode svg { max-width: 100%; height: 36px; }
	/* Thermal */
	.t-center { text-align: center; }
	.t-rule { border-top: 1px dashed #000; margin: 6px 0; }
	.t-row { display: flex; justify-content: space-between; gap: 6px; }
	.t-item { margin-bottom: 4px; }
	.t-total { font-weight: 700; font-size: 14px; }
	.toolbar { position: fixed; bottom: 12px; right: 12px; display: flex; gap: 6px; }
	.toolbar button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; cursor: pointer; }
	.toolbar .primary { background: var(--c); color: #fff; border-color: var(--c); }
	/* Templates */
	body.tpl-modern .head { background: var(--c); color: #fff; border: 0; padding: 16px; border-radius: 10px; }
	body.tpl-modern .head .muted, body.tpl-modern .doc-title h2 { color: #fff; }
	body.tpl-modern .head .barcode svg g { fill: #fff; }
	body.tpl-modern th { background: var(--c); color: #fff; }
	body.tpl-compact { font-size: 11px; }
	body.tpl-compact th, body.tpl-compact td { padding: 3px 6px; }
	body.tpl-compact .head { padding-bottom: 4px; margin-bottom: 6px; }
	body.tpl-compact .head img { max-height: 40px; }
	@media print { .toolbar { display: none; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
<script>
function ghPrint(){var n=window.GoriberHisabNative;if(n&&n.printPage){n.printPage();}else{window.print();}}
function ghClose(){if(window.GoriberHisabNative){history.back();}else{window.close();}}
</script>
</head>
<body class="tpl-<?php echo esc_attr( sanitize_key( (string) $settings['invoice.template'] ) ); ?>">
<div class="toolbar">
	<button type="button" class="primary" onclick="ghPrint()"><?php esc_html_e( 'Print', 'goriber-hisab' ); ?></button>
	<button type="button" onclick="ghClose()"><?php esc_html_e( 'Close', 'goriber-hisab' ); ?></button>
</div>
<div class="page">
<?php if ( $is_void ) : ?>
	<div class="void"><?php esc_html_e( 'VOID', 'goriber-hisab' ); ?></div>
<?php endif; ?>

<?php if ( $thermal && in_array( $type, array( 'sale', 'return', 'payment', 'purchase' ), true ) ) : ?>
	<div class="t-center">
		<?php if ( $logo_url ) : ?>
			<img src="<?php echo esc_url( $logo_url ); ?>" alt="" style="max-height:48px;max-width:70%;filter:grayscale(1)"><br>
		<?php endif; ?>
		<strong style="font-size:15px"><?php echo esc_html( $biz['name'] ); ?></strong><br>
		<?php if ( $branch && $branch['address'] ) : ?>
			<?php echo esc_html( $branch['address'] ); ?><br>
		<?php elseif ( $biz['address'] ) : ?>
			<?php echo esc_html( $biz['address'] ); ?><br>
		<?php endif; ?>
		<?php echo esc_html( $biz['phone'] ); ?>
		<?php if ( $biz['tax_number'] ) : ?>
			<br><?php echo esc_html( $settings['tax.label'] . ': ' . $biz['tax_number'] ); ?>
		<?php endif; ?>
	</div>
	<div class="t-rule"></div>
	<div class="t-center"><strong><?php echo esc_html( $titles[ $type ] ); ?></strong></div>
	<div class="t-row"><span><?php echo esc_html( $number ); ?></span><span><?php echo esc_html( $date( $doc['sale_date'] ?? $doc['purchase_date'] ?? $doc['return_date'] ?? $doc['payment_date'] ?? '' ) ); ?></span></div>
	<?php if ( $party ) : ?>
		<div><?php echo esc_html( $party['name'] ); ?><?php echo ! empty( $party['phone'] ) ? ' · ' . esc_html( $party['phone'] ) : ''; ?></div>
	<?php endif; ?>
	<div class="t-rule"></div>

	<?php if ( 'payment' === $type ) : ?>
		<div class="t-row t-total"><span><?php esc_html_e( 'Amount', 'goriber-hisab' ); ?></span><span><?php echo esc_html( $money( $doc['amount'] ) ); ?></span></div>
		<div class="t-row"><span><?php esc_html_e( 'Method', 'goriber-hisab' ); ?></span><span><?php echo esc_html( $doc['account']['name'] ?? '' ); ?></span></div>
		<?php foreach ( $doc['allocations'] as $a ) : ?>
			<div class="t-row"><span><?php echo esc_html( (string) $a['number'] ); ?></span><span><?php echo esc_html( $money( $a['amount'] ) ); ?></span></div>
		<?php endforeach; ?>
	<?php else : ?>
		<?php foreach ( $doc['items'] as $item ) : ?>
			<div class="t-item">
				<div><?php echo esc_html( $item['name'] ); ?></div>
				<div class="t-row"><span><?php echo esc_html( $qty( $item['qty'] ) . ' × ' . $money( $item['unit_price'] ) ); ?></span><span><?php echo esc_html( $money( $item['total'] ) ); ?></span></div>
			</div>
		<?php endforeach; ?>
		<div class="t-rule"></div>
		<?php if ( isset( $doc['subtotal'] ) ) : ?>
			<div class="t-row"><span><?php esc_html_e( 'Subtotal', 'goriber-hisab' ); ?></span><span><?php echo esc_html( $money( $doc['subtotal'] ) ); ?></span></div>
		<?php endif; ?>
		<?php if ( Decimal::of( $doc['discount_amount'] ?? 0 ) ) : ?>
			<div class="t-row"><span><?php esc_html_e( 'Discount', 'goriber-hisab' ); ?></span><span>-<?php echo esc_html( $money( $doc['discount_amount'] ) ); ?></span></div>
		<?php endif; ?>
		<?php if ( Decimal::of( $doc['tax_amount'] ?? 0 ) ) : ?>
			<div class="t-row"><span><?php echo esc_html( $settings['tax.label'] ); ?></span><span><?php echo esc_html( $money( $doc['tax_amount'] ) ); ?></span></div>
		<?php endif; ?>
		<?php if ( Decimal::of( $doc['shipping_amount'] ?? 0 ) ) : ?>
			<div class="t-row"><span><?php esc_html_e( 'Shipping', 'goriber-hisab' ); ?></span><span><?php echo esc_html( $money( $doc['shipping_amount'] ) ); ?></span></div>
		<?php endif; ?>
		<div class="t-row t-total"><span><?php esc_html_e( 'TOTAL', 'goriber-hisab' ); ?></span><span><?php echo esc_html( $money( $doc['total'] ) ); ?></span></div>
		<?php if ( 'sale' === $type ) : ?>
			<?php foreach ( $doc['payments'] as $p ) : ?>
				<div class="t-row"><span><?php echo esc_html( $p['account_name'] ); ?></span><span><?php echo esc_html( $money( $p['amount'] ) ); ?></span></div>
			<?php endforeach; ?>
			<?php if ( ! empty( $doc['meta']['tendered'] ) && Decimal::of( $doc['meta']['tendered'] ) > Decimal::of( $doc['paid_amount'] ) ) : ?>
				<div class="t-row"><span><?php esc_html_e( 'Cash given', 'goriber-hisab' ); ?></span><span><?php echo esc_html( $money( $doc['meta']['tendered'] ) ); ?></span></div>
				<div class="t-row"><span><?php esc_html_e( 'Change', 'goriber-hisab' ); ?></span><span><?php echo esc_html( $money( Decimal::toString( Decimal::of( $doc['meta']['tendered'] ) - Decimal::of( $doc['paid_amount'] ) ) ) ); ?></span></div>
			<?php endif; ?>
			<?php if ( Decimal::of( $doc['due_amount'] ) > 0 ) : ?>
				<div class="t-row t-total"><span><?php esc_html_e( 'DUE', 'goriber-hisab' ); ?></span><span><?php echo esc_html( $money( $doc['due_amount'] ) ); ?></span></div>
			<?php endif; ?>
		<?php endif; ?>
	<?php endif; ?>
	<div class="t-rule"></div>
	<div class="t-center barcode"><?php echo Barcode::svg( $number, 36, 1 ); // phpcs:ignore WordPress.Security.EscapeOutput -- generated SVG, input filtered to printable ASCII and escaped. ?></div>
	<?php if ( $settings['invoice.footer'] ) : ?>
		<div class="t-center"><?php echo nl2br( esc_html( $settings['invoice.footer'] ) ); ?></div>
	<?php endif; ?>

<?php else : ?>
	<div class="head">
		<div>
			<?php if ( $logo_url ) : ?>
				<img src="<?php echo esc_url( $logo_url ); ?>" alt="<?php echo esc_attr( $biz['name'] ); ?>"><br>
			<?php endif; ?>
			<h1><?php echo esc_html( $biz['name'] ); ?></h1>
			<div class="muted">
				<?php echo nl2br( esc_html( $branch && $branch['address'] ? $branch['address'] : (string) $biz['address'] ) ); ?><br>
				<?php echo esc_html( trim( $biz['phone'] . '  ' . $biz['email'] ) ); ?>
				<?php if ( $biz['website'] ) : ?>
					<br><?php echo esc_html( $biz['website'] ); ?>
				<?php endif; ?>
				<?php if ( $biz['tax_number'] ) : ?>
					<br><?php echo esc_html( $settings['tax.label'] . ': ' . $biz['tax_number'] ); ?>
				<?php endif; ?>
			</div>
		</div>
		<div class="doc-title">
			<h2><?php echo esc_html( $titles[ $type ] ); ?></h2>
			<?php if ( $number ) : ?>
				<div><strong>#<?php echo esc_html( $number ); ?></strong></div>
			<?php endif; ?>
			<div><?php echo esc_html( $date( $doc['sale_date'] ?? $doc['purchase_date'] ?? $doc['return_date'] ?? $doc['payment_date'] ?? $doc['to'] ?? '' ) ); ?></div>
			<?php if ( ! empty( $doc['due_date'] ) ) : ?>
				<div class="muted"><?php esc_html_e( 'Due', 'goriber-hisab' ); ?>: <?php echo esc_html( $date( $doc['due_date'] ) ); ?></div>
			<?php endif; ?>
			<?php if ( 'purchase' === $type && ! empty( $doc['supplier_invoice'] ) ) : ?>
				<div class="muted"><?php esc_html_e( 'Supplier invoice', 'goriber-hisab' ); ?>: <?php echo esc_html( $doc['supplier_invoice'] ); ?></div>
			<?php endif; ?>
			<?php if ( 'return' === $type && ! empty( $doc['document'] ) ) : ?>
				<div class="muted"><?php esc_html_e( 'Against', 'goriber-hisab' ); ?>: <?php echo esc_html( $doc['document']['number'] ); ?></div>
			<?php endif; ?>
			<?php if ( $number ) : ?>
				<div class="barcode"><?php echo Barcode::svg( $number ); // phpcs:ignore WordPress.Security.EscapeOutput ?></div>
			<?php endif; ?>
		</div>
	</div>

	<div class="parties">
		<div>
			<div class="muted"><?php echo esc_html( 'purchase' === $type ? __( 'Supplier', 'goriber-hisab' ) : __( 'Bill to', 'goriber-hisab' ) ); ?></div>
			<?php if ( $party ) : ?>
				<strong><?php echo esc_html( $party['name'] ); ?></strong><br>
				<?php echo ! empty( $party['company'] ) ? esc_html( $party['company'] ) . '<br>' : ''; ?>
				<?php echo ! empty( $party['address'] ) ? nl2br( esc_html( $party['address'] ) ) . '<br>' : ''; ?>
				<?php echo esc_html( $party['phone'] ?? '' ); ?>
			<?php else : ?>
				<strong><?php esc_html_e( 'Walk-in customer', 'goriber-hisab' ); ?></strong>
			<?php endif; ?>
		</div>
		<?php if ( isset( $doc['payment_status'] ) && ! $is_void ) : ?>
			<div style="text-align:right">
				<div class="muted"><?php esc_html_e( 'Status', 'goriber-hisab' ); ?></div>
				<strong style="text-transform:uppercase;color:var(--c)"><?php echo esc_html( $doc['payment_status'] ); ?></strong>
			</div>
		<?php endif; ?>
	</div>

	<?php if ( 'statement' === $type ) : ?>
		<p class="muted"><?php echo esc_html( sprintf( /* translators: 1: from, 2: to */ __( 'Period: %1$s – %2$s', 'goriber-hisab' ), $doc['from'] ? $date( $doc['from'] ) : __( 'Beginning', 'goriber-hisab' ), $date( $doc['to'] ) ) ); ?></p>
		<table>
			<thead><tr><th><?php esc_html_e( 'Date', 'goriber-hisab' ); ?></th><th><?php esc_html_e( 'Reference', 'goriber-hisab' ); ?></th><th><?php esc_html_e( 'Description', 'goriber-hisab' ); ?></th><th class="num"><?php esc_html_e( 'Debit', 'goriber-hisab' ); ?></th><th class="num"><?php esc_html_e( 'Credit', 'goriber-hisab' ); ?></th><th class="num"><?php esc_html_e( 'Balance', 'goriber-hisab' ); ?></th></tr></thead>
			<tbody>
				<tr><td colspan="5"><em><?php esc_html_e( 'Opening balance', 'goriber-hisab' ); ?></em></td><td class="num"><?php echo esc_html( $money( $doc['opening_balance'] ) ); ?></td></tr>
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
		<table class="totals">
			<tr class="grand"><td><?php esc_html_e( 'Closing balance', 'goriber-hisab' ); ?></td><td class="num"><?php echo esc_html( $money( $doc['closing_balance'] ) ); ?></td></tr>
		</table>
	<?php elseif ( 'payment' === $type ) : ?>
		<table>
			<tr><th><?php esc_html_e( 'Amount', 'goriber-hisab' ); ?></th><td class="num"><strong><?php echo esc_html( $money( $doc['amount'] ) ); ?></strong></td></tr>
			<tr><th><?php esc_html_e( 'Payment method', 'goriber-hisab' ); ?></th><td class="num"><?php echo esc_html( $doc['account']['name'] ?? '' ); ?></td></tr>
			<?php if ( $doc['reference'] ) : ?>
				<tr><th><?php esc_html_e( 'Reference', 'goriber-hisab' ); ?></th><td class="num"><?php echo esc_html( $doc['reference'] ); ?></td></tr>
			<?php endif; ?>
			<?php foreach ( $doc['allocations'] as $a ) : ?>
				<tr><th><?php echo esc_html( sprintf( /* translators: %s: invoice number */ __( 'Applied to %s', 'goriber-hisab' ), (string) $a['number'] ) ); ?></th><td class="num"><?php echo esc_html( $money( $a['amount'] ) ); ?></td></tr>
			<?php endforeach; ?>
		</table>
		<?php if ( $doc['note'] ) : ?>
			<p><?php echo nl2br( esc_html( $doc['note'] ) ); ?></p>
		<?php endif; ?>
	<?php else : ?>
		<table>
			<thead>
				<tr>
					<th>#</th>
					<th><?php esc_html_e( 'Item', 'goriber-hisab' ); ?></th>
					<th class="num"><?php esc_html_e( 'Qty', 'goriber-hisab' ); ?></th>
					<th class="num"><?php esc_html_e( 'Unit price', 'goriber-hisab' ); ?></th>
					<?php if ( 'return' !== $type ) : ?>
						<th class="num"><?php esc_html_e( 'Discount', 'goriber-hisab' ); ?></th>
					<?php endif; ?>
					<th class="num"><?php echo esc_html( $settings['tax.label'] ); ?></th>
					<th class="num"><?php esc_html_e( 'Amount', 'goriber-hisab' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( $doc['items'] as $i => $item ) : ?>
					<tr>
						<td><?php echo (int) $i + 1; ?></td>
						<td><?php echo esc_html( $item['name'] ); ?><?php echo ! empty( $item['sku'] ) ? '<br><small class="muted">' . esc_html( $item['sku'] ) . '</small>' : ''; ?></td>
						<td class="num"><?php echo esc_html( $qty( $item['qty'] ) ); ?></td>
						<td class="num"><?php echo esc_html( $money( $item['unit_price'] ) ); ?></td>
						<?php if ( 'return' !== $type ) : ?>
							<td class="num"><?php echo Decimal::of( $item['discount_amount'] ) ? esc_html( $money( $item['discount_amount'] ) ) : '—'; ?></td>
						<?php endif; ?>
						<td class="num"><?php echo Decimal::of( $item['tax_amount'] ) ? esc_html( $money( $item['tax_amount'] ) ) : '—'; ?></td>
						<td class="num"><?php echo esc_html( $money( $item['total'] ) ); ?></td>
					</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
		<table class="totals">
			<?php if ( isset( $doc['subtotal'] ) ) : ?>
				<tr><td><?php esc_html_e( 'Subtotal', 'goriber-hisab' ); ?></td><td class="num"><?php echo esc_html( $money( $doc['subtotal'] ) ); ?></td></tr>
			<?php endif; ?>
			<?php if ( Decimal::of( $doc['discount_amount'] ?? 0 ) ) : ?>
				<tr><td><?php esc_html_e( 'Discount', 'goriber-hisab' ); ?></td><td class="num">-<?php echo esc_html( $money( $doc['discount_amount'] ) ); ?></td></tr>
			<?php endif; ?>
			<?php if ( Decimal::of( $doc['tax_amount'] ?? 0 ) ) : ?>
				<tr><td><?php echo esc_html( $settings['tax.label'] ); ?></td><td class="num"><?php echo esc_html( $money( $doc['tax_amount'] ) ); ?></td></tr>
			<?php endif; ?>
			<?php if ( Decimal::of( $doc['shipping_amount'] ?? 0 ) ) : ?>
				<tr><td><?php esc_html_e( 'Shipping', 'goriber-hisab' ); ?></td><td class="num"><?php echo esc_html( $money( $doc['shipping_amount'] ) ); ?></td></tr>
			<?php endif; ?>
			<?php if ( Decimal::of( $doc['other_cost'] ?? 0 ) ) : ?>
				<tr><td><?php esc_html_e( 'Other costs', 'goriber-hisab' ); ?></td><td class="num"><?php echo esc_html( $money( $doc['other_cost'] ) ); ?></td></tr>
			<?php endif; ?>
			<tr class="grand"><td><?php esc_html_e( 'Total', 'goriber-hisab' ); ?></td><td class="num"><?php echo esc_html( $money( $doc['total'] ) ); ?></td></tr>
			<?php if ( isset( $doc['paid_amount'] ) ) : ?>
				<tr><td><?php esc_html_e( 'Paid', 'goriber-hisab' ); ?></td><td class="num"><?php echo esc_html( $money( $doc['paid_amount'] ) ); ?></td></tr>
				<?php if ( Decimal::of( $doc['return_amount'] ?? 0 ) ) : ?>
					<tr><td><?php esc_html_e( 'Returned', 'goriber-hisab' ); ?></td><td class="num"><?php echo esc_html( $money( $doc['return_amount'] ) ); ?></td></tr>
				<?php endif; ?>
				<?php if ( $settings['invoice.show_due'] ) : ?>
					<tr><td><strong><?php esc_html_e( 'Due', 'goriber-hisab' ); ?></strong></td><td class="num"><strong><?php echo esc_html( $money( $doc['due_amount'] ) ); ?></strong></td></tr>
				<?php endif; ?>
			<?php endif; ?>
			<?php if ( 'return' === $type && Decimal::of( $doc['refund_amount'] ) ) : ?>
				<tr><td><?php esc_html_e( 'Refunded', 'goriber-hisab' ); ?></td><td class="num"><?php echo esc_html( $money( $doc['refund_amount'] ) ); ?></td></tr>
			<?php endif; ?>
		</table>
		<?php if ( ! empty( $doc['payments'] ) ) : ?>
			<p class="muted"><?php esc_html_e( 'Payments', 'goriber-hisab' ); ?>:
				<?php echo esc_html( implode( ', ', array_map( static fn( $p ) => $p['account_name'] . ' ' . $money( $p['amount'] ) . ( $p['reference'] ? ' (' . $p['reference'] . ')' : '' ), $doc['payments'] ) ) ); ?>
			</p>
		<?php endif; ?>
		<?php if ( ! empty( $doc['notes'] ) || ! empty( $doc['reason'] ) ) : ?>
			<p><strong><?php esc_html_e( 'Notes', 'goriber-hisab' ); ?>:</strong> <?php echo nl2br( esc_html( (string) ( $doc['notes'] ?? $doc['reason'] ) ) ); ?></p>
		<?php endif; ?>
	<?php endif; ?>

	<div class="foot">
		<div>
			<?php if ( 'sale' === $type && $settings['invoice.terms'] ) : ?>
				<strong><?php esc_html_e( 'Terms & Conditions', 'goriber-hisab' ); ?></strong>
				<div class="muted"><?php echo nl2br( esc_html( $settings['invoice.terms'] ) ); ?></div>
			<?php endif; ?>
			<?php if ( $settings['invoice.footer'] ) : ?>
				<p><?php echo nl2br( esc_html( $settings['invoice.footer'] ) ); ?></p>
			<?php endif; ?>
		</div>
		<?php if ( $settings['invoice.show_signature'] ) : ?>
			<div class="sign"><?php echo esc_html( $settings['invoice.signature_label'] ); ?></div>
		<?php endif; ?>
	</div>
<?php endif; ?>
</div>
<?php if ( $view['auto'] ) : ?>
<script>window.addEventListener('load',function(){setTimeout(ghPrint,250);});</script>
<?php endif; ?>
</body>
</html>
