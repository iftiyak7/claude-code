"""Coupons and offers: claiming, owner offers, checking and redeeming codes."""
import re
import time
from .cache import bump
from .records import coupon_live, coupon_out, coupon_rows, listing_names, new_claim
from .security import rate_ok
from .store import db, resolve_lid
from .util import ApiError, BN_DIGITS, new_id, s, to_int
from .web import route


def clean_coupon(b):
    title = s(b.get('title'), 120)
    if not title:
        raise ApiError(400, 'অফারের শিরোনাম দিন (যেমন: ২০% ছাড়)')
    dates = {}
    for k in ('starts', 'ends'):
        v = str(b.get(k) or '')
        dates[k] = v if re.match(r'^\d{4}-\d\d-\d\d$', v) else None
    if dates['starts'] and dates['ends'] and dates['ends'] < dates['starts']:
        raise ApiError(400, 'শেষের তারিখ শুরুর আগে হতে পারে না')
    mx = to_int(b.get('maxClaims'))
    return {'title': title, 'details': s(b.get('details'), 600), 'starts': dates['starts'], 'ends': dates['ends'],
            'max_claims': mx if mx and mx > 0 else None, 'audience': 'private' if b.get('audience') == 'private' else 'public'}


@route('GET', r'/listings/([\w-]+)/coupons')
def api_listing_coupons(h, lid):
    me = h.user()
    with db() as c:
        lid = resolve_lid(c, lid)
        rows = [cp for cp in c.execute("SELECT * FROM coupons WHERE listing_id=? AND audience='public'", (lid,)) if coupon_live(cp)]
        out = []
        for cp in rows:
            d = coupon_out(c, cp)
            d['full'] = bool(cp['max_claims'] and d['claims'] >= cp['max_claims'])
            out.append({k: d[k] for k in ('id', 'title', 'details', 'starts', 'ends', 'full', 'claims')})
        mine = [{'code': r['code'], 'coupon': r['coupon_id'], 'title': r['title'], 'details': r['details'], 'ends': r['ends'], 'used': bool(r['used_at'])}
                for r in coupon_rows(c, 'cl.user_id=? AND cp.listing_id=?', (me['id'], lid), live=True)] if me else []
    h.json({'coupons': out, 'mine': mine})


@route('GET', '/coupons')
def api_coupons(h):
    with db() as c:
        names = listing_names(c)
        live_ids = {r['id'] for r in c.execute("SELECT id FROM listings WHERE review='approved'")}
        out = [coupon_out(c, cp, names) for cp in c.execute("SELECT * FROM coupons WHERE audience='public' ORDER BY created_at DESC")
               if coupon_live(cp) and cp['listing_id'] in live_ids]
    h.json([{k: d[k] for k in ('id', 'listing', 'listingName', 'title', 'details', 'ends', 'claims', 'maxClaims')} for d in out])


@route('POST', r'/coupons/(\w+)/claim', auth='user')
def api_claim(h, cid):
    if not rate_ok('claim:%d' % h.me['id'], 30, 86400):
        raise ApiError(429, 'আজ অনেক কুপন নেওয়া হয়েছে, পরে চেষ্টা করুন')
    with db() as c:
        cp = c.execute('SELECT * FROM coupons WHERE id=?', (cid,)).fetchone()
        if not cp or cp['audience'] != 'public' or not coupon_live(cp):
            raise ApiError(404, 'কুপনটি এখন পাওয়া যাচ্ছে না')
        have = c.execute('SELECT code FROM claims WHERE coupon_id=? AND user_id=?', (cid, h.me['id'])).fetchone()
        if have:
            return h.json({'code': have[0]})
        if cp['max_claims'] and c.execute('SELECT COUNT(*) FROM claims WHERE coupon_id=?', (cid,)).fetchone()[0] >= cp['max_claims']:
            raise ApiError(409, 'দুঃখিত, এই কুপন শেষ হয়ে গেছে')
        code = new_claim(c, cid, h.me['id'])
    h.json({'code': code})


