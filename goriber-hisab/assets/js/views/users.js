/**
 * Users (members, roles, per-user permission overrides) and branches.
 */
import { h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { can, state, emit } from '../core/state.js';
import { t } from '../core/i18n.js';
import { datetime } from '../core/format.js';
import { page, card, field, input, select, textarea, modal, toast, showError, showFieldErrors, values, badge, confirmDialog, simpleTable, empty, spinner } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { workersCard } from '../core/workers.js';

export default async function users(el) {
  if (location.hash.startsWith('#/branches')) return branches(el);
  if (!can('users.manage')) { mount(el, empty(t('You do not have access to user management.'))); return; }
  const [members, meta] = await Promise.all([api.get('members'), api.get('roles')]);
  const reload = () => users(el);
  const p = page(t('Users & permissions'), {
    subtitle: t('Give your staff their own login. Choose what each person can see and do — for example a cashier who can only sell.'),
    actions: [h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => memberForm(null, meta, reload) }, icon('plus', 16), t('Add user'))],
  });
  p.body.append(card(null, simpleTable([
    { label: t('Name'), render: (m) => h('span', {}, h('strong', {}, m.name), h('small', { class: 'muted' }, ` ${m.email}`)) },
    { label: t('Role'), render: (m) => t(meta.roles[m.role]?.label || m.role) },
    { label: t('Overrides'), render: (m) => [m.grants.length ? `+${m.grants.length}` : '', m.denies.length ? `−${m.denies.length}` : ''].filter(Boolean).join(' ') || '—' },
    { label: t('Status'), render: (m) => badge(m.status) },
    { label: t('Last seen'), render: (m) => (m.last_seen_at ? datetime(m.last_seen_at) : '—') },
    { label: '', render: (m) => h('button', { class: 'btn btn-sm', type: 'button', onclick: () => memberForm(m, meta, reload) }, t('Manage')) },
  ], members)),
  workersCard('seller'),
  card(t('Roles'), h('ul', { class: 'list' }, Object.entries(meta.roles).map(([key, r]) => h('li', {}, h('span', {}, h('strong', {}, t(r.label))), h('small', { class: 'muted' }, t('{n} permissions', { n: key === 'owner' ? t('all') : r.permissions.length })))))));
  mount(el, p.el);
}

function memberForm(member, meta, onDone) {
  const roleSel = select('role', Object.entries(meta.roles).filter(([k]) => k !== 'owner' || state.ctx.role === 'owner').map(([k, r]) => [k, t(r.label)]), member?.role || 'sales');
  const grants = new Set(member?.grants || []);
  const denies = new Set(member?.denies || []);
  const matrix = h('div', { class: 'perm-matrix' });
  const branchesSel = (state.ctx.branches || []).length > 1
    ? h('select', { class: 'input', name: 'branch_ids', multiple: true, size: Math.min(5, state.ctx.branches.length) }, state.ctx.branches.map((b) => h('option', { value: b.id, selected: (member?.branch_ids || []).includes(Number(b.id)) }, b.name)))
    : null;

  const paint = () => {
    const role = meta.roles[roleSel.value];
    const base = new Set(roleSel.value === 'owner' ? Object.values(meta.permissions).flatMap(Object.keys) : role.permissions);
    mount(matrix, Object.entries(meta.permissions).map(([group, perms]) => h('fieldset', {},
      h('legend', {}, t(group.charAt(0).toUpperCase() + group.slice(1))),
      Object.entries(perms).map(([perm, label]) => {
        const effective = roleSel.value === 'owner' || ((base.has(perm) || grants.has(perm)) && !denies.has(perm));
        const box = h('input', { type: 'checkbox', checked: effective, disabled: roleSel.value === 'owner' || perm === 'business.manage' });
        box.addEventListener('change', () => {
          grants.delete(perm); denies.delete(perm);
          if (box.checked && !base.has(perm)) grants.add(perm);
          if (!box.checked && base.has(perm)) denies.add(perm);
          paint();
        });
        const changed = grants.has(perm) || denies.has(perm);
        return h('label', { class: `check ${changed ? 'changed' : ''}` }, box, h('span', {}, t(label)));
      }))));
  };
  roleSel.addEventListener('change', () => { grants.clear(); denies.clear(); paint(); });

  const f = h('form', { class: 'form' },
    !member ? h('div', { class: 'form-grid' },
      field(t('Email'), input('email', '', { type: 'email', required: true, autofocus: true }), { required: true, hint: t('Existing WordPress users are linked; new people get an email to set their password.') }),
      field(t('Name'), input('name', ''), { hint: t('Needed for new people') }),
      field(t('Password'), input('password', '', { type: 'text', autocomplete: 'new-password', minlength: 8 }), { hint: t('Set a password and give it to your staff — they log in with email + password. Leave empty to send them an email instead.') })) : h('div', {},
      h('div', { class: 'form-grid' },
        field(t('Name'), input('name', member.name, { required: true })),
        field(t('Email'), input('email', member.email, { type: 'email', required: true }), { hint: t('They log in with this email.') }),
        field(t('Phone'), input('phone', member.phone || '', { type: 'tel', inputmode: 'tel', placeholder: '01XXXXXXXXX' })),
        member.user_id !== state.me.user.id ? field(t('New password'), input('password', '', { type: 'text', autocomplete: 'new-password', minlength: 8 }), { hint: t('Only if they forgot it. Leave empty to keep the current password.') }) : null)),
    h('div', { class: 'form-grid' },
      field(t('Role'), roleSel),
      branchesSel ? field(t('Branches (none = all)'), branchesSel) : null,
      member ? field(t('Status'), select('status', [['active', t('Active')], ['suspended', t('Suspended')]], member.status)) : null),
    h('h4', {}, t('Permissions')),
    h('p', { class: 'muted small' }, t('Start from the role, then tick or untick individual permissions for this person.')),
    matrix);
  paint();

  const m = modal({
    title: member ? t('Manage user') : t('Add user'),
    size: 'lg',
    body: f,
    actions: [
      member && member.user_id !== state.me.user.id ? h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => {
        if (!(await confirmDialog(t('Remove {n} from this business?', { n: member.name }), { danger: true, confirmText: t('Remove') }))) return;
        try { await api.del(`members/${member.id}`); m.close(); toast(t('Removed')); onDone(); } catch (err) { showError(err); }
      } }, t('Remove')) : null,
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        const v = values(f);
        const body = { ...v, grants: [...grants], denies: [...denies], branch_ids: branchesSel ? [...branchesSel.selectedOptions].map((o) => Number(o.value)) : [] };
        try {
          if (member) await api.put(`members/${member.id}`, body); else await api.post('members', body);
          m.close(); toast(t('Saved')); onDone();
        } catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
      } }, t('Save')),
    ],
  });
}

