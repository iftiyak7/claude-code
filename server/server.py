#!/usr/bin/env python3
"""Jashore360 server — static files, JSON API and SQLite storage.

Standard library only (Python 3.9+), so a stock Ubuntu VPS can run it as-is.

    python3 server.py --data ./data                  # serve on 127.0.0.1:8360
    python3 server.py --data ./data ensure-admin     # create 'admin' if no admin exists, print password
    python3 server.py --data ./data reset-password admin
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
DATA = DB_PATH = UPLOADS = None

SESSION_DAYS = 14
MAX_BODY = 12 * 1024 * 1024
TEXT_TYPES = ('text/', 'application/javascript', 'application/json', 'image/svg+xml', 'application/manifest+json')
mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('image/webp', '.webp')

SETTING_KEYS = ('site', 'areas', 'categories', 'banners', 'notices')


# ---------------------------------------------------------------- storage

def db():
    c = sqlite3.connect(DB_PATH, timeout=15)
    c.row_factory = sqlite3.Row
    return c


SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY, doc TEXT NOT NULL,
  review TEXT NOT NULL DEFAULT 'approved',      -- approved | pending | rejected (user submissions)
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
"""


def init_db():
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(UPLOADS, exist_ok=True)
    with db() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript(SCHEMA)
        if c.execute('SELECT COUNT(*) FROM settings').fetchone()[0] == 0:
            seed = json.load(open(SEED, encoding='utf-8'))
            for k in SETTING_KEYS:
                c.execute('INSERT INTO settings VALUES (?,?)', (k, json.dumps(seed.get(k, {} if k == 'site' else []), ensure_ascii=False)))
            now = int(time.time())
            for it in seed.get('listings', []):
                c.execute('INSERT OR IGNORE INTO listings (id, doc, review, source, created_at, updated_at) VALUES (?,?,?,?,?,?)',
                          (it['id'], json.dumps(it, ensure_ascii=False), 'approved', 'seed', now, now))


def get_setting(c, key):
    row = c.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return json.loads(row[0]) if row else None


def new_id(prefix=''):
    return prefix + secrets.token_hex(6)


# ---------------------------------------------------------------- caches

_version = [int(time.time())]
_boot_cache = {}
_static_cache = {}
_lock = threading.Lock()


def bump():
    with _lock:
        _version[0] += 1
        _boot_cache.clear()


def bootstrap_payload():
    v = _version[0]
    hit = _boot_cache.get(v)
    if hit:
        return hit
    with db() as c:
        ratings = {r[0]: (round(r[1], 2), r[2]) for r in
                   c.execute('SELECT listing_id, AVG(stars), COUNT(*) FROM reviews WHERE hidden=0 GROUP BY listing_id')}
        listings = []
        for r in c.execute("SELECT id, doc FROM listings WHERE review='approved'"):
            d = json.loads(r['doc'])
            if d.get('hidden'):
                continue
            d['id'] = r['id']
            if r['id'] in ratings:
                d['rating'], d['reviews'] = ratings[r['id']]
            listings.append(d)
        out = {k: get_setting(c, k) for k in SETTING_KEYS}
    out['banners'] = [b for b in out['banners'] or [] if b.get('active', True)]
    out['notices'] = [n for n in out['notices'] or [] if n.get('active', True)]
    out['categories'] = [x for x in out['categories'] or [] if x.get('active', True)]
    out['listings'] = listings
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
        _, s, h = stored.split('$')
        return hmac.compare_digest(hash_pw(pw, base64.b64decode(s)).split('$')[2], h)
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


# ---------------------------------------------------------------- validation

def s(v, n=200):
    return str(v).strip()[:n] if v not in (None, '') else None


