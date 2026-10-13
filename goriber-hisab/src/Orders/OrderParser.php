<?php
/**
 * Reads a pasted customer message (Facebook / WhatsApp) into order fields.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Orders;

/**
 * Rule-based, offline and free. Handles labelled messages
 * ("নাম: …", "Phone: …", "Address - …") as well as free text such as
 * "Rahim, 01712345678, House 5 Road 2 Mirpur, 2 kg badam".
 *
 * Products are matched against the shop's own catalogue (English or Bangla
 * names, SKU), with a quantity and unit read from around the match.
 */
final class OrderParser {

	private const BN_DIGITS = array( '০' => '0', '১' => '1', '২' => '2', '৩' => '3', '৪' => '4', '৫' => '5', '৬' => '6', '৭' => '7', '৮' => '8', '৯' => '9' );

	private const LABELS = array(
		'name'    => 'name|customer|customer name|নাম|গ্রাহক|কাস্টমার|কাস্টমারের নাম|গ্রাহকের নাম',
		'phone'   => 'phone|mobile|mob|cell|contact|number|ph|whatsapp|ফোন|মোবাইল|নম্বর|নাম্বার|ফোন নম্বর|মোবাইল নম্বর|যোগাযোগ',
		'address' => 'address|addr|full address|delivery address|ঠিকানা|এড্রেস|অ্যাড্রেস|ডেলিভারি ঠিকানা|পূর্ণ ঠিকানা',
		'area'    => 'area|district|city|thana|upazila|zilla|zila|জেলা|থানা|উপজেলা|এলাকা|শহর',
		'product' => 'product|products|item|items|order|পণ্য|প্রোডাক্ট|অর্ডার|আইটেম|মাল',
		'qty'     => 'qty|quantity|pcs|পরিমাণ|পিস',
		'note'    => 'note|notes|comment|নোট|মন্তব্য|বিশেষ',
	);

	/** Dhaka city areas that couriers charge as "inside Dhaka". */
	private const DHAKA_AREAS = array( 'dhaka', 'ঢাকা', 'mirpur', 'মিরপুর', 'uttara', 'উত্তরা', 'dhanmondi', 'ধানমন্ডি', 'gulshan', 'গুলশান', 'banani', 'বনানী', 'mohammadpur', 'মোহাম্মদপুর', 'badda', 'বাড্ডা', 'rampura', 'রামপুরা', 'motijheel', 'মতিঝিল', 'jatrabari', 'যাত্রাবাড়ী', 'bashundhara', 'বসুন্ধরা', 'khilgaon', 'খিলগাঁও', 'farmgate', 'ফার্মগেট', 'tejgaon', 'তেজগাঁও', 'lalbagh', 'লালবাগ', 'shyamoli', 'শ্যামলী', 'malibagh', 'মালিবাগ', 'mohakhali', 'মহাখালী', 'wari', 'ওয়ারী', 'paltan', 'পল্টন', 'shantinagar', 'শান্তিনগর', 'azimpur', 'আজিমপুর', 'kafrul', 'কাফরুল', 'cantonment', 'ক্যান্টনমেন্ট', 'pallabi', 'পল্লবী', 'demra', 'ডেমরা', 'khilkhet', 'খিলক্ষেত', 'banasree', 'বনশ্রী', 'aftabnagar', 'আফতাবনগর', 'mugda', 'মুগদা', 'sabujbagh', 'সবুজবাগ', 'kamrangirchar', 'কামরাঙ্গীরচর', 'hazaribagh', 'হাজারীবাগ', 'adabor', 'আদাবর', 'agargaon', 'আগারগাঁও', 'baridhara', 'বারিধারা', 'niketan', 'নিকেতন' );

