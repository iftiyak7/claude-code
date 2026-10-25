(function () {
	'use strict';
	var C = window.NSL || {};
	var d = document;
	var $ = function (s, r) { return (r || d).querySelector(s); };
	var $$ = function (s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); };
	var BN = '০১২৩৪৫৬৭৮৯';
	var bn = function (s) { return C.bn ? String(s).replace(/[0-9]/g, function (c) { return BN[c]; }) : String(s); };
	var money = function (n) { return bn(Math.round(n).toLocaleString('en-US')) + (C.currency || ''); };
	var store = {
		get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
		set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
	};
	var track = function (ev, data) {
		if (C.pixel && window.fbq) window.fbq('track', ev, data || {});
		if (window.dataLayer) window.dataLayer.push(Object.assign({ event: 'nsl_' + ev }, data || {}));
	};

	/* Scroll reveal + counters */
	function countUp(el) {
		var target = parseFloat(el.getAttribute('data-count')) || 0;
		var dec = (String(el.getAttribute('data-count')).split('.')[1] || '').length;
		var t0 = null, dur = 1600;
		function step(t) {
			if (!t0) t0 = t;
			var p = Math.min(1, (t - t0) / dur);
			var v = target * (1 - Math.pow(1 - p, 3));
			el.textContent = bn(dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-US'));
			if (p < 1) requestAnimationFrame(step);
		}
		requestAnimationFrame(step);
	}
	var revealEls = $$('[data-r]');
	var counters = $$('[data-count]');
	var animOn = d.body.classList.contains('anim') && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
	if ('IntersectionObserver' in window) {
		var io = new IntersectionObserver(function (entries) {
			entries.forEach(function (e) {
				if (!e.isIntersecting) return;
				e.target.classList.add('in');
				if (e.target.hasAttribute('data-count') && animOn) countUp(e.target);
				io.unobserve(e.target);
			});
		}, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
		revealEls.concat(counters).forEach(function (el) { io.observe(el); });
	} else {
		revealEls.forEach(function (el) { el.classList.add('in'); });
	}

	/* Evergreen countdown (per visitor) */
	var cd = $('.countdown');
	if (cd) {
		var hours = parseFloat(cd.getAttribute('data-hours')) || 6;
		var key = 'nslDeadline', end = parseInt(store.get(key), 10);
		var parts = { h: $('[data-cd="h"]', cd), m: $('[data-cd="m"]', cd), s: $('[data-cd="s"]', cd) };
		var setPart = function (el, v) {
			v = bn(v < 10 ? '0' + v : v);
			if (el.textContent !== v) { el.textContent = v; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); }
		};
		var tickCd = function () {
			var now = Date.now();
			if (!end || end <= now) { end = now + hours * 3600e3; store.set(key, end); }
			var left = Math.floor((end - now) / 1000);
			setPart(parts.h, Math.floor(left / 3600));
			setPart(parts.m, Math.floor(left % 3600 / 60));
			setPart(parts.s, left % 60);
		};
		tickCd();
		setInterval(tickCd, 1000);
	}

	/* Lazy YouTube */
	$$('[data-yt]').forEach(function (v) {
		var play = function () {
			v.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + v.getAttribute('data-yt') + '?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Video"></iframe>';
			v.removeAttribute('role');
		};
		v.addEventListener('click', play, { once: true });
		v.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); } });
	});

	/* Order form */
	var form = $('#nsl-form');
	var sticky = $('.sticky-bar');

	$$('[data-pick]').forEach(function (b) {
		b.addEventListener('click', function () {
			var r = form && $('input[name="package"][value="' + b.getAttribute('data-pick') + '"]', form);
			if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
		});
	});

	if (form) {
		var ts = d.createElement('input');
		ts.type = 'hidden'; ts.name = 'ts'; ts.value = Date.now();
		form.appendChild(ts);

		var qty = $('input[name="qty"]', form);
		var msg = $('.form-msg', form);
		var btn = $('.submit', form);
		var findById = function (list, id) { for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i]; return null; };
		var val = function (n) { var el = $('input[name="' + n + '"]:checked', form); return el ? el.value : ''; };

		var calc = function () {
			var q = Math.max(1, Math.min(50, parseInt(qty.value, 10) || 1));
			var pkg = findById(C.packages || [], val('package'));
			var zone = findById(C.zones || [], val('zone'));
			var sub = pkg ? pkg.price * q : 0;
			var ship = zone ? zone.charge : 0;
			if (C.freeFrom > 0 && sub >= C.freeFrom) ship = 0;
			var out = { sub: money(sub), ship: ship === 0 && zone ? C.freeLabel : money(ship), total: money(sub + ship) };
			$$('[data-sum]', form).forEach(function (el) {
				var v = out[el.getAttribute('data-sum')];
				if (el.textContent !== v) { el.textContent = v; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
			});
			return { total: sub + ship, pkg: pkg, qty: q };
		};

		form.addEventListener('change', calc);
		qty.addEventListener('input', calc);
		$$('[data-q]', form).forEach(function (b) {
			b.addEventListener('click', function () {
				qty.value = Math.max(1, Math.min(50, (parseInt(qty.value, 10) || 1) + parseInt(b.getAttribute('data-q'), 10)));
				calc();
			});
		});
		calc();

		var started = false;
		form.addEventListener('focusin', function () {
			if (started) return;
			started = true;
			track('InitiateCheckout', { currency: 'BDT', value: calc().total });
		});

		var clearErrors = function () {
			$$('.field.err', form).forEach(function (f) { f.classList.remove('err'); var m = $('.err-msg', f); if (m) m.remove(); });
			msg.textContent = '';
		};
		var showError = function (name, text) {
			var input = form.elements[name];
			if (input && input.length && !input.tagName) input = input[0];
			var f = input && input.closest('.field');
			if (!f) return;
			f.classList.add('err');
			var m = d.createElement('div'); m.className = 'err-msg'; m.textContent = text;
			f.appendChild(m);
		};
		var en = function (s) { return String(s).replace(/[০-৯]/g, function (c) { return BN.indexOf(c); }); };

		form.addEventListener('submit', function (e) {
			e.preventDefault();
			clearErrors();
			var errs = {};
			var phone = en(form.elements.phone.value).replace(/[^0-9]/g, '').replace(/^880/, '0');
			if (form.elements.name.value.trim().length < 2) errs.name = 'আপনার নাম লিখুন';
			if (!/^01[3-9][0-9]{8}$/.test(phone)) errs.phone = 'সঠিক ১১ ডিজিটের মোবাইল নম্বর লিখুন';
			if (form.elements.address.value.trim().length < 8) errs.address = 'সম্পূর্ণ ঠিকানা লিখুন (বাসা, রোড, থানা, জেলা)';
			if (Object.keys(errs).length) {
				Object.keys(errs).forEach(function (k) { showError(k, errs[k]); });
				var first = $('.field.err input, .field.err textarea', form);
				if (first) first.focus();
				return;
			}

			var summary = calc();
			var data = new FormData(form);
			data.append('action', 'nsl_order');
			btn.disabled = true; btn.classList.add('loading');

			fetch(C.ajax, { method: 'POST', body: data, credentials: 'same-origin' })
				.then(function (r) { return r.json().catch(function () { return { success: false, data: {} }; }); })
				.then(function (res) {
					if (!res.success) {
						var dt = res.data || {};
						if (dt.fields) Object.keys(dt.fields).forEach(function (k) { showError(k, dt.fields[k]); });
						msg.textContent = dt.message || 'দুঃখিত, অর্ডারটি পাঠানো যায়নি। আবার চেষ্টা করুন।';
						return;
					}
					track('Purchase', { currency: 'BDT', value: res.data.total, content_name: summary.pkg ? summary.pkg.name : '', num_items: summary.qty });
					if (res.data.redirect) { location.href = res.data.redirect; return; }
					var ok = $('#nsl-success');
					$('.order-no', ok).textContent = 'অর্ডার নম্বর: #' + bn(res.data.order) + ' — মোট ' + money(res.data.total);
					form.hidden = true;
					ok.hidden = false;
					ok.focus();
					ok.scrollIntoView({ behavior: 'smooth', block: 'center' });
					if (sticky) sticky.remove();
				})
				.catch(function () { msg.textContent = 'ইন্টারনেট সংযোগে সমস্যা হচ্ছে। আবার চেষ্টা করুন অথবা আমাদের কল করুন।'; })
				.then(function () { btn.disabled = false; btn.classList.remove('loading'); });
		});
	}

	/* Sticky mobile bar: show after hero, hide while the form is on screen */
	if (sticky && 'IntersectionObserver' in window) {
		var heroGone = false, formSeen = false;
		var hero = $('.hero');
		var update = function () { sticky.classList.toggle('show', heroGone && !formSeen); };
		new IntersectionObserver(function (es) { heroGone = !es[0].isIntersecting; update(); }).observe(hero || d.body);
		if (form) new IntersectionObserver(function (es) { formSeen = es[0].isIntersecting; update(); }, { threshold: 0.05 }).observe(form);
	}
})();
