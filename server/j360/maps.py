"""Google Maps links: reading coordinates, following short links (Google hosts only)."""
import http.client
import re
from urllib.parse import unquote, urljoin, urlparse
from .util import s


MAP_HOSTS = ('google.com', 'goo.gl', 'g.co', 'google.com.bd')


def map_host_ok(url):
    u = urlparse(url)
    host = (u.hostname or '').lower()
    return u.scheme in ('http', 'https') and any(host == h or host.endswith('.' + h) for h in MAP_HOSTS)


def coords_from_text(text):
    """Pull a lat/lng pair out of a Google Maps link (or plain "23.16, 89.21") and check it is in or near Bangladesh."""
    t = unquote(unquote(str(text or '')))
    for rx in (r'!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)', r'@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)',
               r'[?&](?:q|query|ll|destination|center|daddr|sll)=(?:loc:)?(-?\d{1,2}\.\d+)[, +]+(-?\d{1,3}\.\d+)',
               r'^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$'):
        m = re.search(rx, t)
        if m:
            lat, lng = float(m.group(1)), float(m.group(2))
            if 20 <= lat <= 27.5 and 87.5 <= lng <= 93:
                return round(lat, 6), round(lng, 6)
    return None


def resolve_map_link(url, hops=5):
    """Follow a short Google Maps link (maps.app.goo.gl/…) to the full URL that carries the coordinates.
    Only Google hosts are contacted, at every hop."""
    for _ in range(hops):
        found = coords_from_text(url)
        if found or not map_host_ok(url):
            return found
        u = urlparse(url)
        conn = (http.client.HTTPSConnection if u.scheme == 'https' else http.client.HTTPConnection)(u.hostname, timeout=6)
        try:
            conn.request('GET', (u.path or '/') + ('?' + u.query if u.query else ''), headers={'User-Agent': 'Mozilla/5.0 Jashore360'})
            r = conn.getresponse()
            loc = r.getheader('Location')
            body = r.read(200000).decode('utf-8', 'ignore') if not loc else ''
        finally:
            conn.close()
        if loc:
            url = urljoin(url, loc)
            continue
        m = re.search(r'https://www\.google\.[a-z.]+/maps/[^"\'\s\\]+', body)
        return coords_from_text(m.group(0)) if m else coords_from_text(body[:5000])
    return None


def clean_map_url(v):
    v = s(v, 500)
    return v if v and map_host_ok(v) else None