def clean_listing(d, admin):
    cats = {c['id']: c for c in (get_setting(db(), 'categories') or [])}
    out = {
        'cat': s(d.get('cat'), 40), 'sub': s(d.get('sub'), 40), 'name': s(d.get('name'), 120),
        'nameEn': s(d.get('nameEn'), 120), 'area': s(d.get('area'), 60), 'address': s(d.get('address'), 200),
        'phone': s(re.sub(r'[^\d+]', '', str(d.get('phone') or '')), 20), 'phone2': s(re.sub(r'[^\d+]', '', str(d.get('phone2') or '')), 20),
        'web': s(d.get('web'), 300) if re.match(r'^https?://', str(d.get('web') or '')) else None,
        'facebook': s(d.get('facebook'), 300) if re.match(r'^https?://', str(d.get('facebook') or '')) else None,
        'hours': s(d.get('hours'), 20) if re.match(r'^(24h|\d\d:\d\d-\d\d:\d\d)$', str(d.get('hours') or '')) else None,
        'note': s(d.get('note'), 400), 'about': s(d.get('about'), 3000),
    }
    if out['cat'] not in cats:
        raise ValueError('ক্যাটাগরি সঠিক নয়')
    if not out['name']:
        raise ValueError('নাম দিন')
    try:
        out['price'] = int(d['price']) if d.get('price') not in (None, '') else None
    except (TypeError, ValueError):
        out['price'] = None
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
    imgs = d.get('images') or []
    out['images'] = [u for u in imgs if isinstance(u, str) and re.match(r'^(/uploads/[\w.]+|https://\S+)$', u)][:8] or None
    if admin:
        out['status'] = d.get('status') if d.get('status') in ('verified', 'pending', 'needs_update', 'temp_closed', 'closed') else 'pending'
        out['verifiedAt'] = s(d.get('verifiedAt'), 10)
        if out['status'] == 'verified' and not out['verifiedAt']:
            out['verifiedAt'] = time.strftime('%Y-%m-%d')
        for k in ('demo', 'sponsored', 'featured', 'pin', 'hidden'):
            out[k] = bool(d.get(k)) or None
    else:
        out['status'] = 'pending'
    return {k: v for k, v in out.items() if v is not None}


# ---------------------------------------------------------------- HTTP

class ApiError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


ROUTES = []


def route(method, pattern, auth=False):
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

    # -- plumbing
    def do_GET(self): self.dispatch('GET')
    def do_HEAD(self): self.dispatch('GET', head=True)
    def do_POST(self): self.dispatch('POST')
    def do_PUT(self): self.dispatch('PUT')
    def do_DELETE(self): self.dispatch('DELETE')

    def ip(self):
        fwd = self.headers.get('X-Forwarded-For') or self.headers.get('X-Real-IP')
        return (fwd.split(',')[0].strip() if fwd else self.client_address[0])

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
        for c in getattr(self, '_set_cookies', []):
            self.send_header('Set-Cookie', c)
        self.end_headers()
        if not self._head:
            self.wfile.write(body)

    def json(self, obj, status=200, headers=None):
        raw = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode()
        h = {'Cache-Control': 'no-store'}
        h.update(headers or {})
        self.send(status, raw, headers=h, gz=gzip.compress(raw, 5) if len(raw) > 1024 else None)

    def set_cookie(self, name, value, max_age, http_only=True):
        parts = [f'{name}={value}', 'Path=/', f'Max-Age={max_age}', 'SameSite=Strict' if http_only else 'SameSite=Lax']
        if http_only:
            parts.append('HttpOnly')
        if self.https():
            parts.append('Secure')
        self._set_cookies = getattr(self, '_set_cookies', []) + ['; '.join(parts)]

    def device(self):
        d = self.cookies().get('j360d')
        if not d or not re.match(r'^[a-f0-9]{24}$', d):
            d = secrets.token_hex(12)
            self.set_cookie('j360d', d, 5 * 365 * 86400, http_only=False)
        return d

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_BODY:
            raise ApiError(413, 'অনুরোধ অনেক বড়')
        if not n:
            return {}
        if 'application/json' not in self.headers.get('Content-Type', ''):
            raise ApiError(415, 'JSON প্রয়োজন')
        try:
            data = json.loads(self.rfile.read(n))
        except ValueError:
            raise ApiError(400, 'অনুরোধ সঠিক নয়')
        if not isinstance(data, dict):
            raise ApiError(400, 'অনুরোধ সঠিক নয়')
        return data

    def admin(self):
        tok = self.cookies().get('j360s')
        if not tok:
            return None
        with db() as c:
            r = c.execute('SELECT a.id, a.username FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token=? AND s.expires>?',
                          (hashlib.sha256(tok.encode()).hexdigest(), int(time.time()))).fetchone()
        return dict(r) if r else None

    def audit(self, action, target=''):
        with db() as c:
            c.execute('INSERT INTO audit (admin, action, target, at) VALUES (?,?,?,?)',
                      (self.user['username'] if self.user else '-', action, str(target)[:200], int(time.time())))

    def dispatch(self, method, head=False):
        self._head = head
        self._set_cookies = []
        url = urlparse(self.path)
        path = unquote(url.path)
        self.query = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if path.startswith('/api/'):
                for m, rx, auth, fn in ROUTES:
                    mt = rx.match(path[4:])
                    if mt and m == method:
                        self.user = self.admin() if auth or path.startswith('/api/admin/') else None
                        if auth and not self.user:
                            raise ApiError(401, 'লগইন করুন')
                        return fn(self, *mt.groups())
                raise ApiError(404, 'পাওয়া যায়নি')
            if method != 'GET':
                raise ApiError(405, 'অনুমোদিত নয়')
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

    def static(self, path):
        if path.startswith('/uploads/'):
            base, rel, cache = UPLOADS, path[len('/uploads/'):], 'public, max-age=31536000, immutable'
        else:
            base, rel, cache = PUBLIC, path.lstrip('/'), 'no-cache'
            if rel in ('', 'admin', 'admin/'):
                rel = 'admin/index.html' if rel.startswith('admin') else 'index.html'
        full = os.path.normpath(os.path.join(base, rel))
        if not full.startswith(base + os.sep) or not os.path.isfile(full) or os.path.basename(full).startswith('.'):
            if base == PUBLIC and '.' not in os.path.basename(rel):
                full = os.path.join(PUBLIC, 'index.html')
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
        d.update(listing=r['listing_id'], hidden=bool(r['hidden']))
    return d