	private const DISTRICTS = array(
		'Bagerhat' => 'বাগেরহাট', 'Bandarban' => 'বান্দরবান', 'Barguna' => 'বরগুনা', 'Barishal' => 'বরিশাল', 'Barisal' => 'বরিশাল', 'Bhola' => 'ভোলা', 'Bogura' => 'বগুড়া', 'Bogra' => 'বগুড়া', 'Brahmanbaria' => 'ব্রাহ্মণবাড়িয়া', 'Chandpur' => 'চাঁদপুর', 'Chapainawabganj' => 'চাঁপাইনবাবগঞ্জ', 'Chattogram' => 'চট্টগ্রাম', 'Chittagong' => 'চট্টগ্রাম', 'Chuadanga' => 'চুয়াডাঙ্গা', "Cox's Bazar" => 'কক্সবাজার', 'Coxs Bazar' => 'কক্সবাজার', 'Cumilla' => 'কুমিল্লা', 'Comilla' => 'কুমিল্লা', 'Dinajpur' => 'দিনাজপুর', 'Faridpur' => 'ফরিদপুর', 'Feni' => 'ফেনী', 'Gaibandha' => 'গাইবান্ধা', 'Gazipur' => 'গাজীপুর', 'Gopalganj' => 'গোপালগঞ্জ', 'Habiganj' => 'হবিগঞ্জ', 'Jamalpur' => 'জামালপুর', 'Jashore' => 'যশোর', 'Jessore' => 'যশোর', 'Jhalokati' => 'ঝালকাঠি', 'Jhenaidah' => 'ঝিনাইদহ', 'Joypurhat' => 'জয়পুরহাট', 'Khagrachhari' => 'খাগড়াছড়ি', 'Khulna' => 'খুলনা', 'Kishoreganj' => 'কিশোরগঞ্জ', 'Kurigram' => 'কুড়িগ্রাম', 'Kushtia' => 'কুষ্টিয়া', 'Lakshmipur' => 'লক্ষ্মীপুর', 'Lalmonirhat' => 'লালমনিরহাট', 'Madaripur' => 'মাদারীপুর', 'Magura' => 'মাগুরা', 'Manikganj' => 'মানিকগঞ্জ', 'Meherpur' => 'মেহেরপুর', 'Moulvibazar' => 'মৌলভীবাজার', 'Munshiganj' => 'মুন্সীগঞ্জ', 'Mymensingh' => 'ময়মনসিংহ', 'Naogaon' => 'নওগাঁ', 'Narail' => 'নড়াইল', 'Narayanganj' => 'নারায়ণগঞ্জ', 'Narsingdi' => 'নরসিংদী', 'Natore' => 'নাটোর', 'Netrokona' => 'নেত্রকোণা', 'Nilphamari' => 'নীলফামারী', 'Noakhali' => 'নোয়াখালী', 'Pabna' => 'পাবনা', 'Panchagarh' => 'পঞ্চগড়', 'Patuakhali' => 'পটুয়াখালী', 'Pirojpur' => 'পিরোজপুর', 'Rajbari' => 'রাজবাড়ী', 'Rajshahi' => 'রাজশাহী', 'Rangamati' => 'রাঙ্গামাটি', 'Rangpur' => 'রংপুর', 'Satkhira' => 'সাতক্ষীরা', 'Shariatpur' => 'শরীয়তপুর', 'Sherpur' => 'শেরপুর', 'Sirajganj' => 'সিরাজগঞ্জ', 'Sunamganj' => 'সুনামগঞ্জ', 'Sylhet' => 'সিলেট', 'Tangail' => 'টাঙ্গাইল', 'Thakurgaon' => 'ঠাকুরগাঁও', 'Savar' => 'সাভার',
	);

	private const ADDRESS_HINTS = '/\b(house|road|rd|block|sector|lane|village|vill|post|po|ps|thana|upazila|district|bazar|bazaar|para|flat|floor|holding|avenue|street|near|opposite)\b|বাসা|বাড়ি|রোড|সেক্টর|ব্লক|গ্রাম|পোস্ট|থানা|উপজেলা|জেলা|বাজার|পাড়া|ফ্ল্যাট|তলা|মোড়|লেন|সড়ক|কাছে|পাশে/iu';

