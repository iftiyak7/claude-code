/* App releases, general settings, staff accounts and two-step login, activity labels. */
import { fieldHtml, readFields, saveSetting } from './collections.js';
import { pages } from './dashboard.js';
import { empty, load } from './data.js';
import { route } from './router.js';
import { shell } from './shell.js';
import { S, T, api, date, day, esc, num, owner, root, run, toast } from './util.js';

const POPUP_F = [['active', 'check', 'পপআপ চালু'], ['title', 'text', 'শিরোনাম'], ['titleEn', 'text', 'শিরোনাম (English)'], ['body', 'textarea', 'বিস্তারিত'],
  ['bodyEn', 'textarea', 'বিস্তারিত (English)'], ['image', 'image', 'ছবি (ঐচ্ছিক)', 'চওড়া ছবি ভালো দেখায়, যেমন ১২০০×৬৭৫'],
  ['cta', 'text', 'বাটনের লেখা', 'যেমন: বিস্তারিত দেখুন — খালি রাখলে শুধু "ঠিক আছে" বাটন থাকবে'], ['ctaEn', 'text', 'বাটনের লেখা (English)'],
  ['link', 'text', 'বাটনের লিংক', 'অ্যাপের পেজ (যেমন #/ads/rent), ওয়েবসাইট (https://…) বা ফোন (tel:01…)'],
  ['show', 'select', 'কতবার দেখাবে', '', [['once', 'প্রতি ব্যবহারকারীকে একবার'], ['daily', 'দিনে একবার'], ['every', 'প্রতিবার অ্যাপ খুললে']]],
  ['start', 'date0', 'শুরুর তারিখ', 'খালি রাখলে এখনই শুরু'], ['end', 'date0', 'শেষ তারিখ', 'খালি রাখলে বন্ধ না করা পর্যন্ত চলবে']];
const popupPreview = v => `<div class="pp-card">${v.image ? `<img src="${esc(v.image)}" alt="">` : ''}<div class="pp-b"><b>${esc(v.title || T('শিরোনাম'))}</b>
  ${v.body ? `<p>${esc(v.body)}</p>` : ''}<div class="pp-acts">${v.cta ? `<span class="btn sm">${esc(v.cta)}</span>` : ''}<span class="btn sm ghost">${T(v.cta ? 'পরে' : 'ঠিক আছে')}</span></div></div></div>`;
