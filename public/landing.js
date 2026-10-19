/* Landing page: language/theme switch, icons, and live numbers from /api/bootstrap. */
(() => {
  'use strict';
  const BN = '০১২৩৪৫৬৭৮৯';
  const get = (k, d) => { try { const v = localStorage.getItem('j360.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem('j360.' + k, JSON.stringify(v)); } catch {} };
  const lang = () => get('lang', 'bn');
  const T = s => lang() === 'en' ? (window.I18N_EN?.[s] ?? s) : s;
  const num = n => lang() === 'bn' ? String(n).replace(/\d/g, d => BN[d]) : String(n);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let D = null;

  document.querySelectorAll('[data-t]').forEach(el => { el.dataset.bn = el.textContent.trim(); });
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon, 22); });

  function applyTheme() {
    const t = get('theme', 'auto');
    t === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t);
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('[data-themebtn]').innerHTML = icon(dark ? 'sun' : 'moon', 18);
  }

  function render() {
    document.documentElement.lang = lang();
    document.querySelectorAll('[data-t]').forEach(el => { el.textContent = T(el.dataset.bn); });
    document.querySelector('[data-lang]').textContent = lang() === 'bn' ? 'EN' : 'বাং';
    document.title = 'Jashore360 — ' + T('যশোরের সবকিছু, এক অ্যাপে');
    document.querySelectorAll('[data-n]').forEach((el, i) => { el.textContent = num(i + 1); });
    document.querySelector('[data-year]').textContent = num(new Date().getFullYear());
    if (!D) return;
    const site = D.site || {}, loc = (o, f) => (lang() === 'en' && o?.[f + 'En']) || o?.[f] || '';
    const stats = { listings: D.listings.length, categories: D.categories.length, areas: (D.areas || []).length,
      classifieds: Object.values(D.classifiedCounts || {}).reduce((a, b) => a + b, 0) };
    document.querySelectorAll('[data-stat]').forEach(el => { el.textContent = num(stats[el.dataset.stat]); });
    const app = D.app || {};
    document.querySelectorAll('[data-apk]').forEach(a => a.setAttribute('aria-disabled', app.file ? 'false' : 'true'));
    document.querySelectorAll('[data-apkmeta]').forEach(el => {
      el.textContent = app.file ? `v${app.versionName} · ${app.size < 1048576 ? num(Math.max(1, Math.round(app.size / 1024))) + ' KB' : num((app.size / 1048576).toFixed(1)) + ' MB'} · ${T('আপডেট')} ${new Date(app.updated).toLocaleDateString(lang() === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : T('শীঘ্রই আসছে');
    });
    const notes = document.querySelector('[data-apknotes]');
    notes.hidden = !app.notes; notes.textContent = app.notes ? `${T('এই ভার্সনে নতুন')}: ${app.notes}` : '';
    document.querySelector('[data-plans]').innerHTML = (D.plans || []).map(p => `<div class="plan ${p.featured ? 'featured' : ''}">${p.featured ? `<span class="tag">${esc(T('জনপ্রিয়'))}</span>` : ''}
      <h3>${esc(lang() === 'en' ? p.en || p.bn : p.bn)}</h3><div class="price">৳${num(Number(p.price).toLocaleString('en-IN'))}</div><div class="per">${esc(T('{n} দিন').replace('{n}', num(p.days)))}</div>
      <ul>${(lang() === 'en' && p.perksEn ? p.perksEn : p.perks || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('');
    const disc = loc(site, 'disclaimer'); if (disc) document.querySelector('[data-disclaimer]').textContent = disc;
    document.querySelector('[data-contact]').innerHTML = [site.contactPhone && `<a href="tel:${esc(site.contactPhone)}">${esc(num(site.contactPhone))}</a>`,
      site.contactEmail && `<a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a>`, site.facebook && `<a href="${esc(site.facebook)}" rel="noopener">Facebook</a>`].filter(Boolean).join(' · ');
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-lang]')) { set('lang', lang() === 'bn' ? 'en' : 'bn'); render(); }
    if (e.target.closest('[data-themebtn]')) {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
      set('theme', dark ? 'light' : 'dark'); applyTheme();
    }
  });

  applyTheme(); render();
  fetch('/api/bootstrap', { credentials: 'same-origin' }).then(r => r.json()).then(d => { D = d; render(); }).catch(() => {});
})();
