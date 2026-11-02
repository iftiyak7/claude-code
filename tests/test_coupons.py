"""Coupons: claiming, limits, private coupons, redemption by the business owner only."""
import unittest

from helpers import ServerTest


class CouponTest(ServerTest):
    def test_coupon_flow(self):
        adm = self.srv.admin()
        owner, u1, u2, u3 = (self.srv.client() for _ in range(4))
        for c in (owner, u1, u2):
            c.register()
        r3 = u3.register()
        lid = self.ok(owner.post('/my/listings', {'name': 'মেজবান বাড়ি', 'cat': 'place', 'sub': 'park'}))['id']
        self.ok(adm.post('/admin/listings/%s/review' % lid, {'review': 'approved'}))
        cp = self.ok(adm.post('/admin/coupons', {'listing': lid, 'title': '২০% ছাড়', 'ends': '2099-01-01', 'maxClaims': '2', 'audience': 'public'}))
        self.assertEqual(self.ok(self.srv.client().get('/bootstrap'))['offers'].get(lid), 1)
        self.assertEqual(self.srv.client().post('/coupons/%s/claim' % cp['id'])[0], 401)
        code = self.ok(u1.post('/coupons/%s/claim' % cp['id']))['code']
        self.assertEqual(self.ok(u1.post('/coupons/%s/claim' % cp['id']))['code'], code)      # same person, same code
        self.ok(u2.post('/coupons/%s/claim' % cp['id']))
        self.assertEqual(u3.post('/coupons/%s/claim' % cp['id'])[0], 409)                    # all taken
        private = self.ok(adm.post('/admin/coupons', {'listing': lid, 'title': 'ফ্রি ডেজার্ট', 'audience': 'private', 'users': [r3['id']]}))
        self.assertNotIn(private['id'], [x['id'] for x in self.ok(u1.get('/coupons'))])
        self.assertEqual(u1.post('/coupons/%s/claim' % private['id'])[0], 404)
        self.assertIn('ফ্রি ডেজার্ট', [x['title'] for x in self.ok(u3.get('/my/coupons'))['mine']])
        # only the business owner (or admin) checks and uses a code
        self.assertEqual(u2.post('/my/coupons/check', {'code': code, 'redeem': True})[0], 403)
        self.assertEqual(self.ok(owner.post('/my/coupons/check', {'code': code.lower(), 'redeem': True}))['state'], 'used')
        self.assertEqual(owner.post('/my/coupons/check', {'code': code, 'redeem': True})[0], 409)
        # an owner's own offer waits for the admin
        oc = self.ok(owner.post('/my/coupons', {'listing': lid, 'title': '২টা কিনলে ১টা ফ্রি'}))
        self.assertNotIn(oc['id'], [x['id'] for x in self.ok(u1.get('/coupons'))])
        self.assertEqual(u1.post('/my/coupons', {'listing': lid, 'title': 'x'})[0], 403)
        self.assertIn(owner.put('/my/coupons/' + cp['id'], {'status': 'paused'})[0], (403, 404))    # the admin's coupon, not the owner's
        self.ok(adm.put('/admin/coupons/' + oc['id'], {'status': 'active'}))
        self.assertIn(oc['id'], [x['id'] for x in self.ok(u1.get('/coupons'))])


if __name__ == '__main__':
    unittest.main()
