"""Sign in / sign up with Google (OAuth 2.0 authorization code flow with PKCE, done on the server).

Website: /api/auth/google/start → Google → /api/auth/google/callback → signed in, back to the app page.
Android app: Google does not allow its sign-in inside a WebView, so the app opens the start link in the phone's browser and
adds `app` = sha256 of a secret only the app knows. After Google, the browser is sent back to the app with a one-time code;
the app then opens /api/auth/google/finish with the code and its secret. Another app that catches the code cannot use it.
The client id and secret are set by the main admin (Admin → Settings) and are never sent to the app.
"""
import base64
import hashlib
import json
import os
import re
import secrets
import time
import urllib.parse
import urllib.request
from .cache import bump, home_domain
from .security import rate_ok
from .store import db, get_setting, inc
from .util import ApiError, s
from .web import route

AUTH_URL = os.environ.get('J360_GOOGLE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth')
TOKEN_URL = os.environ.get('J360_GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token')
ISSUERS = ('https://accounts.google.com', 'accounts.google.com')
STATE_TTL, CODE_TTL = 600, 180
APP_SCHEME = 'jashore360'


def google_config(c):
    g = get_setting(c, 'google') or {}
    return g if g.get('enabled') and g.get('clientId') and g.get('clientSecret') else None


def callback_url(h):
    host = home_domain() or (h.headers.get('Host') or '')
    scheme = 'https' if h.https() or home_domain() else 'http'
    return f'{scheme}://{host}/api/auth/google/callback'


def back_to_app(h, err=None):
    h.redirect('/app/#/login?err=' + err if err else '/app/#/account')


@route('GET', '/auth/google/start')
def google_start(h):
    if not rate_ok('gstart:' + h.who(), 30, 3600):
        raise ApiError(429, 'অনেকবার চেষ্টা হয়েছে, পরে আবার চেষ্টা করুন')
    with db() as c:
        g = google_config(c)
    if not g:
        return back_to_app(h, 'google-off')
    mode = 'link' if h.query.get('mode') == 'link' else 'login'
    app_hash = h.query.get('app') or None
    if app_hash and not re.match(r'^[a-f0-9]{64}$', app_hash):
        raise ApiError(400, 'অনুরোধ সঠিক নয়')
    me = h.user() if mode == 'link' else None
    if mode == 'link' and not me:
        return back_to_app(h, 'login')
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    with db() as c:
        c.execute('DELETE FROM oauth_states WHERE created<?', (int(time.time()) - STATE_TTL,))
        c.execute('INSERT INTO oauth_states VALUES (?,?,?,?,?,?,?)',
                  (state, verifier, mode, me and me['id'], app_hash, 1 if h.query.get('terms') == '1' else 0, int(time.time())))
    h.redirect(AUTH_URL + '?' + urllib.parse.urlencode({
        'client_id': g['clientId'], 'redirect_uri': callback_url(h), 'response_type': 'code', 'scope': 'openid email profile',
        'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256', 'prompt': 'select_account'}))


def exchange(g, code, verifier, redirect_uri):
    """Trade the code for Google's ID token. It comes straight from Google over HTTPS, so its claims can be read as they are;
    the audience, issuer, expiry and verified e-mail are still checked."""
    data = urllib.parse.urlencode({'code': code, 'client_id': g['clientId'], 'client_secret': g['clientSecret'],
                                   'redirect_uri': redirect_uri, 'grant_type': 'authorization_code', 'code_verifier': verifier}).encode()
    req = urllib.request.Request(TOKEN_URL, data=data, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req, timeout=10) as r:
        tok = json.loads(r.read(200000))
    part = tok['id_token'].split('.')[1]
    claims = json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))
    if claims.get('iss') not in ISSUERS or claims.get('aud') != g['clientId'] or int(claims.get('exp', 0)) < time.time() \
            or not claims.get('sub') or claims.get('email_verified') not in (True, 'true'):
        raise ValueError('bad token')
    return claims


