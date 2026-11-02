"""Public API: bootstrap, reviews, reports, counters, classifieds, map links."""
import hashlib
import http.client
import json
import re
import sqlite3
import time
from .cache import bootstrap_payload, bump, home_domain
from .config import CLASS_KINDS
from .maps import coords_from_text, map_host_ok, resolve_map_link
from .media import save_image
from .records import classified_out, review_row
from .security import rate_ok
from .store import db, inc, resolve_lid
from .util import ApiError, new_id, s, to_int, today
from .web import route


_old_seen = {}


def count_old_app(h):
    # Phones whose installed app still opens an old address: one per device per day, so the admin knows when it is safe to drop it.
    home = home_domain()
    if not home or 'Jashore360App' not in (h.headers.get('User-Agent') or ''):
        return
    host = (h.headers.get('Host') or '').split(':')[0].lower()
    if host.startswith('www.'):
        host = host[4:]
    if not host or host == home or host in ('127.0.0.1', 'localhost') or re.match(r'^[\d.]+$', host):
        return
    t = today()
    if _old_seen.get('day') != t:
        _old_seen.clear()
        _old_seen['day'] = t
        _old_seen['ids'] = set()
    key = h.device()
    if key in _old_seen['ids']:
        return
    _old_seen['ids'].add(key)
    with db() as c:
        inc(c, 'oldapp')

@route('GET', '/bootstrap')
def api_bootstrap(h):
    h.device()
    count_old_app(h)
    raw, gz, etag = bootstrap_payload()
    if h.headers.get('If-None-Match') == etag and not h._set_cookies:
        h.send_response(304)
        h.send_header('ETag', etag)
        h.send_header('Content-Length', '0')
        h.end_headers()
        return
    h.send(200, raw, headers={'ETag': etag, 'Cache-Control': 'no-cache'}, gz=gz)


@route('GET', r'/listings/([\w-]+)/reviews')
def api_reviews(h, lid):
    me = h.user()
    with db() as c:
        lid = resolve_lid(c, lid)
        rows = c.execute('SELECT * FROM reviews WHERE listing_id=? AND hidden=0 ORDER BY created_at DESC LIMIT 200', (lid,)).fetchall()
        mine = me and c.execute('SELECT 1 FROM reviews WHERE listing_id=? AND user_id=?', (lid, me['id'])).fetchone()
    h.json({'reviews': [review_row(r) for r in rows], 'mine': bool(mine)})


@route('POST', '/reviews', auth='user')
def api_add_review(h):
    b, me = h.body(), h.me
    if not rate_ok('rv:%d' % me['id'], 15, 86400):
        raise ApiError(429, 'আজ অনেক রিভিউ দেওয়া হয়েছে, পরে চেষ্টা করুন')
    with db() as c:
        lid = resolve_lid(c, str(b.get('listing') or ''))
    stars = to_int(b.get('stars')) or 0
    if not 1 <= stars <= 5:
        raise ApiError(400, 'স্টার রেটিং দিন')
    with db() as c:
        row = c.execute("SELECT owner_id FROM listings WHERE id=? AND review='approved'", (lid,)).fetchone()
        if not row:
            raise ApiError(404, 'প্রতিষ্ঠান পাওয়া যায়নি')
        if row['owner_id'] == me['id']:
            raise ApiError(403, 'নিজের প্রতিষ্ঠানে রিভিউ দেওয়া যায় না')
        if c.execute('SELECT 1 FROM reviews WHERE listing_id=? AND user_id=?', (lid, me['id'])).fetchone():
            raise ApiError(409, 'একটি প্রতিষ্ঠানে একবারই রিভিউ দেওয়া যায়')
        crit = {str(k)[:40]: max(1, min(5, int(v))) for k, v in (b.get('crit') or {}).items() if str(v).isdigit()} or None
        photo = save_image(b['photo'], 2 * 1024 * 1024) if b.get('photo') else None
        c.execute('INSERT INTO reviews (id, listing_id, stars, crit, name, text, photo, device, ip, created_at, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                  (new_id('r'), lid, stars, json.dumps(crit, ensure_ascii=False) if crit else None, me['name'],
                   s(b.get('text'), 1500), photo, 'u:%d' % me['id'], hashlib.sha256(h.ip().encode()).hexdigest()[:16], int(time.time()), me['id']))
        inc(c, 'reviews')
    bump()
    h.json({'ok': True})


@route('POST', r'/reviews/(\w+)/vote')
def api_vote(h, rid):
    dev, b = h.device(), h.body()
    col = 'up' if b.get('up') else 'down'
    with db() as c:
        try:
            c.execute('INSERT INTO votes VALUES (?,?)', (rid, dev))
        except sqlite3.IntegrityError:
            raise ApiError(409, 'আপনি আগেই ভোট দিয়েছেন')
        c.execute(f'UPDATE reviews SET {col}={col}+1 WHERE id=?', (rid,))
    h.json({'ok': True})


