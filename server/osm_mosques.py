#!/usr/bin/env python3
"""Add the mosques of Jashore Sadar Pourashava from OpenStreetMap to seed.json.

    python3 server/osm_mosques.py            # fetch from Overpass and update seed.json
    python3 server/osm_mosques.py --dry-run  # only print what would change
    python3 server/osm_mosques.py --file osm.json   # use a saved Overpass JSON response

Unnamed mosques are skipped. A mosque already in the seed (same name, or within 50 m of one)
is not added again; the two starter mosques without a position get one if OSM has them.
New entries carry "since": SINCE so upgrade_seed adds them to running sites exactly once.
Data © OpenStreetMap contributors, ODbL.
"""
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request

SINCE = 6
OVERPASS = 'https://overpass-api.de/api/interpreter'
BBOX = (23.135, 89.175, 23.200, 89.245)   # south, west, north, east
SEED = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'seed.json')
NOTE = 'অবস্থান: OpenStreetMap'
NEAR_M = 50

QUERY = """[out:json][timeout:90];
is_in(23.167,89.209)->.here;
area.here[boundary=administrative][~"^name"~"(Jashore|Jessore|যশোর).*(Pourashava|Paurashava|Pourasava|Municipality|পৌরসভা)",i]->.town;
nwr(area.town)[amenity=place_of_worship][religion=muslim];
out center tags;
.town out tags;
nwr[amenity=place_of_worship][religion=muslim](%s,%s,%s,%s);
out center tags;
""" % BBOX

# English spellings of the seed's area names, for entries tagged only in English
AREA_EN = {
    'দড়াটানা': ('doratana', 'daratana'), 'চিত্রামোড়': ('chitra mor', 'chitramor', 'chitra more'),
    'পালবাড়ি': ('palbari',), 'ঘোপ': ('ghop',), 'রেলরোড': ('rail road', 'railroad', 'rail station', 'railway'),
    'নিউমার্কেট': ('new market', 'newmarket'), 'বেজপাড়া': ('bejpara', 'bezpara'),
    'শংকরপুর': ('shankarpur', 'sankarpur'), 'খড়কি': ('kharki', 'khorki'), 'চাঁচড়া': ('chanchra', 'chachra'),
    'উপশহর': ('upashahar', 'upshahar', 'upasahar'), 'কাশিমপুর': ('kashimpur', 'kasimpur'),
    'আরবপুর': ('arabpur',), 'কারবালা': ('karbala',), 'জেল রোড': ('jail road',), 'মুড়লী': ('murali', 'murli'),
}
OLD_UNPLACED = {   # starter mosques with no position yet, and how OSM may spell them
    'm-busstand': ('বাসস্ট্যান্ড', 'bus stand', 'bus-stand', 'busstand'),
    'm-khoyertola': ('খয়েরতলা', 'খয়েরতলা', 'khoyertola', 'khoyer tola', 'khayertala', 'khairtala', 'khoyertala'),
}
BN = re.compile('[ঀ-৿]')