@route('GET', '/my/coupons', auth='user')
def my_coupons(h):
    uid = h.me['id']
    with db() as c:
        names = listing_names(c)
        mine = [{'code': r['code'], 'coupon': r['coupon_id'], 'listing': r['listing_id'], 'listingName': names.get(r['listing_id']), 'title': r['title'],
                 'details': r['details'], 'ends': r['ends'], 'used': bool(r['used_at']), 'usedAt': r['used_at'], 'live': coupon_live(r)}
                for r in coupon_rows(c, 'cl.user_id=?', (uid,))]
        own = [r['id'] for r in c.execute('SELECT id FROM listings WHERE owner_id=?', (uid,))]
        biz = [coupon_out(c, cp, names) for cp in c.execute('SELECT * FROM coupons WHERE listing_id IN (%s) ORDER BY created_at DESC' % ','.join('?' * len(own)), own)] if own else []
    h.json({'mine': mine, 'business': biz, 'listings': [{'id': i, 'name': names.get(i)} for i in own]})


@route('POST', '/my/coupons', auth='user')
def my_add_coupon(h):
    """A business owner offers a coupon on their own listing; it goes live after the admin approves it."""
    b = h.body()
    if not rate_ok('mkcp:%d' % h.me['id'], 10, 86400):
        raise ApiError(429, 'আজ অনেক কুপন তৈরি হয়েছে, পরে চেষ্টা করুন')
    cp = clean_coupon(dict(b, audience='public'))
    with db() as c:
        lid = resolve_lid(c, str(b.get('listing') or ''))
        if not c.execute("SELECT 1 FROM listings WHERE id=? AND owner_id=? AND review='approved'", (lid, h.me['id'])).fetchone():
            raise ApiError(403, 'শুধু নিজের প্রকাশিত ব্যবসার জন্য কুপন দেওয়া যায়')
        cid = new_id('k')
        c.execute('INSERT INTO coupons (id, listing_id, title, details, starts, ends, max_claims, audience, status, created_by, owner_id, created_at) '
                  "VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?)", (cid, lid, cp['title'], cp['details'], cp['starts'], cp['ends'], cp['max_claims'],
                                                             'public', 'owner', h.me['id'], int(time.time())))
    h.json({'ok': True, 'id': cid})


@route('PUT', r'/my/coupons/(\w+)', auth='user')
def my_coupon_status(h, cid):
    """Owners can pause or resume their own approved coupons, or delete them."""
    st = h.body().get('status')
    with db() as c:
        cp = c.execute("SELECT cp.* FROM coupons cp JOIN listings l ON l.id=cp.listing_id WHERE cp.id=? AND l.owner_id=? AND cp.created_by='owner'",
                       (cid, h.me['id'])).fetchone()
        if not cp:
            raise ApiError(404, 'পাওয়া যায়নি')
        if st == 'deleted':
            c.execute('DELETE FROM coupons WHERE id=?', (cid,))
            c.execute('DELETE FROM claims WHERE coupon_id=? AND used_at IS NULL', (cid,))
        elif st in ('paused', 'active') and cp['status'] in ('paused', 'active'):
            c.execute('UPDATE coupons SET status=? WHERE id=?', (st, cid))
        else:
            raise ApiError(400, 'এই কুপন এখন বদলানো যাবে না')
    bump()
    h.json({'ok': True})


def check_code(c, code, owner_uid=None):
    code = re.sub(r'[^A-Z0-9-]', '', str(code or '').upper().translate(BN_DIGITS))
    if code and not code.startswith('J360-'):
        code = 'J360-' + code.replace('-', '')[-6:]
    r = c.execute('SELECT cl.*, cp.listing_id, cp.title, cp.details, cp.starts, cp.ends, cp.status, u.name AS uname, u.phone AS uphone FROM claims cl '
                  'JOIN coupons cp ON cp.id=cl.coupon_id JOIN users u ON u.id=cl.user_id WHERE cl.code=?', (code,)).fetchone()
    if not r:
        raise ApiError(404, 'এই কোডের কোনো কুপন নেই')
    if owner_uid is not None and not c.execute('SELECT 1 FROM listings WHERE id=? AND owner_id=?', (r['listing_id'], owner_uid)).fetchone():
        raise ApiError(403, 'এই কুপন আপনার প্রতিষ্ঠানের নয়')
    names = listing_names(c)
    state = 'used' if r['used_at'] else 'ok' if coupon_live(r) else 'expired'
    return r, {'code': r['code'], 'title': r['title'], 'details': r['details'], 'listingName': names.get(r['listing_id']), 'ends': r['ends'],
               'customer': r['uname'], 'phone': r['uphone'][:3] + '•••••' + r['uphone'][-3:], 'state': state, 'usedAt': r['used_at']}


