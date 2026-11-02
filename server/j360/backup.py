"""Daily copies of the database."""
import os
import re
import sqlite3
import time
from . import config
from .config import BACKUP_KEEP


def make_backup():
    """One consistent copy of the database per day in DATA/backups (photos are not copied); the newest BACKUP_KEEP are kept."""
    folder = os.path.join(config.DATA, 'backups')
    os.makedirs(folder, mode=0o700, exist_ok=True)
    dest = os.path.join(folder, 'jashore360-%s.db' % time.strftime('%Y%m%d'))
    if os.path.exists(dest):
        return None
    tmp = dest + '.part'
    src, dst = sqlite3.connect(config.DB_PATH), sqlite3.connect(tmp)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    os.chmod(tmp, 0o600)
    os.replace(tmp, dest)
    old = sorted(f for f in os.listdir(folder) if re.match(r'^jashore360-\d{8}\.db$', f))[:-BACKUP_KEEP]
    for f in old:
        os.remove(os.path.join(folder, f))
    return dest


def backup_loop():
    while True:
        try:
            make_backup()
        except Exception as e:                          # a full disk must not stop the site
            print('backup failed:', e, flush=True)
        time.sleep(3 * 3600)
