/* Dashboard: to-do counts, notes, the 30-day chart. */
import { empty, load } from './data.js';
import { shell } from './shell.js';
import { AUDIT } from './system.js';
import { S, T, api, compact, date, day, esc, locale, money, num, root } from './util.js';

/* ---------------- dashboard ---------------- */
export const pages = {};
const METRICS = [['views', 'প্রোফাইল ভিউ'], ['calls', 'কল বাটনে চাপ'], ['signups', 'নতুন অ্যাকাউন্ট'], ['reviews', 'নতুন রিভিউ'], ['submissions', 'নতুন জমা'], ['downloads', 'অ্যাপ ডাউনলোড']];
/* Column chart: one series, 30 days. Thin columns with a 2px gap, rounded data-end, hairline grid, hover/focus tooltip. */
function drawChart(box, days, vals) {
  const W = Math.max(280, box.clientWidth), H = 240, L = 40, R = 8, Tp = 22, B = 28;
  const pw = W - L - R, ph = H - Tp - B, band = pw / vals.length, bw = Math.min(24, band - 2);
  const max = Math.max(...vals, 0);
  const step = (() => { const raw = Math.max(1, max) / 4, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return Math.max(1, (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p); })();   // counts: whole-number ticks
  const top = step * 4, y = v => Tp + ph - v / top * ph;
  const peak = vals.indexOf(max);
  let svg = `<svg width="${W}" height="${H}" role="img" aria-label="${esc(T('গত ৩০ দিনের পরিসংখ্যান'))}">`;
  for (let i = 0; i <= 4; i++) { const v = step * i, yy = Math.round(y(v)) + .5;
    svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L - 8}" y="${yy + 4}" class="tick" text-anchor="end">${compact(v)}</text>`; }
  vals.forEach((v, i) => {
    const x = L + i * band + (band - bw) / 2, h = Math.max(0, y(0) - y(v)), r = Math.min(4, h, bw / 2), y0 = y(0);
    if (h > 0) svg += `<path class="bar" d="M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + bw - r} Q${x + bw},${y0 - h} ${x + bw},${y0 - h + r} V${y0} Z"/>`;
    svg += `<rect class="hit" x="${L + i * band}" y="${Tp}" width="${band}" height="${ph}" tabindex="0" data-i="${i}"/>`;
    if (i % 5 === 4 || i === vals.length - 1) svg += `<text x="${L + i * band + band / 2}" y="${H - 8}" class="tick" text-anchor="middle">${esc(new Date(days[i]).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }))}</text>`;
  });
  if (max > 0) svg += `<text x="${L + peak * band + band / 2}" y="${y(max) - 6}" class="peak" text-anchor="middle">${compact(max)}</text>`;
  svg += '</svg><div class="tip" hidden><b></b><span></span></div>';
  box.innerHTML = svg;
  const tip = box.querySelector('.tip');
  const show = el => {
    const i = +el.dataset.i;
    box.querySelectorAll('.hit').forEach(h => h.classList.toggle('on', h === el));
    tip.querySelector('b').textContent = num(vals[i]);
    tip.querySelector('span').textContent = new Date(days[i]).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
    tip.hidden = false;
    const x = L + i * band + band / 2;
    tip.style.left = Math.min(W - tip.offsetWidth - 4, Math.max(4, x - tip.offsetWidth / 2)) + 'px';
    tip.style.top = Math.max(0, y(vals[i]) - tip.offsetHeight - 10) + 'px';
  };
  box.querySelectorAll('.hit').forEach(h => { h.addEventListener('pointerenter', () => show(h)); h.addEventListener('focus', () => show(h)); });
  box.addEventListener('pointerleave', () => { tip.hidden = true; box.querySelectorAll('.hit.on').forEach(h => h.classList.remove('on')); });
}

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  pages.dashboard = async () => {
    const s = await api('/admin/summary');
    S.counts = s; await load();
    const metric = pages.dashboard.metric || 'views';
    const hr = new Date().getHours();
    const greet = T(hr < 12 ? 'শুভ সকাল' : hr < 17 ? 'শুভ দুপুর' : 'শুভ সন্ধ্যা');
    const todo = [['submissions', 'inbox', '#f2711c', s.pending, 'নতুন জমা অনুমোদনের অপেক্ষায়'], ['payments', 'wallet', '#7c5cff', s.payments, 'পেমেন্ট যাচাইয়ের অপেক্ষায়'],
      ['classifieds', 'megaphone', '#0f9fa8', s.classifiedsPending, 'চাকরি/ভাড়ার বিজ্ঞাপন অপেক্ষায়'], ['reports', 'flag', '#e5484d', s.reports, 'খোলা রিপোর্ট']];
    const tiles = [['list', s.listings, 'প্রকাশিত তালিকা', T('{n}টি যাচাইকৃত', { n: num(s.verified) })], ['users', s.users, 'ব্যবহারকারী', ''],
      ['msg', s.reviews, 'মোট রিভিউ', T('এই সপ্তাহে {n}টি', { n: num(s.reviewsWeek) })], ['megaphone', s.classifiedsLive, 'চলমান বিজ্ঞাপন', ''],
      ['eye', s.views, 'মোট ভিউ', ''], ['phone', s.calls, 'মোট কল', '']];
    // Phones whose installed app still opens an old address (see "jashore360.cloud → .com" in the README)
    const old = s.series.oldapp || [], oldToday = old[old.length - 1] || 0, oldPeak = Math.max(0, ...old.slice(-7)), oldEver = old.some(n => n);
    const oldNote = !oldEver ? '' : old.slice(-14).some(n => n)
      ? `<div class="note">${icon('alert', 20)}<div><b>${T('পুরনো ঠিকানায় এখনো অ্যাপ চলছে: আজ {a}টি ফোন, গত ৭ দিনে এক দিনে সর্বোচ্চ {b}টি।', { a: num(oldToday), b: num(oldPeak) })}</b> ${T('এরা অ্যাপ খুললেই আপডেট করতে বলা হচ্ছে। সংখ্যাটা টানা ১৪ দিন ০ থাকলে পুরনো ঠিকানা মুছে ফেলা নিরাপদ।')}</div></div>`
      : `<div class="note info">${icon('check', 20)}<div><b>${T('গত ১৪ দিনে পুরনো ঠিকানায় কোনো অ্যাপ আসেনি।')}</b> ${T('এখন পুরনো ঠিকানা মুছে ফেলা নিরাপদ।')}</div></div>`;
    shell('dashboard', T('ড্যাশবোর্ড'), `<a class="btn" href="#/listings/new">${icon('plus', 18)}<span class="hide-sm">${T('নতুন তালিকা')}</span></a>`, `
      <section class="hello"><div><small>${esc(new Date().toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }))}</small>
        <h2>${greet}, ${esc(S.me.username)}</h2><p>${T('আজ আপনার জন্য যা অপেক্ষা করছে')}</p></div>
        <div class="revenue"><small>${T('এই মাসের আয়')}</small><b>${money(s.revenueMonth)}</b><span>${T('মোট আয়')}: ${money(s.revenueTotal)}</span></div></section>
      <div class="todo">${todo.map(([to, ic, c, n, t]) => `<a href="#/${to}" class="card ${n ? 'hot' : ''}" style="--c:${c}"><span class="ib">${icon(ic, 22)}</span>
        <div><b>${num(n)}</b><small>${T(t)}</small></div>${icon('chevR', 18)}</a>`).join('')}</div>
      ${s.demo ? `<div class="note">${icon('alert', 20)}<div><b>${T('{n}টি নমুনা তথ্য প্রকাশিত আছে।', { n: num(s.demo) })}</b> ${T('লঞ্চের আগে আসল তথ্য যোগ করে নমুনাগুলো মুছে ফেলুন।')}</div><a class="btn sm dark" href="#/listings?flag=demo">${T('দেখুন')}</a></div>` : ''}
      ${oldNote}
      <div class="kpis">${tiles.map(([ic, v, t, sub]) => `<div class="card kpi"><span class="ib">${icon(ic, 20)}</span><div><b>${compact(v)}</b><small>${T(t)}</small>${sub ? `<em>${sub}</em>` : ''}</div></div>`).join('')}</div>
      <div class="card chartcard"><div class="chead"><div><b>${T(METRICS.find(m => m[0] === metric)[1])}</b><small class="muted"> · ${T('গত ৩০ দিন')}</small></div>
        <div class="tabs" style="margin:0">${METRICS.map(([k, t]) => `<button class="${k === metric ? 'on' : ''}" data-metric="${k}">${T(t)}</button>`).join('')}</div></div>
        <div class="cbody"><div class="chart" data-chart></div>
        <details class="tableview"><summary>${T('টেবিল হিসেবে দেখুন')}</summary><div class="tablewrap"><table class="t"><thead><tr><th>${T('তারিখ')}</th><th>${T('সংখ্যা')}</th></tr></thead><tbody>
          ${s.days.map((d, i) => `<tr><td>${esc(day(d))}</td><td>${num(s.series[metric][i])}</td></tr>`).reverse().join('')}</tbody></table></div></details></div></div>
      <div class="two" style="margin-top:16px">
        <div class="card"><h3>${T('সবচেয়ে বেশি দেখা তালিকা')}</h3>${s.top.some(t => t.views) ? `<table class="t"><thead><tr><th>${T('নাম')}</th><th>${T('ভিউ')}</th><th>${T('কল')}</th><th>${T('ম্যাপ')}</th></tr></thead><tbody>
          ${s.top.filter(t => t.views).map(t => `<tr><td><a href="#/listings/${t.id}"><b>${esc(t.name)}</b></a></td><td>${num(t.views)}</td><td>${num(t.calls)}</td><td>${num(t.maps)}</td></tr>`).join('')}</tbody></table>` : empty(T('এখনো কোনো ভিউ নেই'))}</div>
        <div class="card"><h3>${T('সাম্প্রতিক কার্যক্রম')}</h3>${s.audit.length ? s.audit.map(a => `<div class="item"><span class="dotmark"></span><div class="body"><b>${esc(T(AUDIT[a.action] || a.action))}</b><small>${esc(a.admin)}${a.target ? ' · ' + esc(a.target) : ''} · ${date(a.at)}</small></div></div>`).join('') : empty(T('কোনো কার্যক্রম নেই'))}</div>
      </div>`);
    drawChart(root.querySelector('[data-chart]'), s.days, s.series[metric]);
  };
}