@route('GET', r'/listings/([\w-]+)/reviews')
def api_reviews(h, lid):
    dev = h.device()
    with db() as c:
        rows = c.execute('SELECT * FROM reviews WHERE listing_id=? AND hidden=0 ORDER BY created_at DESC LIMIT 200', (lid,)).fetchall()
        mine = c.execute('SELECT 1 FROM reviews WHERE listing_id=? AND device=?', (lid, dev)).fetchone()
    h.json({'reviews': [review_row(r) for r in rows], 'mine': bool(mine)})


@route('POST', '/reviews')
def api_add_review(h):
    dev, b = h.device(), h.body()
    if not rate_ok('rv:' + h.who(), 15, 86400):
        raise ApiError(429, 'আজ অনেক রিভিউ দেওয়া হয়েছে, পরে চেষ্টা করুন')
    lid = str(b.get('listing') or '')
    stars = int(b.get('stars') or 0)
    if not 1 <= stars <= 5:
        raise ApiError(400, 'স্টার রেটিং দিন')
    with db() as c:
        if not c.execute("SELECT 1 FROM listings WHERE id=? AND review='approved'", (lid,)).fetchone():
            raise ApiError(404, 'প্রতিষ্ঠান পাওয়া যায়নি')
        if c.execute('SELECT 1 FROM reviews WHERE listing_id=? AND device=?', (lid, dev)).fetchone():
            raise ApiError(409, 'একটি প্রতিষ্ঠানে একবারই রিভিউ দেওয়া যায়')
        crit = {str(k)[:40]: max(1, min(5, int(v))) for k, v in (b.get('crit') or {}).items() if str(v).isdigit()} or None
        photo = save_image(b['photo'], 2 * 1024 * 1024) if b.get('photo') else None
        c.execute('INSERT INTO reviews (id, listing_id, stars, crit, name, text, photo, device, ip, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
                  (new_id('r'), lid, stars, json.dumps(crit, ensure_ascii=False) if crit else None, s(b.get('name'), 40),
                   s(b.get('text'), 1500), photo, dev, hashlib.sha256(h.ip().encode()).hexdigest()[:16], int(time.time())))
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
    h.device()
    b = h.body()
    if not rate_ok('rep:' + h.who(), 20, 86400):
        raise ApiError(429, 'অনেক রিপোর্ট পাঠানো হয়েছে, পরে চেষ্টা করুন')
    reason = s(b.get('reason'), 600)
    if not reason:
        raise ApiError(400, 'কারণ লিখুন')
    with db() as c:
        c.execute('INSERT INTO reports (id, kind, listing_id, review_id, reason, created_at) VALUES (?,?,?,?,?,?)',
                  (new_id('p'), 'review' if b.get('review') else 'info', s(b.get('listing'), 40), s(b.get('review'), 40), reason, int(time.time())))
    h.json({'ok': True})


