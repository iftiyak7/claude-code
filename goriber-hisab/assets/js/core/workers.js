/**
 * Staff without a login: salespeople (picked at the POS) and the shop's own
 * delivery men (local delivery). Shared by Users, Orders and the POS.
 */
import { h, mount } from './dom.js';
import { api } from './api.js';
import { t } from './i18n.js';
import { money } from './format.js';
import { card, field, input, money_input, modal, toast, showError, showFieldErrors, values, confirmDialog, empty, badge } from './ui.js';
import { icon } from './icons.js';

const LABEL = {
  seller: { one: 'Salesperson', add: 'Add salesperson', title: 'Salespeople (no login needed)', hint: 'For staff who share the shop\'s phone or computer: they pick their name at the POS on every sale, so you can see who sold what. They cannot open the app themselves.', none: 'No salespeople yet.' },
  rider: { one: 'Delivery man', add: 'Add delivery man', title: 'Your delivery men', hint: 'People who deliver orders themselves (local delivery). Their charge per parcel is recorded as a delivery expense when you take the cash from them.', none: 'No delivery men yet.' },
};

/** Add / edit one person. Resolves with the saved person (or null). */
export function workerForm(role, w = null) {
  return new Promise((resolve) => {
    const L = LABEL[role];
    const f = h('form', { class: 'form' },
      field(t('Name'), input('name', w?.name || '', { required: true, autofocus: true }), { required: true }),
      field(t('Mobile'), input('phone', w?.phone || '', { type: 'tel', placeholder: '01XXXXXXXXX' })),
      role === 'rider' ? field(t('Charge per delivery'), money_input('fee', w ? w.fee : ''), { hint: t('Leave empty if paid a salary.') }) : null,
      w ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'inactive', checked: w.status === 'inactive' }), h('span', {}, t('Not working here now (hide from lists)'))) : null);
    let done = false;
    const m = modal({
      title: w ? w.name : t(L.add), size: 'sm', body: f,
      onClose: () => { if (!done) resolve(null); },
      actions: [
        w ? h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => {
          if (!(await confirmDialog(t('Remove {n}? Past sales and orders keep the name.', { n: w.name }), { danger: true, confirmText: t('Remove') }))) return;
          try { await api.del(`workers/${w.id}`); done = true; m.close(); toast(t('Removed')); resolve({ ...w, removed: true }); } catch (err) { showError(err); }
        } }, t('Remove')) : null,
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
          const v = values(f);
          const body = { role, name: v.name, phone: v.phone, fee: v.fee || '0', status: v.inactive ? 'inactive' : 'active' };
          try {
            const saved = w ? await api.put(`workers/${w.id}`, body) : await api.post('workers', body);
            done = true; m.close(); toast(t('Saved')); resolve(saved);
          } catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
        } }, t('Save')),
      ],
    });
    f.addEventListener('submit', (e) => e.preventDefault());
  });
}

/** A card listing salespeople or delivery men with add / edit. */
export function workersCard(role) {
  const L = LABEL[role];
  const list = h('div');
  const paint = async () => {
    const items = await api.get('workers', { role, all: 1 });
    mount(list, items.length ? h('ul', { class: 'list' }, items.map((w) => h('li', {},
      h('span', { class: 'grow' }, h('strong', {}, w.name), w.phone ? h('small', { class: 'muted' }, ` · ${w.phone}`) : null,
        role === 'rider' && Number(w.fee) ? h('small', { class: 'muted' }, ` · ${t('{x} per delivery', { x: money(w.fee) })}`) : null,
        w.status === 'inactive' ? [' ', badge('void', t('Inactive'))] : null),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { if (await workerForm(role, w)) paint(); } }, t('Edit'))))) : empty(t(L.none)));
  };
  paint().catch((err) => mount(list, empty(err.message)));
  return card(t(L.title),
    h('p', { class: 'muted small' }, t(L.hint)),
    list,
    h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { if (await workerForm(role)) paint(); } }, icon('plus', 14), t(L.add)));
}
