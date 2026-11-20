"""The Google Play bundle: built from android/, given the site's assets on the server and signed with the upload key."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

from helpers import SERVER, Server

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIGN = os.path.join(ROOT, 'server', 'sign_aab.py')
BASE = os.path.join(ROOT, 'android', 'base.aab')


class BundleTest(unittest.TestCase):
    def test_base_bundle_layout(self):
        with zipfile.ZipFile(BASE) as z:
            names = set(z.namelist())
            self.assertEqual(z.read('BundleConfig.pb'), b'\x0a\x08\x12\x061.18.2')   # BundleConfig { bundletool { version } }
            manifest = z.read('base/manifest/AndroidManifest.xml')
        for part in ('base/manifest/AndroidManifest.xml', 'base/resources.pb', 'base/dex/classes.dex'):
            self.assertIn(part, names)
        self.assertNotIn('resources.arsc', names)
        self.assertIn(b'com.jashore360.app', manifest)                                    # the package name on Google Play
        # Play's automatic protection needs minSdkVersion 24 or more (proto attribute: name, then the value as text)
        i = manifest.index(b'minSdkVersion')
        self.assertIn(b'24', manifest[i:i + 40])
        self.assertNotIn(b'21', manifest[i:i + 40])

    @unittest.skipUnless(shutil.which('jarsigner') and shutil.which('keytool'), 'needs a JDK')
    def test_signed_with_the_upload_key(self):
        tmp = tempfile.mkdtemp()
        try:
            out, keys = os.path.join(tmp, 'out.aab'), os.path.join(tmp, 'keys')
            subprocess.run([sys.executable, SIGN, BASE, out, 'https://example.com/app/', keys, 'old.example.com',
                            '--www', os.path.join(ROOT, 'public')], check=True, capture_output=True)
            with zipfile.ZipFile(out) as z:
                names = set(z.namelist())
                cfg = z.read('base/assets/config.json')
            self.assertIn(b'"url": "https://example.com/app/"', cfg)
            self.assertIn(b'old.example.com', cfg)
            for n in ('base/assets/www/app.html', 'base/assets/www/js/main.js', 'META-INF/UPLOAD.SF', 'META-INF/UPLOAD.RSA'):
                self.assertIn(n, names)
            v = subprocess.run(['jarsigner', '-verify', out], capture_output=True, text=True)
            self.assertIn('jar verified', v.stdout)
            # the same key signs the next build: Play accepts updates only from the first upload key
            cert = subprocess.run([sys.executable, SIGN, '--cert', keys], check=True, capture_output=True, text=True).stdout
            subprocess.run([sys.executable, SIGN, BASE, out + '2', 'https://example.com/app/', keys], check=True, capture_output=True)
            self.assertEqual(cert, subprocess.run([sys.executable, SIGN, '--cert', keys], check=True, capture_output=True, text=True).stdout)
            self.assertTrue(cert.startswith('-----BEGIN CERTIFICATE-----'))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class PlayDownloadTest(unittest.TestCase):
    def test_only_the_owner_downloads_the_bundle(self):
        srv = Server()
        try:
            adm = srv.admin()
            self.assertIsNone(adm.get('/admin/play')[1])                       # nothing built yet
            self.assertEqual(adm.get('/admin/play/aab')[0], 404)
            pem = os.path.join(srv.tmp, 'cert.pem')
            open(pem, 'w').write('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n')
            subprocess.run([sys.executable, SERVER, '--data', srv.data, 'import-aab', BASE, '1.4.0', '5', 'com.jashore360.app', pem],
                           check=True, capture_output=True, env=srv.env)
            info = adm.get('/admin/play')[1]
            self.assertEqual((info['versionName'], info['versionCode'], info['package']), ('1.4.0', 5, 'com.jashore360.app'))
            self.assertIn('BEGIN CERTIFICATE', info['cert'])
            st, raw, h = adm.raw('GET', '/api/admin/play/aab')
            self.assertEqual(st, 200)
            self.assertEqual(raw, open(BASE, 'rb').read())
            self.assertIn('attachment', h['Content-Disposition'])
            self.assertEqual(srv.client().get('/admin/play/aab')[0], 401)       # not public
            self.assertNotIn('_play', srv.client().get('/bootstrap')[1])
            adm.post('/admin/admins', {'username': 'mod9', 'password': 'Mod#pass2026', 'role': 'moderator'})
            mod = srv.client()
            mod.post('/admin/login', {'username': 'mod9', 'password': 'Mod#pass2026'})
            self.assertEqual(mod.get('/admin/play/aab')[0], 403)                 # moderators cannot
        finally:
            srv.stop()


if __name__ == '__main__':
    unittest.main()
