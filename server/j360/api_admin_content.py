"""Admin work on content: dashboard, listings, submissions, payments, users, classifieds, reviews, reports."""
import json
import re
import secrets
import time
from .cache import bump, home_domain
from .config import CLASS_DAYS
from .records import classified_out, listing_out, review_row
from .security import hash_pw
from .store import db, get_setting
from .util import ApiError, new_id, s, to_int, today
from .validate import clean_listing
from .web import route


@route('GET', '/admin/summary', auth='admin')
def adm_summary(h):
    with db() as c:
        one = lambda q, *a: c.execute(q, a).fetchone()[0]
        week = int(time.time()) - 7 * 86400
        month = time.strftime('%Y-%m')
        top = []
        for r in c.execute("SELECT id, doc, views, calls, maps FROM listings WHERE review='approved' ORDER BY views+calls*3 DESC LIMIT 6"):
            top.append({'id': r['id'], 'name': json.loads(r['doc'])['name'], 'views': r['views'], 'calls': r['calls'], 'maps': r['maps']})
        days = [time.strftime('%Y-%m-%d', time.localtime(time.time() - i * 86400)) for i in range(29, -1, -1)]
        series = {m: [0] * 30 for m in ('views', 'calls', 'maps', 'signups', 'reviews', 'submissions', 'classifieds', 'downloads', 'adclicks', 'oldapp')}
        idx = {d: i for i, d in enumerate(days)}
        for r in c.execute('SELECT day, metric, n FROM daily WHERE day>=?', (days[0],)):
            if r['metric'] in series and r['day'] in idx:
                series[r['metric']][idx[r['day']]] = r['n']
        out = {
            'listings': one("SELECT COUNT(*) FROM listings WHERE review='approved'"),
            'verified': one("SELECT COUNT(*) FROM listings WHERE review='approved' AND json_extract(doc,'$.status')='verified'"),
            'demo': one("SELECT COUNT(*) FROM listings WHERE review='approved' AND json_extract(doc,'$.demo')=1"),
            'pending': one("SELECT COUNT(*) FROM listings WHERE review='pending'"),
            'payments': one("SELECT COUNT(*) FROM payments WHERE status='submitted'"),
            'classifiedsPending': one("SELECT COUNT(*) FROM classifieds WHERE review='pending'"),
            'classifiedsLive': one("SELECT COUNT(*) FROM classifieds WHERE review='approved' AND expires_at>?", int(time.time())),
            'reports': one('SELECT COUNT(*) FROM reports WHERE done=0'),
            'reviews': one('SELECT COUNT(*) FROM reviews'),
            'reviewsWeek': one('SELECT COUNT(*) FROM reviews WHERE created_at>?', week),
            'users': one('SELECT COUNT(*) FROM users'),
            'revenueMonth': one("SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='verified' AND strftime('%Y-%m', decided_at, 'unixepoch', 'localtime')=?", month),
            'revenueTotal': one("SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='verified'"),
            'views': one('SELECT COALESCE(SUM(views),0) FROM listings'),
            'calls': one('SELECT COALESCE(SUM(calls),0) FROM listings'),
            'days': days, 'series': series, 'top': top, 'home': home_domain(),
            'audit': [dict(r) for r in c.execute('SELECT admin, action, target, at FROM audit ORDER BY id DESC LIMIT 10')],
        }
    h.json(out)


@route('GET', '/admin/listings', auth='admin')
def adm_listings(h):
    with db() as c:
        rows = c.execute('SELECT * FROM listings ORDER BY updated_at DESC').fetchall()
        ratings = {r[0]: (round(r[1], 1), r[2]) for r in c.execute('SELECT listing_id, AVG(stars), COUNT(*) FROM reviews GROUP BY listing_id')}
        owners = {r['id']: {'id': r['id'], 'name': r['name'], 'phone': r['phone']} for r in c.execute('SELECT id, name, phone FROM users')}
        pays = {}
        for p in c.execute('SELECT id, listing_id, status, amount, method, trx, sender FROM payments ORDER BY created_at'):
            pays[p['listing_id']] = dict(p)
    out = []
    for r in rows:
        d = listing_out(r, pays.get(r['id']), owners.get(r['owner_id']))
        if r['id'] in ratings:
            d['rating'], d['reviews'] = ratings[r['id']]
        out.append(d)
    h.json(out)


@route('POST', '/admin/listings', auth='admin')
def adm_create(h):
    doc = clean_listing(h.body(), admin=True)
    lid, now = new_id('l'), int(time.time())
    with db() as c:
        c.execute('INSERT INTO listings (id, doc, review, source, created_at, updated_at) VALUES (?,?,?,?,?,?)',
                  (lid, json.dumps(doc, ensure_ascii=False), 'approved', 'admin', now, now))
    bump()
    h.audit('listing.create', doc['name'])
    h.json({'ok': True, 'id': lid})