	/**
	 * @param array<int,array{id:int,name:string,sku:string,price:string,decimal:bool,unit:string}> $catalogue Shop products.
	 * @return array<string,mixed> customer_name, phone, address, area, zone (inside|outside|''), items[{product_id,name,qty,unit_price}], note.
	 */
	public static function parse( string $text, array $catalogue ): array {
		$raw   = strtr( str_replace( array( "\r\n", "\r" ), "\n", $text ), self::BN_DIGITS );
		$out   = array(
			'customer_name' => '',
			'phone'         => '',
			'address'       => '',
			'area'          => '',
			'zone'          => '',
			'items'         => array(),
			'note'          => '',
		);
		$lines = array_values( array_filter( array_map( 'trim', explode( "\n", $raw ) ), static fn( $l ) => '' !== $l ) );

		// 1. Labelled lines.
		$rest = array();
		foreach ( $lines as $line ) {
			$matched = false;
			foreach ( self::LABELS as $field => $labels ) {
				if ( preg_match( '/^\s*[\-*•►✓✅➤]*\s*(?:' . $labels . ')\s*(?:[:：=\-–—]|\s{2,}|\.)\s*(.+)$/iu', $line, $m ) ) {
					$value = trim( $m[1] );
					if ( 'phone' === $field ) {
						$out['phone'] = self::phone( $value ) ?: $out['phone'];
					} elseif ( 'name' === $field && '' === $out['customer_name'] ) {
						$out['customer_name'] = self::clean( $value );
					} elseif ( 'address' === $field ) {
						$out['address'] = trim( $out['address'] . ' ' . $value );
					} elseif ( 'area' === $field ) {
						$out['area'] = self::clean( $value );
					} elseif ( 'note' === $field ) {
						$out['note'] = trim( $out['note'] . ' ' . $value );
					} else {
						$rest[] = $value; // Product / qty lines are matched below.
					}
					$matched = true;
					break;
				}
			}
			if ( ! $matched ) {
				$rest[] = $line;
			}
		}

		// 2. Phone anywhere.
		if ( '' === $out['phone'] ) {
			$out['phone'] = self::phone( $raw );
		}

		// 3. Products from the whole message.
		$out['items'] = self::products( $raw, $catalogue );

		// 4. Free text: split the remaining lines into segments.
		$segments = array();
		foreach ( $rest as $line ) {
			foreach ( preg_split( '/\s*[,;।|]\s*/u', $line ) as $seg ) {
				$seg = trim( preg_replace( '/(?:\+?88)?0?1[3-9]\d{2}[\s\-]?\d{3}[\s\-]?\d{3}/', '', $seg ) );
				$seg = trim( $seg, " \t-–—:." );
				if ( '' !== $seg && ! self::mentionsProduct( $seg, $out['items'], $catalogue ) ) {
					$segments[] = $seg;
				}
			}
		}
		foreach ( $segments as $i => $seg ) {
			if ( '' === $out['customer_name'] && self::looksLikeName( $seg ) ) {
				$out['customer_name'] = self::clean( $seg );
				unset( $segments[ $i ] );
				break;
			}
		}
		if ( '' === $out['address'] ) {
			$addr = array_filter( $segments, static fn( $s ) => (bool) preg_match( self::ADDRESS_HINTS, $s ) || self::findArea( $s ) || mb_strlen( $s ) > 18 );
			$out['address'] = implode( ', ', $addr );
		}

		// 5. Area / inside or outside Dhaka.
		$where = '' !== $out['area'] ? $out['area'] . ' ' . $out['address'] : $out['address'];
		$found = self::findArea( '' !== $where ? $where : $raw );
		if ( $found ) {
			$out['zone'] = $found[1] ? 'inside' : 'outside';
			if ( '' === $out['area'] ) {
				$out['area'] = $found[0];
			}
		}
		return $out;
	}