@route('POST', '/submissions')
def api_submit(h):
    h.device()
    b = h.body()
    if not rate_ok('sub:' + h.who(), 10, 86400):
        raise ApiError(429, 'আজ অনেক তথ্য জমা হয়েছে, পরে চেষ্টা করুন')
    doc = clean_listing(b, admin=False)
    doc['images'] = [save_image(p, 3 * 1024 * 1024) for p in (b.get('photos') or [])[:3]] or None
    doc = {k: v for k, v in doc.items() if v is not None}
    lid, now = new_id('u'), int(time.time())
    with db() as c:
        c.execute('INSERT INTO listings (id, doc, review, source, contact, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
                  (lid, json.dumps(doc, ensure_ascii=False), 'pending', 'user', s(b.get('contact'), 100), now, now))
    h.json({'ok': True, 'id': lid})


@route('POST', '/track')
def api_track(h):
    b = h.body()
    col = {'view': 'views', 'call': 'calls', 'map': 'maps'}.get(b.get('type'))
    if col and rate_ok(f'tr:{h.who()}:{b.get("id")}:{col}', 3, 3600):
        with db() as c:
            c.execute(f'UPDATE listings SET {col}={col}+1 WHERE id=?', (str(b.get('id')),))
    h.send(204)


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
        tok = secrets.token_urlsafe(32)
        c.execute('DELETE FROM sessions WHERE expires<?', (int(time.time()),))
        c.execute('INSERT INTO sessions VALUES (?,?,?)', (hashlib.sha256(tok.encode()).hexdigest(), a['id'], int(time.time()) + SESSION_DAYS * 86400))
    h.set_cookie('j360s', tok, SESSION_DAYS * 86400)
    h.user = {'username': a['username']}
    h.audit('login')
    h.json({'ok': True, 'username': a['username']})


@route('POST', '/admin/logout')
def adm_logout(h):
    tok = h.cookies().get('j360s')
    if tok:
        with db() as c:
            c.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(tok.encode()).hexdigest(),))
    h.set_cookie('j360s', '', 0)
    h.json({'ok': True})


@route('GET', '/admin/me', auth=True)
def adm_me(h):
    h.json(h.user)


@route('GET', '/admin/summary', auth=True)
def adm_summary(h):
    with db() as c:
        one = lambda q, *a: c.execute(q, a).fetchone()[0]
        week = int(time.time()) - 7 * 86400
        top = [dict(r) | {'name': json.loads(r['doc'])['name']} for r in
               c.execute("SELECT id, doc, views, calls, maps FROM listings WHERE review='approved' ORDER BY views+calls*3 DESC LIMIT 8")]
        for t in top:
            t.pop('doc')
        out = {
            'listings': one("SELECT COUNT(*) FROM listings WHERE review='approved'"),
            'verified': one("SELECT COUNT(*) FROM listings WHERE review='approved' AND json_extract(doc,'$.status')='verified'"),
            'demo': one("SELECT COUNT(*) FROM listings WHERE review='approved' AND json_extract(doc,'$.demo')=1"),
            'pending': one("SELECT COUNT(*) FROM listings WHERE review='pending'"),
            'reports': one('SELECT COUNT(*) FROM reports WHERE done=0'),
            'reviews': one('SELECT COUNT(*) FROM reviews'),
            'reviewsWeek': one('SELECT COUNT(*) FROM reviews WHERE created_at>?', week),
            'views': one('SELECT COALESCE(SUM(views),0) FROM listings'),
            'calls': one('SELECT COALESCE(SUM(calls),0) FROM listings'),
            'maps': one('SELECT COALESCE(SUM(maps),0) FROM listings'),
            'top': top,
            'audit': [dict(r) for r in c.execute('SELECT admin, action, target, at FROM audit ORDER BY id DESC LIMIT 12')],
        }
    h.json(out)