@route('POST', '/reports')
def api_report(h):
    b = h.body()
    if not rate_ok('rep:' + h.who(), 20, 86400):
        raise ApiError(429, 'অনেক রিপোর্ট পাঠানো হয়েছে, পরে চেষ্টা করুন')
    reason = s(b.get('reason'), 600)
    if not reason:
        raise ApiError(400, 'কারণ লিখুন')
    kind = 'review' if b.get('review') else 'classified' if b.get('classified') else 'info'
    with db() as c:
        c.execute('INSERT INTO reports (id, kind, listing_id, review_id, reason, created_at) VALUES (?,?,?,?,?,?)',
                  (new_id('p'), kind, s(b.get('listing') or b.get('classified'), 40), s(b.get('review'), 40), reason, int(time.time())))
    h.json({'ok': True})


@route('POST', '/track')
def api_track(h):
    b = h.body()
    col = {'view': 'views', 'call': 'calls', 'map': 'maps'}.get(b.get('type'))
    if col and rate_ok(f'tr:{h.who()}:{b.get("id")}:{col}', 3, 3600):
        with db() as c:
            c.execute(f'UPDATE listings SET {col}={col}+1 WHERE id=?', (resolve_lid(c, str(b.get('id'))),))
            inc(c, col)
    h.send(204)


@route('POST', '/impressions')
def api_impressions(h):
    """How often promoted listings were actually shown on screen — proof for the businesses that pay for it."""
    ids = [str(x)[:60] for x in (h.body().get('ids') or [])[:30]]
    who = h.who()
    with db() as c:
        for lid in ids:
            if rate_ok(f'imp:{who}:{lid}', 1, 1800):
                c.execute('UPDATE listings SET imps=imps+1 WHERE id=?', (resolve_lid(c, lid),))
    h.send(204)


@route('POST', '/adtrack')
def api_adtrack(h):
    b = h.body()
    col = {'imp': 'imps', 'click': 'clicks'}.get(b.get('type'))
    aid = s(b.get('id'), 40)
    if col and aid and rate_ok(f'ad:{h.who()}:{aid}:{col}', 20 if col == 'imps' else 5, 3600):
        with db() as c:
            c.execute(f'INSERT INTO adstats (id, {col}) VALUES (?,1) ON CONFLICT(id) DO UPDATE SET {col}={col}+1', (aid,))
            if col == 'clicks':
                inc(c, 'adclicks')
    h.send(204)


@route('GET', '/classifieds')
def api_classifieds(h):
    kind = h.query.get('kind')
    q = "SELECT * FROM classifieds WHERE review='approved' AND expires_at>?"
    args = [int(time.time())]
    if kind in CLASS_KINDS:
        q += ' AND kind=?'
        args.append(kind)
    with db() as c:
        rows = c.execute(q + ' ORDER BY created_at DESC LIMIT 300', args).fetchall()
    h.json([classified_out(r) for r in rows])


@route('GET', r'/classifieds/(\w+)')
def api_classified(h, cid):
    with db() as c:
        r = c.execute("SELECT * FROM classifieds WHERE id=? AND review='approved' AND expires_at>?", (cid, int(time.time()))).fetchone()
        if not r:
            raise ApiError(404, 'বিজ্ঞাপনটি পাওয়া যায়নি বা মেয়াদ শেষ')
        if rate_ok(f'cv:{h.who()}:{cid}', 1, 3600):
            c.execute('UPDATE classifieds SET views=views+1 WHERE id=?', (cid,))
    h.json(classified_out(r))


@route('POST', '/maplink')
def api_maplink(h):
    """Turn a pasted Google Maps link into coordinates (used by the app's and the admin's forms)."""
    url = str(h.body().get('url') or '').strip()[:1000]
    if not rate_ok('map:' + h.who(), 30, 3600):
        raise ApiError(429, 'অনেকবার চেষ্টা হয়েছে, পরে আবার চেষ্টা করুন')
    found = coords_from_text(url)
    if not found and map_host_ok(url):
        try:
            found = resolve_map_link(url)
        except (OSError, http.client.HTTPException):
            raise ApiError(502, 'লিংকটি খোলা যায়নি, আবার চেষ্টা করুন')
    if not found:
        raise ApiError(400, 'লিংক থেকে লোকেশন পাওয়া যায়নি। Google Maps-এ জায়গাটি খুলে "Share" থেকে লিংক কপি করুন।')
    h.json({'lat': found[0], 'lng': found[1]})
