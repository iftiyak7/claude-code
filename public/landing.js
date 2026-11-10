/* Landing page: the language switch. Everything else on the page is plain HTML filled in by the server. */
if (location.hash.startsWith('#/')) location.replace('/app/' + location.hash);   // old app links like /#/p/id
(() => {
  'use strict';
  const BN = '০১২৩৪৫৬৭৮৯';
  const saved = () => { try { return JSON.parse(localStorage.getItem('j360.lang')) || 'bn'; } catch { return 'bn'; } };
  const els = [...document.querySelectorAll('[data-en]')], nums = [...document.querySelectorAll('[data-num]')];
  els.forEach(el => { el._bn = el.innerHTML; });
  nums.forEach(el => { el._bn = el.textContent; });
  const title = document.title;

  function show(lang) {
    const en = lang === 'en';
    document.documentElement.lang = lang;
    els.forEach(el => { el.innerHTML = en ? el.dataset.en : el._bn; });
    nums.forEach(el => { el.textContent = en ? el._bn.replace(/[০-৯]/g, d => BN.indexOf(d)) : el._bn; });
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
  if (saved() === 'en') show('en');
})();
