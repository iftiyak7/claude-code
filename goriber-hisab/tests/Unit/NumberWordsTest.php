<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Unit;

use GoriberHisab\Support\NumberWords;
use GoriberHisab\Tests\TestCase;

final class NumberWordsTest extends TestCase {

	public function testEnglishLakhCrore(): void {
		$this->assertSame( 'One Lakh Twenty Five Thousand Fifty Taka and Fifty Paisa Only', NumberWords::money( '125050.50' ) );
		$this->assertSame( 'Three Thousand Three Hundred Taka Only', NumberWords::money( '3300' ) );
		$this->assertSame( 'Two Crore Taka Only', NumberWords::money( '20000000' ) );
		$this->assertSame( 'Zero Taka Only', NumberWords::money( '0' ) );
	}

	public function testBangla(): void {
		$this->assertSame( 'এক লক্ষ পঁচিশ হাজার পঞ্চাশ টাকা পঞ্চাশ পয়সা মাত্র', NumberWords::money( '125050.50', 'bn' ) );
		$this->assertSame( 'নিরানব্বই টাকা মাত্র', NumberWords::money( '99', 'bn' ) );
		$this->assertSame( 'এক কোটি দুই লক্ষ টাকা মাত্র', NumberWords::money( '10200000', 'bn' ) );
	}
}
