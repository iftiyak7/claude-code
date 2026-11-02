"""Uploaded photos and videos: checking file types and which uploads a user may attach."""
import base64
import os
import re
import secrets
from . import config
from .config import MAX_IMAGES, MAX_VIDEOS
from .store import db
from .util import ApiError


IMG_SIG = {b'\xff\xd8\xff': 'jpg', b'\x89PNG': 'png', b'RIFF': 'webp'}


def save_image(data_url, max_bytes):
    m = re.match(r'^data:image/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$', data_url or '')
    if not m:
        raise ValueError('ছবির ফরম্যাট সঠিক নয়')
    raw = base64.b64decode(m.group(2))
    if len(raw) > max_bytes:
        raise ValueError('ছবি অনেক বড়')
    ext = next((e for sig, e in IMG_SIG.items() if raw.startswith(sig)), None)
    if not ext or (ext == 'webp' and raw[8:12] != b'WEBP'):
        raise ValueError('ছবির ফরম্যাট সঠিক নয়')
    name = secrets.token_hex(12) + '.' + ext
    with open(os.path.join(config.UPLOADS, name), 'wb') as f:
        f.write(raw)
    return '/uploads/' + name


UPLOAD_RE = re.compile(r'^/uploads/([a-f0-9]{24}\.(jpg|png|webp|mp4|webm|mov))$')
IMAGE_EXTS, VIDEO_EXTS = ('jpg', 'png', 'webp'), ('mp4', 'webm', 'mov')


def sniff(head, kind):
    if kind == 'image':
        ext = next((e for sig, e in IMG_SIG.items() if head.startswith(sig)), None)
        return None if ext == 'webp' and head[8:12] != b'WEBP' else ext
    if head[4:8] == b'ftyp':
        return 'mov' if head[8:10] == b'qt' else 'mp4'
    return 'webm' if head.startswith(b'\x1aE\xdf\xa3') else None


def clean_media(d, uid=None, keep=()):
    """images/videos lists from a form. Users may only attach files they uploaded themselves (or that the item already had)."""
    allowed = None
    if uid is not None:
        names = [m.group(1) for k in ('images', 'videos') if isinstance(d.get(k), list)
                 for u in d[k] if isinstance(u, str) for m in [UPLOAD_RE.match(u)] if m][:40]
        allowed = {u.rsplit('/', 1)[-1] for u in keep}
        if names:
            with db() as c:
                allowed |= {r[0] for r in c.execute('SELECT name FROM media WHERE user_id=? AND name IN (%s)' % ','.join('?' * len(names)), (uid, *names))}
    out = {}
    for key, exts, cap in (('images', IMAGE_EXTS, MAX_IMAGES), ('videos', VIDEO_EXTS, MAX_VIDEOS)):
        urls = []
        for u in d.get(key) if isinstance(d.get(key), list) else []:
            m = UPLOAD_RE.match(u) if isinstance(u, str) else None
            ok = m and m.group(2) in exts and (allowed is None or m.group(1) in allowed)
            ok = ok or (uid is None and key == 'images' and isinstance(u, str) and re.match(r'^https://\S+$', u))
            if ok and u not in urls:
                urls.append(u)
        out[key] = urls[:cap] or None
    return out


def user_media(h, b, keep=()):
    """Media for a user's form: uploaded URLs, plus base64 photos from older app versions."""
    m = clean_media(b, h.me['id'], keep)
    imgs = m['images'] or []
    for p in (b.get('photos') or [])[:max(0, MAX_IMAGES - len(imgs))]:
        try:
            imgs.append(save_image(p, 3 * 1024 * 1024))
        except ValueError as e:
            raise ApiError(400, str(e))
    return {'images': imgs or None, 'videos': m['videos']}
