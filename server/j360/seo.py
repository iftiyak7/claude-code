"""What search engines and link previews see: robots.txt, sitemap.xml, and a real page per listing and per category.

The app itself runs on /app/#/… (hash links that search engines ignore). Each published listing therefore also has
/p/<id> and each category /c/<id>: the same app page, with the listing's title, description, share preview
(Open Graph / Twitter) and schema.org data in the HTML, and its main facts as plain text. People who open such a
link get the app, which jumps to the listing.
"""
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


def app_page(h, title, desc, path, image=None, body='', extra_head=''):
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
    h.send(200, tpl.encode(), 'text/html; charset=utf-8', {'Cache-Control': 'public, max-age=300'})


def category_name(c, cat_id):
    for x in get_setting(c, 'categories') or []:
        if x.get('id') == cat_id:
            return x
    return None


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


@page(r'/')
def landing(h):
    """The landing page, with its share picture and address made absolute (previews need full URLs)."""
    base = base_url(h)
    text = open(os.path.join(PUBLIC, 'index.html'), encoding='utf-8').read().replace('content="/shots/', f'content="{base}/shots/')
    if 'og:url' not in text:
        text = text.replace('<meta property="og:title"', f'<link rel="canonical" href="{base}/">\n  <meta property="og:url" content="{base}/">\n  <meta property="og:title"', 1)
    h.send(200, text.encode(), 'text/html; charset=utf-8', {'Cache-Control': 'no-cache'})


@page(r'/robots\.txt')
def robots(h):
    text = f'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: {base_url(h)}/sitemap.xml\n'
    h.send(200, text.encode(), 'text/plain; charset=utf-8', {'Cache-Control': 'public, max-age=3600'})


@page(r'/sitemap\.xml')
def sitemap(h):
    base = base_url(h)
    with db() as c:
        cats = [x['id'] for x in get_setting(c, 'categories') or [] if x.get('active', True) and x.get('id') != 'emergency']
        rows = list(public_listings(c))
    day = lambda t: time.strftime('%Y-%m-%d', time.gmtime(t or time.time()))
    urls = [(base + '/', None), (base + '/app/', None)] + [(f'{base}/c/{x}', None) for x in cats] + [(f'{base}/p/{i}', day(u)) for i, _, u in rows]
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           + ''.join(f'  <url><loc>{ESC(u)}</loc>{f"<lastmod>{m}</lastmod>" if m else ""}</url>\n' for u, m in urls) + '</urlset>\n')
    h.send(200, xml.encode(), 'application/xml; charset=utf-8', {'Cache-Control': 'public, max-age=3600'})
