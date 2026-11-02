"""Listings, classifieds and uploads from users: approval flow and who may change what."""
import json
import unittest

from helpers import ServerTest

JPG = b'\xff\xd8\xff\xe0' + b'\x00' * 2000
MP4 = b'\x00\x00\x00\x18ftypmp42' + b'\x00' * 3000


def public_ids(c):
    return {l['id'] for l in c.get('/bootstrap')[1]['listings']}


class ListingTest(ServerTest):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.adm = cls.srv.admin()

    def test_free_listing_waits_for_approval(self):
        u = self.srv.client()
        u.register()
        r = self.ok(u.post('/my/listings', {'name': 'রহমান কাচ্চি', 'nameEn': 'Rahman Kacchi', 'cat': 'place', 'sub': 'park',
                                            'area': 'হাইকোর্ট মোড়', 'contacts': [{'role': 'ম্যানেজার', 'phone': '01911111111'}],
                                            'off': [5], 'features': 'পার্কিং, ওয়াইফাই', 'halal': True,
                                            # flags only the admin may set are ignored
                                            'blueTick': True, 'sponsored': True, 'featured': True, 'status': 'verified'}))
        lid = r['id']
        self.assertNotIn(lid, public_ids(u))
        doc = self.ok(u.get('/my/listings/' + lid))
        self.assertEqual(doc['nameEn'], 'Rahman Kacchi')
        self.assertEqual(doc['features'], ['পার্কিং', 'ওয়াইফাই'])
        self.assertTrue(doc['halal'])
        for flag in ('blueTick', 'sponsored', 'featured'):
            self.assertNotIn(flag, doc)
        self.assertEqual(doc['status'], 'pending')
        self.ok(self.adm.post('/admin/listings/%s/review' % lid, {'review': 'approved'}))
        self.assertIn(lid, public_ids(u))
        # an edit sends it back to the admin
        self.assertEqual(self.ok(u.put('/my/listings/' + lid, {'name': 'রহমান কাচ্চি ঘর', 'area': 'হাইকোর্ট মোড়'}))['review'], 'pending')
        self.assertNotIn(lid, public_ids(u))

    def test_paid_listing_needs_payment(self):
        u = self.srv.client()
        u.register()
        self.assertEqual(u.post('/my/listings', {'name': 'ক্লিনিক', 'cat': 'hospital', 'sub': 'clinic'})[0], 400)   # no plan
        r = self.ok(u.post('/my/listings', {'name': 'ক্লিনিক', 'cat': 'hospital', 'sub': 'clinic', 'plan': 'basic'}))
        self.assertTrue(r['needsPayment'])
        self.assertEqual(u.post('/my/payments', {'listing': r['id'], 'method': 'bkash', 'trx': '1', 'sender': u.phone})[0], 400)
        self.ok(u.post('/my/payments', {'listing': r['id'], 'method': 'bkash', 'trx': 'ABC123XYZ', 'sender': u.phone}))
        pay = [p for p in self.ok(self.adm.get('/admin/payments')) if p['listing_id'] == r['id']][0]
        self.ok(self.adm.post('/admin/payments/' + pay['id'], {'decision': 'verify', 'publish': True}))
        self.assertIn(r['id'], public_ids(u))

    def test_nobody_can_change_someone_elses_things(self):
        owner, other = self.srv.client(), self.srv.client()
        owner.register()
        other.register()
        lid = self.ok(owner.post('/my/listings', {'name': 'আমার দোকান', 'cat': 'place', 'sub': 'park'}))['id']
        cid = self.ok(owner.post('/my/classifieds', {'kind': 'rent', 'title': 'বাসা ভাড়া', 'phone': owner.phone, 'price': '8000'}))['id']
        self.assertEqual(other.get('/my/listings/' + lid)[0], 404)
        self.assertEqual(other.put('/my/listings/' + lid, {'name': 'হ্যাক'})[0], 404)
        self.assertEqual(other.delete('/my/listings/' + lid)[0], 404)
        self.assertEqual(other.put('/my/classifieds/' + cid, {'title': 'হ্যাক', 'phone': other.phone})[0], 404)
        self.assertEqual(other.delete('/my/classifieds/' + cid)[0], 404)
        self.assertEqual(self.ok(owner.get('/my/listings/' + lid))['name'], 'আমার দোকান')
        # and users never reach the admin API
        for path in ('/admin/listings', '/admin/users', '/admin/payments', '/admin/export'):
            self.assertEqual(other.get(path)[0], 401, path)

    def test_uploads_are_checked(self):
        u, other = self.srv.client(), self.srv.client()
        u.register()
        other.register()
        img = self.ok(self._upload(u, JPG, 'image/jpeg'))['url']
        self._upload(u, MP4, 'video/mp4')
        st, r = self._upload(u, b'<?php system($_GET[1]); ?>' + b' ' * 100, 'image/jpeg')
        self.assertEqual(st, 400)
        st, r = self._upload(u, b'<svg onload=alert(1)>' + b' ' * 100, 'image/svg+xml')
        self.assertEqual(st, 400)
        theirs = self.ok(self._upload(other, JPG, 'image/jpeg'))['url']
        cid = self.ok(u.post('/my/classifieds', {'kind': 'rent', 'title': 'বাসা', 'phone': u.phone, 'price': '9000',
                                                 'images': [img, theirs, '/uploads/../../etc/passwd', 'https://evil.example/x.jpg']}))['id']
        mine = [x for x in self.ok(u.get('/my'))['classifieds'] if x['id'] == cid][0]
        self.assertEqual(mine['images'], [img])            # only your own uploads can be attached
        st, body, h = u.raw('GET', img)
        self.assertEqual(st, 200)
        self.assertEqual(h['X-Content-Type-Options'], 'nosniff')

    def _upload(self, c, data, ctype):
        st, raw, _ = c.raw('POST', '/api/my/media', data, {'Content-Type': ctype})
        return st, json.loads(raw) if raw else None


if __name__ == '__main__':
    unittest.main()
