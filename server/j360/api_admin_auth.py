"""Admin sign-in (with two-step codes), staff accounts and passwords."""
import base64
import re
import secrets
import sqlite3
import time
from .security import check_pw, hash_pw, rate_ok, totp_ok
from .store import db
from .util import ApiError
from .web import route


@route('POST', '/admin/login')
def adm_login(h):
    b = h.body()
    uname = str(b.get('username') or '').strip().lower()[:30]
    # per address+name, per address (trying many names) and per name (one account tried from many addresses)
    if not (rate_ok('login:' + h.ip() + ':' + uname, 8, 900) and rate_ok('loginip:' + h.ip(), 30, 900) and rate_ok('loginname:' + uname, 20, 3600)):
        raise ApiError(429, 'অনেকবার চেষ্টা হয়েছে, ১৫ মিনিট পর আবার চেষ্টা করুন')
    with db() as c:
        a = c.execute('SELECT * FROM admins WHERE username=?', (uname,)).fetchone()
    if not a or not check_pw(str(b.get('password') or ''), a['pass']):
        failed_login(uname, h.ip(), 'password')
        raise ApiError(401, 'ইউজারনেম বা পাসওয়ার্ড ভুল')
    if a['totp']:
        if not b.get('code'):
            raise ApiError(401, 'অথেনটিকেটর অ্যাপের ৬ সংখ্যার কোড দিন', need2fa=True)
        if not totp_ok(a['totp'], b.get('code'), 'a%d' % a['id']):
            failed_login(uname, h.ip(), 'code')
            raise ApiError(401, 'কোড ভুল বা মেয়াদ শেষ — অ্যাপে নতুন কোড দেখে আবার দিন', need2fa=True)
    h.start_session('sessions', 'admin_id', a['id'], 'j360s', 'Strict')
    h.staff = {'username': a['username']}
    h.audit('login')
    h.json({'ok': True, 'username': a['username'], 'role': a['role'] or 'owner'})


def failed_login(uname, ip, what):
    with db() as c:
        c.execute('INSERT INTO audit (admin, action, target, at) VALUES (?,?,?,?)', (uname or '-', 'login.fail', f'{ip} ({what})', int(time.time())))


@route('POST', '/admin/2fa/setup', auth='admin')
def adm_2fa_setup(h):
    secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')
    label = 'Jashore360:' + h.staff['username']
    h.json({'secret': secret, 'uri': f'otpauth://totp/{label}?secret={secret}&issuer=Jashore360'})


@route('POST', '/admin/2fa', auth='admin')
def adm_2fa(h):
    """Turn two-step login on (with the new secret and a code from it) or off (with a current code). Both need the password."""
    b = h.body()
    with db() as c:
        a = c.execute('SELECT pass, totp FROM admins WHERE id=?', (h.staff['id'],)).fetchone()
    if not check_pw(str(b.get('password') or ''), a['pass']):
        raise ApiError(400, 'পাসওয়ার্ড ভুল')
    who = 'a%d' % h.staff['id']
    if b.get('enable'):
        secret = str(b.get('secret') or '')
        if not re.match(r'^[A-Z2-7]{32}$', secret) or not totp_ok(secret, b.get('code'), who):
            raise ApiError(400, 'কোড মেলেনি — অ্যাপে দেখানো এখনকার কোডটি দিন')
        new, act = secret, 'admin.2fa.on'
    else:
        if a['totp'] and not totp_ok(a['totp'], b.get('code'), who):
            raise ApiError(400, 'কোড মেলেনি')
        new, act = None, 'admin.2fa.off'
    with db() as c:
        c.execute('UPDATE admins SET totp=? WHERE id=?', (new, h.staff['id']))
        c.execute('DELETE FROM sessions WHERE admin_id=? AND token!=?', (h.staff['id'], h.session_token('j360s')))
    h.audit(act)
    h.json({'ok': True, 'enabled': bool(new)})


@route('POST', '/admin/logout')
def adm_logout(h):
    h.end_session('sessions', 'j360s')
    h.json({'ok': True})


@route('GET', '/admin/me', auth='admin')
def adm_me(h):
    with db() as c:
        on = c.execute('SELECT totp IS NOT NULL FROM admins WHERE id=?', (h.staff['id'],)).fetchone()[0]
    h.json(dict(h.staff, twofa=bool(on)))


@route('GET', '/admin/admins', auth='owner')
def adm_admins(h):
    with db() as c:
        h.json([dict(r) for r in c.execute('SELECT id, username, role, created_at, totp IS NOT NULL AS twofa FROM admins ORDER BY id')])


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
        c.execute('DELETE FROM sessions WHERE admin_id=? AND token!=?', (h.staff['id'], h.session_token('j360s')))   # sign out everywhere else
    h.audit('admin.password')
    h.json({'ok': True})