@route('GET', '/auth/google/callback')
def google_callback(h):
    state = h.query.get('state') or ''
    with db() as c:
        st = c.execute('SELECT * FROM oauth_states WHERE state=?', (state,)).fetchone()
        c.execute('DELETE FROM oauth_states WHERE state=?', (state,))          # each sign-in attempt works once
        g = google_config(c)
    if not st or st['created'] < time.time() - STATE_TTL or not g:
        return back_to_app(h, 'google')
    if h.query.get('error') or not h.query.get('code'):
        return back_to_app(h, 'google-cancel')
    try:
        claims = exchange(g, h.query['code'], st['verifier'], callback_url(h))
    except Exception:
        return back_to_app(h, 'google')
    sub, email = str(claims['sub']), s(claims.get('email'), 120)
    name = s(claims.get('name'), 60) or (email or 'Google').split('@')[0][:60]
    now = int(time.time())
    with db() as c:
        user = c.execute('SELECT * FROM users WHERE google_sub=?', (sub,)).fetchone()
        if st['mode'] == 'link':
            if user and user['id'] != st['user_id']:
                return back_to_app(h, 'google-taken')
            c.execute('UPDATE users SET google_sub=?, email=? WHERE id=?', (sub, email, st['user_id']))
            uid = st['user_id']
        elif user:
            if user['banned']:
                return back_to_app(h, 'banned')
            uid = user['id']
            c.execute('UPDATE users SET email=? WHERE id=?', (email, uid))
        else:
            if not st['terms']:
                return back_to_app(h, 'terms')
            tv = (get_setting(c, 'terms') or {}).get('version') or 0
            uid = c.execute('INSERT INTO users (name, created_at, terms_v, terms_at, google_sub, email) VALUES (?,?,?,?,?,?)',
                            (name, now, tv, now, sub, email)).lastrowid
            inc(c, 'signups')
        if st['app_hash']:
            code = secrets.token_urlsafe(32)
            c.execute('DELETE FROM oauth_codes WHERE created<?', (now - CODE_TTL,))
            c.execute('INSERT INTO oauth_codes VALUES (?,?,?,?)', (hashlib.sha256(code.encode()).hexdigest(), uid, st['app_hash'], now))
    if st['app_hash']:
        return open_app(h, code)
    h.start_session('usessions', 'user_id', uid, 'j360u', 'Lax')
    back_to_app(h)


def open_app(h, code):
    """The browser hands the one-time code to the Jashore360 app. A tap is needed: browsers only open apps on a user's tap."""
    link = f'intent://auth?code={code}#Intent;scheme={APP_SCHEME};package=cloud.jashore360.app;end'
    html = f'''<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jashore360</title><style>body{{font-family:system-ui,sans-serif;background:#f3f5f8;margin:0;display:grid;place-items:center;min-height:100vh;text-align:center}}
a{{display:inline-block;margin-top:18px;background:#0e9f6e;color:#fff;padding:16px 28px;border-radius:14px;font-weight:700;text-decoration:none;font-size:18px}}</style></head>
<body><div><h2>লগইন সম্পন্ন ✓</h2><p>অ্যাপে ফিরতে নিচের বাটনে চাপুন</p><a href="{link}">Jashore360 অ্যাপে ফিরুন</a></div></body></html>'''
    h.send(200, html.encode(), 'text/html; charset=utf-8', {'Cache-Control': 'no-store'})


@route('GET', '/auth/google/finish')
def google_finish(h):
    """Opened by the Android app (inside its WebView) with the one-time code and the secret only it knows."""
    code, secret = h.query.get('code') or '', h.query.get('s') or ''
    with db() as c:
        r = c.execute('SELECT * FROM oauth_codes WHERE code=?', (hashlib.sha256(code.encode()).hexdigest(),)).fetchone()
        if r:
            c.execute('DELETE FROM oauth_codes WHERE code=?', (r['code'],))
    if not r or r['created'] < time.time() - CODE_TTL or hashlib.sha256(secret.encode()).hexdigest() != r['app_hash']:
        return back_to_app(h, 'google')
    h.start_session('usessions', 'user_id', r['user_id'], 'j360u', 'Lax')
    back_to_app(h)


@route('GET', '/admin/google', auth='owner')
def adm_google(h):
    with db() as c:
        g = get_setting(c, 'google') or {}
    h.json({'enabled': bool(g.get('enabled')), 'clientId': g.get('clientId') or '', 'hasSecret': bool(g.get('clientSecret')),
            'redirectUri': callback_url(h)})


@route('PUT', '/admin/google', auth='owner')
def adm_google_save(h):
    b = h.body()
    cid, secret = s(b.get('clientId'), 200) or '', s(b.get('clientSecret'), 200)
    if cid and not re.match(r'^[\w.-]+\.apps\.googleusercontent\.com$', cid):
        raise ApiError(400, 'Client ID সঠিক নয় (…apps.googleusercontent.com)')
    with db() as c:
        old = get_setting(c, 'google') or {}
        g = {'clientId': cid, 'clientSecret': secret or old.get('clientSecret') or '', 'enabled': bool(b.get('enabled'))}
        if g['enabled'] and not (g['clientId'] and g['clientSecret']):
            raise ApiError(400, 'চালু করতে Client ID ও Client Secret দুটোই দিন')
        c.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('google', json.dumps(g)))
    bump()
    h.audit('settings.google', 'on' if g['enabled'] else 'off')
    h.json({'ok': True})
