#!/usr/bin/env python3
"""Jashore360 server — landing page, web app, admin panel, JSON API and SQLite storage.

Standard library only (Python 3.9+), so a stock Ubuntu VPS can run it as-is.

    python3 server.py --data ./data                          # serve on 127.0.0.1:8360
    python3 server.py --data ./data ensure-admin             # create owner 'admin' if no admin exists, print password
    python3 server.py --data ./data reset-password admin
    python3 server.py --data ./data import-apk FILE.apk 1.0.0 1 "release notes"
"""
import argparse
import base64
import gzip
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import shutil
import sqlite3
import sys
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.normpath(os.path.join(HERE, '..', 'public'))
SEED = os.path.join(HERE, 'seed.json')
DATA = DB_PATH = UPLOADS = DOWNLOADS = None

SESSION_DAYS = 30
MAX_BODY = 12 * 1024 * 1024
MAX_APK = 80 * 1024 * 1024
TEXT_TYPES = ('text/', 'application/javascript', 'application/json', 'image/svg+xml', 'application/manifest+json')
mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('image/webp', '.webp')
mimetypes.add_type('video/mp4', '.mp4')
mimetypes.add_type('video/webm', '.webm')
mimetypes.add_type('video/quicktime', '.mov')

SETTING_KEYS = ('site', 'areas', 'categories', 'notices', 'ads', 'plans', 'payment', 'app', 'terms')
DICT_SETTINGS = ('site', 'payment', 'app', 'terms')
MODERATOR_SETTINGS = {'notices'}           # every other setting is owner-only
CLASS_KINDS = ('job', 'rent', 'mess')
CLASS_DAYS = 30
STATUSES = ('verified', 'pending', 'needs_update', 'temp_closed', 'closed')
MAX_IMAGES, MAX_VIDEOS = 10, 2
MAX_IMAGE_BYTES, MAX_VIDEO_BYTES = 8 * 1024 * 1024, 60 * 1024 * 1024


# ---------------------------------------------------------------- storage

def db():
    c = sqlite3.connect(DB_PATH, timeout=15)
    c.row_factory = sqlite3.Row
    return c


SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY, doc TEXT NOT NULL,
  review TEXT NOT NULL DEFAULT 'approved',      -- approved | pending | unpaid | rejected
  source TEXT NOT NULL DEFAULT 'admin',          -- seed | admin | user
  contact TEXT, created_at INTEGER, updated_at INTEGER,
  views INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, maps INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, stars INTEGER NOT NULL, crit TEXT, name TEXT, text TEXT, photo TEXT,
  device TEXT, ip TEXT, hidden INTEGER NOT NULL DEFAULT 0, reply TEXT, up INTEGER NOT NULL DEFAULT 0,
  down INTEGER NOT NULL DEFAULT 0, created_at INTEGER, UNIQUE(listing_id, device));
CREATE INDEX IF NOT EXISTS reviews_listing ON reviews(listing_id);
CREATE TABLE IF NOT EXISTS votes (review_id TEXT, device TEXT, PRIMARY KEY (review_id, device));
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, kind TEXT, listing_id TEXT, review_id TEXT, reason TEXT, created_at INTEGER,
  done INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass TEXT NOT NULL, created_at INTEGER);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, admin TEXT, action TEXT, target TEXT, at INTEGER);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, pass TEXT NOT NULL,
  banned INTEGER NOT NULL DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS usessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, user_id INTEGER, listing_id TEXT, plan_id TEXT, amount INTEGER, method TEXT, trx TEXT, sender TEXT,
  status TEXT NOT NULL DEFAULT 'submitted', note TEXT, created_at INTEGER, decided_at INTEGER, decided_by TEXT);
CREATE TABLE IF NOT EXISTS classifieds (
  id TEXT PRIMARY KEY, user_id INTEGER, kind TEXT NOT NULL, doc TEXT NOT NULL, review TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER, updated_at INTEGER, expires_at INTEGER, views INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, metric TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, metric));
