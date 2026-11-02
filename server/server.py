#!/usr/bin/env python3
"""Jashore360 server — landing page, web app, admin panel, JSON API and SQLite storage.

Standard library only (Python 3.9+), so a stock Ubuntu VPS can run it as-is. The code lives in the j360 package
(one module per part: storage, security, web layer, and one per API area); this file only starts it.

    python3 server.py --data ./data                          # serve on 127.0.0.1:8360
    python3 server.py --data ./data ensure-admin             # create owner 'admin' if no admin exists, print password
    python3 server.py --data ./data reset-password admin
    python3 server.py --data ./data import-apk FILE.apk 1.0.0 1 "release notes"
"""
from j360.cli import main

if __name__ == '__main__':
    main()