	/**
	 * First Bangladeshi mobile number as 01XXXXXXXXX.
	 */
	public static function phone( string $text ): string {
		$text = strtr( $text, self::BN_DIGITS );
		if ( preg_match( '/(?:\+?88)?\s*(01[3-9]\d{2})[\s\-]?(\d{3})[\s\-]?(\d{3})/', $text, $m ) ) {
			return $m[1] . $m[2] . $m[3];
		}
		return '';
	}

	/**
	 * @return array{0:string,1:bool}|null [area name, inside Dhaka].
	 */
	private static function findArea( string $text ): ?array {
		$lower = mb_strtolower( $text );
		// Outside districts first: "Savar, Dhaka" is a sub-district of Dhaka district but charged as outside by most couriers.
		foreach ( self::DISTRICTS as $en => $bn ) {
			if ( preg_match( '/(?<![\p{L}])' . preg_quote( mb_strtolower( $en ), '/' ) . '(?![\p{L}])/u', $lower ) || str_contains( $text, $bn ) ) {
				return array( $en, false );
			}
		}
		foreach ( self::DHAKA_AREAS as $a ) {
			if ( preg_match( '/(?<![\p{L}])' . preg_quote( $a, '/' ) . '/u', $lower ) ) {
				return array( preg_match( '/\p{Bengali}/u', $a ) ? 'ঢাকা' : 'Dhaka', true );
			}
		}
		return null;
	}

	/**
	 * @param array<int,array<string,mixed>> $catalogue Products.
	 * @return array<int,array{product_id:int,name:string,qty:string,unit_price:string}>
	 */
	private static function products( string $text, array $catalogue ): array {
		$lower = mb_strtolower( $text );
		$items = array();
		// Longer names first so "Badam (loose)" wins over "Badam".
		usort( $catalogue, static fn( $a, $b ) => mb_strlen( $b['name'] ) <=> mb_strlen( $a['name'] ) );
		$taken = array();
		foreach ( $catalogue as $p ) {
			foreach ( self::aliases( $p ) as $alias ) {
				if ( mb_strlen( $alias ) < 3 ) {
					continue;
				}
				$pos = mb_strpos( $lower, $alias );
				if ( false === $pos ) {
					continue;
				}
				$overlap = false;
				foreach ( $taken as $span ) {
					if ( $pos < $span[1] && $pos + mb_strlen( $alias ) > $span[0] ) {
						$overlap = true;
					}
				}
				if ( $overlap ) {
					continue;
				}
				$taken[] = array( $pos, $pos + mb_strlen( $alias ) );
				$items[] = array(
					'product_id' => (int) $p['id'],
					'name'       => (string) $p['name'],
					'qty'        => self::quantity( $lower, $pos, mb_strlen( $alias ), (bool) $p['decimal'], (string) $p['unit'] ),
					'unit_price' => (string) $p['price'],
				);
				break;
			}
		}
		return $items;
	}

	/**
	 * Names a customer might type for a product.
	 *
	 * @param array<string,mixed> $p Product.
	 * @return array<int,string>
	 */
	private static function aliases( array $p ): array {
		$name = mb_strtolower( trim( (string) $p['name'] ) );
		$out  = array( $name );
		// "Peanuts / Badam (loose)" → "peanuts", "badam".
		$plain = trim( (string) preg_replace( '/\([^)]*\)/u', '', $name ) );
		foreach ( preg_split( '/\s*[\/|]\s*/u', $plain ) as $part ) {
			$out[] = trim( $part );
			// "Mineral Water 500ml" → "mineral water" (customers rarely type the size).
			$out[] = trim( (string) preg_replace( '/\s*\d+(?:\.\d+)?\s*(?:ml|l|ltr|g|gm|kg|pcs|pc|গ্রাম|কেজি|মিলি|লিটার)?\b\s*$/iu', '', $part ) );
		}
		if ( '' !== (string) ( $p['sku'] ?? '' ) ) {
			$out[] = mb_strtolower( (string) $p['sku'] );
		}
		return array_values( array_unique( array_filter( $out ) ) );
	}

