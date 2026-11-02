/* Taps, forms and inputs for the whole app (one listener each). */
import { S } from './state.js';
import { hardRefresh } from './boot.js';
import { loadCoupons, saved } from './components.js';
import { getItem, locate, nameOf, origin } from './data.js';
import { cache } from './page_classifieds.js';
import { MEDIA, contactRow, drawMedia, mediaBody, readCrows, setLoc } from './page_post.js';
import { loadReviews, pages } from './pages.js';
import { doLocate, go, render } from './router.js';
import { areaSheet, closeSheet, filterSheet, noticesSheet, reportSheet, requireLogin, reviewSheet } from './sheets.js';
import { LANG, T, api, applyTheme, beacon, ls, toLatin, toast, track } from './util.js';

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  /* ---------------- events ---------------- */
  document.addEventListener('click', async e => {
    const adEl = e.target.closest('[data-ad]');
    if (adEl) beacon('/adtrack', { id: adEl.dataset.ad, type: 'click' });
    const el = e.target.closest('button, [data-call], [data-call-track], [data-map], [data-copy]');
    if (!el || el.closest('.welcome')) return;
    const ds = el.dataset;
    if ('reload' in ds) return location.reload();
    if ('addcrow' in ds) { const box = el.closest('form').querySelector('[data-crows]'); box.insertAdjacentHTML('beforeend', contactRow()); box.lastElementChild.querySelector('input').focus(); return; }
    if ('rmcrow' in ds) { el.closest('.cedit').remove(); return; }
    if (ds.call) { e.preventDefault(); track(ds.id, 'call'); location.href = 'tel:' + ds.call; return; }
    if (ds.callTrack) return track(ds.callTrack, 'call');
    if (ds.map) return track(ds.map, 'map');
    if (ds.copy) { try { await navigator.clipboard.writeText(ds.copy); toast(T('কপি হয়েছে')); } catch {} return; }
    if ('close' in ds) return closeSheet();
    if ('back' in ds) return history.length > 1 ? history.back() : go('#/');
    if ('filter' in ds) { const [, q = ''] = location.hash.split('?'); const p = new URLSearchParams(q); const m = location.hash.match(/#\/c\/([\w-]+)/); if (m) p.set('cat', m[1]); return filterSheet(p); }
    if ('notices' in ds) return noticesSheet();
    if ('hardrefresh' in ds) return hardRefresh();
    if (ds.claim) {
      if (!requireLogin()) return;
      try { const r = await api(`/coupons/${ds.claim}/claim`, {}); toast(T('কুপন নেওয়া হয়েছে — কোড: {c}', { c: r.code })); cache.mycp = null; S.ME.coupons = (S.ME.coupons || 0) + 1;
        loadCoupons(location.hash.split('/')[2]?.split('?')[0]); if (location.hash.startsWith('#/offers')) { cache.offers = null; render(); } } catch (er) { toast(er.message); }
      return;
    }
    if (ds.cpstatus) {
      const [id, st] = ds.cpstatus.split('|');
      if (st === 'deleted' && !confirm(T('মুছে ফেলবেন?'))) return;
      try { await api('/my/coupons/' + id, { status: st }, 'PUT'); pages.account.cpStale = true; render(); } catch (er) { toast(er.message); }
      return;
    }
    if (ds.cpredeem) {
      try { pages.account.check = await api('/my/coupons/check', { code: ds.cpredeem, redeem: true }); toast(T('কুপন ব্যবহৃত হিসেবে চিহ্নিত হয়েছে')); pages.account.cpStale = true; render(); } catch (er) { toast(er.message); }
      return;
    }
    if ('areasheet' in ds) return areaSheet();
    if ('clrarea' in ds) { ls.set('area', ''); S.originCache = null; cache.ads = {}; return render(); }
    if ('locate' in ds) return doLocate();
    if ('forgetloc' in ds) { S.here = null; ls.set('loc', null); return render(); }
    if ('pop' in ds) { pages.home.pop = ds.pop; return render(); }
    if (ds.themeSet) { ls.set('theme', ds.themeSet); applyTheme(); return render(); }
    if ('lang' in ds || ds.setlang) { ls.set('lang', ds.setlang || (LANG() === 'bn' ? 'en' : 'bn')); applyTheme(); return render(); }
    if ('clear' in ds) return go('#/search');
    if ('clearhist' in ds) { ls.set('hist', []); return render(); }
    if (ds.tab) { pages.item.tab = ds.tab; return render(); }
    if (ds.authmode) { const n = new URLSearchParams(location.hash.split('?')[1] || ''); n.set('mode', ds.authmode); return go('#/login?' + n); }
    if (ds.paymethod) { pages.pay.method = ds.paymethod; return render(); }
    if (ds.save) {
      e.preventDefault();
      const s = saved(), i = s.indexOf(ds.save);
      i >= 0 ? s.splice(i, 1) : s.unshift(ds.save); ls.set('saved', s);
      document.querySelectorAll(`[data-save="${CSS.escape(ds.save)}"]`).forEach(b => b.classList.toggle('on', i < 0));
      toast(T(i >= 0 ? 'সেভ থেকে সরানো হয়েছে' : 'সেভ করা হয়েছে')); return;
    }
    if (ds.share || ds.sharead) {
      const it = ds.share ? getItem(ds.share) : cache.ad?.id === ds.sharead ? cache.ad : Object.values(cache.ads).flat().find(x => x.id === ds.sharead);
      if (!it) return;
      const url = location.origin + '/app/#/' + (ds.share ? 'p/' : 'ad/') + it.id, title = ds.share ? nameOf(it) : it.title;
      try { if (navigator.share) await navigator.share({ title, url }); else { await navigator.clipboard.writeText(title + '\n' + url); toast(T('লিংক কপি হয়েছে')); } } catch {}
      return;
    }
    if (ds.report) return reportSheet({ listing: ds.report });
    if (ds.reportrv) return reportSheet({ listing: location.hash.split('/')[2], review: ds.reportrv });
    if (ds.reportad) return reportSheet({ classified: ds.reportad });
    if ('writereview' in ds) return reviewSheet(getItem(location.hash.split('/')[2]));
    if (ds.vote) {
      const [rid, up] = ds.vote.split('|');
      try { await api(`/reviews/${rid}/vote`, { up: up === '1' }); toast(T('ধন্যবাদ!')); loadReviews(getItem(location.hash.split('/')[2])); } catch (er) { toast(er.message); }
      return;
    }
    if ('gpsfill' in ds) {
      const f = el.closest('form'); toast(T('লোকেশন খোঁজা হচ্ছে…'));
      try { const h = await locate(); setLoc(f, h.lat.toFixed(6), h.lng.toFixed(6)); f.mapUrl.value = ''; } catch { toast(T('লোকেশন পাওয়া যায়নি — ব্রাউজারে অনুমতি দিন')); }
      return;
    }
    if (ds.rmmedia) { const [k, i] = ds.rmmedia.split('|'); MEDIA[k].splice(+i, 1); return drawMedia(); }
    if ('logout' in ds) { await api('/auth/logout', {}); S.ME = null; cache.my = null; toast(T('লগআউট হয়েছে')); return go('#/profile'); }
    if (ds.delad || ds.dellisting) {
      if (!confirm(T('মুছে ফেলবেন?'))) return;
      try { await api(ds.delad ? '/my/classifieds/' + ds.delad : '/my/listings/' + ds.dellisting, undefined, 'DELETE'); pages.account.stale = true; toast(T('মুছে ফেলা হয়েছে')); render(); } catch (er) { toast(er.message); }
    }
  });
  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.matches('[data-sort]')) {
      const [h, q = ''] = location.hash.split('?'), p = new URLSearchParams(q);
      el.value ? p.set('sort', el.value) : p.delete('sort');
      if (el.value === 'near' && !S.here) return doLocate(h + '?' + p);
      return go(h + (p.toString() ? '?' + p : ''));
    }
    if (el.matches('[data-adsort]')) {
      const [h, q = ''] = location.hash.split('?'), p = new URLSearchParams(q);
      el.value ? p.set('sort', el.value) : p.delete('sort');
      if (el.value === 'near' && !origin()) return doLocate(h + '?' + p);
      return go(h + (p.toString() ? '?' + p : ''));
    }
    if (el.matches('[data-maplink]')) {
      const f = el.closest('form'), v = el.value.trim();
      if (!v) return setLoc(f, '', '', '');
      setLoc(f, '', '', T('লিংক থেকে লোকেশন খোঁজা হচ্ছে…'));
      try { const r = await api('/maplink', { url: v }); setLoc(f, r.lat, r.lng); } catch (er) { setLoc(f, '', '', er.message); }
      return;
    }
    if (el.name === 'plan') {
      el.closest('.plans').querySelectorAll('.plan').forEach(x => x.classList.toggle('on', x.contains(el)));
      if (el.closest('[data-planpick]')) { pages.pay.plan = el.value; render(); }
      return;
    }
  });
  document.addEventListener('paste', e => {
    if (e.target.matches?.('[data-maplink]')) setTimeout(() => e.target.dispatchEvent(new Event('change', { bubbles: true })), 30);
  });
  document.addEventListener('submit', async e => {
    const f = e.target; e.preventDefault();
    const btn = f.querySelector('[type=submit]');
    const busy = v => { if (btn) btn.disabled = v; };
    if ('search' in f.dataset) {
      const v = f.q.value.trim(); f.q.blur();
      const m = location.hash.match(/#\/c\/([\w-]+)/);
      return go('#/search?' + new URLSearchParams(Object.assign(v ? { q: v } : {}, m ? { cat: m[1] } : {})));
    }
    if ((f.dataset.addlisting || f.dataset.addclassified) && [...MEDIA.images, ...MEDIA.videos].some(m => !m.url)) return toast(T('ছবি/ভিডিও আপলোড শেষ হওয়া পর্যন্ত অপেক্ষা করুন'));
    busy(true);
    try {
      if (f.dataset.auth) {
        const v = Object.fromEntries(new FormData(f));
        S.ME = await api('/auth/' + (f.dataset.auth === 'login' ? 'login' : 'register'), { name: v.name, phone: toLatin(v.phone), password: v.password, terms: !!v.terms });
        cache.my = null;
        if (f.dataset.auth === 'login' && ls.get('termsV', 0) >= (S.D.terms?.version || 0)) api('/my/terms', {}).catch(() => {});
        toast(T('স্বাগতম, {name}!', { name: S.ME.name }));
        return go('#' + (new URLSearchParams(location.hash.split('?')[1] || '').get('next') || '/account'));
      }
      if (f.dataset.cpcheck != null) {
        try { pages.account.check = await api('/my/coupons/check', { code: toLatin(f.code.value) }); } catch (er) { pages.account.check = null; toast(er.message); }
        return render();
      }
      if (f.dataset.cpnew != null) {
        const v = Object.fromEntries(new FormData(f));
        await api('/my/coupons', { ...v, maxClaims: toLatin(v.maxClaims || '') });
        toast(T('অফার জমা হয়েছে — অনুমোদনের পর দেখাবে')); pages.account.cpStale = true; return render();
      }
      if (f.dataset.profile != null) {
        const v = Object.fromEntries(new FormData(f));
        if (v.phone) v.phone = toLatin(v.phone);
        await api('/my/profile', v, 'PUT'); S.ME = await api('/auth/me'); toast(T('সংরক্ষণ হয়েছে')); return render();
      }
      if (f.dataset.addlisting) {
        const fd = new FormData(f), v = Object.fromEntries(fd), [cat, sub] = (v.catsub || '|').split('|');
        const fb = /facebook\.com|fb\.com/i;
        const body = { name: v.name, nameEn: v.nameEn, cat, sub, area: v.area, address: v.address, phone: toLatin(v.phone || ''), phone2: toLatin(v.phone2 || ''), contacts: readCrows(f),
          hours: v.h24 ? '24h' : v.open && v.close ? `${v.open}-${v.close}` : null, off: fd.getAll('off').map(Number), price: toLatin(v.price || '').replace(/\D/g, ''),
          web: fb.test(v.web) && !v.facebook ? null : v.web, facebook: v.facebook || (fb.test(v.web) ? v.web : null), about: v.about, aboutEn: v.aboutEn, note: v.note,
          features: v.features, tags: v.tags, halal: !!v.halal, plan: v.plan, mapUrl: v.mapUrl, lat: v.lat, lng: v.lng, ...mediaBody() };
        if (f.dataset.edit) {
          await api('/my/listings/' + f.dataset.edit, body, 'PUT');
          cache.my = null; cache.edit = null; toast(T('পরিবর্তন জমা হয়েছে — যাচাইয়ের পর প্রকাশিত হবে')); return go('#/account');
        }
        const r = await api('/my/listings', body);
        cache.my = null;
        if (r.needsPayment) { pages.pay.plan = v.plan; return go('#/pay/' + r.id); }
        pages.post.done = 'আমাদের টিম যাচাই করে শীঘ্রই প্রকাশ করবে। ধন্যবাদ।'; return render();
      }
      if (f.dataset.addclassified) {
        const v = Object.fromEntries(new FormData(f));
        ['price', 'rooms', 'baths', 'size', 'vacancies', 'seats', 'students', 'daysPerWeek', 'phone', 'whatsapp'].forEach(k => v[k] && (v[k] = toLatin(v[k])));
        if (f.dataset.edit) {
          await api('/my/classifieds/' + f.dataset.edit, { ...v, ...mediaBody() }, 'PUT');
          cache.my = null; cache.edit = null; cache.ads = {}; toast(T('পরিবর্তন জমা হয়েছে — যাচাইয়ের পর প্রকাশিত হবে')); return go('#/account?tab=ads');
        }
        await api('/my/classifieds', { ...v, kind: f.dataset.addclassified, ...mediaBody() });
        cache.my = null;
        pages.post.done = 'অ্যাডমিন যাচাইয়ের পর বিজ্ঞাপনটি প্রকাশিত হবে।'; return render();
      }
      if (f.dataset.pay) {
        const v = Object.fromEntries(new FormData(f));
        const methods = ['bkash', 'nagad', 'rocket'].filter(m => S.D.payment?.[m]);
        await api('/my/payments', { listing: f.dataset.pay, plan: pages.pay.plan || undefined, method: methods.includes(pages.pay.method) ? pages.pay.method : methods[0],
          trx: v.trx, sender: toLatin(v.sender) });
        cache.my = null; toast(T('পেমেন্ট জমা হয়েছে — যাচাই চলছে')); return go('#/account');
      }
    } catch (er) { toast(er.message); } finally { busy(false); }
  });
}
