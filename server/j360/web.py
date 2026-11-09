"""The HTTP layer: routing, sessions, static files, uploads streaming, JSON answers."""
import gzip
import hashlib
import json
import mimetypes
import os
import re
import secrets
import sys
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, unquote, urlparse
from . import config
from .cache import _static_cache
from .config import ADMIN_SESSION_DAYS, MAX_BODY, PUBLIC, SESSION_DAYS, TEXT_TYPES
from .media import UPLOAD_RE
from .security import CSP, SECURITY_HEADERS
from .store import db, get_setting, inc
from .util import ApiError


ROUTES = []
PAGES = []          # server-made pages outside /api (robots.txt, sitemap, listing pages for search engines)


def page(pattern):
    def deco(fn):
        PAGES.append((re.compile('^' + pattern + '$'), fn))
        return fn
    return deco


def route(method, pattern, auth=None):
    """auth: None | 'user' | 'admin' | 'owner'"""
    def deco(fn):
        ROUTES.append((method, re.compile('^' + pattern + '$'), auth, fn))
        return fn
    return deco


def content_length(headers):
    try:
        return max(0, int(headers.get('Content-Length') or 0))
    except ValueError:
        return -1


class Handler(BaseHTTPRequestHandler):
    server_version = 'Jashore360'
    protocol_version = 'HTTP/1.1'
    timeout = 30                    # a connection that sends nothing for this long is closed (no thread is held forever)

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
        # The server only listens on localhost behind nginx. X-Real-IP is set by nginx itself; in X-Forwarded-For only the
        # last entry is nginx's own, everything before it comes from the visitor and could be made up to dodge rate limits.
        real = (self.headers.get('X-Real-IP') or '').strip()
        if real:
            return real
        fwd = self.headers.get('X-Forwarded-For')
        return fwd.split(',')[-1].strip() if fwd else self.client_address[0]

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
        for k, v in SECURITY_HEADERS:
            self.send_header(k, v)
        if ctype.startswith('text/html'):
            self.send_header('Content-Security-Policy', CSP)
        if self.https():
            self.send_header('Strict-Transport-Security', 'max-age=31536000')
        for k, v in headers.items():
            self.send_header(k, v)
        for c in self._set_cookies:
            self.send_header('Set-Cookie', c)
        self.end_headers()
        if not self._head:
            self.wfile.write(body)

    def redirect(self, location):
        self.send(302, b'', 'text/plain', {'Location': location, 'Cache-Control': 'no-store'})

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
        n = content_length(self.headers)
        if n < 0:
            raise ApiError(400, 'অনুরোধ সঠিক নয়')
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
        return {'id': u['id'], 'name': u['name'], 'phone': u['phone'], 'email': u['email'], 'google': bool(u['google_sub']),
                'hasPassword': bool(u['pass'])} if u and not u['banned'] else None

    def start_session(self, table, col, uid, cookie, same_site):
        tok = secrets.token_urlsafe(32)
        days = ADMIN_SESSION_DAYS if table == 'sessions' else SESSION_DAYS
        with db() as c:
            c.execute(f'DELETE FROM {table} WHERE expires<?', (int(time.time()),))
            c.execute(f'INSERT INTO {table} (token, {col}, expires) VALUES (?,?,?)',
                      (hashlib.sha256(tok.encode()).hexdigest(), uid, int(time.time()) + days * 86400))
        self.set_cookie(cookie, tok, days * 86400, same_site=same_site)

    def session_token(self, cookie):
        tok = self.cookies().get(cookie)
        return hashlib.sha256(tok.encode()).hexdigest() if tok else ''

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
            if path.startswith('/api/') and method != 'GET' and not self.same_origin():
                raise ApiError(403, 'অনুমোদিত নয়')
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
            for rx, fn in PAGES:
                mt = rx.match(path)
                if mt:
                    return fn(self, *mt.groups())
            return self.static(path)
        except ApiError as e:
            self.json({'error': str(e), **e.extra}, e.status)
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
            n = content_length(self.headers)
            if n < 0:
                self.close_connection = True
            elif n and not self._consumed:
                if n <= MAX_BODY:
                    self.rfile.read(n)
                else:
                    self.close_connection = True

    def same_origin(self):
        # Browsers say which site a request comes from. Changes are only accepted from this site's own pages
        # (cookies are SameSite as well; this is the second lock on the same door). Apps and scripts send no Origin.
        origin = self.headers.get('Origin')
        if not origin or origin == 'null' and not self.headers.get('Cookie'):
            return True
        return urlparse(origin).netloc.lower() == (self.headers.get('Host') or '').lower()

    def download_apk(self):
        with db() as c:
            app = get_setting(c, 'app') or {}
        f = app.get('file') and os.path.join(config.DOWNLOADS, os.path.basename(app['file']))
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
        full = m and os.path.join(config.UPLOADS, m.group(1))
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
        self.send_header('Content-Security-Policy', "default-src 'none'; sandbox")    # an upload is only ever shown, never run
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
