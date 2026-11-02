"""Signed-in users: sign-up/in, profile, their listings, classifieds, payments and uploads."""
import json
import os
import re
import secrets
import sqlite3
import time
from . import config
from .cache import bump
from .config import MAX_IMAGE_BYTES, MAX_VIDEO_BYTES
from .media import sniff, user_media
from .records import classified_out, coupon_rows, listing_state
from .security import check_pw, hash_pw, rate_ok, weak_password
from .store import categories, db, get_setting, inc, needs_payment
from .util import ApiError, new_id, norm_phone, s
from .validate import USER_LISTING_FIELDS, clean_classified, clean_listing
from .web import route


@route('POST', '/auth/register')
def auth_register(h):
    b = h.body()
    if not rate_ok('reg:' + h.who(), 5, 3600):
        raise ApiError(429, 'অনেকবার চেষ্টা হয়েছে, পরে আবার চেষ্টা করুন')
    name, phone, pw = s(b.get('name'), 60), norm_phone(b.get('phone')), str(b.get('password') or '')
    if not name:
        raise ApiError(400, 'নাম দিন')
    if not phone:
        raise ApiError(400, 'সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)')
    weak_password(pw, phone)
    if not b.get('terms'):
        raise ApiError(400, 'শর্তাবলিতে সম্মতি দিন')
    with db() as c:
        tv = (get_setting(c, 'terms') or {}).get('version') or 0
        try:
            uid = c.execute('INSERT INTO users (name, phone, pass, created_at, terms_v, terms_at) VALUES (?,?,?,?,?,?)',
                            (name, phone, hash_pw(pw), int(time.time()), tv, int(time.time()))).lastrowid
        except sqlite3.IntegrityError:
            raise ApiError(409, 'এই নম্বরে আগেই অ্যাকাউন্ট আছে — লগইন করুন')
        inc(c, 'signups')
    h.start_session('usessions', 'user_id', uid, 'j360u', 'Lax')
    h.json({'id': uid, 'name': name, 'phone': phone})


@route('POST', '/auth/login')
def auth_login(h):
    b = h.body()
    phone = norm_phone(b.get('phone'))
    if not (rate_ok(f'ulogin:{h.who()}:{phone}', 8, 900) and rate_ok('uloginip:' + h.who(), 40, 900) and rate_ok(f'uloginph:{phone}', 20, 3600)):
        raise ApiError(429, 'অনেকবার চেষ্টা হয়েছে, ১৫ মিনিট পর আবার চেষ্টা করুন')
    with db() as c:
        u = c.execute('SELECT * FROM users WHERE phone=?', (phone,)).fetchone()
    if not u or not check_pw(str(b.get('password') or ''), u['pass']):
        raise ApiError(401, 'মোবাইল নম্বর বা পাসওয়ার্ড ভুল')
    if u['banned']:
        raise ApiError(403, 'এই অ্যাকাউন্ট বন্ধ করা হয়েছে')
    h.start_session('usessions', 'user_id', u['id'], 'j360u', 'Lax')
    h.json({'id': u['id'], 'name': u['name'], 'phone': u['phone']})


@route('POST', '/auth/logout')
def auth_logout(h):
    h.end_session('usessions', 'j360u')
    h.json({'ok': True})


@route('GET', '/auth/me')
def auth_me(h):
    me = h.user()
    if me:
        with db() as c:
            me = dict(me, coupons=len(coupon_rows(c, 'cl.user_id=? AND cl.used_at IS NULL', (me['id'],), live=True)))
    h.json(me)


@route('PUT', '/my/profile', auth='user')
def my_profile(h):
    b = h.body()
    name = s(b.get('name'), 60)
    if not name:
        raise ApiError(400, 'নাম দিন')
    with db() as c:
        c.execute('UPDATE users SET name=? WHERE id=?', (name, h.me['id']))
        if b.get('phone') and not h.me['phone']:          # an account made with Google adds its mobile number once
            phone = norm_phone(b.get('phone'))
            if not phone:
                raise ApiError(400, 'সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)')
            try:
                c.execute('UPDATE users SET phone=? WHERE id=?', (phone, h.me['id']))
            except sqlite3.IntegrityError:
                raise ApiError(409, 'এই নম্বরে আরেকটি অ্যাকাউন্ট আছে')
        if b.get('newPassword'):
            u = c.execute('SELECT pass FROM users WHERE id=?', (h.me['id'],)).fetchone()
            if u['pass'] and not check_pw(str(b.get('password') or ''), u['pass']):    # Google-only accounts have none yet
                raise ApiError(400, 'বর্তমান পাসওয়ার্ড ভুল')
            weak_password(str(b['newPassword']), h.me['phone'])
            c.execute('UPDATE users SET pass=? WHERE id=?', (hash_pw(b['newPassword']), h.me['id']))
            c.execute('DELETE FROM usessions WHERE user_id=? AND token!=?', (h.me['id'], h.session_token('j360u')))
    h.json({'ok': True})


