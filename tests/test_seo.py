"""What search engines and link previews get: robots.txt, sitemap.xml, a real page per listing and per category."""
import json
import re
import unittest

from helpers import ServerTest


class SeoTest(ServerTest):
    def get(self, path):
        st, body, h = self.srv.client().raw('GET', path)
        return st, body.decode('utf-8', 'replace'), h

    def test_robots_and_sitemap(self):
        st, text, h = self.get('/robots.txt')
        self.assertEqual(st, 200)
        self.assertIn('Disallow: /admin', text)
        self.assertIn('Disallow: /api/', text)
        self.assertRegex(text, r'Sitemap: https?://[^/]+/sitemap\.xml')
        st, xml, h = self.get('/sitemap.xml')
        self.assertEqual(st, 200)
        self.assertIn('application/xml', h['Content-Type'])
        self.assertIn('/p/h-general</loc>', xml)
        self.assertIn('/c/hospital</loc>', xml)
        self.assertIn('/c/emergency</loc>', xml)                    # emergency services matter most

    def test_listing_page_has_title_preview_and_text(self):
        st, page, h = self.get('/p/h-general')
        self.assertEqual(st, 200)
        self.assertIn('<title>২৫০ শয্যা জেনারেল হাসপাতাল', page)
        self.assertEqual(page.count('<title>'), 1)
        for tag in ('og:title', 'og:description', 'og:image', 'og:url', 'twitter:card'):
            self.assertIn(f'"{tag}"', page)
        self.assertRegex(page, r'<link rel="canonical" href="https?://[^"]+/p/h-general">')
        self.assertRegex(page, r'og:image" content="https?://')          # previews need a full address
        ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page, re.S).group(1))
        self.assertEqual(ld['name'], '২৫০ শয্যা জেনারেল হাসপাতাল, যশোর')
        self.assertIn('<article class="seo"><h1>', page)                  # readable without running the app
        self.assertIn('/js/main.js', page)                                # and it is still the app
        self.assertIn("script-src 'self'", h['Content-Security-Policy'])

    def test_app_page_and_opening_hours(self):
        st, page, h = self.get('/app/')
        self.assertEqual(st, 200)
        self.assertIn('og:title', page)
        self.assertRegex(page, r'og:image" content="https?://')
        self.assertEqual(h['Cache-Control'], 'no-cache')
        st, page, _ = self.get('/p/h-general')                         # open 24 hours
        ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page, re.S).group(1))
        self.assertEqual(ld['openingHours'], 'Mo-Su 00:00-23:59')

    def test_category_page_lists_links(self):
        st, page, _ = self.get('/c/hospital')
        self.assertEqual(st, 200)
        self.assertIn('<a href="/p/h-general">', page)

    def test_unknown_hidden_and_renamed(self):
        st, _, h = self.srv.client().raw('GET', '/p/no-such-place', follow=False)
        self.assertEqual((st, h['Location']), (302, '/app/'))
        adm = self.srv.admin()
        u = self.srv.client()
        u.register()
        lid = self.ok(u.post('/my/listings', {'name': '<script>alert(1)</script> দোকান', 'cat': 'place', 'sub': 'park', 'about': '"></title><img src=x>'}))['id']
        st, _, h = self.srv.client().raw('GET', '/p/' + lid, follow=False)
        self.assertEqual(st, 302)                                         # not published yet
        self.ok(adm.post('/admin/listings/%s/review' % lid, {'review': 'approved'}))
        st, page, _ = self.get('/p/' + lid)
        self.assertNotIn('<script>alert', page)
        self.assertNotIn('<img src=x>', page)
        self.assertIn('&lt;script&gt;', page)
        self.ok(adm.post('/admin/listings/%s/rename' % lid, {'id': 'safe-shop'}))
        st, _, h = self.srv.client().raw('GET', '/p/' + lid, follow=False)
        self.assertEqual((st, h['Location']), (302, '/p/safe-shop'))

    def test_landing_preview_is_absolute(self):
        st, page, _ = self.get('/')
        self.assertEqual(st, 200)
        self.assertRegex(page, r'og:image" content="https?://[^"]+/shots/')
        self.assertIn('og:url', page)


if __name__ == '__main__':
    unittest.main()
