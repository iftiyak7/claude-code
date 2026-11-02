"""Small helpers shared everywhere: text and number cleaning, dates, ids, phone numbers, the API error type."""
import re
import secrets
import time


def new_id(prefix=''):
    return prefix + secrets.token_hex(6)


def today():
    return time.strftime('%Y-%m-%d')


BN_DIGITS = str.maketrans('০১২৩৪৫৬৭৮৯', '0123456789')


def norm_phone(p):
    p = re.sub(r'\D', '', str(p or '').translate(BN_DIGITS))
    if p.startswith('880'):
        p = p[2:]
    return p if re.match(r'^01[3-9]\d{8}$', p) else None


def s(v, n=200):
    return str(v).strip()[:n] if v not in (None, '') else None


def to_int(v):
    try:
        return int(str(v).translate(BN_DIGITS).replace(',', '').strip()) if v not in (None, '') else None
    except ValueError:
        return None


class ApiError(Exception):
    def __init__(self, status, msg, **extra):
        super().__init__(msg)
        self.status = status
        self.extra = extra