@route('GET', '/my', auth='user')
def my_overview(h):
    uid = h.me['id']
    with db() as c:
        pays = [dict(r) for r in c.execute('SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC', (uid,))]
        latest = {}
        for p in pays:
            latest.setdefault(p['listing_id'], p)
        listings = []
        for r in c.execute('SELECT * FROM listings WHERE owner_id=? ORDER BY created_at DESC', (uid,)):
            d = json.loads(r['doc'])
            pay = latest.get(r['id'])
            listings.append({'id': r['id'], 'name': d.get('name'), 'cat': d.get('cat'), 'sub': d.get('sub'), 'images': d.get('images'),
                             'plan': r['plan'], 'paidUntil': r['paid_until'], 'review': r['review'], 'views': r['views'], 'calls': r['calls'], 'imps': r['imps'], 'sponsored': d.get('sponsored'), 'sponsoredUntil': d.get('sponsoredUntil'),
                             'state': listing_state(r['review'], r['paid_until'], pay),
                             'payment': {k: pay[k] for k in ('status', 'amount', 'method', 'trx', 'note')} if pay else None})
        classifieds = [classified_out(r, True) for r in c.execute('SELECT * FROM classifieds WHERE user_id=? ORDER BY created_at DESC', (uid,))]
        reviews = c.execute('SELECT COUNT(*) FROM reviews WHERE user_id=?', (uid,)).fetchone()[0]
    h.json({'user': h.me, 'listings': listings, 'classifieds': classifieds, 'reviews': reviews,
            'payments': [{k: p[k] for k in ('id', 'listing_id', 'plan_id', 'amount', 'method', 'trx', 'status', 'note', 'created_at')} for p in pays]})


@route('POST', '/my/listings', auth='user')
def my_add_listing(h):
    b = h.body()
    if not rate_ok('sub:%d' % h.me['id'], 10, 86400):
        raise ApiError(429, 'আজ অনেক তথ্য জমা হয়েছে, পরে চেষ্টা করুন')
    doc = clean_listing(b, admin=False)
    cat = categories()[doc['cat']]
    paid = needs_payment(cat, doc.get('sub'))
    plan = None
    if paid:
        with db() as c:
            plans = {p['id']: p for p in get_setting(c, 'plans') or []}
        plan = plans.get(b.get('plan'))
        if not plan:
            raise ApiError(400, 'একটি প্যাকেজ বেছে নিন')
    doc.update(user_media(h, b))
    doc = {k: v for k, v in doc.items() if v is not None}
    lid, now = new_id('u'), int(time.time())
    with db() as c:
        c.execute('INSERT INTO listings (id, doc, review, source, contact, created_at, updated_at, owner_id, plan) VALUES (?,?,?,?,?,?,?,?,?)',
                  (lid, json.dumps(doc, ensure_ascii=False), 'unpaid' if paid else 'pending', 'user', h.me['phone'], now, now, h.me['id'],
                   plan['id'] if plan else None))
        inc(c, 'submissions')
    h.json({'ok': True, 'id': lid, 'needsPayment': paid, 'amount': plan['price'] if plan else 0})


