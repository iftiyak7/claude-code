#!/usr/bin/env python3
"""Put the parts of the app together as an Android App Bundle (.aab), the format Google Play asks for.

    python3 make_aab.py PROTO_RES.zip classes.dex OUT.aab

PROTO_RES.zip is what `aapt2 link --proto-format` writes (AndroidManifest.xml, resources.pb, res/...). The bundle has a
single "base" module; the server adds assets/ and signs it (server/sign_aab.py), and Google Play makes the APKs from it.
"""
import sys
import zipfile

# BundleConfig { bundletool { version: "1.18.2" } } — field 1 holds a message whose field 2 is the version string.
BUNDLETOOL_VERSION = b'1.18.2'
_inner = b'\x12' + bytes([len(BUNDLETOOL_VERSION)]) + BUNDLETOOL_VERSION
BUNDLE_CONFIG = b'\x0a' + bytes([len(_inner)]) + _inner

# A fixed date keeps the file the same when nothing in the app changed.
STAMP = (2026, 1, 1, 0, 0, 0)


def entry(z, name, data):
    info = zipfile.ZipInfo(name, STAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    z.writestr(info, data)


def main(proto_zip, dex, out):
    with zipfile.ZipFile(proto_zip) as src, zipfile.ZipFile(out, 'w') as z:
        names = src.namelist()
        if 'AndroidManifest.xml' not in names or 'resources.pb' not in names:
            sys.exit('not an aapt2 --proto-format output: ' + proto_zip)
        entry(z, 'BundleConfig.pb', BUNDLE_CONFIG)
        entry(z, 'base/manifest/AndroidManifest.xml', src.read('AndroidManifest.xml'))
        entry(z, 'base/resources.pb', src.read('resources.pb'))
        for n in sorted(names):
            if n.startswith('res/') and not n.endswith('/'):
                entry(z, 'base/' + n, src.read(n))
        entry(z, 'base/dex/classes.dex', open(dex, 'rb').read())


if __name__ == '__main__':
    main(*sys.argv[1:4])
