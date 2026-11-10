"""What search engines and link previews see: robots.txt, sitemap.xml, and a real page per listing and per category.

The app itself runs on /app/#/… (hash links that search engines ignore). Each published listing therefore also has
/p/<id> and each category /c/<id>: the same app page, with the listing's title, description, share preview
(Open Graph / Twitter) and schema.org data in the HTML, and its main facts as plain text. People who open such a
link get the app, which jumps to the listing.
"""
import gzip
import html
import json
import os
import re
import time
from .cache import home_domain
from .config import PUBLIC
from .store import db, get_setting, resolve_lid
from .util import today
from .web import page

ESC = html.escape


def send_text(h, text, ctype, headers):
    raw = text.encode()
    h.send(200, raw, ctype, headers, gzip.compress(raw, 6))


def base_url(h):
    host = home_domain() or (h.headers.get('Host') or 'localhost')
    return ('https' if home_domain() or h.https() else 'http') + '://' + host


def public_listings(c, lid=None):
    """Published, not hidden, not lapsed — the same rule as the app's data."""
    t = today()
    q = "SELECT id, doc, updated_at, paid_until FROM listings WHERE review='approved'" + (' AND id=?' if lid else '')
    for r in c.execute(q, (lid,) if lid else ()):
        d = json.loads(r['doc'])
        if d.get('hidden') or (r['paid_until'] and r['paid_until'] < t):
            continue
        yield r['id'], d, r['updated_at']


def app_page(h, title, desc, path, image=None, body='', extra_head='', cache='public, max-age=300'):
    """app.html with this page's title, description, share preview and readable content."""
    base = base_url(h)
    url = base + path
    img = image if image and image.startswith('http') else base + (image or '/shots/home.webp')
    head = f'''<title>{ESC(title)}</title>
  <meta name="description" content="{ESC(desc)}">
  <link rel="canonical" href="{ESC(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Jashore360">
  <meta property="og:title" content="{ESC(title)}">
  <meta property="og:description" content="{ESC(desc)}">
  <meta property="og:url" content="{ESC(url)}">
  <meta property="og:image" content="{ESC(img)}">
  <meta property="og:locale" content="bn_BD">
  <meta name="twitter:card" content="summary_large_image">{extra_head}'''
    tpl = open(os.path.join(PUBLIC, 'app.html'), encoding='utf-8').read()
    tpl = re.sub(r'<title>.*?</title>\s*<meta name="description"[^>]*>', lambda m: head, tpl, count=1, flags=re.S)
    tpl = tpl.replace('<main id="app"><div class="boot"><div class="spinner"></div></div></main>',
                      f'<main id="app">{body}<div class="boot"><div class="spinner"></div></div></main>', 1)
    send_text(h, tpl, 'text/html; charset=utf-8', {'Cache-Control': cache})


def category_name(c, cat_id):
    for x in get_setting(c, 'categories') or []:
        if x.get('id') == cat_id:
            return x
    return None


DAYS = ('Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa')      # the app stores days off as 0 = Sunday … 6 = Saturday


def opening_hours(d):
    """schema.org openingHours, e.g. "Sa,Su,Mo,Tu,We,Th 09:00-21:00" (Friday off), or "Mo-Su 00:00-23:59" for 24 hours."""
    hours, off = d.get('hours'), set(d.get('off') or [])
    if hours == '24h':
        return 'Mo-Su 00:00-23:59'
    m = re.match(r'^(\d\d:\d\d)-(\d\d:\d\d)$', hours or '')
    if not m:
        return None
    open_days = [DAYS[i] for i in (6, 0, 1, 2, 3, 4, 5) if i not in off]       # the week as Bangladesh counts it, from Saturday
    if not open_days:
        return None
    return (','.join(open_days) if off else 'Mo-Su') + f' {m.group(1)}-{m.group(2)}'


@page(r'/app/?')
def app_home(h):
    """The app's own address, with the same share preview as the landing page."""
    app_page(h, 'Jashore360 — যশোরের সবকিছু, এক অ্যাপে',
             'যশোরের জরুরি সেবা, হাসপাতাল, রেস্টুরেন্ট, দোকান, সার্ভিস ও দর্শনীয় স্থানের যাচাইকৃত তথ্য এক জায়গায়।', '/app/',
             cache='no-cache')          # like before: a new app version is picked up at once


