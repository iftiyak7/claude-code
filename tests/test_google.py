"""Sign in / sign up with Google, against a stand-in for Google's token service."""
import base64
import hashlib
import http.server
import json
import re
import threading
import time
import unittest
import urllib.parse

from helpers import Server, free_port

CLIENT_ID = 'test-123.apps.googleusercontent.com'
ACCOUNTS = {   # code Google would hand out -> who signed in
    'rahim': {'sub': '1001', 'email': 'rahim@gmail.com', 'name': 'Rahim Uddin', 'email_verified': True},
    'karim': {'sub': '1002', 'email': 'karim@gmail.com', 'name': 'Karim', 'email_verified': True},
    'salma': {'sub': '1003', 'email': 'salma@gmail.com', 'name': 'Salma', 'email_verified': True},
    'linker': {'sub': '1007', 'email': 'linker@gmail.com', 'name': 'Linker', 'email_verified': True},
    'app': {'sub': '1004', 'email': 'app@gmail.com', 'name': 'App User', 'email_verified': True},
    'unverified': {'sub': '1005', 'email': 'x@gmail.com', 'email_verified': False},
    'wrongaud': {'sub': '1006', 'email': 'y@gmail.com', 'email_verified': True, 'aud': 'someone-else.apps.googleusercontent.com'},
}


