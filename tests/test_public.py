"""Public pages and API: what anyone on the internet can reach."""
import unittest

from helpers import ServerTest


class PublicTest(ServerTest):
    def test_bootstrap_has_the_app_data(self):
        d = self.ok(self.srv.client().get('/bootstrap'))
        for k in ('listings', 'categories', 'areas', 'ads', 'plans', 'terms', 'offers', 'v'):
            self.assertIn(k, d)
        self.assertIn('হাইকোর্ট মোড়', d['areas'])
        self.assertTrue(all(l.get('id') for l in d['listings']))
        # nothing private in the public data
        text = str(d)
        for secret in ('_owner', '_contact', 'pass', 'totp'):
            self.assertNotIn("'%s'" % secret, text)

    def test_pages_send_security_headers(self):
        c = self.srv.client()
        for path in ('/', '/app/', '/admin/'):
            st, body, h = c.raw('GET', path)
            self.assertEqual(st, 200, path)
            self.assertIn("script-src 'self'", h['Content-Security-Policy'])
            self.assertIn("frame-ancestors 'none'", h['Content-Security-Policy'])
            self.assertEqual(h['X-Frame-Options'], 'DENY')
            self.assertEqual(h['X-Content-Type-Options'], 'nosniff')
            self.assertNotIn(b'<script>', body, 'inline scripts would be blocked by the CSP')
            self.assertNotIn(b'onclick=', body)
        self.assertIsNone(c.raw('GET', '/api/bootstrap')[2]['Strict-Transport-Security'])
        st, _, h = c.raw('GET', '/api/bootstrap', headers={'X-Forwarded-Proto': 'https'})
        self.assertIn('max-age=', h['Strict-Transport-Security'])

    def test_no_files_outside_public(self):
        c = self.srv.client()
        for path in ('/../server/server.py', '/%2e%2e/server/server.py', '/..%2fserver%2fseed.json', '/.git/config',
                     '/uploads/../jashore360.db', '/uploads/x.db', '/app/../../server/seed.json'):
            st, body, _ = c.raw('GET', path)
            # either "not found" or the app's own start page, never a file from outside public/
            self.assertTrue(st == 404 or body.lstrip().lower().startswith(b'<!doctype html'), path)
            self.assertNotIn(b'SQLite format', body, path)

    def test_unknown_api_is_404_json(self):
        st, r = self.srv.client().get('/nope')
        self.assertEqual(st, 404)
        self.assertIn('error', r)

    def test_json_body_required_for_writes(self):
        # A form posted from another site cannot send JSON, so it cannot act for a signed-in visitor.
        c = self.srv.client()
        c.register()
        st, _, _ = c.raw('POST', '/api/my/listings', b'name=x&cat=place', {'Content-Type': 'application/x-www-form-urlencoded'})
        self.assertIn(st, (400, 415))

    def test_other_sites_cannot_send_changes(self):
        c = self.srv.client()
        c.register()
        st, _ = c.call('POST', '/auth/logout', {}, {'Origin': 'https://evil.example'})
        self.assertEqual(st, 403)
        self.assertIsNotNone(self.ok(c.get('/auth/me')))         # still signed in
        host = c.base.split('//')[1]
        self.ok(c.call('POST', '/auth/logout', {}, {'Origin': 'http://' + host}))

    def test_bad_request_sizes(self):
        c = self.srv.client()
        for bad in ('-1', 'abc'):
            st, _, _ = c.raw('POST', '/api/reports', b'{}', {'Content-Type': 'application/json', 'Content-Length': bad})
            self.assertIn(st, (400, 411, 413), bad)
        self.ok(c.get('/bootstrap'))                              # the server is still fine

    def test_reviews_need_an_account(self):
        st, _ = self.srv.client().post('/reviews', {'listing': 'h-general', 'stars': 5})
        self.assertEqual(st, 401)

    def test_map_link_only_reads_coordinates(self):
        c = self.srv.client()
        r = self.ok(c.post('/maplink', {'url': 'https://www.google.com/maps/place/x/@23.1667,89.2089,17z'}))
        self.assertAlmostEqual(r['lat'], 23.1667)
        # other hosts are never fetched (no requests to internal addresses)
        for url in ('http://127.0.0.1:22/', 'http://169.254.169.254/latest/meta-data', 'https://google.com.evil.example/maps'):
            st, r = c.post('/maplink', {'url': url})
            self.assertFalse(st == 200 and r and r.get('lat'), url)
        # a short Google link is followed; without internet (as in tests) that fails cleanly, never with a crash
        self.assertIn(c.post('/maplink', {'url': 'https://maps.app.goo.gl/AbCdEf123'})[0], (200, 400, 502))


if __name__ == '__main__':
    unittest.main()