async function branches(el) {
  if (!can('branches.manage')) { mount(el, empty(t('You do not have access to branches.'))); return; }
  const list = await api.get('branches');
  const reload = async () => { emit('session:reload', { go: '/branches' }); };
  const p = page(t('Branches'), {
    subtitle: t('Each branch keeps its own stock, cash and sales; reports can combine them.'),
    actions: [h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => branchForm(null, reload) }, icon('plus', 16), t('Add branch'))],
  });
  p.body.append(card(null, simpleTable([
    { label: t('Name'), render: (b) => h('span', {}, h('strong', {}, b.name), Number(b.is_default) ? h('small', { class: 'muted' }, ` (${t('main')})`) : null) },
    { label: t('Code'), key: 'code' },
    { label: t('Phone'), key: 'phone' },
    { label: t('Status'), render: (b) => badge(b.status) },
    { label: '', render: (b) => h('button', { class: 'btn btn-sm', type: 'button', onclick: () => branchForm(b, reload) }, t('Edit')) },
  ], list)));
  mount(el, p.el);
}

/** Last step before deleting: type the exact name. Resolves true when it matches. */
function typeToConfirm(name) {
  return new Promise((resolve) => {
    const inp = input('confirm_name', '', { autocomplete: 'off', placeholder: name });
    const go = h('button', { class: 'btn btn-danger', type: 'button', disabled: true }, icon('trash', 16), t('Delete'));
    inp.addEventListener('input', () => { go.disabled = inp.value.trim() !== String(name).trim(); });
    let ok = false;
    const m = modal({
      title: t('Type the name to delete'), size: 'sm',
      body: h('div', { class: 'form' }, h('p', {}, t('To confirm, type: {n}', { n: '' }), h('strong', {}, name)), inp),
      onClose: () => resolve(ok),
      actions: [go],
    });
    go.addEventListener('click', () => { ok = true; m.close(); });
    setTimeout(() => inp.focus(), 50);
  });
}

function branchForm(b, onDone) {
  const f = h('form', { class: 'form' }, h('div', { class: 'form-grid' },
    field(t('Name'), input('name', b?.name, { required: true }), { required: true }),
    field(t('Code'), input('code', b?.code)),
    field(t('Phone'), input('phone', b?.phone)),
    field(t('Email'), input('email', b?.email, { type: 'email' })),
    field(t('Address'), textarea('address', b?.address, { rows: 2 }), { wide: true }),
    b ? field(t('Status'), select('status', [['active', t('Active')], ['inactive', t('Inactive')]], b.status)) : null));
  const m = modal({
    title: b ? t('Edit branch') : t('Add branch'), body: f,
    actions: [
      b ? h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => {
        // Three separate checks so a stray tap never deletes a branch.
        if (!(await confirmDialog(t('Delete the branch {n}?', { n: b.name }), { danger: true, confirmText: t('Yes, continue') }))) return;
        if (!(await confirmDialog(Number(b.is_default)
          ? t('{n} is the main branch. Another active branch will become the main branch. A branch with sales, purchases or stock movements cannot be deleted — deactivate it instead. Continue?', { n: b.name })
          : t('The branch, its address and settings will be removed. A branch with sales, purchases or stock movements cannot be deleted — deactivate it instead. Continue?'), { danger: true, title: t('Last warning'), confirmText: t('Continue') }))) return;
        if (!(await typeToConfirm(b.name))) return;
        try { await api.del(`branches/${b.id}`); m.close(); toast(t('Branch deleted')); onDone(); } catch (err) { showError(err); }
      } }, icon('trash', 16), t('Delete')) : null,
      b && !Number(b.is_default) ? h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!(await confirmDialog(t('Make {n} the main branch?', { n: b.name }), { confirmText: t('Yes, continue') }))) return;
        if (!(await confirmDialog(t('New staff, reports and the POS will start in {n} by default. Your records do not change. Make it the main branch?', { n: b.name }), { title: t('Please confirm'), confirmText: t('Make main branch') }))) return;
        try { await api.post(`branches/${b.id}/main`); m.close(); toast(t('{n} is now the main branch', { n: b.name })); onDone(); } catch (err) { showError(err); }
      } }, t('Make main branch')) : null,
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        try { if (b) await api.put(`branches/${b.id}`, values(f)); else await api.post('branches', values(f)); m.close(); toast(t('Saved')); onDone(); }
        catch (err) { showFieldErrors(f, err.errors || {}); showError(err); }
      } }, t('Save')),
    ],
  });
  void spinner;
}