@route('POST', '/my/payments', auth='user')
def my_pay(h):
    b = h.body()
    if not rate_ok('pay:%d' % h.me['id'], 10, 86400):
        raise ApiError(429, 'অনেকবার চেষ্টা হয়েছে, পরে আবার চেষ্টা করুন')
    lid, method = str(b.get('listing') or ''), b.get('method')
    trx = re.sub(r'[^A-Za-z0-9]', '', str(b.get('trx') or '')).upper()[:30]
    sender = norm_phone(b.get('sender'))
    if method not in ('bkash', 'nagad', 'rocket'):
        raise ApiError(400, 'পেমেন্ট মাধ্যম বেছে নিন')
    if len(trx) < 6:
        raise ApiError(400, 'সঠিক Transaction ID দিন')
    if not sender:
        raise ApiError(400, 'যে নম্বর থেকে টাকা পাঠিয়েছেন সেটি দিন')
    with db() as c:
        r = c.execute('SELECT * FROM listings WHERE id=? AND owner_id=?', (lid, h.me['id'])).fetchone()
        if not r:
            raise ApiError(404, 'তালিকা পাওয়া যায়নি')
        plans = {p['id']: p for p in get_setting(c, 'plans') or []}
        plan = plans.get(b.get('plan') or r['plan'])
        if not plan:
            raise ApiError(400, 'একটি প্যাকেজ বেছে নিন')
        if c.execute("SELECT 1 FROM payments WHERE listing_id=? AND status='submitted'", (lid,)).fetchone():
            raise ApiError(409, 'এই তালিকার একটি পেমেন্ট যাচাইয়ের অপেক্ষায় আছে')
        if c.execute("SELECT 1 FROM payments WHERE trx=? AND status!='rejected'", (trx,)).fetchone():
            raise ApiError(409, 'এই Transaction ID আগেই ব্যবহার হয়েছে')
        c.execute('INSERT INTO payments (id, user_id, listing_id, plan_id, amount, method, trx, sender, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
                  (new_id('y'), h.me['id'], lid, plan['id'], plan['price'], method, trx, sender, int(time.time())))
        c.execute('UPDATE listings SET plan=? WHERE id=?', (plan['id'], lid))
    h.json({'ok': True})


@route('POST', '/my/classifieds', auth='user')
def my_add_classified(h):
    b = h.body()
    if not rate_ok('cls:%d' % h.me['id'], 10, 86400):
        raise ApiError(429, 'আজ অনেক বিজ্ঞাপন দেওয়া হয়েছে, পরে চেষ্টা করুন')
    kind = b.get('kind')
    doc = clean_classified(kind, b)
    doc.update(user_media(h, b))
    doc = {k: v for k, v in doc.items() if v is not None}
    cid, now = new_id('c'), int(time.time())
    with db() as c:
        c.execute('INSERT INTO classifieds (id, user_id, kind, doc, created_at, updated_at) VALUES (?,?,?,?,?,?)',
                  (cid, h.me['id'], kind, json.dumps(doc, ensure_ascii=False), now, now))
        inc(c, 'classifieds')
    h.json({'ok': True, 'id': cid})


@route('DELETE', r'/my/classifieds/(\w+)', auth='user')
def my_del_classified(h, cid):
    with db() as c:
        if not c.execute('DELETE FROM classifieds WHERE id=? AND user_id=?', (cid, h.me['id'])).rowcount:
            raise ApiError(404, 'পাওয়া যায়নি')
    bump()
    h.json({'ok': True})


@route('DELETE', r'/my/listings/([\w-]+)', auth='user')
def my_del_listing(h, lid):
    with db() as c:
        if not c.execute("DELETE FROM listings WHERE id=? AND owner_id=? AND review IN ('unpaid','pending','rejected')", (lid, h.me['id'])).rowcount:
            raise ApiError(404, 'পাওয়া যায়নি')
    h.json({'ok': True})


@route('POST', '/my/media', auth='user')
def my_media(h):
    """One photo or video per request, sent as the raw file body, streamed to disk."""
    ctype = h.headers.get('Content-Type', '').split(';')[0].strip().lower()
    kind = 'image' if ctype.startswith('image/') else 'video' if ctype.startswith('video/') else None
    if not kind:
        raise ApiError(415, 'শুধু ছবি বা ভিডিও আপলোড করা যায়')
    n = int(h.headers.get('Content-Length') or 0)
    if not 0 < n <= (MAX_IMAGE_BYTES if kind == 'image' else MAX_VIDEO_BYTES):
        raise ApiError(413, 'ছবি সর্বোচ্চ ৮ MB' if kind == 'image' else 'ভিডিও সর্বোচ্চ ৬০ MB')
    if not rate_ok('media:%d' % h.me['id'], 100, 86400):
        raise ApiError(429, 'আজ অনেক ফাইল আপলোড হয়েছে, পরে চেষ্টা করুন')
    h._consumed = True
    head = h.rfile.read(min(n, 64 * 1024))
    ext = sniff(head, kind)
    if not ext:
        h.close_connection = True
        raise ApiError(400, 'ফাইলের ফরম্যাট সঠিক নয় (ছবি: JPG/PNG/WebP, ভিডিও: MP4/WebM/MOV)')
    name = secrets.token_hex(12) + '.' + ext
    part = os.path.join(config.UPLOADS, name + '.part')
    left = n - len(head)
    with open(part, 'wb') as f:
        f.write(head)
        while left > 0:
            chunk = h.rfile.read(min(left, 1 << 20))
            if not chunk:
                break
            f.write(chunk)
            left -= len(chunk)
    if left:
        os.remove(part)
        h.close_connection = True
        raise ApiError(400, 'আপলোড অসম্পূর্ণ, আবার চেষ্টা করুন')
    os.replace(part, os.path.join(config.UPLOADS, name))
    with db() as c:
        c.execute('INSERT INTO media VALUES (?,?,?,?,?)', (name, h.me['id'], kind, n, int(time.time())))
    h.json({'url': '/uploads/' + name, 'kind': kind})