@route('PUT', r'/admin/listings/([\w-]+)', auth='admin')
def adm_update(h, lid):
    b = h.body()
    doc = clean_listing(b, admin=True)
    with db() as c:
        r = c.execute('SELECT review, paid_until, doc FROM listings WHERE id=?', (lid,)).fetchone()
        if not r:
            raise ApiError(404, 'পাওয়া যায়নি')
        review = b.get('_review') if b.get('_review') in ('approved', 'pending', 'rejected', 'unpaid') else r['review']
        edited = json.loads(r['doc']).get('editedAt')
        if edited and review != 'approved':           # still waiting for the admin to look at the owner's changes
            doc['editedAt'] = edited
        paid_until = r['paid_until']
        if '_paidUntil' in b and h.staff['role'] == 'owner':
            paid_until = s(b.get('_paidUntil'), 10)
        c.execute('UPDATE listings SET doc=?, review=?, paid_until=?, updated_at=? WHERE id=?',
                  (json.dumps(doc, ensure_ascii=False), review, paid_until, int(time.time()), lid))
    bump()
    h.audit('listing.update', doc['name'])
    h.json({'ok': True})


@route('POST', r'/admin/listings/([\w-]+)/review', auth='admin')
def adm_review_listing(h, lid):
    b = h.body()
    decision = b.get('review')
    if decision not in ('approved', 'rejected', 'pending'):
        raise ApiError(400, 'সঠিক নয়')
    with db() as c:
        r = c.execute('SELECT doc, review FROM listings WHERE id=?', (lid,)).fetchone()
        if not r:
            raise ApiError(404, 'পাওয়া যায়নি')
        if decision == 'approved' and r['review'] == 'unpaid':
            raise ApiError(400, 'আগে পেমেন্ট যাচাই করুন')
        doc = json.loads(r['doc'])
        if decision == 'approved' and b.get('verified'):
            doc.update(status='verified', verifiedAt=today())
        if decision == 'approved':
            doc.pop('editedAt', None)
        c.execute('UPDATE listings SET review=?, doc=?, updated_at=? WHERE id=?', (decision, json.dumps(doc, ensure_ascii=False), int(time.time()), lid))
    bump()
    h.audit('listing.' + decision, doc.get('name'))
    h.json({'ok': True})


SLUG_RE = re.compile(r'^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$')


@route('POST', r'/admin/listings/([\w-]+)/rename', auth='admin')
def adm_rename_listing(h, lid):
    """Change a listing's link (/app/#/p/<id>). Reviews, payments and reports move with it; the old link keeps working."""
    new = str(h.body().get('id') or '').strip().lower()
    if not SLUG_RE.match(new):
        raise ApiError(400, 'লিংকে শুধু ইংরেজি ছোট হাতের অক্ষর, সংখ্যা ও - দিন (যেমন: shahi-khana)')
    if new == lid:
        return h.json({'ok': True, 'id': lid})
    with db() as c:
        r = c.execute('SELECT doc FROM listings WHERE id=?', (lid,)).fetchone()
        if not r:
            raise ApiError(404, 'পাওয়া যায়নি')
        if c.execute('SELECT 1 FROM listings WHERE id=?', (new,)).fetchone():
            raise ApiError(409, 'এই লিংক আরেকটি তালিকায় আছে, অন্যটি দিন')
        doc = json.loads(r['doc'])
        if 'id' in doc:
            doc['id'] = new
        c.execute('UPDATE listings SET id=?, doc=? WHERE id=?', (new, json.dumps(doc, ensure_ascii=False), lid))
        c.execute('UPDATE coupons SET listing_id=? WHERE listing_id=?', (new, lid))
        for table in ('reviews', 'reports', 'payments'):
            c.execute(f'UPDATE {table} SET listing_id=? WHERE listing_id=?', (new, lid))
        c.execute('DELETE FROM aliases WHERE old=?', (new,))                 # the new id is a real id again
        c.execute('UPDATE aliases SET new=? WHERE new=?', (new, lid))        # links that pointed to the old id
        c.execute('INSERT OR REPLACE INTO aliases VALUES (?,?)', (lid, new))
        ads = get_setting(c, 'ads') or []
        if any(a.get('link') == '#/p/' + lid for a in ads):
            for a in ads:
                if a.get('link') == '#/p/' + lid:
                    a['link'] = '#/p/' + new
            c.execute("UPDATE settings SET value=? WHERE key='ads'", (json.dumps(ads, ensure_ascii=False),))
    bump()
    h.audit('listing.rename', f'{lid} → {new}')
    h.json({'ok': True, 'id': new})