CREATE TABLE IF NOT EXISTS adstats (id TEXT PRIMARY KEY, imps INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS media (name TEXT PRIMARY KEY, user_id INTEGER, kind TEXT NOT NULL, size INTEGER, created_at INTEGER);
"""

MIGRATIONS = [('listings', 'owner_id', 'INTEGER'), ('listings', 'plan', 'TEXT'), ('listings', 'paid_until', 'TEXT'),
              ('reviews', 'user_id', 'INTEGER'), ('admins', 'role', "TEXT NOT NULL DEFAULT 'owner'"),
              ('users', 'terms_v', 'INTEGER'), ('users', 'terms_at', 'INTEGER')]


def init_db():
    for d in (DATA, UPLOADS, DOWNLOADS):
        os.makedirs(d, exist_ok=True)
    seed = json.load(open(SEED, encoding='utf-8'))
    with db() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript(SCHEMA)
        for table, col, decl in MIGRATIONS:
            if not any(r[1] == col for r in c.execute(f'PRAGMA table_info({table})')):
                c.execute(f'ALTER TABLE {table} ADD COLUMN {col} {decl}')
        fresh = c.execute('SELECT COUNT(*) FROM settings').fetchone()[0] == 0
        have = {r[0] for r in c.execute('SELECT key FROM settings')}
        for k in SETTING_KEYS:
            if k in have:
                continue
            val = seed.get(k, {} if k in DICT_SETTINGS else [])
            if k == 'ads' and 'banners' in have:      # older installs kept homepage banners under "banners"
                val = [dict(b, placement='home') for b in json.loads(c.execute("SELECT value FROM settings WHERE key='banners'").fetchone()[0])]
            c.execute('INSERT INTO settings VALUES (?,?)', (k, json.dumps(val, ensure_ascii=False)))
        for key in ('site', 'payment'):                # new fields (e.g. English text) for settings that already exist
            if key in have:
                cur = json.loads(c.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()[0])
                merged = {**seed.get(key, {}), **cur}
                if merged != cur:
                    c.execute('UPDATE settings SET value=? WHERE key=?', (json.dumps(merged, ensure_ascii=False), key))
        for key in ('ads', 'notices'):                 # English text for the seeded banners and notices
            if key in have or key == 'ads':
                row = c.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
                cur, seeded = json.loads(row[0]), {x['id']: x for x in seed.get(key, [])}
                for x in cur:
                    for f, v in seeded.get(x.get('id'), {}).items():
                        if f.endswith('En') and f not in x:
                            x[f] = v
                    if x.get('subtitle') == 'বিনামূল্যে প্রোফাইল — যাচাইয়ের পর প্রকাশিত হবে':   # old stock text; listing is paid now
                        x.update({f: seeded[x['id']][f] for f in ('subtitle', 'subtitleEn', 'link') if f in seeded.get(x['id'], {})})
                c.execute('UPDATE settings SET value=? WHERE key=?', (json.dumps(cur, ensure_ascii=False), key))
        if 'categories' in have:                       # give older category lists the pricing fields
            cats = json.loads(c.execute("SELECT value FROM settings WHERE key='categories'").fetchone()[0])
            seeded = {x['id']: x for x in seed['categories']}
            changed = False
            for x in cats:
                for f in ('paid', 'freeSubs', 'subsEn'):
                    if f not in x and x['id'] in seeded:
                        x[f] = seeded[x['id']][f]
                        changed = True
            if changed:
                c.execute("UPDATE settings SET value=? WHERE key='categories'", (json.dumps(cats, ensure_ascii=False),))
        if fresh:
            now = int(time.time())
            for it in seed.get('listings', []):
                c.execute('INSERT OR IGNORE INTO listings (id, doc, review, source, created_at, updated_at) VALUES (?,?,?,?,?,?)',
                          (it['id'], json.dumps(it, ensure_ascii=False), 'approved', 'seed', now, now))


def get_setting(c, key):
    row = c.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return json.loads(row[0]) if row else None


def new_id(prefix=''):
    return prefix + secrets.token_hex(6)


def today():
    return time.strftime('%Y-%m-%d')


def inc(c, metric, n=1):
    c.execute('INSERT INTO daily (day, metric, n) VALUES (?,?,?) ON CONFLICT(day, metric) DO UPDATE SET n=n+?', (today(), metric, n, n))


# ---------------------------------------------------------------- caches

_version = [int(time.time())]
_boot_cache = {}
_static_cache = {}
_lock = threading.Lock()


def bump():
    with _lock:
        _version[0] += 1
        _boot_cache.clear()


def live_ads(ads):
    t = today()
    return [a for a in ads or [] if a.get('active', True) and (not a.get('start') or a['start'] <= t) and (not a.get('end') or a['end'] >= t)]


def bootstrap_payload():
    v = _version[0]
    hit = _boot_cache.get(v)
    if hit:
        return hit
    t = today()
    with db() as c:
        ratings = {r[0]: (round(r[1], 2), r[2]) for r in
                   c.execute('SELECT listing_id, AVG(stars), COUNT(*) FROM reviews WHERE hidden=0 GROUP BY listing_id')}
        listings = []
        for r in c.execute("SELECT id, doc, paid_until FROM listings WHERE review='approved'"):
            d = json.loads(r['doc'])
            if d.get('hidden') or (r['paid_until'] and r['paid_until'] < t):
                continue
            d['id'] = r['id']
            if r['id'] in ratings:
                d['rating'], d['reviews'] = ratings[r['id']]
            listings.append(d)
        out = {k: get_setting(c, k) for k in SETTING_KEYS}
        counts = {k: 0 for k in CLASS_KINDS}
        for r in c.execute("SELECT kind, COUNT(*) FROM classifieds WHERE review='approved' AND expires_at>? GROUP BY kind", (int(time.time()),)):
            counts[r[0]] = r[1]
    out['ads'] = live_ads(out['ads'])
    out['notices'] = [n for n in out['notices'] or [] if n.get('active', True)]
    out['categories'] = [x for x in out['categories'] or [] if x.get('active', True)]
    out['listings'] = listings
    out['classifiedCounts'] = counts
    out['v'] = v
    raw = json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode()
    entry = (raw, gzip.compress(raw, 6), '"b%d"' % v)
    _boot_cache[v] = entry
    return entry


# ---------------------------------------------------------------- security helpers

def hash_pw(pw, salt=None):
    salt = salt or secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return 'scrypt$' + base64.b64encode(salt).decode() + '$' + base64.b64encode(h).decode()


def check_pw(pw, stored):
    try:
        _, s_, h = stored.split('$')
        return hmac.compare_digest(hash_pw(pw, base64.b64decode(s_)).split('$')[2], h)
    except Exception:
        return False


_hits = {}


def rate_ok(key, limit, window):
    now = time.time()
    with _lock:
        q = [t for t in _hits.get(key, []) if now - t < window]
        ok = len(q) < limit
        if ok:
            q.append(now)
        _hits[key] = q
    return ok


IMG_SIG = {b'\xff\xd8\xff': 'jpg', b'\x89PNG': 'png', b'RIFF': 'webp'}


def save_image(data_url, max_bytes):
    m = re.match(r'^data:image/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$', data_url or '')
    if not m:
        raise ValueError('ছবির ফরম্যাট সঠিক নয়')
    raw = base64.b64decode(m.group(2))
    if len(raw) > max_bytes:
        raise ValueError('ছবি অনেক বড়')
    ext = next((e for sig, e in IMG_SIG.items() if raw.startswith(sig)), None)
    if not ext or (ext == 'webp' and raw[8:12] != b'WEBP'):
        raise ValueError('ছবির ফরম্যাট সঠিক নয়')
    name = secrets.token_hex(12) + '.' + ext
    with open(os.path.join(UPLOADS, name), 'wb') as f:
        f.write(raw)
    return '/uploads/' + name


UPLOAD_RE = re.compile(r'^/uploads/([a-f0-9]{24}\.(jpg|png|webp|mp4|webm|mov))$')
IMAGE_EXTS, VIDEO_EXTS = ('jpg', 'png', 'webp'), ('mp4', 'webm', 'mov')


def sniff(head, kind):
    if kind == 'image':
        ext = next((e for sig, e in IMG_SIG.items() if head.startswith(sig)), None)
        return None if ext == 'webp' and head[8:12] != b'WEBP' else ext
    if head[4:8] == b'ftyp':
        return 'mov' if head[8:10] == b'qt' else 'mp4'
    return 'webm' if head.startswith(b'\x1aE\xdf\xa3') else None


def clean_media(d, uid=None, keep=()):
    """images/videos lists from a form. Users may only attach files they uploaded themselves (or that the item already had)."""
    allowed = None
    if uid is not None:
        names = [m.group(1) for k in ('images', 'videos') if isinstance(d.get(k), list)
                 for u in d[k] if isinstance(u, str) for m in [UPLOAD_RE.match(u)] if m][:40]
        allowed = {u.rsplit('/', 1)[-1] for u in keep}
        if names:
            with db() as c:
                allowed |= {r[0] for r in c.execute('SELECT name FROM media WHERE user_id=? AND name IN (%s)' % ','.join('?' * len(names)), (uid, *names))}
    out = {}
    for key, exts, cap in (('images', IMAGE_EXTS, MAX_IMAGES), ('videos', VIDEO_EXTS, MAX_VIDEOS)):
        urls = []
        for u in d.get(key) if isinstance(d.get(key), list) else []:
            m = UPLOAD_RE.match(u) if isinstance(u, str) else None
            ok = m and m.group(2) in exts and (allowed is None or m.group(1) in allowed)
            ok = ok or (uid is None and key == 'images' and isinstance(u, str) and re.match(r'^https://\S+$', u))
            if ok and u not in urls:
                urls.append(u)
        out[key] = urls[:cap] or None
    return out


BN_DIGITS = str.maketrans('০১২৩৪৫৬৭৮৯', '0123456789')


def norm_phone(p):
    p = re.sub(r'\D', '', str(p or '').translate(BN_DIGITS))
    if p.startswith('880'):
        p = p[2:]
    return p if re.match(r'^01[3-9]\d{8}$', p) else None


# ---------------------------------------------------------------- validation

def s(v, n=200):
    return str(v).strip()[:n] if v not in (None, '') else None


def to_int(v):
    try:
        return int(str(v).translate(BN_DIGITS).replace(',', '').strip()) if v not in (None, '') else None
    except ValueError:
        return None


def categories():
    with db() as c:
        return {x['id']: x for x in (get_setting(c, 'categories') or [])}


def needs_payment(cat, sub):
    return bool(cat.get('paid')) and sub not in (cat.get('freeSubs') or [])


def clean_listing(d, admin):
    cats = categories()
    out = {
        'cat': s(d.get('cat'), 40), 'sub': s(d.get('sub'), 40), 'name': s(d.get('name'), 120),
        'nameEn': s(d.get('nameEn'), 120), 'area': s(d.get('area'), 60), 'address': s(d.get('address'), 200),
        'phone': s(re.sub(r'[^\d+]', '', str(d.get('phone') or '').translate(BN_DIGITS)), 20),
        'phone2': s(re.sub(r'[^\d+]', '', str(d.get('phone2') or '').translate(BN_DIGITS)), 20),
        'web': s(d.get('web'), 300) if re.match(r'^https?://', str(d.get('web') or '')) else None,
        'facebook': s(d.get('facebook'), 300) if re.match(r'^https?://', str(d.get('facebook') or '')) else None,
        'hours': s(d.get('hours'), 20) if re.match(r'^(24h|\d\d:\d\d-\d\d:\d\d)$', str(d.get('hours') or '')) else None,
        'note': s(d.get('note'), 400), 'about': s(d.get('about'), 3000), 'price': to_int(d.get('price')),
    }
    if out['cat'] not in cats:
        raise ValueError('ক্যাটাগরি সঠিক নয়')
    if not out['name']:
        raise ValueError('নাম দিন')
    out['off'] = [int(x) for x in d.get('off') or [] if str(x).isdigit() and 0 <= int(x) <= 6][:7] or None
    for k in ('features', 'tags'):
        v = d.get(k) or []
        if isinstance(v, str):
            v = v.split(',')
        out[k] = [str(x).strip()[:40] for x in v if str(x).strip()][:20] or None
    for k in ('lat', 'lng'):
        try:
            out[k] = round(float(d[k]), 6) if d.get(k) not in (None, '') else None
        except (TypeError, ValueError):
            out[k] = None
    if admin:
        out.update(clean_media(d))
        out['status'] = d.get('status') if d.get('status') in STATUSES else 'pending'
        out['verifiedAt'] = s(d.get('verifiedAt'), 10)
        if out['status'] == 'verified' and not out['verifiedAt']:
            out['verifiedAt'] = today()
        for k in ('demo', 'sponsored', 'featured', 'pin', 'hidden'):
            out[k] = bool(d.get(k)) or None
    else:
        out['status'] = 'pending'
    return {k: v for k, v in out.items() if v is not None}


CLASS_FIELDS = {
    '*': {'title': 120, 'description': 3000, 'area': 60, 'address': 200, 'contactName': 60},
    'job': {'company': 120, 'jobType': 30, 'deadline': 10, 'qualification': 400, 'howToApply': 500, 'experience': 60},
    'rent': {'propertyType': 30, 'availableFrom': 10, 'floor': 20, 'facilities': 400},
    'mess': {'seatType': 30, 'gender': 10, 'availableFrom': 10, 'facilities': 400},
}
CLASS_NUMS = {'*': ('price',), 'job': ('vacancies',), 'rent': ('rooms', 'baths', 'size'), 'mess': ('seats',)}


def clean_classified(kind, d):
    if kind not in CLASS_KINDS:
        raise ValueError('ধরন সঠিক নয়')
    out = {}
    for group in ('*', kind):
        for k, n in CLASS_FIELDS[group].items():
            out[k] = s(d.get(k), n)
        for k in CLASS_NUMS[group]:
            out[k] = to_int(d.get(k))
    out['phone'] = norm_phone(d.get('phone'))
    out['whatsapp'] = norm_phone(d.get('whatsapp'))
    if not out['title']:
        raise ValueError('শিরোনাম দিন')
    if not out['phone']:
        raise ValueError('সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)')
    return {k: v for k, v in out.items() if v is not None}


# ---------------------------------------------------------------- HTTP

class ApiError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


ROUTES = []


def route(method, pattern, auth=None):
    """auth: None | 'user' | 'admin' | 'owner'"""
    def deco(fn):
        ROUTES.append((method, re.compile('^' + pattern + '$'), auth, fn))
        return fn
    return deco


class Handler(BaseHTTPRequestHandler):
    server_version = 'Jashore360'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        if os.environ.get('J360_LOG'):
            super().log_message(fmt, *args)

    def do_GET(self): self.dispatch('GET')
    def do_HEAD(self): self.dispatch('GET', head=True)
    def do_POST(self): self.dispatch('POST')
    def do_PUT(self): self.dispatch('PUT')
    def do_DELETE(self): self.dispatch('DELETE')

    # -- request helpers
    def ip(self):
        fwd = self.headers.get('X-Forwarded-For') or self.headers.get('X-Real-IP')
        return fwd.split(',')[0].strip() if fwd else self.client_address[0]

    def who(self):
        # Behind a proxy that doesn't forward the client IP every request looks local; fall back to the device cookie.
        ip = self.ip()
        return 'd:' + self.device() if ip in ('127.0.0.1', '::1', 'localhost') else ip

    def cookies(self):
        c = SimpleCookie()
        try:
            c.load(self.headers.get('Cookie', ''))
        except Exception:
            pass
        return {k: v.value for k, v in c.items()}

    def https(self):
        return self.headers.get('X-Forwarded-Proto', '') == 'https'

    def send(self, status, body=b'', ctype='application/json; charset=utf-8', headers=None, gz=None):
        self.send_response(status)
        headers = dict(headers or {})
        if gz is not None and 'gzip' in self.headers.get('Accept-Encoding', ''):
            body = gz
            headers['Content-Encoding'] = 'gzip'
        headers.setdefault('Vary', 'Accept-Encoding')
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        for k, v in headers.items():
            self.send_header(k, v)
        for c in self._set_cookies:
            self.send_header('Set-Cookie', c)
        self.end_headers()
        if not self._head:
            self.wfile.write(body)

    def json(self, obj, status=200, headers=None):
        raw = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode()
        h = {'Cache-Control': 'no-store'}
        h.update(headers or {})
        self.send(status, raw, headers=h, gz=gzip.compress(raw, 5) if len(raw) > 1024 else None)

    def set_cookie(self, name, value, max_age, http_only=True, same_site='Lax'):
        parts = [f'{name}={value}', 'Path=/', f'Max-Age={max_age}', f'SameSite={same_site}']
        if http_only:
            parts.append('HttpOnly')
        if self.https():
            parts.append('Secure')
        self._set_cookies.append('; '.join(parts))

    def device(self):
        d = self.cookies().get('j360d')
        if not d or not re.match(r'^[a-f0-9]{24}$', d):
            d = secrets.token_hex(12)
            self.set_cookie('j360d', d, 5 * 365 * 86400, http_only=False)
            self._device = d
        return getattr(self, '_device', d)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_BODY:
            raise ApiError(413, 'অনুরোধ অনেক বড়')
        self._consumed = True
        if not n:
            return {}
        if 'application/json' not in self.headers.get('Content-Type', ''):
            raise ApiError(415, 'JSON প্রয়োজন')
        try:
            data = json.loads(self.rfile.read(n))
        except ValueError:
            raise ApiError(400, 'অনুরোধ সঠিক নয়')
        if not isinstance(data, (dict, list)):
            raise ApiError(400, 'অনুরোধ সঠিক নয়')
        return data

    def session_lookup(self, cookie, table, col, owner_table):
        tok = self.cookies().get(cookie)
        if not tok:
            return None
        with db() as c:
            r = c.execute(f'SELECT x.* FROM {table} s JOIN {owner_table} x ON x.id=s.{col} WHERE s.token=? AND s.expires>?',
                          (hashlib.sha256(tok.encode()).hexdigest(), int(time.time()))).fetchone()
        return dict(r) if r else None

    def admin(self):
        a = self.session_lookup('j360s', 'sessions', 'admin_id', 'admins')
        return {'id': a['id'], 'username': a['username'], 'role': a['role'] or 'owner'} if a else None

    def user(self):
        u = self.session_lookup('j360u', 'usessions', 'user_id', 'users')
        return {'id': u['id'], 'name': u['name'], 'phone': u['phone']} if u and not u['banned'] else None

    def start_session(self, table, col, uid, cookie, same_site):
        tok = secrets.token_urlsafe(32)
        with db() as c:
            c.execute(f'DELETE FROM {table} WHERE expires<?', (int(time.time()),))
            c.execute(f'INSERT INTO {table} (token, {col}, expires) VALUES (?,?,?)',
                      (hashlib.sha256(tok.encode()).hexdigest(), uid, int(time.time()) + SESSION_DAYS * 86400))
        self.set_cookie(cookie, tok, SESSION_DAYS * 86400, same_site=same_site)

    def end_session(self, table, cookie):
        tok = self.cookies().get(cookie)
        if tok:
            with db() as c:
                c.execute(f'DELETE FROM {table} WHERE token=?', (hashlib.sha256(tok.encode()).hexdigest(),))
        self.set_cookie(cookie, '', 0)

    def audit(self, action, target=''):
        with db() as c:
            c.execute('INSERT INTO audit (admin, action, target, at) VALUES (?,?,?,?)',
                      (self.staff['username'] if self.staff else '-', action, str(target)[:200], int(time.time())))

    def dispatch(self, method, head=False):
        self._head = head
        self._set_cookies = []
        self._consumed = False
        self.staff = self.me = None
        url = urlparse(self.path)
        path = unquote(url.path)
        self.query = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if path.startswith('/api/'):
                for m, rx, auth, fn in ROUTES:
                    mt = rx.match(path[4:])
                    if mt and m == method:
                        if auth in ('admin', 'owner') or path.startswith('/api/admin/'):
                            self.staff = self.admin()
                        if auth in ('admin', 'owner') and not self.staff:
                            raise ApiError(401, 'লগইন করুন')
                        if auth == 'owner' and self.staff['role'] != 'owner':
                            raise ApiError(403, 'শুধু মূল অ্যাডমিন এটি করতে পারেন')
                        if auth == 'user':
                            self.me = self.user()
                            if not self.me:
                                raise ApiError(401, 'এর জন্য অ্যাকাউন্টে লগইন করুন')
                        return fn(self, *mt.groups())
                raise ApiError(404, 'পাওয়া যায়নি')
            if method != 'GET':
                raise ApiError(405, 'অনুমোদিত নয়')
            if path in ('/download/jashore360.apk', '/download/app.apk'):
                return self.download_apk()
            return self.static(path)
        except ApiError as e:
            self.json({'error': str(e)}, e.status)
        except ValueError as e:
            self.json({'error': str(e)}, 400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # pragma: no cover
            sys.stderr.write(f'error {method} {self.path}: {e!r}\n')
            try:
                self.json({'error': 'সার্ভারে সমস্যা হয়েছে'}, 500)
            except Exception:
                pass
        finally:
            # Unread request bodies would be parsed as the start of the next request on a kept-alive connection.
            n = int(self.headers.get('Content-Length') or 0)
            if n and not self._consumed:
                if n <= MAX_BODY:
                    self.rfile.read(n)
                else:
                    self.close_connection = True

    def download_apk(self):
        with db() as c:
            app = get_setting(c, 'app') or {}
        f = app.get('file') and os.path.join(DOWNLOADS, os.path.basename(app['file']))
        if not f or not os.path.isfile(f):
            raise ApiError(404, 'অ্যাপ ফাইল এখনো যোগ করা হয়নি')
        with db() as c:
            inc(c, 'downloads')
        data = open(f, 'rb').read()
        self.send(200, data, 'application/vnd.android.package-archive', {
            'Content-Disposition': 'attachment; filename="Jashore360-%s.apk"' % re.sub(r'[^\w.]', '', app.get('versionName', '')),
            'Cache-Control': 'no-cache'})

    def upload_file(self, path):
        m = UPLOAD_RE.match(path)
        full = m and os.path.join(UPLOADS, m.group(1))
        if not full or not os.path.isfile(full):
            raise ApiError(404, 'পাওয়া যায়নি')
        size = os.path.getsize(full)
        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        start, end, status = 0, size - 1, 200
        rng = re.match(r'^bytes=(\d*)-(\d*)$', self.headers.get('Range', ''))
        if rng and size and (rng.group(1) or rng.group(2)):
            if rng.group(1):
                start, end = int(rng.group(1)), min(int(rng.group(2) or size - 1), size - 1)
            else:
                start = max(0, size - int(rng.group(2)))
            if start > end:
                self.send_response(416)
                self.send_header('Content-Range', 'bytes */%d' % size)
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            status = 206
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if status == 206:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.end_headers()
        if self._head:
            return
        with open(full, 'rb') as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(left, 256 * 1024))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def static(self, path):
        if path.startswith('/uploads/'):
            return self.upload_file(path)
        else:
            base, rel, cache = PUBLIC, path.lstrip('/'), 'no-cache'
            rel = {'': 'index.html', 'app': 'app.html', 'app/': 'app.html', 'admin': 'admin/index.html', 'admin/': 'admin/index.html'}.get(rel, rel)
        full = os.path.normpath(os.path.join(base, rel))
        if not full.startswith(base + os.sep) or not os.path.isfile(full) or os.path.basename(full).startswith('.'):
            if base == PUBLIC and '.' not in os.path.basename(rel):
                full = os.path.join(PUBLIC, 'app.html' if rel.startswith('app/') else 'index.html')
            else:
                raise ApiError(404, 'পাওয়া যায়নি')
        st = os.stat(full)
        etag = '"%x-%x"' % (int(st.st_mtime), st.st_size)
        if self.headers.get('If-None-Match') == etag:
            self.send_response(304)
            self.send_header('ETag', etag)
            self.send_header('Cache-Control', cache)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        key = (full, etag)
        hit = _static_cache.get(key)
        if not hit:
            raw = open(full, 'rb').read()
            ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
            if ctype.startswith('text/') or ctype in ('application/javascript', 'application/manifest+json'):
                ctype += '; charset=utf-8'
            gz = gzip.compress(raw, 6) if ctype.startswith(TEXT_TYPES) and len(raw) > 512 else None
            hit = (raw, gz, ctype)
            if len(raw) < 2 * 1024 * 1024:
                _static_cache[key] = hit
        raw, gz, ctype = hit
        self.send(200, raw, ctype, {'ETag': etag, 'Cache-Control': cache}, gz)


# ---------------------------------------------------------------- public API

@route('GET', '/bootstrap')
def api_bootstrap(h):
    h.device()
    raw, gz, etag = bootstrap_payload()
    if h.headers.get('If-None-Match') == etag and not h._set_cookies:
        h.send_response(304)
        h.send_header('ETag', etag)
        h.send_header('Content-Length', '0')
        h.end_headers()
        return
    h.send(200, raw, headers={'ETag': etag, 'Cache-Control': 'no-cache'}, gz=gz)


def review_row(r, include_private=False):
    d = {'id': r['id'], 'stars': r['stars'], 'crit': json.loads(r['crit']) if r['crit'] else None, 'name': r['name'],
         'text': r['text'], 'photo': r['photo'], 'reply': r['reply'], 'up': r['up'], 'down': r['down'], 't': r['created_at']}
    if include_private:
        d.update(listing=r['listing_id'], hidden=bool(r['hidden']), userId=r['user_id'])
    return d


@route('GET', r'/listings/([\w-]+)/reviews')
def api_reviews(h, lid):
    me = h.user()
    with db() as c:
        rows = c.execute('SELECT * FROM reviews WHERE listing_id=? AND hidden=0 ORDER BY created_at DESC LIMIT 200', (lid,)).fetchall()
        mine = me and c.execute('SELECT 1 FROM reviews WHERE listing_id=? AND user_id=?', (lid, me['id'])).fetchone()
    h.json({'reviews': [review_row(r) for r in rows], 'mine': bool(mine)})


@route('POST', '/reviews', auth='user')
def api_add_review(h):
    b, me = h.body(), h.me
    if not rate_ok('rv:%d' % me['id'], 15, 86400):
        raise ApiError(429, 'আজ অনেক রিভিউ দেওয়া হয়েছে, পরে চেষ্টা করুন')
    lid = str(b.get('listing') or '')
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
            c.execute(f'UPDATE listings SET {col}={col}+1 WHERE id=?', (str(b.get('id')),))
            inc(c, col)
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


# -- classifieds (public view)

def classified_out(r, private=False):
    d = json.loads(r['doc'])
    d.update(id=r['id'], kind=r['kind'], t=r['created_at'], expires=r['expires_at'], views=r['views'])
    if private:
        d.update(review=r['review'])
    return d


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


# ---------------------------------------------------------------- user accounts

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
    if len(pw) < 6:
        raise ApiError(400, 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষর')
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
    if not rate_ok(f'ulogin:{h.who()}:{phone}', 8, 900):
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
    h.json(h.user())


@route('PUT', '/my/profile', auth='user')
def my_profile(h):
    b = h.body()
    name = s(b.get('name'), 60)
    if not name:
        raise ApiError(400, 'নাম দিন')
    with db() as c:
        c.execute('UPDATE users SET name=? WHERE id=?', (name, h.me['id']))
        if b.get('newPassword'):
            u = c.execute('SELECT pass FROM users WHERE id=?', (h.me['id'],)).fetchone()
            if not check_pw(str(b.get('password') or ''), u['pass']):
                raise ApiError(400, 'বর্তমান পাসওয়ার্ড ভুল')
            if len(b['newPassword']) < 6:
                raise ApiError(400, 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষর')
            c.execute('UPDATE users SET pass=? WHERE id=?', (hash_pw(b['newPassword']), h.me['id']))
    h.json({'ok': True})


def listing_state(review, paid_until, pay):
    if review == 'unpaid':
        return 'payment_review' if pay and pay['status'] == 'submitted' else 'payment_rejected' if pay and pay['status'] == 'rejected' else 'unpaid'
    if review == 'approved' and paid_until and paid_until < today():
        return 'expired'
    return review


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
                             'plan': r['plan'], 'paidUntil': r['paid_until'], 'review': r['review'], 'views': r['views'], 'calls': r['calls'],
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
        c.execute('DELETE FROM classifieds WHERE id=? AND user_id=?', (cid, h.me['id']))
    bump()
    h.json({'ok': True})


@route('DELETE', r'/my/listings/([\w-]+)', auth='user')
def my_del_listing(h, lid):
    with db() as c:
        c.execute("DELETE FROM listings WHERE id=? AND owner_id=? AND review IN ('unpaid','pending','rejected')", (lid, h.me['id']))
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
    part = os.path.join(UPLOADS, name + '.part')
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
    os.replace(part, os.path.join(UPLOADS, name))
    with db() as c:
        c.execute('INSERT INTO media VALUES (?,?,?,?,?)', (name, h.me['id'], kind, n, int(time.time())))
    h.json({'url': '/uploads/' + name, 'kind': kind})


def user_media(h, b, keep=()):
    """Media for a user's form: uploaded URLs, plus base64 photos from older app versions."""
    m = clean_media(b, h.me['id'], keep)
    imgs = m['images'] or []
    for p in (b.get('photos') or [])[:max(0, MAX_IMAGES - len(imgs))]:
        try:
            imgs.append(save_image(p, 3 * 1024 * 1024))
        except ValueError as e:
            raise ApiError(400, str(e))
    return {'images': imgs or None, 'videos': m['videos']}


USER_LISTING_FIELDS = ('name', 'area', 'address', 'phone', 'phone2', 'hours', 'price', 'web', 'facebook', 'about', 'note', 'images', 'videos')


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


# ---------------------------------------------------------------- admin API

@route('POST', '/admin/login')
def adm_login(h):
    b = h.body()
    if not rate_ok('login:' + h.ip() + ':' + str(b.get('username') or '').lower()[:30], 8, 900):
        raise ApiError(429, 'অনেকবার চেষ্টা হয়েছে, ১৫ মিনিট পর আবার চেষ্টা করুন')
    with db() as c:
        a = c.execute('SELECT * FROM admins WHERE username=?', (str(b.get('username') or '').strip().lower(),)).fetchone()
    if not a or not check_pw(str(b.get('password') or ''), a['pass']):
        raise ApiError(401, 'ইউজারনেম বা পাসওয়ার্ড ভুল')
    h.start_session('sessions', 'admin_id', a['id'], 'j360s', 'Strict')
    h.staff = {'username': a['username']}
    h.audit('login')
    h.json({'ok': True, 'username': a['username'], 'role': a['role'] or 'owner'})


@route('POST', '/admin/logout')
def adm_logout(h):
    h.end_session('sessions', 'j360s')
    h.json({'ok': True})


@route('GET', '/admin/me', auth='admin')
def adm_me(h):
    h.json(h.staff)


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
        series = {m: [0] * 30 for m in ('views', 'calls', 'maps', 'signups', 'reviews', 'submissions', 'classifieds', 'downloads', 'adclicks')}
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
            'days': days, 'series': series, 'top': top,
            'audit': [dict(r) for r in c.execute('SELECT admin, action, target, at FROM audit ORDER BY id DESC LIMIT 10')],
        }
    h.json(out)


