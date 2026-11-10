"""Updating a running site: the database of an older version is brought up to date without losing the admin's edits."""
import json
import os
import sqlite3
import subprocess
import sys
import unittest

from helpers import SERVER, Server


class UpgradeTest(unittest.TestCase):
    def test_older_install_gets_new_areas_and_keeps_admin_edits(self):
        srv = Server()
        try:
            srv.proc.terminate()
            srv.proc.wait(10)
            srv.proc.stderr.close()
            db = sqlite3.connect(os.path.join(srv.data, 'jashore360.db'))
            areas = json.loads(db.execute("SELECT value FROM settings WHERE key='areas'").fetchone()[0])
            old = [a for a in areas if a not in ('হাইকোর্ট মোড়', 'মণিহার', 'খড়কি')] + ['আমার নিজের এলাকা']
            db.execute("UPDATE settings SET value=? WHERE key='areas'", (json.dumps(old, ensure_ascii=False),))
            db.execute("UPDATE settings SET value='5' WHERE key='_seedv'")
            db.execute("DELETE FROM listings WHERE id='h-general'")          # the admin deleted a starter entry
            db.commit()
            db.close()
            subprocess.run([sys.executable, SERVER, '--data', srv.data, 'backup'], check=True, capture_output=True, env=srv.env)
            srv.proc = subprocess.Popen([sys.executable, SERVER, '--data', srv.data, '--port', str(srv.port)],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=srv.env)
            c = srv.client()
            for _ in range(100):
                try:
                    st, d = c.get('/bootstrap')
                    break
                except OSError:
                    import time
                    time.sleep(0.1)
            areas = d['areas']
            self.assertIn('হাইকোর্ট মোড়', areas)
            self.assertIn('মণিহার', areas)
            self.assertIn('আমার নিজের এলাকা', areas)        # the admin's own area stays
            self.assertNotIn('খড়কি', areas)                 # an older area the admin removed stays removed
            self.assertLess(areas.index('হাইকোর্ট মোড়'), areas.index('ঝিকরগাছা'))
            self.assertNotIn('h-general', {l['id'] for l in d['listings']})
            self.assertTrue(os.listdir(os.path.join(srv.data, 'backups')))
        finally:
            srv.stop()


class TermsRenewalTest(unittest.TestCase):
    OLD = '১. Jashore360 একটি স্বতন্ত্র তথ্য প্ল্যাটফর্ম।'

    def restart(self, srv, terms):
        srv.proc.terminate()
        srv.proc.wait(10)
        srv.proc.stderr.close()
        db = sqlite3.connect(os.path.join(srv.data, 'jashore360.db'))
        db.execute("UPDATE settings SET value=? WHERE key='terms'", (json.dumps(terms, ensure_ascii=False),))
        db.execute("DELETE FROM settings WHERE key='privacy'")             # an install from before the privacy policy
        db.commit()
        db.close()
        srv.proc = subprocess.Popen([sys.executable, SERVER, '--data', srv.data, '--port', str(srv.port)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=srv.env)
        import time
        for _ in range(100):
            try:
                return srv.client().get('/bootstrap')[1]
            except OSError:
                time.sleep(0.1)

    def test_starter_terms_are_replaced_but_edited_terms_are_kept(self):
        import hashlib
        import importlib.util
        spec = importlib.util.spec_from_file_location('migrate_src', os.path.join(os.path.dirname(SERVER), 'j360', 'migrate.py'))
        src = open(spec.origin, encoding='utf-8').read()
        old_hash = src.split("OLD_TERMS = ('")[1].split("'")[0]
        srv = Server()
        try:
            # an admin's own terms stay, and the privacy policy appears
            d = self.restart(srv, {'version': 3, 'updated': '2026-01-01', 'bn': 'আমার নিজের শর্ত', 'en': 'My own terms'})
            self.assertEqual((d['terms']['bn'], d['terms']['version']), ('আমার নিজের শর্ত', 3))
            self.assertIn('আমরা কী তথ্য নিই', d['privacy']['bn'])
            # the old starter terms (recognised by their fingerprint) become the full terms, as a new version
            import subprocess as sp
            old_bn = sp.run(['git', '-C', os.path.dirname(os.path.dirname(SERVER)), 'show', 'dc27029:server/seed.json'], capture_output=True, text=True).stdout
            if not old_bn:
                self.skipTest('git history not available')
            old_bn = json.loads(old_bn)['terms']['bn']
            self.assertEqual(hashlib.sha256(old_bn.strip().encode()).hexdigest(), old_hash)
            d = self.restart(srv, {'version': 1, 'updated': '2026-10-20', 'bn': old_bn, 'en': 'old'})
            self.assertEqual(d['terms']['version'], 2)
            self.assertIn('প্রযোজ্য আইন', d['terms']['bn'])
        finally:
            srv.stop()


class OldUsersTableTest(unittest.TestCase):
    def test_users_from_before_google_keep_working(self):
        srv = Server()
        try:
            c = srv.client()
            c.register()
            uid = c.get('/auth/me')[1]['id']
            srv.proc.terminate()
            srv.proc.wait(10)
            srv.proc.stderr.close()
            db = sqlite3.connect(os.path.join(srv.data, 'jashore360.db'))
            db.executescript('''ALTER TABLE users RENAME TO u2;
                CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, pass TEXT NOT NULL,
                  banned INTEGER NOT NULL DEFAULT 0, created_at INTEGER, terms_v INTEGER, terms_at INTEGER);
                INSERT INTO users SELECT id, name, phone, pass, banned, created_at, terms_v, terms_at FROM u2; DROP TABLE u2;''')
            db.close()
            srv.proc = subprocess.Popen([sys.executable, SERVER, '--data', srv.data, '--port', str(srv.port)],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=srv.env)
            import time
            for _ in range(100):
                try:
                    me = c.get('/auth/me')[1]
                    break
                except OSError:
                    time.sleep(0.1)
            self.assertEqual(me['id'], uid)                              # still signed in, same account
            fresh = srv.client()
            self.assertEqual(fresh.post('/auth/login', {'phone': c.phone, 'password': c.password})[0], 200)
            cols = [r[1] for r in sqlite3.connect(os.path.join(srv.data, 'jashore360.db')).execute('PRAGMA table_info(users)')]
            self.assertIn('google_sub', cols)
        finally:
            srv.stop()


if __name__ == '__main__':
    unittest.main()