@route('DELETE', r'/admin/listings/([\w-]+)', auth='admin')
def adm_delete(h, lid):
    with db() as c:
        r = c.execute('SELECT doc FROM listings WHERE id=?', (lid,)).fetchone()
        c.execute('DELETE FROM listings WHERE id=?', (lid,))
        c.execute('DELETE FROM reviews WHERE listing_id=?', (lid,))
    bump()
    h.audit('listing.delete', json.loads(r['doc'])['name'] if r else lid)
    h.json({'ok': True})


@route('GET', '/admin/payments', auth='admin')
def adm_payments(h):
    with db() as c:
        names = {r['id']: json.loads(r['doc'])['name'] for r in c.execute('SELECT id, doc FROM listings')}
        users = {r['id']: (r['name'], r['phone']) for r in c.execute('SELECT id, name, phone FROM users')}
        rows = [dict(r) for r in c.execute("SELECT * FROM payments ORDER BY status='submitted' DESC, created_at DESC LIMIT 500")]
    for r in rows:
        r['listingName'] = names.get(r['listing_id'], '—')
        r['userName'], r['userPhone'] = users.get(r['user_id'], ('—', ''))
    h.json(rows)


@route('POST', r'/admin/payments/(\w+)', auth='owner')
def adm_payment_decide(h, pid):
    b = h.body()
    decision = b.get('decision')
    if decision not in ('verify', 'reject'):
        raise ApiError(400, 'সঠিক নয়')
    with db() as c:
        p = c.execute('SELECT * FROM payments WHERE id=?', (pid,)).fetchone()
        if not p or p['status'] != 'submitted':
            raise ApiError(400, 'এই পেমেন্ট আগেই যাচাই হয়েছে')
        now = int(time.time())
        c.execute('UPDATE payments SET status=?, note=?, decided_at=?, decided_by=? WHERE id=?',
                  ('verified' if decision == 'verify' else 'rejected', s(b.get('note'), 300), now, h.staff['username'], pid))
        if decision == 'verify':
            l = c.execute('SELECT * FROM listings WHERE id=?', (p['listing_id'],)).fetchone()
            plans = {x['id']: x for x in get_setting(c, 'plans') or []}
            plan = plans.get(p['plan_id']) or {'days': 365}
            base = max(today(), l['paid_until'] or '')
            until = time.strftime('%Y-%m-%d', time.localtime(time.mktime(time.strptime(base, '%Y-%m-%d')) + int(plan.get('days', 365)) * 86400))
            doc = json.loads(l['doc'])
            if plan.get('featured'):
                doc['featured'] = True
            if plan.get('sponsored'):                 # promoted plans: on top of lists and search until the plan ends
                doc['sponsored'] = True
                doc['sponsoredUntil'] = max(doc.get('sponsoredUntil') or '', until)
            review = 'approved' if b.get('publish') else ('pending' if l['review'] == 'unpaid' else l['review'])
            c.execute('UPDATE listings SET paid_until=?, plan=?, review=?, doc=?, updated_at=? WHERE id=?',
                      (until, p['plan_id'], review, json.dumps(doc, ensure_ascii=False), now, l['id']))
    bump()
    h.audit('payment.' + decision, pid)
    h.json({'ok': True})


@route('GET', '/admin/users', auth='admin')
def adm_users(h):
    with db() as c:
        counts = {}
        for r in c.execute('SELECT owner_id, COUNT(*) FROM listings WHERE owner_id IS NOT NULL GROUP BY owner_id'):
            counts.setdefault(r[0], {})['listings'] = r[1]
        for r in c.execute('SELECT user_id, COUNT(*) FROM classifieds GROUP BY user_id'):
            counts.setdefault(r[0], {})['classifieds'] = r[1]
        for r in c.execute('SELECT user_id, COUNT(*) FROM reviews WHERE user_id IS NOT NULL GROUP BY user_id'):
            counts.setdefault(r[0], {})['reviews'] = r[1]
        rows = [dict(r, **counts.get(r['id'], {})) for r in c.execute('SELECT id, name, phone, banned, created_at FROM users ORDER BY id DESC LIMIT 2000')]
    h.json(rows)


@route('PUT', r'/admin/users/(\d+)', auth='admin')
def adm_user_update(h, uid):
    b = h.body()
    with db() as c:
        if 'banned' in b:
            c.execute('UPDATE users SET banned=? WHERE id=?', (1 if b['banned'] else 0, uid))
            if b['banned']:
                c.execute('DELETE FROM usessions WHERE user_id=?', (uid,))
    h.audit('user.' + ('ban' if b.get('banned') else 'unban'), uid)
    h.json({'ok': True})


@route('POST', r'/admin/users/(\d+)/reset', auth='admin')
def adm_user_reset(h, uid):
    pw = secrets.token_hex(4)
    with db() as c:
        if not c.execute('UPDATE users SET pass=? WHERE id=?', (hash_pw(pw), uid)).rowcount:
            raise ApiError(404, 'পাওয়া যায়নি')
        c.execute('DELETE FROM usessions WHERE user_id=?', (uid,))
    h.audit('user.reset', uid)
    h.json({'password': pw})


