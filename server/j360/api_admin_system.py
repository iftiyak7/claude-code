"""Admin system pages: settings, ads stats, image upload, app releases, data export."""
import hashlib
import json
import os
import re
import time
from . import config
from .cache import bump
from .config import DICT_SETTINGS, MAX_APK, MODERATOR_SETTINGS, SETTING_KEYS
from .geocode import start_lookup
from .media import save_image
from .records import classified_out, listing_out, review_row
from .store import db, get_setting
from .util import ApiError, s, to_int, today
from .web import route


@route('GET', r'/admin/settings/(\w+)', auth='admin')
def adm_get_setting(h, key):
    if key not in SETTING_KEYS:
        raise ApiError(404, 'পাওয়া যায়নি')
    with db() as c:
        h.json(get_setting(c, key))


@route('PUT', r'/admin/settings/(\w+)', auth='admin')
def adm_put_setting(h, key):
    if key not in SETTING_KEYS:
        raise ApiError(404, 'পাওয়া যায়নি')
    if key not in MODERATOR_SETTINGS and h.staff['role'] != 'owner':
        raise ApiError(403, 'শুধু মূল অ্যাডমিন এটি করতে পারেন')
    val = h.body()
    expected = dict if key in DICT_SETTINGS else list
    if not isinstance(val, expected):
        raise ApiError(400, 'ফরম্যাট সঠিক নয়')
    if key == 'categories':
        ids = [c_.get('id') for c_ in val]
        if any(not re.match(r'^[a-z0-9-]{2,30}$', str(i)) for i in ids) or len(set(ids)) != len(ids):
            raise ApiError(400, 'ক্যাটাগরি আইডি সঠিক নয় বা একই আইডি দুবার আছে')
        with db() as c:
            used = {r[0] for r in c.execute("SELECT DISTINCT json_extract(doc,'$.cat') FROM listings")}
        missing = used - set(ids)
        if missing:
            raise ApiError(400, 'এই ক্যাটাগরিতে তথ্য আছে, আগে সেগুলো সরান: ' + ', '.join(sorted(missing)))
    if key == 'plans':
        for p in val:
            if not re.match(r'^[a-z0-9-]{2,30}$', str(p.get('id'))) or to_int(p.get('price')) is None:
                raise ApiError(400, 'প্যাকেজের আইডি ও দাম সঠিকভাবে দিন')
            p['price'], p['days'] = to_int(p['price']), to_int(p.get('days')) or 365
    with db() as c:
        if key == 'terms':                         # a new version makes everyone accept again
            old = get_setting(c, 'terms') or {}
            val = {'bn': s(val.get('bn'), 30000) or '', 'en': s(val.get('en'), 30000) or '', 'updated': today(),
                   'version': (old.get('version') or 0) + (1 if (val.get('bn'), val.get('en')) != (old.get('bn'), old.get('en')) else 0)}
        if key == 'privacy':
            val = {'bn': s(val.get('bn'), 30000) or '', 'en': s(val.get('en'), 30000) or '', 'updated': today()}
        if key == 'popup':                         # changed content counts as a new popup, so "show once" shows it again
            old = get_setting(c, 'popup') or {}
            body = {k: v for k, v in val.items() if k != 'rev'}
            val = dict(body, rev=(old.get('rev') or 0) + (1 if body != {k: v for k, v in old.items() if k != 'rev'} else 0))
        c.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (key, json.dumps(val, ensure_ascii=False)))
    bump()
    h.audit('settings.' + key)
    h.json({'ok': True})


@route('GET', '/admin/adstats', auth='owner')
def adm_adstats(h):
    with db() as c:
        h.json({r['id']: {'imps': r['imps'], 'clicks': r['clicks']} for r in c.execute('SELECT * FROM adstats')})


@route('POST', '/admin/upload', auth='admin')
def adm_upload(h):
    h.json({'url': save_image(h.body().get('data'), 6 * 1024 * 1024)})


def store_apk(raw, version_name, version_code, notes, c):
    if not raw.startswith(b'PK'):
        raise ApiError(400, 'এটি সঠিক APK ফাইল নয়')
    name = 'jashore360-%d.apk' % version_code
    with open(os.path.join(config.DOWNLOADS, name), 'wb') as f:
        f.write(raw)
    old = get_setting(c, 'app') or {}
    app = {'versionName': version_name, 'versionCode': version_code, 'notes': notes, 'file': name,
           'size': len(raw), 'updated': today(), 'sha256': hashlib.sha256(raw).hexdigest()}
    c.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('app', json.dumps(app, ensure_ascii=False)))
    if old.get('file') and old['file'] != name:          # keep only the current and the previous build
        for fn in os.listdir(config.DOWNLOADS):
            if fn.endswith('.apk') and fn not in (name, old['file']):
                os.remove(os.path.join(config.DOWNLOADS, fn))
    return app


@route('POST', '/admin/apk', auth='owner')
def adm_apk(h):
    n = int(h.headers.get('Content-Length') or 0)
    if not 0 < n <= MAX_APK:
        raise ApiError(413, 'ফাইল সর্বোচ্চ ৮০ MB')
    vname = s(h.query.get('versionName'), 20)
    vcode = to_int(h.query.get('versionCode'))
    if not vname or not vcode:
        raise ApiError(400, 'ভার্সন নাম ও কোড দিন')
    raw = h.rfile.read(n)
    h._consumed = True
    with db() as c:
        app = store_apk(raw, vname, vcode, s(h.query.get('notes'), 500), c)
    bump()
    h.audit('app.release', vname)
    h.json(app)


@route('GET', '/admin/export', auth='owner')
def adm_export(h):
    with db() as c:
        out = {k: get_setting(c, k) for k in SETTING_KEYS}
        out['listings'] = [listing_out(r) for r in c.execute('SELECT * FROM listings')]
        out['reviews'] = [review_row(r, True) for r in c.execute('SELECT * FROM reviews')]
        out['reports'] = [dict(r) for r in c.execute('SELECT * FROM reports')]
        out['classifieds'] = [classified_out(r, True) for r in c.execute('SELECT * FROM classifieds')]
        out['payments'] = [dict(r) for r in c.execute('SELECT * FROM payments')]
        out['users'] = [dict(r) for r in c.execute('SELECT id, name, phone, banned, created_at FROM users')]
        out['exportedAt'] = time.strftime('%Y-%m-%d %H:%M')
    raw = json.dumps(out, ensure_ascii=False, indent=1).encode()
    h.send(200, raw, headers={'Content-Disposition': 'attachment; filename="jashore360-backup-%s.json"' % time.strftime('%Y%m%d'),
                              'Cache-Control': 'no-store'})


@route('POST', '/admin/areas/lookup', auth='owner')
def adm_area_lookup(h):
    """Look up the map points of all areas that have none, on OpenStreetMap (runs in the background, about a second per area)."""
    started = start_lookup()
    h.audit('settings.areaGeo', 'lookup')
    h.json({'started': started})