def listing_out(r):
    d = json.loads(r['doc'])
    d.update(id=r['id'], _review=r['review'], _source=r['source'], _contact=r['contact'], _created=r['created_at'],
             _updated=r['updated_at'], _views=r['views'], _calls=r['calls'], _maps=r['maps'])
    return d


@route('GET', '/admin/listings', auth=True)
def adm_listings(h):
    with db() as c:
        rows = c.execute('SELECT * FROM listings ORDER BY updated_at DESC').fetchall()
        ratings = {r[0]: (round(r[1], 1), r[2]) for r in c.execute('SELECT listing_id, AVG(stars), COUNT(*) FROM reviews GROUP BY listing_id')}
    out = []
    for r in rows:
        d = listing_out(r)
        if r['id'] in ratings:
            d['rating'], d['reviews'] = ratings[r['id']]
        out.append(d)
    h.json(out)


@route('POST', '/admin/listings', auth=True)
def adm_create(h):
    doc = clean_listing(h.body(), admin=True)
    lid, now = new_id('l'), int(time.time())
    with db() as c:
        c.execute('INSERT INTO listings (id, doc, review, source, created_at, updated_at) VALUES (?,?,?,?,?,?)',
                  (lid, json.dumps(doc, ensure_ascii=False), 'approved', 'admin', now, now))
    bump()
    h.audit('listing.create', doc['name'])
    h.json({'ok': True, 'id': lid})


@route('PUT', r'/admin/listings/([\w-]+)', auth=True)
def adm_update(h, lid):
    b = h.body()
    doc = clean_listing(b, admin=True)
    with db() as c:
        r = c.execute('SELECT review FROM listings WHERE id=?', (lid,)).fetchone()
        if not r:
            raise ApiError(404, 'পাওয়া যায়নি')
        review = b.get('_review') if b.get('_review') in ('approved', 'pending', 'rejected') else r['review']
        c.execute('UPDATE listings SET doc=?, review=?, updated_at=? WHERE id=?', (json.dumps(doc, ensure_ascii=False), review, int(time.time()), lid))
    bump()
    h.audit('listing.update', doc['name'])
    h.json({'ok': True})


@route('POST', r'/admin/listings/([\w-]+)/review', auth=True)
def adm_review_listing(h, lid):
    b = h.body()
    decision = b.get('review')
    if decision not in ('approved', 'rejected', 'pending'):
        raise ApiError(400, 'সঠিক নয়')
    with db() as c:
        r = c.execute('SELECT doc FROM listings WHERE id=?', (lid,)).fetchone()
        if not r:
            raise ApiError(404, 'পাওয়া যায়নি')
        doc = json.loads(r['doc'])
        if decision == 'approved' and b.get('verified'):
            doc.update(status='verified', verifiedAt=time.strftime('%Y-%m-%d'))
        c.execute('UPDATE listings SET review=?, doc=?, updated_at=? WHERE id=?', (decision, json.dumps(doc, ensure_ascii=False), int(time.time()), lid))
    bump()
    h.audit('listing.' + decision, doc.get('name'))
    h.json({'ok': True})


@route('DELETE', r'/admin/listings/([\w-]+)', auth=True)
def adm_delete(h, lid):
    with db() as c:
        r = c.execute('SELECT doc FROM listings WHERE id=?', (lid,)).fetchone()
        c.execute('DELETE FROM listings WHERE id=?', (lid,))
        c.execute('DELETE FROM reviews WHERE listing_id=?', (lid,))
    bump()
    h.audit('listing.delete', json.loads(r['doc'])['name'] if r else lid)
    h.json({'ok': True})


@route('GET', '/admin/reviews', auth=True)
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


