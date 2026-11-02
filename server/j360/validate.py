"""Cleaning what users and admins send before it is stored."""
import re
from .config import CLASS_KINDS, STATUSES
from .maps import clean_map_url
from .media import clean_media
from .store import categories
from .util import BN_DIGITS, norm_phone, s, to_int, today


def clean_contacts(v):
    """Extra numbers with their role, e.g. a police station's OC, investigation officer and duty officer."""
    out = []
    for c in v if isinstance(v, list) else []:
        if not isinstance(c, dict):
            continue
        phone = s(re.sub(r'[^\d+]', '', str(c.get('phone') or '').translate(BN_DIGITS)), 20)
        if phone:
            out.append({k: x for k, x in (('role', s(c.get('role'), 60)), ('name', s(c.get('name'), 80)), ('phone', phone)) if x})
    return out[:12] or None


def clean_listing(d, admin):
    cats = categories()
    out = {
        'cat': s(d.get('cat'), 40), 'sub': s(d.get('sub'), 40), 'name': s(d.get('name'), 120),
        'nameEn': s(d.get('nameEn'), 120), 'area': s(d.get('area'), 60), 'address': s(d.get('address'), 200),
        'phone': s(re.sub(r'[^\d+]', '', str(d.get('phone') or '').translate(BN_DIGITS)), 20),
        'phone2': s(re.sub(r'[^\d+]', '', str(d.get('phone2') or '').translate(BN_DIGITS)), 20),
        'contacts': clean_contacts(d.get('contacts')),
        'web': s(d.get('web'), 300) if re.match(r'^https?://', str(d.get('web') or '')) else None,
        'facebook': s(d.get('facebook'), 300) if re.match(r'^https?://', str(d.get('facebook') or '')) else None,
        'hours': s(d.get('hours'), 20) if re.match(r'^(24h|\d\d:\d\d-\d\d:\d\d)$', str(d.get('hours') or '')) else None,
        'note': s(d.get('note'), 400), 'about': s(d.get('about'), 3000), 'aboutEn': s(d.get('aboutEn'), 3000), 'price': to_int(d.get('price')),
        'mapUrl': clean_map_url(d.get('mapUrl')),
    }
    if out['cat'] not in cats:
        raise ValueError('ক্যাটাগরি সঠিক নয়')
    if not out['name']:
        raise ValueError('নাম দিন')
    out['off'] = [int(x) for x in d.get('off') or [] if str(x).isdigit() and 0 <= int(x) <= 6][:7] or None
    for k in ('features', 'tags'):
        v = d.get(k) or []
        if isinstance(v, str):
            v = v.split(',')
        out[k] = [str(x).strip()[:40] for x in v if str(x).strip()][:20] or None
    for k in ('lat', 'lng'):
        try:
            out[k] = round(float(d[k]), 6) if d.get(k) not in (None, '') else None
        except (TypeError, ValueError):
            out[k] = None
    if admin:
        out.update(clean_media(d))
        out['status'] = d.get('status') if d.get('status') in STATUSES else 'pending'
        out['verifiedAt'] = s(d.get('verifiedAt'), 10)
        out['sponsoredUntil'] = s(d.get('sponsoredUntil'), 10) if re.match(r'^\d{4}-\d\d-\d\d$', str(d.get('sponsoredUntil') or '')) else None
        if out['status'] == 'verified' and not out['verifiedAt']:
            out['verifiedAt'] = today()
        for k in ('demo', 'sponsored', 'featured', 'pin', 'hidden', 'blueTick'):
            out[k] = bool(d.get(k)) or None
    else:
        out['status'] = 'pending'
    out['halal'] = bool(d.get('halal')) or None       # an owner's claim; the admin checks it before approving
    return {k: v for k, v in out.items() if v is not None}


CLASS_FIELDS = {
    '*': {'title': 120, 'description': 3000, 'area': 60, 'address': 200, 'contactName': 60},
    'job': {'company': 120, 'jobType': 30, 'deadline': 10, 'qualification': 400, 'howToApply': 500, 'experience': 60},
    'rent': {'propertyType': 30, 'availableFrom': 10, 'floor': 20, 'facilities': 400},
    'mess': {'seatType': 30, 'gender': 10, 'availableFrom': 10, 'facilities': 400},
    'tuition': {'tuitionType': 10, 'subject': 200, 'classLevel': 60, 'medium': 30, 'tutorGender': 10, 'qualification': 400},
}
CLASS_NUMS = {'*': ('price',), 'job': ('vacancies',), 'rent': ('rooms', 'baths', 'size'), 'mess': ('seats',), 'tuition': ('students', 'daysPerWeek')}


def clean_classified(kind, d):
    if kind not in CLASS_KINDS:
        raise ValueError('ধরন সঠিক নয়')
    out = {}
    for group in ('*', kind):
        for k, n in CLASS_FIELDS[group].items():
            out[k] = s(d.get(k), n)
        for k in CLASS_NUMS[group]:
            out[k] = to_int(d.get(k))
    out['phone'] = norm_phone(d.get('phone'))
    out['whatsapp'] = norm_phone(d.get('whatsapp'))
    out['mapUrl'] = clean_map_url(d.get('mapUrl'))
    for k in ('lat', 'lng'):
        try:
            out[k] = round(float(d[k]), 6) if d.get(k) not in (None, '') else None
        except (TypeError, ValueError):
            out[k] = None
    if not out['title']:
        raise ValueError('শিরোনাম দিন')
    if not out['phone']:
        raise ValueError('সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)')
    return {k: v for k, v in out.items() if v is not None}


USER_LISTING_FIELDS = ('name', 'nameEn', 'area', 'address', 'phone', 'phone2', 'contacts', 'hours', 'off', 'price', 'web', 'facebook', 'about', 'aboutEn',
                       'note', 'features', 'tags', 'halal', 'images', 'videos', 'lat', 'lng', 'mapUrl')
