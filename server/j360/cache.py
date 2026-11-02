"""The public "bootstrap" bundle every app start downloads, cached until something changes."""
import gzip
import json
import re
import time
from .config import CLASS_KINDS, DOMAIN_FILE, SETTING_KEYS
from .store import _lock, db, get_setting
from .util import today


_version = [int(time.time())]
_boot_cache = {}


def home_domain():
    # The site's one real address; the app on any other (old) address is asked to update.
    try:
        d = open(DOMAIN_FILE).read().strip().lower()
    except OSError:
        return None
    d = d[4:] if d.startswith('www.') else d
    return d if re.match(r'^[a-z0-9.-]+\.[a-z]+$', d) else None
_static_cache = {}


def bump():
    with _lock:
        _version[0] += 1
        _boot_cache.clear()


def live_ads(ads):
    t = today()
    return [a for a in ads or [] if a.get('active', True) and (not a.get('start') or a['start'] <= t) and (not a.get('end') or a['end'] >= t)]


def bootstrap_payload():
    v, t, home = _version[0], today(), home_domain()
    hit = _boot_cache.get((v, t, home))            # per day too: paid listings and popups expire by date
    if hit:
        return hit
    with db() as c:
        ratings = {r[0]: (round(r[1], 2), r[2]) for r in
                   c.execute('SELECT listing_id, AVG(stars), COUNT(*) FROM reviews WHERE hidden=0 GROUP BY listing_id')}
        listings = []
        for r in c.execute("SELECT id, doc, paid_until FROM listings WHERE review='approved'"):
            d = json.loads(r['doc'])
            if d.get('hidden') or (r['paid_until'] and r['paid_until'] < t):
                continue
            d['id'] = r['id']
            if d.get('sponsored') and d.get('sponsoredUntil') and d['sponsoredUntil'] < t:
                d.pop('sponsored')                    # paid promotion ended
            if r['id'] in ratings:
                d['rating'], d['reviews'] = ratings[r['id']]
            listings.append(d)
        out = {k: get_setting(c, k) for k in SETTING_KEYS}
        aliases = {r['old']: r['new'] for r in c.execute('SELECT old, new FROM aliases')}
        offers = {}
        for r in c.execute("SELECT listing_id, COUNT(*) FROM coupons WHERE status='active' AND audience='public' AND (starts IS NULL OR starts<=?) "
                           "AND (ends IS NULL OR ends>=?) GROUP BY listing_id", (t, t)):
            offers[r[0]] = r[1]
        counts = {k: 0 for k in CLASS_KINDS}
        for r in c.execute("SELECT kind, COUNT(*) FROM classifieds WHERE review='approved' AND expires_at>? GROUP BY kind", (int(time.time()),)):
            counts[r[0]] = r[1]
    out['ads'] = live_ads(out['ads'])
    out['notices'] = [n for n in out['notices'] or [] if n.get('active', True)]
    pop = out.get('popup') or {}
    live = pop.get('active') and (pop.get('title') or pop.get('image')) and (pop.get('start') or '') <= t and (not pop.get('end') or pop['end'] >= t)
    out['popup'] = pop if live else None
    out['categories'] = [x for x in out['categories'] or [] if x.get('active', True)]
    out['listings'] = listings
    out['classifiedCounts'] = counts
    out['aliases'] = aliases
    out['offers'] = offers
    out['home'] = home
    out['v'] = v
    raw = json.dumps(out, ensure_ascii=False, separators=(',', ':')).encode()
    entry = (raw, gzip.compress(raw, 6), '"b%d-%s-%s"' % (v, t, home or ''))
    _boot_cache.clear()
    _boot_cache[(v, t, home)] = entry
    return entry