@page(r'/p/([\w-]+)/?')
def listing_page(h, lid):
    with db() as c:
        real = resolve_lid(c, lid)
        if real != lid:
            return h.redirect('/p/' + real)
        found = next(public_listings(c, lid), None)
        cat = found and category_name(c, found[1].get('cat'))
    if not found:
        return h.redirect('/app/')
    _, d, _ = found
    sub = (cat or {}).get('subs', {}).get(d.get('sub')) or (cat or {}).get('bn') or ''
    place = ', '.join(x for x in (d.get('address'), d.get('area')) if x)
    if not re.search('যশোর|jashore|jessore', place, re.I):
        place = (place + ', যশোর') if place else 'যশোর'
    title = f"{d['name']} — {sub}, {d.get('area') or 'যশোর'} | Jashore360"
    desc = (d.get('about') or '').strip() or f"{d['name']}: {sub}, {place}।" + (f" ফোন {d['phone']}।" if d.get('phone') else '')
    desc = desc[:157] + '…' if len(desc) > 160 else desc
    ld = {'@context': 'https://schema.org', '@type': 'Hospital' if d.get('cat') == 'hospital' and d.get('sub') in ('govt', 'private') else
          'Restaurant' if d.get('cat') == 'restaurant' else 'LocalBusiness',
          'name': d['name'], 'url': base_url(h) + '/p/' + lid, 'address': {'@type': 'PostalAddress', 'streetAddress': d.get('address') or '',
          'addressLocality': d.get('area') or 'Jashore', 'addressRegion': 'Jashore', 'addressCountry': 'BD'}}
    if d.get('phone'):
        ld['telephone'] = d['phone']
    if d.get('lat') is not None:
        ld['geo'] = {'@type': 'GeoCoordinates', 'latitude': d['lat'], 'longitude': d['lng']}
    hours = opening_hours(d)
    if hours:
        ld['openingHours'] = hours
    if d.get('images'):
        ld['image'] = [base_url(h) + u for u in d['images'][:3]]
    # a <script> data block is not run, so the page's script rules (CSP) do not stop it; with every "<" written as \u003c
    # (still the same JSON) nothing in a name can end or confuse the block
    extra = '\n  <script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e') + '</script>'
    facts = [('ধরন', sub), ('ঠিকানা', place), ('ফোন', d.get('phone')), ('সময়', '২৪ ঘণ্টা খোলা' if d.get('hours') == '24h' else d.get('hours'))]
    body = (f'<article class="seo"><h1>{ESC(d["name"])}</h1>' + ''.join(f'<p><b>{ESC(k)}:</b> {ESC(str(v))}</p>' for k, v in facts if v)
            + (f'<p>{ESC(d["about"])}</p>' if d.get('about') else '') + '</article>')
    app_page(h, title, desc, '/p/' + lid, (d.get('images') or [None])[0], body, extra)


@page(r'/c/([\w-]+)/?')
def category_page(h, cat_id):
    with db() as c:
        cat = category_name(c, cat_id)
        rows = [(i, d) for i, d, _ in public_listings(c) if d.get('cat') == cat_id] if cat else []
    if not cat:
        return h.redirect('/app/')
    title = f"{cat.get('bn', cat_id)} — যশোর | Jashore360"
    desc = f"যশোরের {cat.get('bn', '')}: {len(rows)}টি প্রতিষ্ঠানের ঠিকানা, ফোন নম্বর, সময় ও ম্যাপ।"
    body = (f'<article class="seo"><h1>{ESC(cat.get("bn", ""))} — যশোর</h1><ul>'
            + ''.join(f'<li><a href="/p/{ESC(i)}">{ESC(d["name"])}</a>{" — " + ESC(d["area"]) if d.get("area") else ""}</li>' for i, d in rows[:300])
            + '</ul></article>')
    app_page(h, title, desc, '/c/' + cat_id, None, body)


BN_DIGITS = str.maketrans('0123456789', '০১২৩৪৫৬৭৮৯')
BN_MONTHS = ('জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর')
EN_MONTHS = ('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December')


def bn(n):
    return str(n).translate(BN_DIGITS)


def long_date(iso, en=False):
    m = re.match(r'^(\d{4})-(\d\d)-(\d\d)', iso or '')
    if not m:
        return ''
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return f'{d} {EN_MONTHS[mo - 1]} {y}' if en else bn(f'{d} {BN_MONTHS[mo - 1]} {y}')


def fill(template, values):
    """Put values into a page template's {{name}} places. Values are HTML; escape text before passing it."""
    return re.sub(r'\{\{(\w+)\}\}', lambda m: str(values.get(m.group(1), '')), template)


def contact_html(site):
    """Phone, e-mail and Facebook from Admin → General settings, as links."""
    parts = []
    if site.get('contactPhone'):
        parts.append(f'<a href="tel:{ESC(site["contactPhone"])}">{ESC(site["contactPhone"])}</a>')
    if site.get('contactEmail'):
        parts.append(f'<a href="mailto:{ESC(site["contactEmail"])}">{ESC(site["contactEmail"])}</a>')
    if re.match(r'^https?://', site.get('facebook') or ''):
        parts.append(f'<a href="{ESC(site["facebook"])}" rel="noopener">Facebook</a>')
    return ' · '.join(parts)


