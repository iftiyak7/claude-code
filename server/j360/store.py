"""The SQLite database: connections, settings, counters, category lookups."""
import json
import sqlite3
import threading
from . import config
from .util import today


def db():
    c = sqlite3.connect(config.DB_PATH, timeout=15)
    c.row_factory = sqlite3.Row
    return c


def get_setting(c, key):
    row = c.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return json.loads(row[0]) if row else None


def resolve_lid(c, lid):
    """A listing's current id, following renamed links (old ids stay valid)."""
    r = c.execute('SELECT new FROM aliases WHERE old=?', (lid,)).fetchone()
    return r[0] if r else lid


def inc(c, metric, n=1):
    c.execute('INSERT INTO daily (day, metric, n) VALUES (?,?,?) ON CONFLICT(day, metric) DO UPDATE SET n=n+?', (today(), metric, n, n))


_lock = threading.Lock()


def categories():
    with db() as c:
        return {x['id']: x for x in (get_setting(c, 'categories') or [])}


def needs_payment(cat, sub):
    return bool(cat.get('paid')) and sub not in (cat.get('freeSubs') or [])
