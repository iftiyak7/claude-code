"""Admin panel: sign-in with two-step codes, roles, settings checks, audit log."""
import base64
import hashlib
import hmac
import time
import unittest

from helpers import ServerTest


def totp(secret, offset=0):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8))
    d = hmac.new(key, ((int(time.time()) // 30) + offset).to_bytes(8, 'big'), hashlib.sha1).digest()
    o = d[-1] & 15
    return '%06d' % ((int.from_bytes(d[o:o + 4], 'big') & 0x7fffffff) % 1000000)


class AdminTest(ServerTest):
    def test_wrong_password_is_logged_and_limited(self):
        c = self.srv.client()
        codes = [c.post('/admin/login', {'username': 'admin', 'password': 'nope%d' % i})[0] for i in range(10)]
        self.assertEqual(codes[0], 401)
        self.assertEqual(codes[-1], 429)
        audit = self.ok(self.srv.admin().get('/admin/summary'))['audit']
        self.assertIn('login.fail', [a['action'] for a in audit])

    def test_admin_cookie_is_strict(self):
        c = self.srv.client()
        st, _, h = c.raw('POST', '/api/admin/login', ('{"username":"admin","password":"%s"}' % self.srv.admin_password).encode(),
                         {'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https'})
        self.assertEqual(st, 200)
        cookie = [v for k, v in h.items() if k.lower() == 'set-cookie' and v.startswith('j360s=')][0]
        for flag in ('HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=604800'):
            self.assertIn(flag, cookie)

    def test_moderator_cannot_touch_money_or_settings(self):
        adm = self.srv.admin()
        self.ok(adm.post('/admin/admins', {'username': 'mod1', 'password': 'Mod#pass2026', 'role': 'moderator'}))
        mod = self.srv.client()
        self.ok(mod.post('/admin/login', {'username': 'mod1', 'password': 'Mod#pass2026'}))
        self.assertEqual(mod.put('/admin/settings/ads', [])[0], 403)
        self.assertEqual(mod.put('/admin/settings/payment', {})[0], 403)
        self.assertEqual(mod.post('/admin/payments/x', {'decision': 'verify'})[0], 403)
        self.assertEqual(mod.get('/admin/export')[0], 403)
        self.assertEqual(mod.post('/admin/admins', {'username': 'evil', 'password': 'Evil#pass2026', 'role': 'owner'})[0], 403)
        self.ok(mod.put('/admin/settings/notices', []))

    def test_two_step_login(self):
        adm = self.srv.admin()
        self.ok(adm.post('/admin/admins', {'username': 'boss2', 'password': 'Boss#pass2026', 'role': 'owner'}))
        me = self.srv.client()
        self.ok(me.post('/admin/login', {'username': 'boss2', 'password': 'Boss#pass2026'}))
        secret = self.ok(me.post('/admin/2fa/setup'))['secret']
        self.assertEqual(me.post('/admin/2fa', {'enable': True, 'secret': secret, 'code': '000000', 'password': 'Boss#pass2026'})[0], 400)
        self.assertEqual(me.post('/admin/2fa', {'enable': True, 'secret': secret, 'code': totp(secret), 'password': 'wrong'})[0], 400)
        self.ok(me.post('/admin/2fa', {'enable': True, 'secret': secret, 'code': totp(secret, -1), 'password': 'Boss#pass2026'}))
        self.assertTrue(self.ok(me.get('/admin/me'))['twofa'])
        other = self.srv.client()
        st, r = other.post('/admin/login', {'username': 'boss2', 'password': 'Boss#pass2026'})
        self.assertEqual((st, r.get('need2fa')), (401, True))
        self.assertEqual(other.post('/admin/login', {'username': 'boss2', 'password': 'Boss#pass2026', 'code': '123456'})[0], 401)
        self.ok(other.post('/admin/login', {'username': 'boss2', 'password': 'Boss#pass2026', 'code': totp(secret)}))
        # the same code cannot be used twice
        third = self.srv.client()
        self.assertEqual(third.post('/admin/login', {'username': 'boss2', 'password': 'Boss#pass2026', 'code': totp(secret)})[0], 401)
        listed = [a for a in self.ok(adm.get('/admin/admins')) if a['username'] == 'boss2'][0]
        self.assertTrue(listed['twofa'])
        self.assertNotIn('totp', listed)

    def test_settings_are_validated(self):
        adm = self.srv.admin()
        self.assertEqual(adm.put('/admin/settings/nope', {})[0], 404)
        self.assertEqual(adm.put('/admin/settings/ads', {'not': 'a list'})[0], 400)
        self.assertEqual(adm.put('/admin/settings/categories', [{'id': '../x'}])[0], 400)
        self.assertEqual(adm.put('/admin/settings/plans', [{'id': 'x', 'price': 'free'}])[0], 400)


if __name__ == '__main__':
    unittest.main()
