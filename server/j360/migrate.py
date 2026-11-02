"""Creating the database and bringing an older install's tables and starter data up to date."""
import json
import os
import time
from . import config
from .config import DICT_SETTINGS, SEED, SETTING_KEYS
from .store import db, get_setting


SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY, doc TEXT NOT NULL,
  review TEXT NOT NULL DEFAULT 'approved',      -- approved | pending | unpaid | rejected
  source TEXT NOT NULL DEFAULT 'admin',          -- seed | admin | user
  contact TEXT, created_at INTEGER, updated_at INTEGER,
  views INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, maps INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, stars INTEGER NOT NULL, crit TEXT, name TEXT, text TEXT, photo TEXT,
  device TEXT, ip TEXT, hidden INTEGER NOT NULL DEFAULT 0, reply TEXT, up INTEGER NOT NULL DEFAULT 0,
  down INTEGER NOT NULL DEFAULT 0, created_at INTEGER, UNIQUE(listing_id, device));
CREATE INDEX IF NOT EXISTS reviews_listing ON reviews(listing_id);
CREATE TABLE IF NOT EXISTS votes (review_id TEXT, device TEXT, PRIMARY KEY (review_id, device));
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, kind TEXT, listing_id TEXT, review_id TEXT, reason TEXT, created_at INTEGER,
  done INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass TEXT NOT NULL, created_at INTEGER);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, admin TEXT, action TEXT, target TEXT, at INTEGER);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE, pass TEXT,
  banned INTEGER NOT NULL DEFAULT 0, created_at INTEGER, terms_v INTEGER, terms_at INTEGER, google_sub TEXT UNIQUE, email TEXT);
CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, verifier TEXT NOT NULL, mode TEXT NOT NULL, user_id INTEGER,
  app_hash TEXT, terms INTEGER, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_codes (code TEXT PRIMARY KEY, user_id INTEGER NOT NULL, app_hash TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS usessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, user_id INTEGER, listing_id TEXT, plan_id TEXT, amount INTEGER, method TEXT, trx TEXT, sender TEXT,
  status TEXT NOT NULL DEFAULT 'submitted', note TEXT, created_at INTEGER, decided_at INTEGER, decided_by TEXT);
CREATE TABLE IF NOT EXISTS classifieds (
  id TEXT PRIMARY KEY, user_id INTEGER, kind TEXT NOT NULL, doc TEXT NOT NULL, review TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER, updated_at INTEGER, expires_at INTEGER, views INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, metric TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, metric));
