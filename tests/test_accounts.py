"""User accounts: sign-up rules, sign-in, sessions."""
import unittest

from helpers import ServerTest


class AccountTest(ServerTest):
    def test_register_rules(self):
        new = self.srv.client      # sign-ups are limited per visitor, so each try comes from a new one
        base = {'name': 'রহিম', 'phone': '01799000001', 'password': 'Jsr#2026test', 'terms': True}
        self.assertEqual(new().post('/auth/register', dict(base, phone='123'))[0], 400)
        self.assertEqual(new().post('/auth/register', dict(base, terms=False))[0], 400)
        for weak in ('short1', '12345678', 'password', 'aaaaaaaaaa', 'x99000001x'):
            self.assertEqual(new().post('/auth/register', dict(base, password=weak))[0], 400, weak)
        c = new()
        self.ok(c.post('/auth/register', dict(base, phone='০১৭৯৯০০০০০১')))       # Bangla digits are fine
        self.assertEqual(new().post('/auth/register', base)[0], 409)                 # same number again
        me = self.ok(c.get('/auth/me'))
        self.assertEqual(me['phone'], '01799000001')
        self.assertNotIn('pass', me)

    def test_session_cookie_is_protected(self):
        c = self.srv.client()
        st, _, h = c.raw('POST', '/api/auth/register', b'{"name":"A","phone":"01799000002","password":"Jsr#2026test","terms":true}',
                         {'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https'})
        self.assertEqual(st, 200)
        cookie = [v for k, v in h.items() if k.lower() == 'set-cookie' and v.startswith('j360u=')][0]
        for flag in ('HttpOnly', 'Secure', 'SameSite=Lax'):
            self.assertIn(flag, cookie)

    def test_login_logout_and_wrong_password(self):
        c = self.srv.client()
        c.register()
        self.ok(c.post('/auth/logout'))
        self.assertIsNone(self.ok(c.get('/auth/me')))
        self.assertEqual(c.post('/auth/login', {'phone': c.phone, 'password': 'wrong-password'})[0], 401)
        self.ok(c.post('/auth/login', {'phone': c.phone, 'password': c.password}))
        self.assertEqual(self.ok(c.get('/auth/me'))['phone'], c.phone)

    def test_login_attempts_are_limited(self):
        victim = self.srv.client()
        victim.register()
        attacker = self.srv.client()
        codes = [attacker.post('/auth/login', {'phone': victim.phone, 'password': 'guess%d' % i})[0] for i in range(10)]
        self.assertEqual(codes[-1], 429)
        # also when the attacker keeps changing the forwarded address
        spoof = [attacker.call('POST', '/auth/login', {'phone': victim.phone, 'password': 'x'}, {'X-Forwarded-For': '9.9.9.%d' % i})[0]
                 for i in range(3)]
        self.assertTrue(all(s == 429 for s in spoof))

    def test_password_change_signs_out_other_devices(self):
        phone_a = self.srv.client()
        phone_a.register()
        phone_b = self.srv.client()
        self.ok(phone_b.post('/auth/login', {'phone': phone_a.phone, 'password': phone_a.password}))
        self.assertEqual(phone_a.put('/my/profile', {'name': 'নতুন', 'password': 'wrong', 'newPassword': 'Jsr#2027next'})[0], 400)
        self.assertEqual(phone_a.put('/my/profile', {'name': 'নতুন', 'password': phone_a.password, 'newPassword': '12345678'})[0], 400)
        self.ok(phone_a.put('/my/profile', {'name': 'নতুন', 'password': phone_a.password, 'newPassword': 'Jsr#2027next'}))
        self.assertEqual(self.ok(phone_a.get('/auth/me'))['name'], 'নতুন')
        self.assertIsNone(self.ok(phone_b.get('/auth/me')))

    def test_private_pages_need_login(self):
        c = self.srv.client()
        for path in ('/my', '/my/coupons'):
            self.assertEqual(c.get(path)[0], 401, path)
        self.assertEqual(c.post('/my/listings', {'name': 'x', 'cat': 'place'})[0], 401)


if __name__ == '__main__':
    unittest.main()