	/**
	 * Quantity written next to a product mention, in the product's own unit.
	 */
	private static function quantity( string $text, int $pos, int $len, bool $decimal, string $unit ): string {
		// Only look within the same line / list entry.
		$before = mb_substr( $text, max( 0, $pos - 24 ), min( 24, $pos ) );
		$cut    = max( (int) mb_strrpos( "\n" . $before, "\n" ), (int) mb_strrpos( "\n" . $before, ',' ), (int) mb_strrpos( "\n" . $before, ';' ) );
		$before = mb_substr( $before, max( 0, $cut - 1 ) );
		$after  = (string) preg_split( '/[\n,;]/u', mb_substr( $text, $pos + $len, 24 ) )[0];
		$num    = '(\d+(?:\.\d+)?)\s*(kg|kilo|কেজি|g|gm|gram|grams|গ্রাম|ltr|liter|litre|লিটার|l|ml|pcs|pc|piece|pieces|টা|টি|পিস|x|×)?';
		$qty    = null;
		$u      = '';
		if ( preg_match( '/^\s*[\-:=x×]?\s*' . $num . '/u', $after, $m ) ) {
			$qty = (float) $m[1];
			$u   = $m[2] ?? '';
		} elseif ( preg_match( '/' . $num . '\s*$/u', $before, $m ) ) {
			$qty = (float) $m[1];
			$u   = $m[2] ?? '';
		}
		if ( null === $qty || $qty <= 0 ) {
			return '1';
		}
		$unit = mb_strtolower( $unit );
		if ( in_array( $u, array( 'g', 'gm', 'gram', 'grams', 'গ্রাম' ), true ) && in_array( $unit, array( 'kg', 'কেজি' ), true ) ) {
			$qty /= 1000;
		} elseif ( in_array( $u, array( 'kg', 'kilo', 'কেজি' ), true ) && in_array( $unit, array( 'g', 'gm', 'gram' ), true ) ) {
			$qty *= 1000;
		} elseif ( 'ml' === $u && in_array( $unit, array( 'l', 'ltr', 'liter', 'litre' ), true ) ) {
			$qty /= 1000;
		}
		if ( ! $decimal ) {
			$qty = max( 1, round( $qty ) );
		}
		return rtrim( rtrim( number_format( $qty, 3, '.', '' ), '0' ), '.' );
	}

	/**
	 * @param array<int,array<string,mixed>> $items     Found items.
	 * @param array<int,array<string,mixed>> $catalogue Products.
	 */
	private static function mentionsProduct( string $seg, array $items, array $catalogue ): bool {
		$lower = mb_strtolower( $seg );
		foreach ( $items as $it ) {
			foreach ( $catalogue as $p ) {
				if ( (int) $p['id'] !== (int) $it['product_id'] ) {
					continue;
				}
				foreach ( self::aliases( $p ) as $a ) {
					if ( mb_strlen( $a ) >= 3 && str_contains( $lower, $a ) ) {
						return true;
					}
				}
			}
		}
		return false;
	}

	private static function looksLikeName( string $seg ): bool {
		if ( preg_match( '/\d/', $seg ) || preg_match( self::ADDRESS_HINTS, $seg ) || self::findArea( $seg ) ) {
			return false;
		}
		$words = preg_split( '/\s+/u', trim( $seg ) );
		return count( $words ) >= 1 && count( $words ) <= 4 && mb_strlen( $seg ) <= 40 && (bool) preg_match( '/^[\p{L}\s.\'-]+$/u', $seg ) && ! preg_match( '/^(hi|hello|salam|assalamu|আসসালামু|ভাই|apu|vai|please|plz|order|অর্ডার)/iu', $seg );
	}

	private static function clean( string $s ): string {
		return trim( (string) preg_replace( '/\s+/u', ' ', $s ), " \t-–—:.," );
	}
}
