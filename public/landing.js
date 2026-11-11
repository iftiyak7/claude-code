/* Landing page: the language switch and the search box. Everything else on the page is plain HTML filled in by the server. */
if (location.hash.startsWith('#/')) location.replace('/app/' + location.hash);   // old app links like /#/p/id
(() => {
  'use strict';
  const BN = '০১২৩৪৫৬৭৮৯';
  const saved = () => { try { return JSON.parse(localStorage.getItem('j360.lang')) || 'bn'; } catch { return 'bn'; } };
  const els = [...document.querySelectorAll('[data-en]')], nums = [...document.querySelectorAll('[data-num]')];
  els.forEach(el => { el._bn = el.innerHTML; });
  nums.forEach(el => { el._bn = el.textContent; });
  const title = document.title;
  const phs = [...document.querySelectorAll('[data-en-ph]')];
  phs.forEach(el => { el._bn = el.placeholder; });

  function show(lang) {
    const en = lang === 'en';
    document.documentElement.lang = lang;
    els.forEach(el => { el.innerHTML = en ? el.dataset.en : el._bn; });
    nums.forEach(el => { el.textContent = en ? el._bn.replace(/[০-৯]/g, d => BN.indexOf(d)) : el._bn; });
    phs.forEach(el => { el.placeholder = en ? el.dataset.enPh : el._bn; });
    document.title = en ? 'Jashore360 — hospitals, emergency numbers, house rent, mess and jobs in Jashore, in one free app' : title;
    const b = document.querySelector('[data-lang]');
    if (b) b.textContent = en ? 'বাংলা' : 'EN';
  }

  document.addEventListener('click', e => {
    if (!e.target.closest('[data-lang]')) return;
    const next = document.documentElement.lang === 'en' ? 'bn' : 'en';
    try { localStorage.setItem('j360.lang', JSON.stringify(next)); } catch {}     // the app opens in the same language
    show(next);
  });
  // the search box on the landing page opens the app's search with the words typed
  document.addEventListener('submit', e => {
    const f = e.target.closest('[data-search]');
    if (!f) return;
    e.preventDefault();
    const q = (f.elements.q.value || '').trim().slice(0, 100);
    location.href = q ? '/app/#/search?q=' + encodeURIComponent(q) : '/app/#/search';
  });
  if (saved() === 'en') show('en');
})();
