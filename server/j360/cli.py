"""Command line: serve, ensure-admin, reset-password, import-apk, backup."""
import argparse
import os
import secrets
import threading
import time
from http.server import ThreadingHTTPServer
from . import api_account, api_admin_auth, api_admin_content, api_admin_system, api_coupons, api_google, api_public
from . import config
from .api_admin_system import store_apk
from .backup import backup_loop, make_backup
from .config import HERE, set_paths
from .migrate import init_db
from .security import hash_pw
from .store import db, get_setting
from .web import Handler


# Importing the API modules registers their routes.
API = (api_public, api_account, api_google, api_coupons, api_admin_auth, api_admin_content, api_admin_system)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.path.join(HERE, 'data'))
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=8360)
    ap.add_argument('cmd', nargs='?', default='serve', choices=['serve', 'ensure-admin', 'reset-password', 'import-apk', 'backup'])
    ap.add_argument('args', nargs='*')
    a = ap.parse_args()
    set_paths(a.data)
    init_db()
    if a.cmd in ('ensure-admin', 'reset-password'):
        user = (a.args or ['admin'])[0]
        pw = secrets.token_urlsafe(9)
        with db() as c:
            if a.cmd == 'ensure-admin':
                if c.execute('SELECT COUNT(*) FROM admins').fetchone()[0]:
                    return
                c.execute("INSERT INTO admins (username, pass, created_at, role) VALUES (?,?,?,'owner')", (user, hash_pw(pw), int(time.time())))
            else:
                if not c.execute('UPDATE admins SET pass=?, totp=NULL WHERE username=?', (hash_pw(pw), user)).rowcount:   # also the way back in after losing the phone
                    c.execute("INSERT INTO admins (username, pass, created_at, role) VALUES (?,?,?,'owner')", (user, hash_pw(pw), int(time.time())))
                c.execute('DELETE FROM sessions')
        print(f'username: {user}\npassword: {pw}')
        return
    if a.cmd == 'backup':
        print(make_backup() or 'today\'s backup already exists')
        return
    if a.cmd == 'import-apk':
        path, vname, vcode = a.args[0], a.args[1], int(a.args[2])
        notes = a.args[3] if len(a.args) > 3 else ''
        with db() as c:
            cur = (get_setting(c, 'app') or {}).get('versionCode') or 0
            if vcode <= cur:
                print(f'APK {vname} ({vcode}) already current (installed: {cur})')
                return
            store_apk(open(path, 'rb').read(), vname, vcode, notes, c)
        print(f'APK {vname} ({vcode}) published')
        return
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    srv.daemon_threads = True
    threading.Thread(target=backup_loop, daemon=True).start()
    print(f'Jashore360 running on http://{a.host}:{a.port}  (data: {config.DATA})', flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
