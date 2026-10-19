#!/usr/bin/env python3
"""Turn android/base.apk into a signed, installable APK for this server.

    python3 sign_apk.py BASE.apk OUT.apk https://example.com/app/ KEYDIR

Adds assets/config.json with the site URL, zipaligns, and signs with a key kept in KEYDIR.
The key is created on first run and must stay the same forever: Android only installs an
update over an existing app when both are signed with the same key.
"""
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import zipfile


def run(*cmd, **kw):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, **kw)


def ensure_key(keydir):
    os.makedirs(keydir, mode=0o700, exist_ok=True)
    ks, pw = os.path.join(keydir, 'release.jks'), os.path.join(keydir, 'release.pass')
    if not os.path.exists(ks):
        with open(pw, 'w') as f:
            f.write(secrets.token_urlsafe(24))
        os.chmod(pw, 0o600)
        run('keytool', '-genkeypair', '-keystore', ks, '-storetype', 'PKCS12', '-alias', 'jashore360',
            '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Jashore360',
            '-storepass:file', pw, '-keypass:file', pw)
        os.chmod(ks, 0o600)
    return ks, pw


def main(base, out, url, keydir):
    ks, pw = ensure_key(keydir)
    tmp = tempfile.mkdtemp()
    try:
        raw = os.path.join(tmp, 'raw.apk')
        aligned = os.path.join(tmp, 'aligned.apk')
        shutil.copy(base, raw)
        with zipfile.ZipFile(raw, 'a') as z:
            if 'assets/config.json' not in z.namelist():
                z.writestr('assets/config.json', json.dumps({'url': url}))
        run('zipalign', '-f', '-p', '4', raw, aligned)
        env = dict(os.environ, J360_KS_PASS=open(pw).read().strip())
        run('apksigner', 'sign', '--ks', ks, '--ks-key-alias', 'jashore360', '--ks-pass', 'env:J360_KS_PASS',
            '--out', out, aligned, env=env)
        run('apksigner', 'verify', out)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main(*sys.argv[1:5])
