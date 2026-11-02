"""How stored rows are turned into API answers (shared by the public, user and admin APIs)."""
import json
import secrets
import sqlite3
import time
from .util import ApiError, today


def review_row(r, include_private=False):
    d = {'id': r['id'], 'stars': r['stars'], 'crit': json.loads(r['crit']) if r['crit'] else None, 'name': r['name'],
         'text': r['text'], 'photo': r['photo'], 'reply': r['reply'], 'up': r['up'], 'down': r['down'], 't': r['created_at']}
    if include_private:
        d.update(listing=r['listing_id'], hidden=bool(r['hidden']), userId=r['user_id'])
    return d


def classified_out(r, private=False):
    d = json.loads(r['doc'])
    d.update(id=r['id'], kind=r['kind'], t=r['created_at'], expires=r['expires_at'], views=r['views'])
    if private:
        d.update(review=r['review'])
    return d


def listing_state(review, paid_until, pay):
    if review == 'unpaid':
        return 'payment_review' if pay and pay['status'] == 'submitted' else 'payment_rejected' if pay and pay['status'] == 'rejected' else 'unpaid'
    if review == 'approved' and paid_until and paid_until < today():
        return 'expired'
    return review


CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'


def coupon_live(cp, t=None):
    t = t or today()
    return cp['status'] == 'active' and (not cp['starts'] or cp['starts'] <= t) and (not cp['ends'] or cp['ends'] >= t)


def coupon_out(c, cp, names=None):
    names = names or {}
    used = c.execute('SELECT COUNT(*), SUM(used_at IS NOT NULL) FROM claims WHERE coupon_id=?', (cp['id'],)).fetchone()
    return {'id': cp['id'], 'listing': cp['listing_id'], 'listingName': names.get(cp['listing_id']), 'title': cp['title'], 'details': cp['details'],
            'starts': cp['starts'], 'ends': cp['ends'], 'maxClaims': cp['max_claims'], 'audience': cp['audience'], 'status': cp['status'],
            'createdBy': cp['created_by'], 'note': cp['note'], 'claims': used[0] or 0, 'used': used[1] or 0, 'live': coupon_live(cp)}


def coupon_rows(c, where, args, live=False):
    rows = c.execute('SELECT cl.*, cp.listing_id, cp.title, cp.details, cp.starts, cp.ends, cp.status FROM claims cl JOIN coupons cp ON cp.id=cl.coupon_id '
                     'WHERE ' + where + ' ORDER BY cl.claimed_at DESC', args).fetchall()
    return [r for r in rows if not live or coupon_live(r)]


def new_claim(c, coupon_id, uid):
    for _ in range(20):
        code = 'J360-' + ''.join(secrets.choice(CODE_CHARS) for _ in range(6))
        try:
            c.execute('INSERT INTO claims (code, coupon_id, user_id, claimed_at) VALUES (?,?,?,?)', (code, coupon_id, uid, int(time.time())))
            return code
        except sqlite3.IntegrityError as e:
            if 'coupon_id' in str(e) or 'UNIQUE constraint failed: claims.coupon_id' in str(e):
                return c.execute('SELECT code FROM claims WHERE coupon_id=? AND user_id=?', (coupon_id, uid)).fetchone()[0]
    raise ApiError(500, 'কোড তৈরি করা যায়নি')


def listing_names(c):
    return {r['id']: json.loads(r['doc']).get('name') for r in c.execute('SELECT id, doc FROM listings')}


def listing_out(r, pay=None, owner=None):
    d = json.loads(r['doc'])
    d.update(id=r['id'], _review=r['review'], _source=r['source'], _contact=r['contact'], _created=r['created_at'],
             _updated=r['updated_at'], _views=r['views'], _calls=r['calls'], _maps=r['maps'], _imps=r['imps'], _plan=r['plan'],
             _paidUntil=r['paid_until'], _owner=owner, _payment=pay)
    return d