@page(r'/')
def landing(h):
    """The landing page. Live numbers, the app download details and contact links are put in here on the server,
    so the page needs no data request of its own and search engines see the finished text."""
    with db() as c:
        listings = sum(1 for _ in public_listings(c))
        areas = len(get_setting(c, 'areas') or [])
        app = get_setting(c, 'app') or {}
        site = get_setting(c, 'site') or {}
    if app.get('file'):
        size = app.get('size') or 0
        size = f'{max(1, round(size / 1024))} KB' if size < 1048576 else f'{size / 1048576:.1f} MB'
        apk = f'v{ESC(str(app.get("versionName", "")))} · {size}'
    else:
        apk = ''
    text = fill(open(os.path.join(PUBLIC, 'index.html'), encoding='utf-8').read(), {
        'base': base_url(h), 'listings': bn(listings), 'areas': bn(areas), 'apk': apk, 'noapk': '' if apk else ' data-noapk',
        'contact': contact_html(site), 'year': bn(time.strftime('%Y'))})
    send_text(h, text, 'text/html; charset=utf-8', {'Cache-Control': 'no-cache'})


LEGAL = {'terms': ('শর্তাবলি', 'Terms & Conditions', 'Jashore360 ব্যবহারের শর্তাবলি: অ্যাকাউন্ট, বিজ্ঞাপন, রিভিউ, দায় ও নিয়ম।'),
         'privacy': ('গোপনীয়তা নীতি', 'Privacy Policy', 'Jashore360 আপনার কোন তথ্য নেয়, কীভাবে ব্যবহার করে ও সুরক্ষিত রাখে।')}


def legal_html(text):
    """Plain text from the admin → HTML: blank line = new paragraph, "## " = heading, a short "Label:" at the start is bold."""
    out = []
    for block in re.split(r'\n\s*\n', (text or '').strip()):
        block = block.strip()
        if not block:
            continue
        if block.startswith('## '):
            out.append(f'<h2>{ESC(block[3:].strip())}</h2>')
        else:
            para = ESC(block).replace('\n', '<br>')
            para = re.sub(r'^([^:।.<]{2,30}):\s', lambda m: f'<b>{m.group(1)}:</b> ', para)
            out.append(f'<p>{para}</p>')
    return '\n'.join(out)


@page(r'/(terms|privacy)/?')
def legal_page(h, which):
    en = h.query.get('lang') == 'en'
    with db() as c:
        doc = get_setting(c, which) or {}
        site = get_setting(c, 'site') or {}
    bn_title, en_title, desc = LEGAL[which]
    title = en_title if en else bn_title
    body = legal_html((en and doc.get('en')) or doc.get('bn')) or f'<p>{"Not added yet." if en else "এখনো যোগ করা হয়নি।"}</p>'
    contact = contact_html(site)
    if contact:
        body += f'<h2>{"Contact" if en else "যোগাযোগ"}</h2><p>{contact}</p>'
    updated = long_date(doc.get('updated'), en)
    text = fill(open(os.path.join(PUBLIC, 'legal.html'), encoding='utf-8').read(), {
        'lang': 'en' if en else 'bn', 'title': ESC(title), 'desc': ESC(desc), 'base': base_url(h), 'path': '/' + which,
        'updated': (('Last updated: ' if en else 'সর্বশেষ আপডেট: ') + updated) if updated else '', 'body': body,
        'switch': f'<a class="chip" href="/{which}{"" if en else "?lang=en"}">{"বাংলা" if en else "English"}</a>',
        'home': 'Home' if en else 'হোম', 'open': 'Open the app' if en else 'অ্যাপ খুলুন',
        'terms': 'Terms' if en else 'শর্তাবলি', 'privacy': 'Privacy' if en else 'গোপনীয়তা নীতি', 'q': '?lang=en' if en else '',
        'terms_on': ' aria-current="page"' if which == 'terms' else '', 'privacy_on': ' aria-current="page"' if which == 'privacy' else '',
        'year': time.strftime('%Y') if en else bn(time.strftime('%Y'))})
    send_text(h, text, 'text/html; charset=utf-8', {'Cache-Control': 'no-cache'})


@page(r'/robots\.txt')
def robots(h):
    text = f'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: {base_url(h)}/sitemap.xml\n'
    send_text(h, text, 'text/plain; charset=utf-8', {'Cache-Control': 'public, max-age=3600'})


@page(r'/sitemap\.xml')
def sitemap(h):
    base = base_url(h)
    with db() as c:
        cats = [x['id'] for x in get_setting(c, 'categories') or [] if x.get('active', True)]
        rows = list(public_listings(c))
    day = lambda t: time.strftime('%Y-%m-%d', time.gmtime(t or time.time()))
    urls = [(base + '/', None), (base + '/app/', None), (base + '/terms', None), (base + '/privacy', None)] + [(f'{base}/c/{x}', None) for x in cats] + [(f'{base}/p/{i}', day(u)) for i, _, u in rows]
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           + ''.join(f'  <url><loc>{ESC(u)}</loc>{f"<lastmod>{m}</lastmod>" if m else ""}</url>\n' for u, m in urls) + '</urlset>\n')
    send_text(h, xml, 'application/xml; charset=utf-8', {'Cache-Control': 'public, max-age=3600'})