class FakeGoogle(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        form = urllib.parse.parse_qs(self.rfile.read(int(self.headers['Content-Length'])).decode())
        code = form['code'][0]
        if code not in ACCOUNTS or form.get('client_secret') != ['s3cret'] or not form.get('code_verifier'):
            self.send_response(400)
            self.end_headers()
            return
        claims = {'iss': 'https://accounts.google.com', 'aud': CLIENT_ID, 'exp': int(time.time()) + 300, **ACCOUNTS[code]}
        b64 = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
        body = json.dumps({'id_token': b64({'alg': 'RS256'}) + '.' + b64(claims) + '.sig'}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class GoogleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        port = free_port()
        cls.fake = http.server.ThreadingHTTPServer(('127.0.0.1', port), FakeGoogle)
        threading.Thread(target=cls.fake.serve_forever, daemon=True).start()
        cls.srv = Server(env={'J360_GOOGLE_TOKEN_URL': f'http://127.0.0.1:{port}/token', 'J360_GOOGLE_AUTH_URL': 'https://accounts.example/auth'})
        cls.adm = cls.srv.admin()

    @classmethod
    def tearDownClass(cls):
        cls.srv.stop()
        cls.fake.shutdown()

    def setUp(self):
        self.assertEqual(self.adm.put('/admin/google', {'clientId': CLIENT_ID, 'clientSecret': 's3cret', 'enabled': True})[0], 200)

    def start(self, c, query='terms=1'):
        st, _, h = c.raw('GET', '/api/auth/google/start?' + query, follow=False)
        self.assertEqual(st, 302)
        return h['Location']

    def sign_in(self, c, code, query='terms=1'):
        loc = self.start(c, query)
        q = urllib.parse.parse_qs(urllib.parse.urlparse(loc).query)
        st, body, h = c.raw('GET', '/api/auth/google/callback?' + urllib.parse.urlencode({'state': q['state'][0], 'code': code}), follow=False)
        return st, body, h, q

    def test_admin_settings(self):
        self.assertEqual(self.adm.put('/admin/google', {'clientId': 'not-a-client-id', 'clientSecret': 'x', 'enabled': True})[0], 400)
        g = self.adm.get('/admin/google')[1]
        self.assertEqual((g['clientId'], g['hasSecret'], g['enabled']), (CLIENT_ID, True, True))
        self.assertNotIn('s3cret', json.dumps(g))
        self.assertTrue(self.adm.put('/admin/google', {'clientId': CLIENT_ID, 'enabled': True})[0] == 200)   # secret kept
        boot = self.srv.client().get('/bootstrap')[1]
        self.assertTrue(boot['googleLogin'])
        self.assertNotIn('s3cret', json.dumps(boot))
        self.assertEqual(self.srv.client().get('/admin/google')[0], 401)
        self.adm.put('/admin/google', {'clientId': CLIENT_ID, 'enabled': False})
        self.assertFalse(self.srv.client().get('/bootstrap')[1]['googleLogin'])
        self.assertIn('err=google-off', self.start(self.srv.client()))

    def test_sign_up_then_sign_in_on_the_website(self):
        c = self.srv.client()
        st, _, h, q = self.sign_in(c, 'rahim')
        self.assertEqual(q['code_challenge_method'], ['S256'])
        self.assertEqual(q['client_id'], [CLIENT_ID])
        self.assertTrue(q['redirect_uri'][0].endswith('/api/auth/google/callback'))
        self.assertEqual((st, h['Location']), (302, '/app/#/account'))
        me = c.get('/auth/me')[1]
        self.assertEqual((me['name'], me['email'], me['google'], me['phone'], me['hasPassword']), ('Rahim Uddin', 'rahim@gmail.com', True, None, False))
        again = self.srv.client()
        self.sign_in(again, 'rahim', 'terms=0')                    # existing account: no new terms needed
        self.assertEqual(again.get('/auth/me')[1]['id'], me['id'])
        # add a phone number and a password, then the number works for signing in too
        self.assertEqual(c.put('/my/profile', {'name': 'Rahim', 'phone': '01788800001', 'newPassword': 'Jsr#2026goog'})[0], 200)
        phone = self.srv.client()
        self.assertEqual(phone.post('/auth/login', {'phone': '01788800001', 'password': 'Jsr#2026goog'})[0], 200)
        self.assertEqual(phone.get('/auth/me')[1]['id'], me['id'])

    def test_a_sign_in_link_works_once(self):
        c = self.srv.client()
        loc = self.start(c)
        state = urllib.parse.parse_qs(urllib.parse.urlparse(loc).query)['state'][0]
        c.raw('GET', f'/api/auth/google/callback?state={state}&code=karim', follow=False)
        st, _, h = self.srv.client().raw('GET', f'/api/auth/google/callback?state={state}&code=karim', follow=False)
        self.assertIn('err=google', h['Location'])
        st, _, h = c.raw('GET', '/api/auth/google/callback?state=made-up&code=karim', follow=False)
        self.assertIn('err=google', h['Location'])

    def test_rejected_cases(self):
        for code, err in (('unverified', 'err=google'), ('wrongaud', 'err=google'), ('nobody', 'err=google')):
            c = self.srv.client()
            st, _, h, _ = self.sign_in(c, code)
            self.assertIn(err, h['Location'], code)
            self.assertIsNone(c.get('/auth/me')[1])
        c = self.srv.client()
        st, _, h, _ = self.sign_in(c, 'salma', 'terms=0')             # a new account needs the terms accepted
        self.assertIn('err=terms', h['Location'])
        st, _, h = c.raw('GET', '/api/auth/google/start?app=not-a-hash', follow=False)
        self.assertEqual(st, 400)

    def test_android_app_hand_off(self):
        secret = 'a' * 64
        app_hash = hashlib.sha256(secret.encode()).hexdigest()
        browser = self.srv.client()
        st, body, h, _ = self.sign_in(browser, 'app', 'terms=1&app=' + app_hash)
        self.assertEqual(st, 200)
        self.assertIsNone(browser.get('/auth/me')[1])                  # the browser itself is not signed in
        code = re.search(r'intent://auth\?code=([\w-]+)#Intent;scheme=jashore360;package=cloud\.jashore360\.app;end', body.decode()).group(1)
        thief = self.srv.client()
        st, _, h = thief.raw('GET', f'/api/auth/google/finish?code={code}&s=wrong', follow=False)
        self.assertIn('err=google', h['Location'])                    # without the app's secret the code is useless…
        app = self.srv.client()
        st, _, h = app.raw('GET', f'/api/auth/google/finish?code={code}&s={secret}', follow=False)
        self.assertIn('err=google', h['Location'])                    # …and a tried code is spent
        st, body, h, _ = self.sign_in(browser, 'app', 'terms=1&app=' + app_hash)
        code = re.search(r'code=([\w-]+)#', body.decode()).group(1)
        st, _, h = app.raw('GET', f'/api/auth/google/finish?code={code}&s={secret}', follow=False)
        self.assertEqual(h['Location'], '/app/#/account')
        self.assertEqual(app.get('/auth/me')[1]['email'], 'app@gmail.com')

    def test_link_google_to_a_phone_account(self):
        u = self.srv.client()
        u.register()
        self.assertIn('err=login', self.start(self.srv.client(), 'mode=link'))
        self.sign_in(u, 'linker', 'mode=link')
        me = u.get('/auth/me')[1]
        self.assertTrue(me['google'])
        self.assertEqual(me['phone'], u.phone)
        other = self.srv.client()
        other.register()
        st, _, h, _ = self.sign_in(other, 'linker', 'mode=link')
        self.assertIn('err=google-taken', h['Location'])
        g = self.srv.client()
        self.sign_in(g, 'linker', 'terms=0')                            # Google now signs in to the phone account
        self.assertEqual(g.get('/auth/me')[1]['id'], me['id'])


if __name__ == '__main__':
    unittest.main()
