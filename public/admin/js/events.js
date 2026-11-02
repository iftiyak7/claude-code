/* Taps, forms and uploads for the whole panel. */
import { viewClassified } from './classifieds.js';
import { editCollection, modal, readFields, saveSetting } from './collections.js';
import { acheck, couponModal } from './coupons.js';
import { pages } from './dashboard.js';
import { demoIdFix, drawContacts, drawImgs, drawVids, fillSubs, readListing, slugify } from './listings.js';
import { refreshList, route } from './router.js';
import { renderLogin } from './shell.js';
import { S, T, api, applyTheme, esc, ls, num, root, run, toast, upload } from './util.js';

// Runs once at start-up, in the original order (main.js calls it after every module has loaded).
export function init() {
  /* ---------------- events ---------------- */
  document.addEventListener('click', async e => {
    const b = e.target.closest('button, [data-menu]'); if (!b) return;
    const d = b.dataset;
    if (d.setlang) { ls.set('lang', d.setlang); applyTheme(); return S.me ? route() : renderLogin(); }
    if (d.settheme) { ls.set('theme', d.settheme); applyTheme(); document.querySelectorAll('[data-settheme]').forEach(x => x.classList.toggle('on', x.dataset.settheme === d.settheme)); return; }
    if ('menu' in d) return root.querySelector('.shell').classList.toggle('open');
    if (d.metric) { pages.dashboard.metric = d.metric; return route(); }
    if ('logout' in d) { await api('/admin/logout', {}); S.me = null; return renderLogin(); }
    if (d.togglehide) {
      const l = S.listings.find(x => x.id === d.togglehide);
      await run(() => api('/admin/listings/' + l.id, { ...l, hidden: !l.hidden }, 'PUT'), l.hidden ? 'অ্যাপে দেখানো হচ্ছে' : 'লুকানো হয়েছে');
      await refreshList(); return route();
    }
    if (d.dellisting) {
      const l = S.listings.find(x => x.id === d.dellisting);
      if (!confirm(T('"{n}" এবং এর সব রিভিউ মুছে যাবে। নিশ্চিত?', { n: l?.name }))) return;
      await run(() => api('/admin/listings/' + d.dellisting, undefined, 'DELETE'), 'মুছে ফেলা হয়েছে');
      await refreshList(); if (location.hash.startsWith('#/listings/')) location.hash = '#/listings'; else route(); return;
    }
    if ('deldemo' in d) {
      const demo = S.listings.filter(l => l.demo);
      if (!confirm(T('{n}টি নমুনা তথ্য মুছে যাবে। নিশ্চিত?', { n: num(demo.length) }))) return;
      for (const l of demo) await api('/admin/listings/' + l.id, undefined, 'DELETE');
      toast(T('সব নমুনা তথ্য মুছে ফেলা হয়েছে')); await refreshList(); location.hash = '#/listings'; return;
    }
    if (d.approve || d.reject) {
      await run(() => api(`/admin/listings/${d.approve || d.reject}/review`, { review: d.approve ? 'approved' : 'rejected', verified: !!d.verified }), d.approve ? 'প্রকাশিত হয়েছে' : 'বাতিল করা হয়েছে');
      await refreshList(); return route();
    }
    if (d.paydecide) {
      const [id, decision, publish] = d.paydecide.split('|');
      if (decision === 'reject') {
        return modal(T('পেমেন্ট বাতিল'), `<label class="field"><span>${T('কারণ (ব্যবসায়ী দেখতে পাবেন)')}</span><textarea name="note" rows="3" placeholder="${T('যেমন: এই TrxID পাওয়া যায়নি')}"></textarea></label>`, async f => {
          await run(() => api('/admin/payments/' + id, { decision, note: f.note.value }), 'বাতিল করা হয়েছে'); await refreshList(); route();
        }, 'বাতিল করুন');
      }
      await run(() => api('/admin/payments/' + id, { decision, publish: publish === '1' }), publish === '1' ? 'যাচাই ও প্রকাশ হয়েছে' : 'যাচাই হয়েছে');
      await refreshList(); return route();
    }
    if (d.clreview) {
      const [id, review] = d.clreview.split('|'), days = (b.closest('.modal') || root).querySelector(`[data-cldays="${id}"]`)?.value || 30;
      await run(() => api(`/admin/classifieds/${id}/review`, { review, days }), review === 'approved' ? 'অনুমোদন হয়েছে' : 'বাতিল করা হয়েছে');
      document.querySelector('.modal-bg')?.remove(); return route();
    }
    if ('cpnew' in d) return couponModal(null);
    if (d.cpedit) return couponModal(S.coupons.find(c => c.id === d.cpedit));
    if (d.cpassign) return couponModal(S.coupons.find(c => c.id === d.cpassign), true);
    if (d.cpst) { const [id, status] = d.cpst.split('|'); await run(() => api('/admin/coupons/' + id, { status }, 'PUT'), 'আপডেট হয়েছে'); return route(); }
    if (d.cpdel) { if (!confirm(T('কুপন ও এর সব কোড মুছে যাবে। নিশ্চিত?'))) return; await run(() => api('/admin/coupons/' + d.cpdel, undefined, 'DELETE'), 'মুছে ফেলা হয়েছে'); return route(); }
    if (d.acredeem) return acheck(d.acredeem, true);
    if (d.clview) { const c = (S.cls || []).find(x => x.id === d.clview); return c && viewClassified(c); }
    if (d.cldel) { if (!confirm(T('মুছে ফেলবেন?'))) return; await run(() => api('/admin/classifieds/' + d.cldel, undefined, 'DELETE'), 'মুছে ফেলা হয়েছে'); return route(); }
    if (d.banuser) { const [id, v] = d.banuser.split('|'); if (v === '1' && !confirm(T('এই ব্যবহারকারী আর লগইন করতে পারবেন না। নিশ্চিত?'))) return;
      await run(() => api('/admin/users/' + id, { banned: v === '1' }, 'PUT'), 'আপডেট হয়েছে'); return route(); }
    if (d.resetuser) {
      if (!confirm(T('নতুন অস্থায়ী পাসওয়ার্ড তৈরি হবে। নিশ্চিত?'))) return;
      const r = await run(() => api(`/admin/users/${d.resetuser}/reset`, {}));
      return modal(T('নতুন পাসওয়ার্ড'), `<p>${T('ব্যবহারকারীকে এই পাসওয়ার্ড জানান। লগইনের পর তিনি সেটিংস থেকে বদলে নিতে পারবেন।')}</p><p class="bigpw">${esc(r.password)}</p>`, () => true, 'ঠিক আছে');
    }
    if (d.hiderv) {
      await run(() => api('/admin/reviews/' + d.hiderv, { hidden: d.h === '1' }, 'PUT'), d.h === '1' ? 'রিভিউ লুকানো হয়েছে' : 'রিভিউ দেখানো হচ্ছে');
      [S.reviews, S.reports] = await Promise.all([api('/admin/reviews'), api('/admin/reports')]); return route();
    }
    if (d.delrv) {
      if (!confirm(T('রিভিউটি স্থায়ীভাবে মুছে যাবে। নিশ্চিত?'))) return;
      await run(() => api('/admin/reviews/' + d.delrv, undefined, 'DELETE'), 'মুছে ফেলা হয়েছে');
      S.reviews = await api('/admin/reviews'); return route();
    }
    if (d.reply) {
      const r = S.reviews.find(x => x.id === d.reply);
      return modal(T('রিভিউয়ের উত্তর'), `<p class="muted" style="margin:0">"${esc(r.text || '')}"</p><label class="field"><span>${T('উত্তর')}</span><textarea name="reply" rows="4">${esc(r.reply || '')}</textarea><em>${T('অ্যাপে "Jashore360 টিম / প্রতিষ্ঠানের উত্তর" হিসেবে দেখাবে। খালি রাখলে উত্তর সরে যাবে।')}</em></label>`, async f => {
        await run(() => api('/admin/reviews/' + r.id, { reply: f.reply.value }, 'PUT'), 'উত্তর সংরক্ষণ হয়েছে'); S.reviews = await api('/admin/reviews'); route();
      });
    }
    if (d.resolve) { await run(() => api('/admin/reports/' + d.resolve, { done: d.d === '1' }, 'PUT')); S.reports = await api('/admin/reports'); return route(); }
    if (d.colnew) return editCollection(d.colnew);
    if (d.coledit) { const [k, i] = d.coledit.split('|'); return editCollection(k, +i); }
    if (d.coltoggle) { const [k, i] = d.coltoggle.split('|'); const next = S.settings[k].map((x, n) => n === +i ? { ...x, active: x.active === false } : x); await saveSetting(k, next); return route(); }
    if (d.coldel) {
      const [k, i] = d.coldel.split('|');
      if (!confirm(T('মুছে ফেলবেন?'))) return;
      try { await saveSetting(k, S.settings[k].filter((_, n) => n !== +i), 'মুছে ফেলা হয়েছে'); } catch { return; }
      return route();
    }
    if (d.colmove) {
      const [k, i, dir] = d.colmove.split('|'), arr = S.settings[k].slice(), j = +i + +dir;
      [arr[i], arr[j]] = [arr[j], arr[i]]; await saveSetting(k, arr, 'ক্রম বদলানো হয়েছে'); return route();
    }
    if (d.pickicon) { const box = b.closest('.field'); box.querySelector('input').value = d.pickicon; box.querySelectorAll('[data-pickicon]').forEach(x => x.classList.toggle('on', x === b)); return; }
    if ('clearimg' in d) { const box = b.closest('.imgupload'); box.querySelector('input[type=hidden]').value = ''; box.querySelector('.pv').style.backgroundImage = ''; box.closest('form')?.dispatchEvent(new Event('change')); return; }
    if ('genslug' in d) {
      const f = b.closest('form'), taken = new Set((S.listings || []).map(x => x.id).filter(x => x !== f.dataset.edit));
      f._slug.value = slugify({ nameEn: f.nameEn.value, cat: f.cat.value }, taken);
      if (!f.nameEn.value) toast(T('আগে "নাম (English)" লিখুন, তাহলে সুন্দর লিংক হবে'), true);
      return;
    }
    if ('fixdemoids' in d) {
      const list = demoIdFix(), taken = new Set(S.listings.map(x => x.id));
      if (!list.length || !confirm(T('{n}টি তালিকার লিংক থেকে "demo" সরানো হবে। পুরনো লিংকও কাজ করবে। চালিয়ে যাবেন?', { n: num(list.length) }))) return;
      for (const l of list) { const nid = slugify(l, taken); taken.add(nid); try { await api(`/admin/listings/${l.id}/rename`, { id: nid }); } catch (er) { toast(er.message, true); } }
      toast(T('লিংক ঠিক করা হয়েছে')); await refreshList(); return route();
    }
    if ('addcontact' in d) { const f = b.closest('form'); f._contacts.push({}); drawContacts(f); f.querySelector('.crow:last-child input')?.focus(); return; }
    if (d.delcontact != null) { const f = b.closest('form'); f._contacts.splice(+d.delcontact, 1); return drawContacts(f); }
    if (d.viddel != null) { const f = b.closest('form'); f._videos.splice(+d.viddel, 1); return drawVids(f); }
    if (d.imgdel != null) { const f = b.closest('form'); f._images.splice(+d.imgdel, 1); return drawImgs(f); }
    if (d.imgfirst != null) { const f = b.closest('form'); f._images.unshift(...f._images.splice(+d.imgfirst, 1)); return drawImgs(f); }
    if ('addadmin' in d) {
      return modal(T('নতুন অ্যাডমিন'), `<label class="field"><span>${T('ইউজারনেম')}</span><input name="username" required pattern="[a-z0-9_.\\-]{3,30}"><em>${T('ইংরেজি ছোট হাতের অক্ষর/সংখ্যা')}</em></label>
        <label class="field"><span>${T('পাসওয়ার্ড')}</span><input name="password" type="password" required minlength="8"></label>
        <label class="field"><span>${T('ভূমিকা')}</span><select name="role"><option value="moderator">${T('মডারেটর')}</option><option value="owner">${T('মূল অ্যাডমিন')}</option></select></label>`, async f => {
        await run(() => api('/admin/admins', { username: f.username.value, password: f.password.value, role: f.role.value }), 'অ্যাডমিন যোগ হয়েছে'); route();
      }, 'যোগ করুন');
    }
    if ('2faon' in d) {
      const st = await run(() => api('/admin/2fa/setup', {}));
      return modal(T('দুই ধাপের লগইন চালু করুন'), `<ol class="steps">
          <li>${T('ফোনে Google Authenticator বা Microsoft Authenticator অ্যাপ নামান।')}</li>
          <li>${T('অ্যাপে + চাপুন → "Enter a setup key" → নাম দিন Jashore360, আর নিচের কী-টি লিখুন:')}<p class="bigpw" style="letter-spacing:2px;font-size:17px">${esc(st.secret.match(/.{1,4}/g).join(' '))}</p>
            <small class="muted">${T('ফোনেই এই পেজ খোলা থাকলে')} <a href="${esc(st.uri)}">${T('এখানে চাপুন')}</a></small></li>
          <li>${T('অ্যাপে দেখানো ৬ সংখ্যার কোড আর আপনার পাসওয়ার্ড দিন।')}</li></ol>
        <label class="field"><span>${T('অ্যাপের কোড')}</span><input name="code" inputmode="numeric" maxlength="6" required autocomplete="one-time-code"></label>
        <label class="field"><span>${T('পাসওয়ার্ড')}</span><input name="password" type="password" required autocomplete="current-password"></label>`,
        async f => { await run(() => api('/admin/2fa', { enable: true, secret: st.secret, code: f.code.value, password: f.password.value }), '2FA চালু হয়েছে'); route(); }, 'চালু করুন');
    }
    if ('2faoff' in d) {
      return modal(T('2FA বন্ধ করুন'), `<p>${T('বন্ধ করলে শুধু পাসওয়ার্ড দিয়েই লগইন হবে।')}</p>
        <label class="field"><span>${T('অ্যাপের কোড')}</span><input name="code" inputmode="numeric" maxlength="6" required></label>
        <label class="field"><span>${T('পাসওয়ার্ড')}</span><input name="password" type="password" required autocomplete="current-password"></label>`,
        async f => { await run(() => api('/admin/2fa', { code: f.code.value, password: f.password.value }), '2FA বন্ধ হয়েছে'); route(); }, 'বন্ধ করুন');
    }
    if (d.deladmin) { if (!confirm(T('এই অ্যাডমিন মুছে যাবে। নিশ্চিত?'))) return; await run(() => api('/admin/admins/' + d.deladmin, undefined, 'DELETE'), 'মুছে ফেলা হয়েছে'); return route(); }
  });
  document.addEventListener('input', e => {
    const f = e.target.closest?.('[data-cf]') && e.target.closest('form');
    if (f && f._contacts) f._contacts[+e.target.closest('.crow').dataset.ci][e.target.dataset.cf] = e.target.value;
  });
  document.addEventListener('paste', e => {
    if (e.target.matches?.('[data-adminmaplink]')) setTimeout(() => e.target.dispatchEvent(new Event('change', { bubbles: true })), 30);
  });
  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.matches('[data-adminmaplink]') && el.value.trim()) {
      const f = el.closest('form'), hint = f.querySelector('[data-maphint]');
      hint.textContent = T('লিংক থেকে লোকেশন খোঁজা হচ্ছে…');
      try { const r = await api('/maplink', { url: el.value.trim() }); f.lat.value = r.lat; f.lng.value = r.lng; hint.textContent = '✓ ' + T('লোকেশন বসানো হয়েছে') + ` (${r.lat}, ${r.lng})`; }
      catch (er) { hint.textContent = er.message; }
      return;
    }
    if (el.closest('[data-filter]')) {
      const f = el.closest('form'), p = new URLSearchParams();
      ['q', 'cat', 'status', 'flag'].forEach(k => f.elements[k].value && p.set(k, f.elements[k].value));
      location.hash = '#/listings' + (p.toString() ? '?' + p : ''); return;
    }
    if (el.matches('[data-catsel]')) return fillSubs(el.form);
    if (el.matches('[data-imgup]')) {
      const f = el.closest('form');
      for (const file of [...el.files].slice(0, 10 - f._images.length)) {
        try { toast(T('ছবি আপলোড হচ্ছে…')); f._images.push(await upload(file)); drawImgs(f); } catch (er) { toast(er.message, true); }
      }
      toast(T('ছবি যোগ হয়েছে')); return;
    }
    if (el.matches('[data-single]')) {
      const box = el.closest('.imgupload');
      try { toast(T('ছবি আপলোড হচ্ছে…')); const url = await upload(el.files[0]); box.querySelector('input[type=hidden]').value = url; box.querySelector('.pv').style.backgroundImage = `url('${url}')`; toast(T('আপলোড হয়েছে'));
        box.closest('form')?.dispatchEvent(new Event('change')); }
      catch (er) { toast(er.message, true); }
    }
  });
  document.addEventListener('paste', e => {
    const el = e.target;
    if (!el.matches?.('[data-latlng]')) return;
    const m = (e.clipboardData.getData('text') || '').match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (m) { e.preventDefault(); el.value = m[1]; el.form.elements.lng.value = m[2]; toast(T('অবস্থান বসানো হয়েছে')); }
  });
  document.addEventListener('submit', async e => {
    const f = e.target;
    if (f.matches('[data-filter]')) { e.preventDefault(); f.querySelector('select').dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (f.matches('[data-userq]')) { e.preventDefault(); location.hash = '#/users?q=' + encodeURIComponent(f.q.value.trim()); return; }
    if (f.matches('[data-paysettings]')) {
      e.preventDefault();
      const F = [['bkash', 'text'], ['nagad', 'text'], ['rocket', 'text'], ['type', 'select'], ['note', 'textarea'], ['noteEn', 'textarea']];
      const v = readFields(f, F); ['bkash', 'nagad', 'rocket'].forEach(k => v[k] = (v[k] || '').replace(/[^\d]/g, ''));
      return saveSetting('payment', { ...S.settings.payment, ...v });
    }
    if (f.matches('[data-apk]')) {
      e.preventDefault();
      const file = f.file.files[0], btn = f.querySelector('button'), bar = f.querySelector('.progress');
      if (!file) return;
      btn.disabled = true; bar.hidden = false;
      const qs = new URLSearchParams({ versionName: f.versionName.value, versionCode: f.versionCode.value, notes: f.notes.value });
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/apk?' + qs);
      xhr.setRequestHeader('Content-Type', 'application/vnd.android.package-archive');
      xhr.upload.onprogress = ev => { bar.firstElementChild.style.width = (ev.loaded / ev.total * 100) + '%'; };
      xhr.onload = () => { btn.disabled = false; bar.hidden = true;
        const r = JSON.parse(xhr.responseText || '{}'); if (xhr.status === 200) { toast(T('নতুন ভার্সন প্রকাশিত হয়েছে')); S.settings.app = r; route(); } else toast(T(r.error || 'সমস্যা হয়েছে'), true); };
      xhr.onerror = () => { btn.disabled = false; bar.hidden = true; toast(T('আপলোড ব্যর্থ হয়েছে'), true); };
      xhr.send(file);
      return;
    }
    if (!f.matches('[data-edit]')) return;
    e.preventDefault();
    const id = f.dataset.edit, body = readListing(f), btn = e.submitter;
    if (btn?.name === 'approve') body._review = 'approved';
    if (btn) btn.disabled = true;
    try {
      if (id) await api('/admin/listings/' + id, body, 'PUT'); else await api('/admin/listings', body);
      const slug = f._slug?.value.trim().toLowerCase();
      if (id && slug && slug !== id) await api(`/admin/listings/${id}/rename`, { id: slug });
      toast(T('সংরক্ষণ হয়েছে')); await refreshList(); location.hash = '#/listings';
    } catch (er) { toast(er.message, true); if (btn) btn.disabled = false; }
  });
}