@route('GET', r'/my/listings/([\w-]+)', auth='user')
def my_get_listing(h, lid):
    with db() as c:
        r = c.execute('SELECT * FROM listings WHERE id=? AND owner_id=?', (lid, h.me['id'])).fetchone()
    if not r:
        raise ApiError(404, 'পাওয়া যায়নি')
    h.json(dict(json.loads(r['doc']), id=r['id'], review=r['review'], plan=r['plan'], paidUntil=r['paid_until']))


@route('PUT', r'/my/listings/([\w-]+)', auth='user')
def my_edit_listing(h, lid):
    """Owners can edit any time. A published (or rejected) listing goes back to the admin for approval."""
    b = h.body()
    if not rate_ok('edit:%d' % h.me['id'], 60, 86400):
        raise ApiError(429, 'আজ অনেকবার সম্পাদনা হয়েছে, পরে চেষ্টা করুন')
    with db() as c:
        r = c.execute('SELECT * FROM listings WHERE id=? AND owner_id=?', (lid, h.me['id'])).fetchone()
    if not r:
        raise ApiError(404, 'পাওয়া যায়নি')
    old = json.loads(r['doc'])
    new = clean_listing(dict(b, cat=old.get('cat'), sub=old.get('sub')), admin=False)    # category is fixed: it decides the price
    new.update(user_media(h, b, (old.get('images') or []) + (old.get('videos') or [])))
    doc = {k: v for k, v in old.items() if k not in USER_LISTING_FIELDS}
    doc.update({k: new[k] for k in USER_LISTING_FIELDS if new.get(k) is not None})
    review = 'pending' if r['review'] in ('approved', 'rejected') else r['review']
    if r['review'] == 'approved':
        doc['editedAt'] = int(time.time())
    with db() as c:
        c.execute('UPDATE listings SET doc=?, review=?, updated_at=? WHERE id=?', (json.dumps(doc, ensure_ascii=False), review, int(time.time()), lid))
    bump()
    h.json({'ok': True, 'review': review})


@route('PUT', r'/my/classifieds/(\w+)', auth='user')
def my_edit_classified(h, cid):
    """Edit before or after approval; every edit needs the admin's approval again."""
    b = h.body()
    if not rate_ok('edit:%d' % h.me['id'], 60, 86400):
        raise ApiError(429, 'আজ অনেকবার সম্পাদনা হয়েছে, পরে চেষ্টা করুন')
    with db() as c:
        r = c.execute('SELECT * FROM classifieds WHERE id=? AND user_id=?', (cid, h.me['id'])).fetchone()
    if not r:
        raise ApiError(404, 'বিজ্ঞাপনটি পাওয়া যায়নি')
    old = json.loads(r['doc'])
    doc = clean_classified(r['kind'], b)
    doc.update(user_media(h, b, (old.get('images') or []) + (old.get('videos') or [])))
    if r['review'] != 'pending' or old.get('editedAt'):
        doc['editedAt'] = int(time.time())
    doc = {k: v for k, v in doc.items() if v is not None}
    with db() as c:
        c.execute("UPDATE classifieds SET doc=?, review='pending', expires_at=NULL, updated_at=? WHERE id=?",
                  (json.dumps(doc, ensure_ascii=False), int(time.time()), cid))
    bump()
    h.json({'ok': True})


@route('POST', '/my/terms', auth='user')
def my_terms(h):
    with db() as c:
        v = (get_setting(c, 'terms') or {}).get('version') or 0
        c.execute('UPDATE users SET terms_v=?, terms_at=? WHERE id=?', (v, int(time.time()), h.me['id']))
    h.json({'ok': True})
