"""Map points for the areas people choose in the app, looked up on OpenStreetMap by the server itself.

Distances for a chosen area start from that area's point. Areas without one are looked up in the background
(Nominatim, at most one request a second, as its usage policy asks), only inside Jashore, and saved like a point the
admin set; the admin can check or change each one (Admin → General settings). An area that is not found is tried
again after a week. Points the admin set are never replaced.
"""
import json
import os
import re
import time
import urllib.parse
import urllib.request
from . import config
from .cache import bump, home_domain
from .config import PUBLIC
from .store import db, get_setting

SEARCH_URL = os.environ.get('J360_GEOCODE_URL', 'https://nominatim.openstreetmap.org/search')
TOWN = (23.12, 89.15, 23.22, 89.27)            # Jashore town (south, west, north, east)
DISTRICT = (22.75, 88.85, 23.50, 89.60)        # the whole district, for upazilas
UPAZILAS = ('যশোর সদর', 'ঝিকরগাছা', 'চৌগাছা', 'মনিরামপুর', 'কেশবপুর', 'অভয়নগর', 'বাঘারপাড়া', 'শার্শা', 'বেনাপোল', 'নওয়াপাড়া')
RETRY_AFTER = 7 * 86400
GAP = float(os.environ.get('J360_GEOCODE_GAP', 1.1))     # seconds between requests (Nominatim allows one a second)


def english_names():
    """The English area names the app already uses (public/i18n.js, AREA_EN)."""
    try:
        text = open(os.path.join(PUBLIC, 'i18n.js'), encoding='utf-8').read()
        block = text[text.index('window.AREA_EN'):text.index('};', text.index('window.AREA_EN'))]
        return dict(re.findall(r"'([^']+)':\s*'([^']+)'", block))
    except (OSError, ValueError):
        return {}


def queries(area, en):
    """Names to try, most specific first: "Chitra More" is often mapped as "Chitra Mor" or "Chitra Moor"."""
    out = []
    if en:
        out.append(en)
        if en.endswith(' More'):
            out += [en[:-5] + ' Mor', en[:-5] + ' Moor', en[:-5]]
    out.append(area)
    return out


def lookup(name, box):
    south, west, north, east = box
    q = urllib.parse.urlencode({'q': name + (', Jashore, Bangladesh' if not re.search('[ঀ-৿]', name) else ', যশোর'),
                                'format': 'jsonv2', 'limit': 1, 'countrycodes': 'bd', 'bounded': 1,
                                'viewbox': f'{west},{north},{east},{south}'})
    req = urllib.request.Request(SEARCH_URL + '?' + q, headers={
        'User-Agent': 'Jashore360/1.0 (area map points; https://%s)' % (home_domain() or 'jashore360.com'), 'Accept-Language': 'bn,en'})
    with urllib.request.urlopen(req, timeout=15) as r:
        found = json.loads(r.read(200000))
    if found:
        lat, lng = round(float(found[0]['lat']), 6), round(float(found[0]['lon']), 6)
        if south <= lat <= north and west <= lng <= east:
            return [lat, lng]
    return None


def fill_missing(sleep=time.sleep, retry=False):
    """Look up every area that has no point yet (and, unless retry, was not tried in the last week). Returns how many were found."""
    with db() as c:
        areas = get_setting(c, 'areas') or []
        geo = get_setting(c, 'areaGeo') or {}
        tried = get_setting(c, '_geocodeTried') or {}
    en, now, found = english_names(), int(time.time()), 0
    for area in areas:
        if area in geo or (not retry and now - tried.get(area, 0) < RETRY_AFTER):
            continue
        point = None
        for name in queries(area, en.get(area)):
            try:
                point = lookup(name, DISTRICT if area in UPAZILAS else TOWN)
            except Exception:
                point = None
            sleep(GAP)
            if point:
                break
        with db() as c:                       # re-read: the admin may have set points meanwhile
            geo = get_setting(c, 'areaGeo') or {}
            tried = get_setting(c, '_geocodeTried') or {}
            tried[area] = now
            if point and area not in geo:
                geo[area] = point
                found += 1
                c.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('areaGeo', json.dumps(geo, ensure_ascii=False)))
            c.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('_geocodeTried', json.dumps(tried, ensure_ascii=False)))
        if point:
            bump()
    return found


def geocode_loop():
    time.sleep(20)
    while True:
        try:
            if config.DATA:
                fill_missing()
        except Exception as e:                  # no internet etc.: try again later
            print('area lookup failed:', e, flush=True)
        time.sleep(6 * 3600)


_running = []


def start_lookup():
    """Admin's "look up now": one background run at a time."""
    import threading
    if _running and _running[0].is_alive():
        return False
    t = threading.Thread(target=fill_missing, kwargs={'retry': True}, daemon=True)
    _running[:] = [t]
    t.start()
    return True