@route('PUT', r'/admin/reviews/(\w+)', auth=True)
def adm_review_update(h, rid):
    b = h.body()
    with db() as c:
        if 'hidden' in b:
            c.execute('UPDATE reviews SET hidden=? WHERE id=?', (1 if b['hidden'] else 0, rid))
        if 'reply' in b:
            c.execute('UPDATE reviews SET reply=? WHERE id=?', (s(b['reply'], 1000), rid))
        if b.get('hidden'):
            c.execute("UPDATE reports SET done=1 WHERE review_id=?", (rid,))
    bump()
    h.audit('review.update', rid)
    h.json({'ok': True})


@route('DELETE', r'/admin/reviews/(\w+)', auth=True)
def adm_review_delete(h, rid):
    with db() as c:
        c.execute('DELETE FROM reviews WHERE id=?', (rid,))
        c.execute('UPDATE reports SET done=1 WHERE review_id=?', (rid,))
    bump()
    h.audit('review.delete', rid)
    h.json({'ok': True})


@route('GET', '/admin/reports', auth=True)
def adm_reports(h):
    with db() as c:
        names = {r['id']: json.loads(r['doc'])['name'] for r in c.execute('SELECT id, doc FROM listings')}
        rows = [dict(r) for r in c.execute('SELECT * FROM reports ORDER BY done, created_at DESC LIMIT 500')]
        texts = {r['id']: r['text'] for r in c.execute('SELECT id, text FROM reviews')}
    for r in rows:
        r['listingName'] = names.get(r['listing_id'], '—')
        r['reviewText'] = texts.get(r['review_id'])
    h.json(rows)


@route('PUT', r'/admin/reports/(\w+)', auth=True)
def adm_report_update(h, pid):
    b = h.body()
    with db() as c:
        c.execute('UPDATE reports SET done=? WHERE id=?', (1 if b.get('done') else 0, pid))
    h.json({'ok': True})


@route('GET', r'/admin/settings/(\w+)', auth=True)
def adm_get_setting(h, key):
    if key not in SETTING_KEYS:
        raise ApiError(404, 'পাওয়া যায়নি')
    with db() as c:
        h.json(get_setting(c, key))


@route('PUT', r'/admin/settings/(\w+)', auth=True)
def adm_put_setting(h, key):
    if key not in SETTING_KEYS:
        raise ApiError(404, 'পাওয়া যায়নি')
    n = int(h.headers.get('Content-Length') or 0)
    if n > MAX_BODY:
        raise ApiError(413, 'অনুরোধ অনেক বড়')
    try:
        val = json.loads(h.rfile.read(n))
    except ValueError:
        raise ApiError(400, 'অনুরোধ সঠিক নয়')
    expected = dict if key == 'site' else list
    if not isinstance(val, expected):
        raise ApiError(400, 'ফরম্যাট সঠিক নয়')
    if key == 'categories':
        ids = [c.get('id') for c in val]
        if any(not re.match(r'^[a-z0-9-]{2,30}$', str(i)) for i in ids) or len(set(ids)) != len(ids):
            raise ApiError(400, 'ক্যাটাগরি আইডি সঠিক নয় বা একই আইডি দুবার আছে')
        with db() as c:
            used = {r[0] for r in c.execute("SELECT DISTINCT json_extract(doc,'$.cat') FROM listings")}
        missing = used - set(ids)
        if missing:
            raise ApiError(400, 'এই ক্যাটাগরিতে তথ্য আছে, আগে সেগুলো সরান: ' + ', '.join(sorted(missing)))
    with db() as c:
        c.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (key, json.dumps(val, ensure_ascii=False)))
    bump()
    h.audit('settings.' + key)
    h.json({'ok': True})


@route('POST', '/admin/upload', auth=True)
def adm_upload(h):
    h.json({'url': save_image(h.body().get('data'), 6 * 1024 * 1024)})


@route('GET', '/admin/admins', auth=True)
def adm_admins(h):
    with db() as c:
        h.json([dict(r) for r in c.execute('SELECT id, username, created_at FROM admins ORDER BY id')])