export const AUDIT = { login: 'লগইন', 'listing.create': 'নতুন তালিকা যোগ', 'listing.update': 'তালিকা সম্পাদনা', 'listing.delete': 'তালিকা মুছে ফেলা',
  'listing.approved': 'জমা অনুমোদন', 'listing.rejected': 'জমা বাতিল', 'listing.pending': 'অপেক্ষমাণ করা হয়েছে', 'review.update': 'রিভিউ আপডেট', 'review.delete': 'রিভিউ মুছে ফেলা',
  'settings.site': 'সেটিংস পরিবর্তন', 'settings.areas': 'এলাকা পরিবর্তন', 'settings.categories': 'ক্যাটাগরি পরিবর্তন', 'settings.ads': 'বিজ্ঞাপন পরিবর্তন',
  'settings.notices': 'ঘোষণা পরিবর্তন', 'settings.plans': 'প্যাকেজ পরিবর্তন', 'settings.payment': 'পেমেন্ট নম্বর পরিবর্তন', 'admin.add': 'নতুন অ্যাডমিন',
  'admin.delete': 'অ্যাডমিন মুছে ফেলা', 'admin.password': 'পাসওয়ার্ড পরিবর্তন',
  'admin.2fa.on': '2FA চালু', 'settings.google': 'Google লগইন সেটিং', 'admin.2fa.off': '2FA বন্ধ', 'login.fail': '⚠ ভুল লগইন চেষ্টা', 'payment.verify': 'পেমেন্ট যাচাই', 'payment.reject': 'পেমেন্ট বাতিল',
  'classified.approved': 'বিজ্ঞাপন অনুমোদন', 'classified.rejected': 'বিজ্ঞাপন বাতিল', 'classified.delete': 'বিজ্ঞাপন মুছে ফেলা', 'user.ban': 'ব্যবহারকারী বন্ধ',
  'user.unban': 'ব্যবহারকারী চালু', 'user.reset': 'ব্যবহারকারীর পাসওয়ার্ড রিসেট', 'app.release': 'নতুন অ্যাপ ভার্সন' };

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  /* ---------------- app release ---------------- */
  pages.app = async () => {
    await load(true);
    const a = S.settings.app || {};
    shell('app', T('অ্যাপ রিলিজ (APK)'), '', `<div class="split"><div class="grid">
      <div class="card"><h3>${T('বর্তমান ভার্সন')}</h3><div class="cbody">${a.file ? `<div class="apkcur"><span class="thumb" style="--c:#0e9f6e;width:56px;height:56px">${icon('download', 26)}</span>
          <div><b style="font-size:20px">v${esc(a.versionName)}</b> <small class="muted">(${T('কোড')} ${num(a.versionCode)})</small><br><small class="muted">${esc(day(a.updated))} · ${a.size < 1048576 ? num(Math.max(1, Math.round(a.size / 1024))) + ' KB' : num((a.size / 1048576).toFixed(1)) + ' MB'}</small>
          ${a.notes ? `<p style="margin:8px 0 0">${esc(a.notes)}</p>` : ''}</div></div>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><a class="btn dark" href="/download/jashore360.apk">${icon('download', 18)}${T('ডাউনলোড')}</a><a class="btn ghost" href="/" target="_blank">${T('ল্যান্ডিং পেজ দেখুন')}</a></div>`
        : empty(T('এখনো কোনো APK যোগ করা হয়নি'), '', 'download')}</div></div>
      <form class="card" data-apk><h3>${T('নতুন ভার্সন আপলোড')}</h3><div class="cbody form">
        <label class="field"><span>${T('APK ফাইল')}</span><input type="file" name="file" accept=".apk,application/vnd.android.package-archive" required></label>
        <div class="two"><label class="field"><span>${T('ভার্সন নাম')}</span><input name="versionName" required placeholder="1.1.0"></label>
          <label class="field"><span>${T('ভার্সন কোড')}</span><input name="versionCode" required inputmode="numeric" value="${(a.versionCode || 0) + 1}"><em>${T('প্রতিবার আগের চেয়ে বড় সংখ্যা দিন')}</em></label></div>
        <label class="field"><span>${T('কী নতুন')}</span><textarea name="notes" rows="3"></textarea></label>
        <div class="progress" hidden><i></i></div>
        <div><button class="btn">${icon('upload', 18)}${T('আপলোড ও প্রকাশ')}</button></div></div></form></div>
      <div class="card"><h3>${T('কীভাবে কাজ করে')}</h3><div class="cbody"><ol class="howto">
        <li>${T('নতুন APK আপলোড করলে ওয়েবসাইটের ডাউনলোড বাটন সাথে সাথে নতুন ফাইল দেয়।')}</li>
        <li>${T('যাদের ফোনে পুরনো অ্যাপ আছে, তারা অ্যাপের হোমপেজে "নতুন ভার্সন এসেছে" দেখবেন।')}</li>
        <li>${T('অ্যাপের ভেতরের তথ্য ও ডিজাইন ওয়েবসাইট থেকে আসে — সেগুলো বদলাতে নতুন APK লাগে না।')}</li>
        <li>${T('একই সাইনিং কী দিয়ে তৈরি APK দিতে হবে, নইলে ব্যবহারকারীরা আপডেট করতে পারবেন না।')}</li></ol></div></div></div>`);
  };
  /* ---------------- settings & admins ---------------- */
  pages.settings = async () => {
    await load();
    const s = S.settings.site || {}, g = owner() ? await api('/admin/google') : null;
    const F = [['name', 'text', 'অ্যাপের নাম'], ['tagline', 'text', 'ট্যাগলাইন'], ['taglineEn', 'text', 'ট্যাগলাইন (English)'], ['headline', 'text', 'হোমপেজের শিরোনাম'],
      ['headlineEn', 'text', 'হোমপেজের শিরোনাম (English)'], ['hotline', 'text', 'প্রধান জরুরি নম্বর', 'হোম ও জরুরি পেজের বড় কল বাটন'], ['hotlineNote', 'text', 'জরুরি নম্বরের বিবরণ'],
      ['hotlineNoteEn', 'text', 'জরুরি নম্বরের বিবরণ (English)'], ['contactPhone', 'text', 'যোগাযোগের ফোন'], ['contactEmail', 'text', 'যোগাযোগের ইমেইল'], ['facebook', 'text', 'ফেসবুক পেজ লিংক'],
      ['about', 'textarea', 'আমাদের সম্পর্কে'], ['aboutEn', 'textarea', 'আমাদের সম্পর্কে (English)'], ['disclaimer', 'textarea', 'দাবিত্যাগ (ফুটারে দেখায়)'],
      ['disclaimerEn', 'textarea', 'দাবিত্যাগ (English)'], ['snakeTip', 'textarea', 'সাপে কামড়ের নির্দেশনা (জরুরি পেজ)'], ['snakeTipEn', 'textarea', 'সাপে কামড়ের নির্দেশনা (English)'],
      ['classifiedDisclaimer', 'textarea', 'চাকরি/ভাড়া বিজ্ঞাপনের নিচের সতর্কতা'], ['classifiedDisclaimerEn', 'textarea', 'চাকরি/ভাড়া বিজ্ঞাপনের সতর্কতা (English)'],
      ['listingDisclaimer', 'textarea', 'প্রতিষ্ঠানের পেজের নিচের সতর্কতা'], ['listingDisclaimerEn', 'textarea', 'প্রতিষ্ঠানের পেজের সতর্কতা (English)']];
    const pair = (a, b) => `<div class="two">${fieldHtml(F[a], s[F[a][0]])}${fieldHtml(F[b], s[F[b][0]])}</div>`;
    shell('settings', T('সাধারণ সেটিংস'), '', `<div class="split"><form class="card" data-site><h3>${T('অ্যাপের তথ্য')}</h3><div class="cbody form">
        ${fieldHtml(F[0], s.name)}${pair(1, 2)}${pair(3, 4)}${fieldHtml(F[5], s.hotline)}${pair(6, 7)}${pair(8, 9)}${fieldHtml(F[10], s.facebook)}
        ${pair(11, 12)}${pair(13, 14)}${pair(15, 16)}${pair(17, 18)}${pair(19, 20)}<div><button class="btn">${icon('check', 18)}${T('সংরক্ষণ করুন')}</button></div></div></form>
      <div class="grid"><form class="card" data-areas><h3>${T('এলাকার তালিকা')}</h3><div class="cbody form"><label class="field"><span>${T('প্রতি লাইনে একটি এলাকা')}</span>
        <textarea name="areas" rows="16">${esc((S.settings.areas || []).map(a => S.settings.areaGeo?.[a] ? `${a} = ${S.settings.areaGeo[a].join(', ')}` : a).join('\n'))}</textarea>
        <em>${T('চাইলে এলাকার কেন্দ্রের লোকেশন দিন: নিউমার্কেট = 23.1712, 89.2143 — এলাকা বাছলে দূরত্ব এখান থেকে মাপা হবে। না দিলে সেই এলাকার তালিকাগুলোর গড় অবস্থান ধরা হয়।')}</em>
        <em>${T('শহরের এলাকায় (যেমন হাইকোর্ট মোড়) লোকেশন দিলে, এলাকা না লেখা থাকলেও ১.২ কিমির মধ্যের সব তথ্য সেই এলাকায় দেখাবে। Google Maps-এ জায়গায় রাইট-ক্লিক করলে সংখ্যা দুটো পাবেন।')}</em></label><div><button class="btn">${icon('check', 18)}${T('সংরক্ষণ')}</button></div></div></form>
        ${g ? `<form class="card" data-google><h3>${T('Google দিয়ে লগইন')}</h3><div class="cbody form">
          <ol class="steps"><li>${T('console.cloud.google.com → নতুন প্রজেক্ট → APIs & Services → OAuth consent screen পূরণ করুন (অ্যাপের নাম, ইমেইল, লোগো)।')}</li>
            <li>${T('Credentials → Create credentials → OAuth client ID → Web application।')}</li>
            <li>${T('"Authorized redirect URIs"-এ ঠিক এটি দিন:')}<p class="bigpw" style="font-size:13px;letter-spacing:0;user-select:all">${esc(g.redirectUri)}</p></li>
            <li>${T('Client ID ও Client Secret নিচে বসিয়ে চালু করুন।')}</li></ol>
          <label class="field"><span>Client ID</span><input name="clientId" value="${esc(g.clientId)}" placeholder="…apps.googleusercontent.com" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span>Client Secret</span><input name="clientSecret" type="password" autocomplete="new-password" placeholder="${g.hasSecret ? T('বসানো আছে — বদলাতে নতুনটি দিন') : ''}"></label>
          <label class="check"><input type="checkbox" name="enabled" ${g.enabled ? 'checked' : ''}><span>${T('অ্যাপ ও ওয়েবসাইটে "Google দিয়ে লগইন" দেখান')}</span></label>
          <div><button class="btn">${icon('check', 18)}${T('সংরক্ষণ')}</button></div></div></form>` : ''}
        ${areaGeoCard()}
        <div class="card"><h3>${T('ব্যাকআপ')}</h3><div class="cbody"><p class="muted" style="margin-top:0">${T('সব তালিকা, রিভিউ, পেমেন্ট, ব্যবহারকারী ও সেটিংস একটি ফাইলে ডাউনলোড করুন। নিয়মিত ব্যাকআপ রাখুন।')}</p>
          <p class="muted">${icon('shield', 14)} ${T('সার্ভার নিজেও প্রতিদিন ডাটাবেসের একটি কপি রাখে (শেষ ১৪ দিনের)।')}</p>
          <a class="btn dark" href="/api/admin/export">${icon('download', 18)}${T('ব্যাকআপ ডাউনলোড')}</a></div></div></div></div>`);
    const gf = root.querySelector('[data-google]');
    if (gf) gf.onsubmit = async e => { e.preventDefault(); await run(() => api('/admin/google', { clientId: gf.clientId.value.trim(), clientSecret: gf.clientSecret.value.trim(), enabled: gf.enabled.checked }, 'PUT'), 'সংরক্ষণ হয়েছে'); route(); };
    root.querySelector('[data-site]').onsubmit = async e => { e.preventDefault(); await saveSetting('site', { ...s, ...readFields(e.target, F) }); };
    const ag = root.querySelector('[data-areageo]');
    ag.onsubmit = async e => {
      e.preventDefault();
      const btn = ag.querySelector('button[type=submit]'), geo = { ...(S.settings.areaGeo || {}) };
      let added = 0, bad = [];
      btn.disabled = true;
      try {
        for (const inp of ag.querySelectorAll('[data-geo]')) {
          const v = inp.value.trim(), name = inp.dataset.geo;
          if (!v) continue;
          const m = v.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
          try {
            const r = m ? { lat: +m[1], lng: +m[2] } : await api('/maplink', { url: v });
            if (!(r.lat > 20 && r.lat < 27 && r.lng > 87 && r.lng < 93)) throw new Error();
            geo[name] = [r.lat, r.lng]; added++;
          } catch { bad.push(name); }
        }
        if (added) await saveSetting('areaGeo', geo);
        if (bad.length) toast(T('এগুলোর লিংক থেকে লোকেশন পাওয়া যায়নি: {a}', { a: bad.join(', ') }), true);
        else if (added) toast(T('{n}টি এলাকার লোকেশন সংরক্ষণ হয়েছে', { n: num(added) }));
        route();
      } finally { btn.disabled = false; }
    };
    ag.addEventListener('click', async e => {
      const b = e.target.closest('[data-geodel]'); if (!b) return;
      const geo = { ...(S.settings.areaGeo || {}) }; delete geo[b.dataset.geodel];
      await saveSetting('areaGeo', geo); route();
    });
    root.querySelector('[data-areas]').onsubmit = async e => {
      e.preventDefault();
      const areas = [], geo = {};
      e.target.areas.value.split('\n').map(x => x.trim()).filter(Boolean).forEach(line => {
        const [name, ll] = line.split('=').map(x => x.trim()), m = (ll || '').match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
        if (!areas.includes(name)) areas.push(name);
        if (m) geo[name] = [+m[1], +m[2]];
      });
      await saveSetting('areas', areas);
      await saveSetting('areaGeo', geo);
    };
  };
  // Each area's map point: the app measures "how far" from it when someone picks that area.
  function areaGeoCard() {
    const geo = S.settings.areaGeo || {}, areas = S.settings.areas || [], missing = areas.filter(a => !geo[a]);
    return `<form class="card" data-areageo><h3>${T('এলাকার ম্যাপ-অবস্থান')}</h3><div class="cbody form">
      <p class="muted" style="margin:0;font-size:13px">${T('কেউ অ্যাপে এলাকা বাছলে দূরত্ব এই বিন্দু থেকে মাপা হয়। Google Maps-এ এলাকার মাঝখানটা খুলে Share → Copy link করে পাশের ঘরে পেস্ট করুন (অথবা রাইট-ক্লিক করে পাওয়া "23.17, 89.21" সংখ্যা)।')}</p>
      <p style="margin:0">${missing.length ? `<span class="tag warn">${T('{n}টি এলাকার লোকেশন নেই', { n: num(missing.length) })}</span>` : `<span class="tag ok">${T('সব এলাকার লোকেশন আছে')}</span>`}</p>
      <div class="geolist">${[...missing, ...areas.filter(a => geo[a])].map(a => `<div class="georow"><b>${esc(a)}</b>
        ${geo[a] ? `<a class="tag ok" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${geo[a].join(',')}">${icon('check', 12)} ${T('আছে')}</a><button type="button" class="iconbtn" data-geodel="${esc(a)}" title="${T('মুছুন')}">${icon('x', 15)}</button>`
          : `<input data-geo="${esc(a)}" placeholder="${T('Google Maps লিংক')}" autocomplete="off">`}</div>`).join('')}</div>
      <div><button class="btn" type="submit">${icon('check', 18)}${T('সংরক্ষণ')}</button></div></div></form>`;
  }
  pages.popup = async () => {
    await load();
    const v = S.settings.popup || {}, f = POPUP_F;
    shell('popup', T('পপআপ'), '', `<p class="muted" style="margin-top:0">${T('অ্যাপ খুললে ব্যবহারকারীদের সামনে একটি পপআপ দেখান — নতুন সুবিধা, অফার, জরুরি ঘোষণা বা ক্যাম্পেইনের জন্য। নতুন লেখা দিলে "একবার" সেটিংয়েও সবাই আবার দেখবে।')}</p>
      <div class="split"><form class="card" data-popup><h3>${T('পপআপ')}</h3><div class="cbody form">
        ${fieldHtml(f[0], v.active)}<div class="two">${fieldHtml(f[1], v.title)}${fieldHtml(f[2], v.titleEn)}</div><div class="two">${fieldHtml(f[3], v.body)}${fieldHtml(f[4], v.bodyEn)}</div>
        ${fieldHtml(f[5], v.image)}<div class="two">${fieldHtml(f[6], v.cta)}${fieldHtml(f[7], v.ctaEn)}</div>${fieldHtml(f[8], v.link)}
        ${fieldHtml(f[9], v.show || 'once')}<div class="two">${fieldHtml(f[10], v.start)}${fieldHtml(f[11], v.end)}</div>
        <div><button class="btn">${icon('check', 18)}${T('সংরক্ষণ করুন')}</button></div></div></form>
        <div class="card"><h3>${T('প্রিভিউ')}</h3><div class="cbody pp-wrap" data-pp>${popupPreview(v)}</div></div></div>`);
    const form = root.querySelector('[data-popup]');
    const refresh = () => { root.querySelector('[data-pp]').innerHTML = popupPreview(readFields(form, f)); };
    form.addEventListener('input', refresh); form.addEventListener('change', () => setTimeout(refresh, 50));
    form.onsubmit = async e => {
      e.preventDefault();
      const val = readFields(form, f);
      if (val.active && !val.title && !val.image) return toast(T('শিরোনাম বা ছবি দিন'), true);
      await saveSetting('popup', val, val.active ? 'পপআপ চালু হয়েছে' : 'সংরক্ষণ হয়েছে');
      S.settings.popup = await api('/admin/settings/popup');
    };
  };
  pages.terms = async () => {
    await load();
    const t = S.settings.terms || {};
    shell('terms', T('শর্তাবলি'), '', `<p class="muted" style="margin-top:0">${T('অ্যাপে প্রথমবার ঢোকার সময় ও অ্যাকাউন্ট খোলার সময় ব্যবহারকারীকে এই শর্তাবলিতে সম্মতি দিতে হয়। লেখা বদলালে সবাইকে আবার সম্মতি দিতে হবে।')}</p>
      ${t.version ? `<div class="note info">${icon('doc', 20)}<div>${T('বর্তমান ভার্সন')}: <b>${num(t.version)}</b>${t.updated ? ` · ${T('আপডেট')}: ${date(t.updated)}` : ''} · <a href="/app/#/terms" target="_blank">${T('অ্যাপে দেখুন')}</a></div></div>` : ''}
      <form class="split" data-terms>
        <div class="card"><h3>বাংলা</h3><div class="cbody form"><label class="field"><span>${T('শর্তাবলি (বাংলা)')}</span><textarea name="bn" rows="22">${esc(t.bn || '')}</textarea>
          <em>${T('প্রতিটি অনুচ্ছেদের মাঝে একটি ফাঁকা লাইন দিন')}</em></label></div></div>
        <div class="card"><h3>English</h3><div class="cbody form"><label class="field"><span>${T('শর্তাবলি (English)')}</span><textarea name="en" rows="22">${esc(t.en || '')}</textarea></label></div></div>
        <div class="savebar" style="grid-column:1/-1"><button class="btn">${icon('check', 18)}${T('সংরক্ষণ করুন')}</button></div></form>`);
    root.querySelector('[data-terms]').onsubmit = async e => {
      e.preventDefault();
      await saveSetting('terms', { bn: e.target.bn.value, en: e.target.en.value });
      S.settings.terms = await api('/admin/settings/terms'); route();
    };
  };
  pages.admins = async () => {
    const [admins, me] = await Promise.all([owner() ? api('/admin/admins') : [], api('/admin/me')]);
    shell('admins', T('অ্যাডমিন ও নিরাপত্তা'), owner() ? `<button class="btn" data-addadmin>${icon('plus', 18)}<span class="hide-sm">${T('নতুন অ্যাডমিন')}</span></button>` : '', `<div class="split">
      ${owner() ? `<div class="card"><h3>${T('অ্যাডমিন অ্যাকাউন্ট')}</h3>${admins.map(a => `<div class="item"><span class="thumb" style="--c:${a.role === 'owner' ? '#7c5cff' : '#0e9f6e'}">${icon(a.role === 'owner' ? 'shield' : 'user', 20)}</span>
        <div class="body"><b>${esc(a.username)}${a.username === S.me.username ? ` <span class="tag ok">${T('আপনি')}</span>` : ''}</b><small>${T(a.role === 'owner' ? 'মূল অ্যাডমিন' : 'মডারেটর')} · ${T('যোগ হয়েছে')} ${date(a.created_at)}</small>
          <div class="tags" style="margin-top:4px">${a.twofa ? `<span class="tag ok">${icon('shield', 12)} ${T('2FA চালু')}</span>` : `<span class="tag warn">${T('2FA বন্ধ')}</span>`}</div></div>
        ${a.username !== S.me.username ? `<button class="iconbtn red" data-deladmin="${a.id}" title="${T('মুছুন')}">${icon('trash', 18)}</button>` : ''}</div>`).join('')}
        <div class="cbody muted" style="font-size:13px">${T('মডারেটর তালিকা, জমা, বিজ্ঞাপন অনুমোদন, রিভিউ ও রিপোর্ট দেখতে পারেন। পেমেন্ট যাচাই, বিজ্ঞাপন (Ads), প্যাকেজ, ক্যাটাগরি, অ্যাপ রিলিজ ও সেটিংস শুধু মূল অ্যাডমিনের।')}</div></div>` : '<div></div>'}
      <div class="grid">
      <div class="card"><h3>${T('দুই ধাপের লগইন (2FA)')}</h3><div class="cbody">
        ${me.twofa ? `<div class="note info" style="margin:0 0 14px">${icon('shield', 20)}<div><b>${T('চালু আছে।')}</b> ${T('লগইনে পাসওয়ার্ডের পর ফোনের অথেনটিকেটর অ্যাপের কোড লাগে।')}</div></div>
          <button class="btn ghost" data-2faoff>${T('বন্ধ করুন')}</button>`
        : `<div class="note" style="margin:0 0 14px">${icon('alert', 20)}<div><b>${T('বন্ধ আছে।')}</b> ${T('চালু করলে কেউ পাসওয়ার্ড জেনে গেলেও আপনার ফোন ছাড়া ঢুকতে পারবে না।')}</div></div>
          <button class="btn" data-2faon>${icon('shield', 18)}${T('চালু করুন')}</button>`}</div></div>
      <form class="card" data-pw><h3>${T('পাসওয়ার্ড পরিবর্তন')}</h3><div class="cbody form">
        <label class="field"><span>${T('বর্তমান পাসওয়ার্ড')}</span><input type="password" name="current" required autocomplete="current-password"></label>
        <label class="field"><span>${T('নতুন পাসওয়ার্ড')}</span><input type="password" name="new" required minlength="8" autocomplete="new-password"><em>${T('কমপক্ষে ৮ অক্ষর')}</em></label>
        <em class="muted" style="font-size:13px">${T('পরিবর্তনের পর অন্য সব ডিভাইস থেকে লগআউট হয়ে যাবে।')}</em>
        <div><button class="btn">${icon('lock', 18)}${T('পরিবর্তন করুন')}</button></div></div></form></div></div>`);
    root.querySelector('[data-pw]').onsubmit = async e => { e.preventDefault(); await run(() => api('/admin/password', { current: e.target.current.value, new: e.target.new.value }), 'পাসওয়ার্ড পরিবর্তন হয়েছে'); e.target.reset(); };
  };
}