def fetch():
    body = urllib.parse.urlencode({'data': QUERY}).encode()
    req = urllib.request.Request(OVERPASS, body, {'User-Agent': 'Jashore360 seed importer'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def dist_m(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def norm(name):
    n = (name or '').lower().replace('য়', 'য়').replace('ড়', 'ড়').replace('ঢ়', 'ঢ়')
    for w in ('jame', 'jama', 'jamia', 'masjid', 'mosque', 'moshjid', 'জামে', 'জামিয়া', 'মসজিদ', 'মসজিদ'):
        n = n.replace(w, ' ')
    return re.sub(r'[\W_]+', '', n)


def pos(e):
    if 'lat' in e:
        return e['lat'], e['lon']
    c = e.get('center')
    return (c['lat'], c['lon']) if c else None


def names(t):
    bn = t.get('name:bn') or (t.get('name') if BN.search(t.get('name', '')) else None)
    en = t.get('name:en') or (t.get('name') if t.get('name') and not BN.search(t['name']) else None)
    return bn or en, en


def address(t):
    parts = [t.get(k) for k in ('addr:housenumber', 'addr:street', 'addr:place', 'addr:suburb', 'addr:city') if t.get(k)]
    return ', '.join(dict.fromkeys(parts)) or t.get('addr:full')


def area_of(text, areas):
    low = text.lower()
    for a in areas:
        if a in text or any(w in low for w in AREA_EN.get(a, ())):
            return a
    return 'যশোর সদর'


def main(argv):
    dry = '--dry-run' in argv
    data = json.load(open(argv[argv.index('--file') + 1])) if '--file' in argv else fetch()
    els = data.get('elements', [])
    # output order: mosques inside the Pourashava boundary, the boundary itself, then the bbox
    cut = next((i for i, e in enumerate(els) if e['type'] == 'area'), None)
    if cut is not None:
        pool = els[:cut]
        print('Boundary:', els[cut]['tags'].get('name'), '-', len(pool), 'inside', file=sys.stderr)
    else:
        pool = els
        print('No Pourashava boundary in OSM; using the bounding box', file=sys.stderr)

    seed = json.load(open(SEED, encoding='utf-8'))
    listings = seed['listings']
    areas = [a for a in seed['areas'] if a in AREA_EN]
    mosques = [x for x in listings if x.get('sub') == 'mosque']
    known_names = {norm(x.get(k)) for x in mosques for k in ('name', 'nameEn') if x.get(k)}
    known_pos = [(x['lat'], x['lng']) for x in mosques if x.get('lat') is not None]
    have_ids = {x['id'] for x in listings}

    placed, added, skipped = [], [], {'unnamed': 0, 'duplicate': 0}
    for e in sorted(pool, key=lambda e: (e['type'], e['id'])):
        t, p = e.get('tags', {}), pos(e)
        name, en = names(t)
        if not name or not p:
            skipped['unnamed'] += 1
            continue
        hay = ' '.join(filter(None, (name, en, t.get('name'), address(t)))).lower()
        old = next((i for i, w in OLD_UNPLACED.items() if any(x in hay for x in w)), None)
        if old:
            it = next(x for x in listings if x['id'] == old)
            if it.get('lat') is None:
                it['lat'], it['lng'] = round(p[0], 6), round(p[1], 6)
                it['note'] = NOTE
                placed.append(old)
            known_pos.append(p)
            continue
        if norm(name) in known_names or (en and norm(en) in known_names) or any(dist_m(p, q) < NEAR_M for q in known_pos):
            skipped['duplicate'] += 1
            continue
        lid = 'm-osm-%s%d' % (e['type'][0], e['id'])
        if lid in have_ids:
            continue
        it = {'id': lid, 'cat': 'religious', 'sub': 'mosque', 'name': name}
        if en and en != name:
            it['nameEn'] = en
        it['area'] = area_of(' '.join(filter(None, (name, en, address(t)))), areas)
        it['address'] = address(t) or ('%s, যশোর' % it['area'] if it['area'] != 'যশোর সদর' else 'যশোর')
        it.update({'lat': round(p[0], 6), 'lng': round(p[1], 6), 'note': NOTE, 'status': 'pending', 'since': SINCE})
        added.append(it)
        known_names.update(norm(x) for x in (name, en) if x)
        known_pos.append(p)

    at = max(i for i, x in enumerate(listings) if x.get('sub') == 'mosque') + 1
    listings[at:at] = added
    for x in added:
        print(x['id'], x['name'], x.get('nameEn', ''), x['area'], sep=' | ')
    print('added %d, placed %s, skipped %s' % (len(added), placed or 'none', skipped), file=sys.stderr)
    if not dry:
        with open(SEED, 'w', encoding='utf-8') as f:
            json.dump(seed, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(sys.argv[1:])