def listing_out(r, pay=None, owner=None):
    d = json.loads(r['doc'])
    d.update(id=r['id'], _review=r['review'], _source=r['source'], _contact=r['contact'], _created=r['created_at'],
             _updated=r['updated_at'], _views=r['views'], _calls=r['calls'], _maps=r['maps'], _plan=r['plan'],
             _paidUntil=r['paid_until'], _owner=owner, _payment=pay)
    return d


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


@route('DELETE', r'/admin/listings/([\w-]+)', auth='admin')
def adm_delete(h, lid):
    with db() as c:
        r = c.execute('SELECT doc FROM listings WHERE id=?', (lid,)).fetchone()
        c.execute('DELETE FROM listings WHERE id=?', (lid,))
        c.execute('DELETE FROM reviews WHERE listing_id=?', (lid,))
    bump()
    h.audit('listing.delete', json.loads(r['doc'])['name'] if r else lid)
    h.json({'ok': True})


# -- payments

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
            review = 'approved' if b.get('publish') else ('pending' if l['review'] == 'unpaid' else l['review'])
            c.execute('UPDATE listings SET paid_until=?, plan=?, review=?, doc=?, updated_at=? WHERE id=?',
                      (until, p['plan_id'], review, json.dumps(doc, ensure_ascii=False), now, l['id']))
    bump()
    h.audit('payment.' + decision, pid)
    h.json({'ok': True})


