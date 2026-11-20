#!/usr/bin/env python3
"""Turn android/base.aab into the signed App Bundle to upload to Google Play.

    python3 sign_aab.py BASE.aab OUT.aab https://example.com/app/ KEYDIR [old-domain.com,other.com] [--www PUBLIC_DIR] [--boot BOOTSTRAP.json]

Adds the same assets as sign_apk.py (site address, app files, today's data) and signs the bundle with the *upload key*
kept in KEYDIR (created on first run). Google Play re-signs the app for phones with its own key (Play App Signing); the
upload key only proves to Play that a new version comes from the owner. The first bundle uploaded fixes which upload key
Play accepts, so keep KEYDIR; if it is ever lost, the owner can ask for a new upload key in Play Console.
"""
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sign_apk import add_assets, ensure_key, run   # noqa: E402

ALIAS = 'upload'


def main(base, out, url, keydir, old_hosts='', www=None, boot=None):
    ks, pw = ensure_key(keydir, 'upload', ALIAS)
    tmp = tempfile.mkdtemp()
    try:
        raw = os.path.join(tmp, 'raw.aab')
        shutil.copy(base, raw)
        add_assets(raw, 'base/assets/', url, old_hosts, www, boot)
        env = dict(os.environ, J360_KS_PASS=open(pw).read().strip())
        run('jarsigner', '-keystore', ks, '-storepass:env', 'J360_KS_PASS', '-keypass:env', 'J360_KS_PASS',
            '-sigalg', 'SHA256withRSA', '-digestalg', 'SHA-256', '-signedjar', out, raw, ALIAS, env=env)
        # (the upload key is self-signed, as Play expects, so only the signature itself is checked, not a certificate chain)
        check = subprocess.run(['jarsigner', '-verify', out], capture_output=True, text=True)
        if check.returncode != 0 or 'jar verified' not in check.stdout:
            sys.exit('signature check failed: ' + check.stdout + check.stderr)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def certificate(keydir):
    """The upload key's certificate (PEM): Play Console asks for it if the upload key ever has to be replaced."""
    ks, pw = ensure_key(keydir, 'upload', ALIAS)
    return subprocess.run(['keytool', '-exportcert', '-rfc', '-keystore', ks, '-alias', ALIAS, '-storepass:file', pw],
                          check=True, capture_output=True, text=True).stdout


if __name__ == '__main__':
    args, opts = [], {}
    it = iter(sys.argv[1:])
    for a in it:
        if a in ('--www', '--boot'):
            opts[a[2:]] = next(it)
        elif a == '--cert':
            print(certificate(next(it)), end='')
            sys.exit(0)
        else:
            args.append(a)
    main(*args[:5], **opts)
