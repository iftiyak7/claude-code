"""Every page of the app and the admin panel opens in a real browser without script errors (skipped without Playwright)."""
import os
import shutil
import subprocess
import unittest

from helpers import ROOT, ServerTest


def node_with_playwright():
    node = shutil.which('node')
    if not node:
        return None
    env = dict(os.environ)
    for path in ('/opt/node22/lib/node_modules', os.path.expanduser('~/.npm-global/lib/node_modules')):
        if os.path.isdir(os.path.join(path, 'playwright')):
            env['NODE_PATH'] = path
    ok = subprocess.run([node, '-e', 'require("playwright")'], env=env, capture_output=True).returncode == 0
    if os.path.exists('/opt/pw-browsers/chromium'):
        env.setdefault('PW_CHROMIUM', '/opt/pw-browsers/chromium')
    return (node, env) if ok else None


@unittest.skipUnless(node_with_playwright(), 'Playwright is not installed')
class UiTest(ServerTest):
    def test_all_pages_open_without_errors(self):
        node, env = node_with_playwright()
        r = subprocess.run([node, os.path.join(ROOT, 'tests', 'ui_smoke.js'), self.srv.base, self.srv.admin_password],
                           env=env, capture_output=True, text=True, timeout=300)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)


if __name__ == '__main__':
    unittest.main()