# -- users

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


# -- classifieds

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


# -- reviews & reports

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


# -- settings, ads, uploads

@route('GET', r'/admin/settings/(\w+)', auth='admin')
def adm_get_setting(h, key):
    if key not in SETTING_KEYS:
        raise ApiError(404, 'পাওয়া যায়নি')
    with db() as c:
        h.json(get_setting(c, key))


@route('PUT', r'/admin/settings/(\w+)', auth='admin')
def adm_put_setting(h, key):
    if key not in SETTING_KEYS:
        raise ApiError(404, 'পাওয়া যায়নি')
    if key not in MODERATOR_SETTINGS and h.staff['role'] != 'owner':
        raise ApiError(403, 'শুধু মূল অ্যাডমিন এটি করতে পারেন')
    val = h.body()
    expected = dict if key in DICT_SETTINGS else list
    if not isinstance(val, expected):
        raise ApiError(400, 'ফরম্যাট সঠিক নয়')
    if key == 'categories':
        ids = [c_.get('id') for c_ in val]
        if any(not re.match(r'^[a-z0-9-]{2,30}$', str(i)) for i in ids) or len(set(ids)) != len(ids):
            raise ApiError(400, 'ক্যাটাগরি আইডি সঠিক নয় বা একই আইডি দুবার আছে')
        with db() as c:
            used = {r[0] for r in c.execute("SELECT DISTINCT json_extract(doc,'$.cat') FROM listings")}
        missing = used - set(ids)
        if missing:
            raise ApiError(400, 'এই ক্যাটাগরিতে তথ্য আছে, আগে সেগুলো সরান: ' + ', '.join(sorted(missing)))
    if key == 'plans':
        for p in val:
            if not re.match(r'^[a-z0-9-]{2,30}$', str(p.get('id'))) or to_int(p.get('price')) is None:
                raise ApiError(400, 'প্যাকেজের আইডি ও দাম সঠিকভাবে দিন')
            p['price'], p['days'] = to_int(p['price']), to_int(p.get('days')) or 365
    with db() as c:
        if key == 'terms':                         # a new version makes everyone accept again
            old = get_setting(c, 'terms') or {}
            val = {'bn': s(val.get('bn'), 30000) or '', 'en': s(val.get('en'), 30000) or '', 'updated': today(),
                   'version': (old.get('version') or 0) + (1 if (val.get('bn'), val.get('en')) != (old.get('bn'), old.get('en')) else 0)}
        c.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (key, json.dumps(val, ensure_ascii=False)))
    bump()
    h.audit('settings.' + key)
    h.json({'ok': True})


