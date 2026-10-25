jQuery(function ($) {
	var PX = 'nmo';

	// Tabs, remembering the last one opened.
	function openTab(hash) {
		var $link = $('.nmo-tab-nav a[href="' + hash + '"]');
		if (!$link.length) return;
		$('.nmo-tab-nav a').removeClass('active');
		$link.addClass('active');
		$('.nmo-panel').removeClass('active');
		$(hash).addClass('active');
		try { localStorage.setItem('nmoTab', hash); } catch (e) {}
	}
	$('.nmo-tab-nav a').on('click', function (e) {
		e.preventDefault();
		openTab($(this).attr('href'));
	});
	try { openTab(localStorage.getItem('nmoTab') || ''); } catch (e) {}

	$('.nmo-color').wpColorPicker();

	// Media library picker.
	$(document).on('click', '.nmo-image-pick', function (e) {
		e.preventDefault();
		var $wrap = $(this).closest('.nmo-image');
		var frame = wp.media({ title: 'ছবি বাছুন', multiple: false, library: { type: 'image' } });
		frame.on('select', function () {
			var a = frame.state().get('selection').first().toJSON();
			var thumb = (a.sizes && a.sizes.thumbnail) ? a.sizes.thumbnail.url : a.url;
			$wrap.find('input').val(a.id);
			$wrap.attr('data-full', a.url);
			$wrap.find('img').attr('src', thumb).removeClass('hidden');
		});
		frame.open();
	});
	$(document).on('click', '.nmo-image-clear', function (e) {
		e.preventDefault();
		var $wrap = $(this).closest('.nmo-image');
		$wrap.find('input').val('');
		$wrap.attr('data-full', '');
		$wrap.find('img').attr('src', '').addClass('hidden');
	});
	/* Brand colours from the logo: sample its pixels, find the dominant
	   brand hues and derive a readable palette for the landing page. */
	function hsl2hex(h, s, l) {
		s /= 100; l /= 100;
		var k = function (n) { return (n + h / 30) % 12; };
		var a = s * Math.min(l, 1 - l);
		var f = function (n) { return Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0'); };
		return '#' + f(0) + f(8) + f(4);
	}
	function rgb2hsl(r, g, b) {
		r /= 255; g /= 255; b /= 255;
		var max = Math.max(r, g, b), min = Math.min(r, g, b), h = 0, s = 0, l = (max + min) / 2, dd = max - min;
		if (dd) {
			s = dd / (1 - Math.abs(2 * l - 1));
			h = max === r ? ((g - b) / dd) % 6 : max === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
			h = (h * 60 + 360) % 360;
		}
		return [h, s * 100, l * 100];
	}
	var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
	var hueGap = function (a, b) { var x = Math.abs(a - b) % 360; return x > 180 ? 360 - x : x; };

	function brandPalette(img) {
		var c = document.createElement('canvas'), W = 120, H = Math.max(1, Math.round(W * img.naturalHeight / img.naturalWidth));
		c.width = W; c.height = H;
		var ctx = c.getContext('2d');
		ctx.drawImage(img, 0, 0, W, H);
		var px = ctx.getImageData(0, 0, W, H).data, buckets = {}, neutral = [];
		for (var i = 0; i < px.length; i += 4) {
			if (px[i + 3] < 128) continue;
			var hsl = rgb2hsl(px[i], px[i + 1], px[i + 2]);
			if (hsl[2] > 94 || hsl[2] < 6) continue; // background white / pure black
			if (hsl[1] < 18) { neutral.push(hsl); continue; }
			var key = Math.round(hsl[0] / 12) + '-' + Math.round(hsl[2] / 20);
			var bk = buckets[key] || (buckets[key] = { n: 0, h: 0, s: 0, l: 0 });
			bk.n++; bk.h += hsl[0]; bk.s += hsl[1]; bk.l += hsl[2];
		}
		var list = Object.keys(buckets).map(function (k) { var b = buckets[k]; return { n: b.n, h: b.h / b.n, s: b.s / b.n, l: b.l / b.n }; })
			.sort(function (a, b) { return b.n * b.s - a.n * a.s; });
		if (!list.length) {
			if (!neutral.length) return null;
			list = [{ h: 30, s: 10, l: 40, n: 1 }]; // monochrome logo
		}
		var main = list[0];
		var second = list.filter(function (x) { return hueGap(x.h, main.h) > 25 && x.n > main.n * 0.08; })[0];
		// The lighter brand colour becomes the highlight, the deeper one the buttons and dark sections.
		var p = main, a = second || { h: main.h, s: main.s, l: main.l - 20 };
		if (second && second.l > main.l) { p = second; a = main; }

		// Primary sits on dark backgrounds and behind dark text: keep it mid-bright.
		var primary = hsl2hex(p.h, clamp(p.s, 45, 95), clamp(p.l, 48, 62));
		// Accent is the CTA button with white text: keep it dark enough to read.
		var accent = hsl2hex(a.h, clamp(a.s, 45, 90), clamp(a.l, 24, 38));
		return {
			color_primary: primary,
			color_accent: accent,
			color_dark: hsl2hex(a.h, clamp(a.s * 0.6, 20, 60), 10),
			color_cream: hsl2hex(p.h, clamp(p.s, 40, 80), 97),
			color_text: hsl2hex(a.h, clamp(a.s * 0.4, 15, 40), 15)
		};
	}

	$('#' + PX + '-from-logo').on('click', function () {
		var $sw = $('.' + PX + '-swatches').empty();
		var src = $('#' + PX + '-logo').closest('.' + PX + '-image').attr('data-full');
		if (!src) { $sw.html('<em>আগে “সাধারণ ও ব্র্যান্ড” ট্যাবে লোগো আপলোড করুন।</em>'); return; }
		var img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = function () {
			var pal;
			try { pal = brandPalette(img); } catch (e) { pal = null; }
			if (!pal) { $sw.html('<em>লোগো থেকে রং পড়া যায়নি — রংগুলো হাতে বসিয়ে দিন।</em>'); return; }
			Object.keys(pal).forEach(function (k) {
				$('#' + PX + '-' + k).wpColorPicker('color', pal[k]);
				$sw.append($('<i>').css('background', pal[k]).attr('title', pal[k]));
			});
			$sw.append(' <span>✓ সেট হয়েছে — এখন “সেভ করুন” চাপুন</span>');
		};
		img.onerror = function () { $sw.html('<em>লোগো লোড করা যায়নি।</em>'); };
		img.src = src;
	});
});
