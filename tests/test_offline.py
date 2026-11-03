"""The Android app's offline copy: the file list the app syncs, the copy bundled into the APK, and opening it with no internet."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

from helpers import ROOT, ServerTest
from test_ui import node_with_playwright


class OfflineTest(ServerTest):
    def test_file_list_matches_what_the_site_serves(self):
        c = self.srv.client()
        files = self.ok(c.get('/shell'))['files']
        paths = {f['path'] for f in files}
        self.assertTrue({'app.html', 'app.css', 'i18n.js', 'js/main.js', 'js/boot.js'} <= paths)
        for f in files:
            st, body, _ = c.raw('GET', '/' + f['path'])
            self.assertEqual(st, 200, f['path'])
            self.assertEqual(hashlib.sha256(body).hexdigest(), f['sha256'], f['path'])
        # every module the app imports is in the list (a missing one would break the app offline)
        js = {p for p in paths if p.startswith('js/')}
        self.assertEqual(js, {'js/' + f for f in os.listdir(os.path.join(ROOT, 'public', 'js'))})

    @unittest.skipUnless(shutil.which('apksigner') and shutil.which('zipalign') and shutil.which('keytool'), 'Android signing tools missing')
    def test_apk_carries_the_app_and_todays_data(self):
        tmp = tempfile.mkdtemp()
        try:
            boot = os.path.join(tmp, 'boot.json')
            st, body, _ = self.srv.client().raw('GET', '/api/bootstrap')
            with open(boot, 'wb') as f:
                f.write(body)
            out = os.path.join(tmp, 'app.apk')
            subprocess.run([sys.executable, os.path.join(ROOT, 'server', 'sign_apk.py'), os.path.join(ROOT, 'android', 'base.apk'), out,
                            'https://jashore360.test/app/', os.path.join(tmp, 'keys'), '', '--www', os.path.join(ROOT, 'public'), '--boot', boot],
                           check=True, capture_output=True)
            with zipfile.ZipFile(out) as z:
                names = set(z.namelist())
                z.extractall(tmp, [n for n in names if n.startswith('assets/')])
                boot_in_apk = json.loads(z.read('assets/www/api/bootstrap.json'))
            for p in ('assets/www/app.html', 'assets/www/js/main.js', 'assets/www/api/bootstrap.json', 'assets/config.json'):
                self.assertIn(p, names)
            self.assertTrue(boot_in_apk['listings'])
            www = os.path.join(tmp, 'assets', 'www')
            pw = node_with_playwright()
            if pw:      # open exactly that copy in a browser with no internet at all
                node, env = pw
                r = subprocess.run([node, os.path.join(ROOT, 'tests', 'offline_app.js'), www], env=env, capture_output=True, text=True, timeout=120)
                self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