@route('GET', '/admin/classifieds', auth='admin')
def adm_classifieds(h):
    with db() as c:
        users = {r['id']: (r['name'], r['phone']) for r in c.execute('SELECT id, name, phone FROM users')}
        rows = []
        for r in c.execute("SELECT * FROM classifieds ORDER BY review='pending' DESC, created_at DESC LIMIT 1000"):
            d = classified_out(r, True)
            d['userName'], d['userPhone'] = users.get(r['user_id'], ('—', ''))
            rows.append(d)
    h.json(rows)


@route('POST', r'/admin/classifieds/(\w+)/review', auth='admin')
def adm_classified_review(h, cid):
    b = h.body()
    decision = b.get('review')
    if decision not in ('approved', 'rejected', 'pending'):
        raise ApiError(400, 'সঠিক নয়')
    days = to_int(b.get('days')) or CLASS_DAYS
    with db() as c:
        r = c.execute('SELECT doc FROM classifieds WHERE id=?', (cid,)).fetchone()
        if not r:
            raise ApiError(404, 'পাওয়া যায়নি')
        doc = json.loads(r['doc'])
        if decision == 'approved':
            doc.pop('editedAt', None)
        c.execute('UPDATE classifieds SET review=?, doc=?, expires_at=?, updated_at=? WHERE id=?',
                  (decision, json.dumps(doc, ensure_ascii=False), int(time.time()) + days * 86400 if decision == 'approved' else None, int(time.time()), cid))
    bump()
    h.audit('classified.' + decision, cid)
    h.json({'ok': True})


@route('DELETE', r'/admin/classifieds/(\w+)', auth='admin')
def adm_classified_delete(h, cid):
    with db() as c:
        c.execute('DELETE FROM classifieds WHERE id=?', (cid,))
    bump()
    h.audit('classified.delete', cid)
    h.json({'ok': True})


@route('GET', '/admin/reviews', auth='admin')
def adm_reviews(h):
    with db() as c:
        names = {r['id']: json.loads(r['doc'])['name'] for r in c.execute('SELECT id, doc FROM listings')}
        reported = {r[0] for r in c.execute("SELECT review_id FROM reports WHERE kind='review' AND done=0")}
        rows = c.execute('SELECT * FROM reviews ORDER BY created_at DESC LIMIT 1000').fetchall()
    out = []
    for r in rows:
        d = review_row(r, True)
        d.update(listingName=names.get(r['listing_id'], '—'), reported=r['id'] in reported)
        out.append(d)
    h.json(out)


@route('PUT', r'/admin/reviews/(\w+)', auth='admin')
def adm_review_update(h, rid):
    b = h.body()
    with db() as c:
        if 'hidden' in b:
            c.execute('UPDATE reviews SET hidden=? WHERE id=?', (1 if b['hidden'] else 0, rid))
        if 'reply' in b:
            c.execute('UPDATE reviews SET reply=? WHERE id=?', (s(b['reply'], 1000), rid))
        if b.get('hidden'):
            c.execute('UPDATE reports SET done=1 WHERE review_id=?', (rid,))
    bump()
    h.audit('review.update', rid)
    h.json({'ok': True})


@route('DELETE', r'/admin/reviews/(\w+)', auth='admin')
def adm_review_delete(h, rid):
    with db() as c:
        c.execute('DELETE FROM reviews WHERE id=?', (rid,))
        c.execute('UPDATE reports SET done=1 WHERE review_id=?', (rid,))
    bump()
    h.audit('review.delete', rid)
    h.json({'ok': True})


@route('GET', '/admin/reports', auth='admin')
def adm_reports(h):
    with db() as c:
        names = {r['id']: json.loads(r['doc'])['name'] for r in c.execute('SELECT id, doc FROM listings')}
        names.update({r['id']: json.loads(r['doc']).get('title') for r in c.execute('SELECT id, doc FROM classifieds')})
        rows = [dict(r) for r in c.execute('SELECT * FROM reports ORDER BY done, created_at DESC LIMIT 500')]
        texts = {r['id']: r['text'] for r in c.execute('SELECT id, text FROM reviews')}
    for r in rows:
        r['listingName'] = names.get(r['listing_id'], '—')
        r['reviewText'] = texts.get(r['review_id'])
    h.json(rows)


@route('PUT', r'/admin/reports/(\w+)', auth='admin')
def adm_report_update(h, pid):
    b = h.body()
    with db() as c:
        c.execute('UPDATE reports SET done=? WHERE id=?', (1 if b.get('done') else 0, pid))
    h.json({'ok': True})