@route('GET', '/admin/adstats', auth='owner')
def adm_adstats(h):
    with db() as c:
        h.json({r['id']: {'imps': r['imps'], 'clicks': r['clicks']} for r in c.execute('SELECT * FROM adstats')})


@route('POST', '/admin/upload', auth='admin')
def adm_upload(h):
    h.json({'url': save_image(h.body().get('data'), 6 * 1024 * 1024)})


def store_apk(raw, version_name, version_code, notes, c):
    if not raw.startswith(b'PK'):
        raise ApiError(400, 'এটি সঠিক APK ফাইল নয়')
    name = 'jashore360-%d.apk' % version_code
    with open(os.path.join(DOWNLOADS, name), 'wb') as f:
        f.write(raw)
    old = get_setting(c, 'app') or {}
    app = {'versionName': version_name, 'versionCode': version_code, 'notes': notes, 'file': name,
           'size': len(raw), 'updated': today(), 'sha256': hashlib.sha256(raw).hexdigest()}
    c.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('app', json.dumps(app, ensure_ascii=False)))
    if old.get('file') and old['file'] != name:          # keep only the current and the previous build
        for fn in os.listdir(DOWNLOADS):
            if fn.endswith('.apk') and fn not in (name, old['file']):
                os.remove(os.path.join(DOWNLOADS, fn))
    return app