@route('POST', '/my/coupons/check', auth='user')
def my_check(h):
    b = h.body()
    with db() as c:
        r, info = check_code(c, b.get('code'), h.me['id'])
        if b.get('redeem'):
            if info['state'] != 'ok':
                raise ApiError(409, 'এই কুপন ব্যবহার করা যাবে না (আগেই ব্যবহৃত বা মেয়াদ শেষ)')
            c.execute('UPDATE claims SET used_at=?, used_by=? WHERE code=? AND used_at IS NULL', (int(time.time()), 'owner:%d' % h.me['id'], r['code']))
            info.update(state='used', usedAt=int(time.time()), justUsed=True)
    h.json(info)


@route('GET', '/admin/coupons', auth='admin')
def adm_coupons(h):
    with db() as c:
        names = listing_names(c)
        h.json([coupon_out(c, cp, names) for cp in c.execute("SELECT * FROM coupons ORDER BY status='pending' DESC, created_at DESC")])


@route('POST', '/admin/coupons', auth='admin')
def adm_add_coupon(h):
    b = h.body()
    cp = clean_coupon(b)
    with db() as c:
        lid = resolve_lid(c, str(b.get('listing') or ''))
        if not c.execute('SELECT 1 FROM listings WHERE id=?', (lid,)).fetchone():
            raise ApiError(400, 'প্রতিষ্ঠান বেছে নিন')
        cid = new_id('k')
        c.execute('INSERT INTO coupons (id, listing_id, title, details, starts, ends, max_claims, audience, status, created_by, created_at) '
                  "VALUES (?,?,?,?,?,?,?,?,'active','admin',?)", (cid, lid, cp['title'], cp['details'], cp['starts'], cp['ends'], cp['max_claims'],
                                                               cp['audience'], int(time.time())))
        n = assign_users(c, cid, b.get('users'))
    bump()
    h.audit('coupon.create', cp['title'])
    h.json({'ok': True, 'id': cid, 'assigned': n})


def assign_users(c, cid, users):
    n = 0
    for u in (users or [])[:5000]:
        uid = to_int(u)
        if uid and c.execute('SELECT 1 FROM users WHERE id=?', (uid,)).fetchone():
            new_claim(c, cid, uid)
            n += 1
    return n


@route('PUT', r'/admin/coupons/(\w+)', auth='admin')
def adm_edit_coupon(h, cid):
    b = h.body()
    with db() as c:
        cp = c.execute('SELECT * FROM coupons WHERE id=?', (cid,)).fetchone()
        if not cp:
            raise ApiError(404, 'পাওয়া যায়নি')
        if b.get('status') in ('active', 'paused', 'rejected') and len(b) <= 2:
            c.execute('UPDATE coupons SET status=?, note=? WHERE id=?', (b['status'], s(b.get('note'), 300), cid))
        else:
            v = clean_coupon(dict(b, audience=b.get('audience', cp['audience'])))
            c.execute('UPDATE coupons SET title=?, details=?, starts=?, ends=?, max_claims=?, audience=? WHERE id=?',
                      (v['title'], v['details'], v['starts'], v['ends'], v['max_claims'], v['audience'], cid))
        n = assign_users(c, cid, b.get('users'))
    bump()
    h.audit('coupon.update', cid)
    h.json({'ok': True, 'assigned': n})


@route('DELETE', r'/admin/coupons/(\w+)', auth='admin')
def adm_del_coupon(h, cid):
    with db() as c:
        c.execute('DELETE FROM coupons WHERE id=?', (cid,))
        c.execute('DELETE FROM claims WHERE coupon_id=?', (cid,))
    bump()
    h.audit('coupon.delete', cid)
    h.json({'ok': True})


@route('POST', '/admin/coupons/check', auth='admin')
def adm_check(h):
    b = h.body()
    with db() as c:
        r, info = check_code(c, b.get('code'))
        if b.get('redeem'):
            if info['state'] != 'ok':
                raise ApiError(409, 'এই কুপন ব্যবহার করা যাবে না (আগেই ব্যবহৃত বা মেয়াদ শেষ)')
            c.execute('UPDATE claims SET used_at=?, used_by=? WHERE code=? AND used_at IS NULL', (int(time.time()), 'admin:' + h.staff['username'], r['code']))
            info.update(state='used', usedAt=int(time.time()), justUsed=True)
        info['phone'] = r['uphone']
    h.json(info)