@route('POST', '/admin/admins', auth=True)
def adm_add_admin(h):
    b = h.body()
    u, pw = str(b.get('username') or '').strip().lower(), str(b.get('password') or '')
    if not re.match(r'^[a-z0-9_.-]{3,30}$', u):
        raise ApiError(400, 'ইউজারনেম: ৩-৩০ অক্ষর, ইংরেজি ছোট হাতের অক্ষর/সংখ্যা')
    if len(pw) < 8:
        raise ApiError(400, 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষর')
    with db() as c:
        try:
            c.execute('INSERT INTO admins (username, pass, created_at) VALUES (?,?,?)', (u, hash_pw(pw), int(time.time())))
        except sqlite3.IntegrityError:
            raise ApiError(409, 'এই ইউজারনেম আগেই আছে')
    h.audit('admin.add', u)
    h.json({'ok': True})


@route('DELETE', r'/admin/admins/(\d+)', auth=True)
def adm_del_admin(h, aid):
    if int(aid) == h.user['id']:
        raise ApiError(400, 'নিজের অ্যাকাউন্ট মুছতে পারবেন না')
    with db() as c:
        c.execute('DELETE FROM sessions WHERE admin_id=?', (aid,))
        c.execute('DELETE FROM admins WHERE id=?', (aid,))
    h.audit('admin.delete', aid)
    h.json({'ok': True})


@route('POST', '/admin/password', auth=True)
def adm_password(h):
    b = h.body()
    with db() as c:
        a = c.execute('SELECT pass FROM admins WHERE id=?', (h.user['id'],)).fetchone()
        if not check_pw(str(b.get('current') or ''), a['pass']):
            raise ApiError(400, 'বর্তমান পাসওয়ার্ড ভুল')
        if len(str(b.get('new') or '')) < 8:
            raise ApiError(400, 'নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষর')
        c.execute('UPDATE admins SET pass=? WHERE id=?', (hash_pw(b['new']), h.user['id']))
    h.audit('admin.password')
    h.json({'ok': True})


@route('GET', '/admin/export', auth=True)
def adm_export(h):
    with db() as c:
        out = {k: get_setting(c, k) for k in SETTING_KEYS}
        out['listings'] = [listing_out(r) for r in c.execute('SELECT * FROM listings')]
        out['reviews'] = [review_row(r, True) for r in c.execute('SELECT * FROM reviews')]
        out['reports'] = [dict(r) for r in c.execute('SELECT * FROM reports')]
        out['exportedAt'] = time.strftime('%Y-%m-%d %H:%M')
    raw = json.dumps(out, ensure_ascii=False, indent=1).encode()
    h.send(200, raw, headers={'Content-Disposition': 'attachment; filename="jashore360-backup-%s.json"' % time.strftime('%Y%m%d'),
                              'Cache-Control': 'no-store'})


# ---------------------------------------------------------------- CLI

def set_paths(data):
    global DATA, DB_PATH, UPLOADS
    DATA = os.path.abspath(data)
    DB_PATH = os.path.join(DATA, 'jashore360.db')
    UPLOADS = os.path.join(DATA, 'uploads')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.path.join(HERE, 'data'))
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=8360)
    ap.add_argument('cmd', nargs='?', default='serve', choices=['serve', 'ensure-admin', 'reset-password'])
    ap.add_argument('user', nargs='?', default='admin')
    a = ap.parse_args()
    set_paths(a.data)
    init_db()
    if a.cmd in ('ensure-admin', 'reset-password'):
        pw = secrets.token_urlsafe(9)
        with db() as c:
            if a.cmd == 'ensure-admin':
                if c.execute('SELECT COUNT(*) FROM admins').fetchone()[0]:
                    return
                c.execute('INSERT INTO admins (username, pass, created_at) VALUES (?,?,?)', (a.user, hash_pw(pw), int(time.time())))
            else:
                if not c.execute('UPDATE admins SET pass=? WHERE username=?', (hash_pw(pw), a.user)).rowcount:
                    c.execute('INSERT INTO admins (username, pass, created_at) VALUES (?,?,?)', (a.user, hash_pw(pw), int(time.time())))
                c.execute('DELETE FROM sessions')
        print(f'username: {a.user}\npassword: {pw}')
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