CREATE TABLE IF NOT EXISTS adstats (id TEXT PRIMARY KEY, imps INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS media (name TEXT PRIMARY KEY, user_id INTEGER, kind TEXT NOT NULL, size INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS aliases (old TEXT PRIMARY KEY, new TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, title TEXT NOT NULL, details TEXT, starts TEXT, ends TEXT, max_claims INTEGER,
  audience TEXT NOT NULL DEFAULT 'public', status TEXT NOT NULL DEFAULT 'active', created_by TEXT, owner_id INTEGER, note TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS claims (
  code TEXT PRIMARY KEY, coupon_id TEXT NOT NULL, user_id INTEGER NOT NULL, claimed_at INTEGER, used_at INTEGER, used_by TEXT,
  UNIQUE(coupon_id, user_id));
"""

MIGRATIONS = [('listings', 'owner_id', 'INTEGER'), ('listings', 'plan', 'TEXT'), ('listings', 'paid_until', 'TEXT'),
              ('reviews', 'user_id', 'INTEGER'), ('admins', 'role', "TEXT NOT NULL DEFAULT 'owner'"),
              ('users', 'terms_v', 'INTEGER'), ('users', 'terms_at', 'INTEGER'), ('listings', 'imps', 'INTEGER NOT NULL DEFAULT 0'),
              ('admins', 'totp', 'TEXT')]


def users_allow_google(c):
    """Older installs require a phone number and a password for every user; a Google account may have neither.
    SQLite cannot drop NOT NULL, so the table is copied once into the new shape (ids, sessions and everything else stay)."""
    cols = {r[1]: r for r in c.execute('PRAGMA table_info(users)')}
    if not cols['phone'][3] and 'google_sub' in cols:
        return
    keep = [k for k in ('id', 'name', 'phone', 'pass', 'banned', 'created_at', 'terms_v', 'terms_at') if k in cols]
    c.execute('ALTER TABLE users RENAME TO users_old')
    c.executescript(SCHEMA)
    c.execute(f'INSERT INTO users ({", ".join(keep)}) SELECT {", ".join(keep)} FROM users_old')
    c.execute('DROP TABLE users_old')


def init_db():
    for d in (config.DATA, config.UPLOADS, config.DOWNLOADS):
        os.makedirs(d, exist_ok=True)
    seed = json.load(open(SEED, encoding='utf-8'))
    with db() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript(SCHEMA)
        users_allow_google(c)
        for table, col, decl in MIGRATIONS:
            if not any(r[1] == col for r in c.execute(f'PRAGMA table_info({table})')):
                c.execute(f'ALTER TABLE {table} ADD COLUMN {col} {decl}')
        fresh = c.execute('SELECT COUNT(*) FROM settings').fetchone()[0] == 0
        have = {r[0] for r in c.execute('SELECT key FROM settings')}
        for k in SETTING_KEYS:
            if k in have:
                continue
            val = seed.get(k, {} if k in DICT_SETTINGS else [])
            if k == 'ads' and 'banners' in have:      # older installs kept homepage banners under "banners"
                val = [dict(b, placement='home') for b in json.loads(c.execute("SELECT value FROM settings WHERE key='banners'").fetchone()[0])]
            c.execute('INSERT INTO settings VALUES (?,?)', (k, json.dumps(val, ensure_ascii=False)))
        for key in ('site', 'payment'):                # new fields (e.g. English text) for settings that already exist
            if key in have:
                cur = json.loads(c.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()[0])
                merged = {**seed.get(key, {}), **cur}
                if merged != cur:
                    c.execute('UPDATE settings SET value=? WHERE key=?', (json.dumps(merged, ensure_ascii=False), key))
        for key in ('ads', 'notices'):                 # English text for the seeded banners and notices
            if key in have or key == 'ads':
                row = c.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
                cur, seeded = json.loads(row[0]), {x['id']: x for x in seed.get(key, [])}
                for x in cur:
                    for f, v in seeded.get(x.get('id'), {}).items():
                        if f.endswith('En') and f not in x:
                            x[f] = v
                    if x.get('subtitle') == 'বিনামূল্যে প্রোফাইল — যাচাইয়ের পর প্রকাশিত হবে':   # old stock text; listing is paid now
                        x.update({f: seeded[x['id']][f] for f in ('subtitle', 'subtitleEn', 'link') if f in seeded.get(x['id'], {})})
                c.execute('UPDATE settings SET value=? WHERE key=?', (json.dumps(cur, ensure_ascii=False), key))
        if 'categories' in have:                       # categories added in later versions (e.g. mosques), and the "near" flag
            cats = json.loads(c.execute("SELECT value FROM settings WHERE key='categories'").fetchone()[0])
            ids, changed = {x['id'] for x in cats}, False
            for i, sc in enumerate(seed['categories']):
                if sc['id'] not in ids and sc.get('since', 1) > 1:
                    after = seed['categories'][i - 1]['id'] if i else None
                    pos = next((n + 1 for n, x in enumerate(cats) if x['id'] == after), len(cats))
                    cats.insert(pos, {k: v for k, v in sc.items() if k != 'since'})
                    changed = True
            for x in cats:
                sc = next((y for y in seed['categories'] if y['id'] == x['id']), None)
                if sc and 'near' in sc and 'near' not in x:
                    x['near'] = sc['near']
                    changed = True
            if changed:
                c.execute("UPDATE settings SET value=? WHERE key='categories'", (json.dumps(cats, ensure_ascii=False),))
        if 'categories' in have:                       # give older category lists the pricing fields
            cats = json.loads(c.execute("SELECT value FROM settings WHERE key='categories'").fetchone()[0])
            seeded = {x['id']: x for x in seed['categories']}
            changed = False
            for x in cats:
                for f in ('paid', 'freeSubs', 'subsEn'):
                    if f not in x and x['id'] in seeded:
                        x[f] = seeded[x['id']][f]
                        changed = True
            if changed:
                c.execute("UPDATE settings SET value=? WHERE key='categories'", (json.dumps(cats, ensure_ascii=False),))
        if fresh:
            now = int(time.time())
            for it in seed.get('listings', []):
                it = {k: v for k, v in it.items() if k != 'since'}
                c.execute('INSERT OR IGNORE INTO listings (id, doc, review, source, created_at, updated_at) VALUES (?,?,?,?,?,?)',
                          (it['id'], json.dumps(it, ensure_ascii=False), 'approved', 'seed', now, now))
            c.execute("INSERT OR REPLACE INTO settings VALUES ('_seedv', ?)", (str(SEED_VERSION),))
        else:
            upgrade_seed(c, seed)


SEED_VERSION = 6
UPAZILA_NAMES = ('ঝিকরগাছা', 'চৌগাছা', 'মনিরামপুর', 'কেশবপুর', 'অভয়নগর', 'বাঘারপাড়া', 'শার্শা', 'বেনাপোল', 'নওয়াপাড়া')
MOVED_KEYS = {4: {'place': ('মসজিদ', 'mosque', 'মন্দির', 'temple')}}   # search words that now belong to another category
NEW_SUBS = {3: {'hospital': ('doctor', 'homeo')}}     # sub-types added to existing categories, by seed version
NEW_COORDS = {7: ('m-busstand', 'm-khoyertola')}   # starter entries that got a map position later, by seed version
NO_COORDS_NOTE = 'ম্যাপে সঠিক অবস্থান এখনো যোগ হয়নি'
FILL_FIELDS = ('phone', 'phone2', 'address', 'about', 'aboutEn', 'note', 'nameEn', 'hours', 'tags')


def upgrade_seed(c, seed):
    """Bring an existing install's starter data up to date without touching anything the admin changed."""
    row = c.execute("SELECT value FROM settings WHERE key='_seedv'").fetchone()
    v = int(row[0]) if row else 1
    if v >= SEED_VERSION:
        return
    if v < 2:
        upgrade_v2(c, seed, v)
    cats = get_setting(c, 'categories') or []
    for ver, by_cat in NEW_SUBS.items():
        if v >= ver:
            continue
        for x in cats:
            sc = next((y for y in seed['categories'] if y['id'] == x['id']), None)
            for sub in by_cat.get(x['id'], ()):
                if sc and sub not in (x.get('subs') or {}):
                    x.setdefault('subs', {})[sub] = sc['subs'][sub]
                    x.setdefault('subsEn', {})[sub] = sc.get('subsEn', {}).get(sub, sub)
            if sc:
                x['keys'] = list(dict.fromkeys((x.get('keys') or []) + [k for k in sc.get('keys', []) if k not in (x.get('keys') or [])]))
    if v < 5:                                  # role-labelled numbers (e.g. OC of each police station) for starter entries
        for it in seed.get('listings', []):
            if not it.get('contacts'):
                continue
            r = c.execute('SELECT doc FROM listings WHERE id=?', (it['id'],)).fetchone()
            if r:
                doc = json.loads(r['doc'])
                if not doc.get('contacts'):
                    doc['contacts'] = it['contacts']
                    c.execute('UPDATE listings SET doc=? WHERE id=?', (json.dumps(doc, ensure_ascii=False), it['id']))
    areas = get_setting(c, 'areas') or []
    for ver, names in seed.get('_newAreas', {}).items():   # town localities added later go in before the upazilas
        add = [a for a in names if a not in areas] if v < int(ver) else []
        if add:
            at = next((i for i, a in enumerate(areas) if a in UPAZILA_NAMES), len(areas))
            areas[at:at] = add
            c.execute("UPDATE settings SET value=? WHERE key='areas'", (json.dumps(areas, ensure_ascii=False),))
    if v >= 2:                                 # new starter entries (e.g. mosques from OpenStreetMap): added once, never brought back
        add_new_listings(c, seed, v)
    for ver, ids in NEW_COORDS.items():
        if v < ver:
            fill_coords(c, seed, ids)
    for ver, by_cat in MOVED_KEYS.items():
        if v < ver:
            for x in cats:
                if x['id'] in by_cat and x.get('keys'):
                    x['keys'] = [k for k in x['keys'] if k not in by_cat[x['id']]]
    c.execute("UPDATE settings SET value=? WHERE key='categories'", (json.dumps(cats, ensure_ascii=False),))
    c.execute("INSERT OR REPLACE INTO settings VALUES ('_seedv', ?)", (str(SEED_VERSION),))


def add_new_listings(c, seed, v):
    """Insert starter entries newer than this install's seed. Older ones the admin deleted stay deleted."""
    now = int(time.time())
    for it in seed.get('listings', []):
        if it.get('since', 1) <= v:
            continue
        it = {k: x for k, x in it.items() if k != 'since'}
        c.execute('INSERT OR IGNORE INTO listings (id, doc, review, source, created_at, updated_at) VALUES (?,?,?,?,?,?)',
                  (it['id'], json.dumps(it, ensure_ascii=False), 'approved', 'seed', now, now))


def fill_coords(c, seed, ids):
    """Give a starter entry its map position, only if the admin has not set one."""
    by_id = {x['id']: x for x in seed.get('listings', [])}
    for lid in ids:
        it, r = by_id.get(lid), c.execute('SELECT doc FROM listings WHERE id=?', (lid,)).fetchone()
        if not it or it.get('lat') is None or not r:
            continue
        doc = json.loads(r['doc'])
        if doc.get('lat') is not None or doc.get('lng') is not None:
            continue
        doc['lat'], doc['lng'] = it['lat'], it['lng']
        if doc.get('note') == NO_COORDS_NOTE and it.get('note'):
            doc['note'] = it['note']
        c.execute('UPDATE listings SET doc=? WHERE id=?', (json.dumps(doc, ensure_ascii=False), lid))


def upgrade_v2(c, seed, v):
    """New starter entries are added once, empty fields are filled, and only our own early rough coordinates are replaced."""
    now, rough = int(time.time()), seed.get('_oldRough', {})
    have = {r['id']: r for r in c.execute('SELECT id, doc FROM listings')}
    for it in seed.get('listings', []):
        it = dict(it)
        since = it.pop('since', 1)
        if it['id'] not in have:
            if since > v:
                c.execute('INSERT OR IGNORE INTO listings (id, doc, review, source, created_at, updated_at) VALUES (?,?,?,?,?,?)',
                          (it['id'], json.dumps(it, ensure_ascii=False), 'approved', 'seed', now, now))
            continue
        doc = json.loads(have[it['id']]['doc'])
        new = dict(doc)
        for k in FILL_FIELDS:
            if not new.get(k) and it.get(k):
                new[k] = it[k]
        if it['id'] in rough and [doc.get('lat'), doc.get('lng')] == rough[it['id']]:
            for k in ('lat', 'lng'):
                if it.get(k) is None:
                    new.pop(k, None)
                else:
                    new[k] = it[k]
        if new != doc:
            c.execute('UPDATE listings SET doc=? WHERE id=?', (json.dumps(new, ensure_ascii=False), it['id']))
    areas = get_setting(c, 'areas') or []
    added = [a for a in seed.get('areas', []) if a not in areas]
    if added:
        c.execute("UPDATE settings SET value=? WHERE key='areas'", (json.dumps(areas + added, ensure_ascii=False),))
    geo = get_setting(c, 'areaGeo') or {}
    merged = {**seed.get('areaGeo', {}), **geo}
    c.execute("INSERT OR REPLACE INTO settings VALUES ('areaGeo', ?)", (json.dumps(merged, ensure_ascii=False),))
