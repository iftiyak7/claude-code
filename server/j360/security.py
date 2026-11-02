"""Passwords, two-step codes, rate limits and the HTTP security headers."""
import base64
import hashlib
import hmac
import re
import secrets
import time
from .store import _lock
from .util import ApiError, BN_DIGITS


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


# Two-step login for staff: a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator…), RFC 6238.
def totp_code(secret, counter):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8))
    d = hmac.new(key, counter.to_bytes(8, 'big'), 'sha1').digest()
    o = d[-1] & 15
    return '%06d' % ((int.from_bytes(d[o:o + 4], 'big') & 0x7fffffff) % 1000000)


_totp_used = {}


def totp_ok(secret, code, who):
    code = re.sub(r'\D', '', str(code or '').translate(BN_DIGITS))
    if len(code) != 6 or not secret:
        return False
    now = int(time.time()) // 30
    for ctr in (now - 1, now, now + 1):                 # a little clock drift is fine
        if hmac.compare_digest(totp_code(secret, ctr), code):
            if _totp_used.get(who, -1) >= ctr:          # each code works once
                return False
            _totp_used[who] = ctr
            return True
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


SECURITY_HEADERS = [('X-Frame-Options', 'DENY'), ('Cross-Origin-Opener-Policy', 'same-origin'),
                    ('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()')]
# Pages may only run this site's own scripts. Inline style attributes are used throughout, so styles stay allowed.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' blob:; "
       "connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; "
       "form-action 'self'; frame-ancestors 'none'")


COMMON_PW = {'12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', 'password', 'password1',
             'qwertyui', 'qwerty123', 'abcd1234', 'bangladesh', 'iloveyou', 'jashore360', 'jessore123', 'jashore123'}


def weak_password(pw, phone=''):
    """New passwords (existing ones keep working): at least 8 characters, not a well-known one, not the phone number."""
    if len(pw) < 8:
        raise ApiError(400, 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষর')
    if pw.lower() in COMMON_PW or len(set(pw)) < 3 or (phone and phone[-8:] in pw):
        raise ApiError(400, 'পাসওয়ার্ডটি সহজে অনুমান করা যায় — অন্য একটি দিন')