@route('POST', '/admin/apk', auth='owner')
def adm_apk(h):
    n = int(h.headers.get('Content-Length') or 0)
    if not 0 < n <= MAX_APK:
        raise ApiError(413, 'ফাইল সর্বোচ্চ ৮০ MB')
    vname = s(h.query.get('versionName'), 20)
    vcode = to_int(h.query.get('versionCode'))
    if not vname or not vcode:
        raise ApiError(400, 'ভার্সন নাম ও কোড দিন')
    raw = h.rfile.read(n)
    h._consumed = True
    with db() as c:
        app = store_apk(raw, vname, vcode, s(h.query.get('notes'), 500), c)
    bump()
    h.audit('app.release', vname)
    h.json(app)


# -- admins

@route('GET', '/admin/admins', auth='owner')
def adm_admins(h):
    with db() as c:
        h.json([dict(r) for r in c.execute('SELECT id, username, role, created_at FROM admins ORDER BY id')])


@route('POST', '/admin/admins', auth='owner')
def adm_add_admin(h):
    b = h.body()
    u, pw = str(b.get('username') or '').strip().lower(), str(b.get('password') or '')
    role = 'owner' if b.get('role') == 'owner' else 'moderator'
    if not re.match(r'^[a-z0-9_.-]{3,30}$', u):
        raise ApiError(400, 'ইউজারনেম: ৩-৩০ অক্ষর, ইংরেজি ছোট হাতের অক্ষর/সংখ্যা')
    if len(pw) < 8:
        raise ApiError(400, 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষর')
    with db() as c:
        try:
            c.execute('INSERT INTO admins (username, pass, created_at, role) VALUES (?,?,?,?)', (u, hash_pw(pw), int(time.time()), role))
        except sqlite3.IntegrityError:
            raise ApiError(409, 'এই ইউজারনেম আগেই আছে')
    h.audit('admin.add', f'{u} ({role})')
    h.json({'ok': True})


@route('DELETE', r'/admin/admins/(\d+)', auth='owner')
def adm_del_admin(h, aid):
    if int(aid) == h.staff['id']:
        raise ApiError(400, 'নিজের অ্যাকাউন্ট মুছতে পারবেন না')
    with db() as c:
        c.execute('DELETE FROM sessions WHERE admin_id=?', (aid,))
        c.execute('DELETE FROM admins WHERE id=?', (aid,))
    h.audit('admin.delete', aid)
    h.json({'ok': True})


@route('POST', '/admin/password', auth='admin')
def adm_password(h):
    b = h.body()
    with db() as c:
        a = c.execute('SELECT pass FROM admins WHERE id=?', (h.staff['id'],)).fetchone()
        if not check_pw(str(b.get('current') or ''), a['pass']):
            raise ApiError(400, 'বর্তমান পাসওয়ার্ড ভুল')
        if len(str(b.get('new') or '')) < 8:
            raise ApiError(400, 'নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষর')
        c.execute('UPDATE admins SET pass=? WHERE id=?', (hash_pw(b['new']), h.staff['id']))
    h.audit('admin.password')
    h.json({'ok': True})


@route('GET', '/admin/export', auth='owner')
def adm_export(h):
    with db() as c:
        out = {k: get_setting(c, k) for k in SETTING_KEYS}
        out['listings'] = [listing_out(r) for r in c.execute('SELECT * FROM listings')]
        out['reviews'] = [review_row(r, True) for r in c.execute('SELECT * FROM reviews')]
        out['reports'] = [dict(r) for r in c.execute('SELECT * FROM reports')]
        out['classifieds'] = [classified_out(r, True) for r in c.execute('SELECT * FROM classifieds')]
        out['payments'] = [dict(r) for r in c.execute('SELECT * FROM payments')]
        out['users'] = [dict(r) for r in c.execute('SELECT id, name, phone, banned, created_at FROM users')]
        out['exportedAt'] = time.strftime('%Y-%m-%d %H:%M')
    raw = json.dumps(out, ensure_ascii=False, indent=1).encode()
    h.send(200, raw, headers={'Content-Disposition': 'attachment; filename="jashore360-backup-%s.json"' % time.strftime('%Y%m%d'),
                              'Cache-Control': 'no-store'})


# ---------------------------------------------------------------- CLI

def set_paths(data):
    global DATA, DB_PATH, UPLOADS, DOWNLOADS
    DATA = os.path.abspath(data)
    DB_PATH = os.path.join(DATA, 'jashore360.db')
    UPLOADS = os.path.join(DATA, 'uploads')
    DOWNLOADS = os.path.join(DATA, 'downloads')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.path.join(HERE, 'data'))
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=8360)
    ap.add_argument('cmd', nargs='?', default='serve', choices=['serve', 'ensure-admin', 'reset-password', 'import-apk'])
    ap.add_argument('args', nargs='*')
    a = ap.parse_args()
    set_paths(a.data)
    init_db()
    if a.cmd in ('ensure-admin', 'reset-password'):
        user = (a.args or ['admin'])[0]
        pw = secrets.token_urlsafe(9)
        with db() as c:
            if a.cmd == 'ensure-admin':
                if c.execute('SELECT COUNT(*) FROM admins').fetchone()[0]:
                    return
                c.execute("INSERT INTO admins (username, pass, created_at, role) VALUES (?,?,?,'owner')", (user, hash_pw(pw), int(time.time())))
            else:
                if not c.execute('UPDATE admins SET pass=? WHERE username=?', (hash_pw(pw), user)).rowcount:
                    c.execute("INSERT INTO admins (username, pass, created_at, role) VALUES (?,?,?,'owner')", (user, hash_pw(pw), int(time.time())))
                c.execute('DELETE FROM sessions')
        print(f'username: {user}\npassword: {pw}')
        return
    if a.cmd == 'import-apk':
        path, vname, vcode = a.args[0], a.args[1], int(a.args[2])
        notes = a.args[3] if len(a.args) > 3 else ''
        with db() as c:
            cur = (get_setting(c, 'app') or {}).get('versionCode') or 0
            if vcode <= cur:
                print(f'APK {vname} ({vcode}) already current (installed: {cur})')
                return
            store_apk(open(path, 'rb').read(), vname, vcode, notes, c)
        print(f'APK {vname} ({vcode}) published')
        return
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    srv.daemon_threads = True
    print(f'Jashore360 running on http://{a.host}:{a.port}  (data: {DATA})', flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
