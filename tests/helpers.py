"""Test harness: runs the real server on a free port with a throwaway data folder, and a small cookie-keeping client."""
import http.cookiejar
import itertools
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server', 'server.py')
_ips = itertools.count(1)
_phones = itertools.count(11000000)


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class Server:
    """One server process for a test module. Stopped and its data deleted in stop()."""

    def __init__(self, data=None, env=None):
        self.tmp = tempfile.mkdtemp(prefix='j360test-')
        self.data = data or os.path.join(self.tmp, 'data')
        self.port = free_port()
        self.env = dict(os.environ, J360_DOMAIN_FILE=os.path.join(self.tmp, 'domain'), **(env or {}))
        out = subprocess.run([sys.executable, SERVER, '--data', self.data, 'ensure-admin', 'admin'],
                             capture_output=True, text=True, env=self.env, check=True).stdout
        self.admin_password = out.split('password: ')[1].strip() if 'password: ' in out else None
        self.proc = subprocess.Popen([sys.executable, SERVER, '--data', self.data, '--port', str(self.port)],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=self.env)
        self.base = f'http://127.0.0.1:{self.port}'
        for _ in range(100):
            try:
                urllib.request.urlopen(self.base + '/api/bootstrap', timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError('server did not start: ' + self.proc.stderr.read().decode())

    def stop(self):
        self.proc.terminate()
        self.proc.wait(10)
        self.proc.stderr.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def client(self, ip=None):
        return Client(self.base, ip or '10.0.%d.%d' % divmod(next(_ips), 250))

    def admin(self):
        c = self.client()
        st, r = c.post('/admin/login', {'username': 'admin', 'password': self.admin_password})
        assert st == 200, r
        return c


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kw):
        return None


class Client:
    """Keeps cookies like a browser. Each client looks like a different visitor (its own address)."""

    def __init__(self, base, ip):
        self.base, self.ip = base, ip
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), urllib.request.ProxyHandler({}))
        self.nofollow = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), urllib.request.ProxyHandler({}), NoRedirect)

    def raw(self, method, path, data=None, headers=None, follow=True):
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={'X-Real-IP': self.ip, **(headers or {})})
        op = self.op if follow else self.nofollow
        try:
            with op.open(req, timeout=20) as r:
                return r.status, r.read(), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers

    def call(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        st, raw, _ = self.raw(method, '/api' + path, data, {'Content-Type': 'application/json', **(headers or {})})
        return st, json.loads(raw) if raw else None

    def get(self, path):
        return self.call('GET', path)

    def post(self, path, body=None):
        return self.call('POST', path, body if body is not None else {})

    def put(self, path, body):
        return self.call('PUT', path, body)

    def delete(self, path):
        return self.call('DELETE', path)

    def register(self, name='টেস্ট ইউজার', password='Jsr#2026test'):
        phone = '017%08d' % next(_phones)
        st, r = self.post('/auth/register', {'name': name, 'phone': phone, 'password': password, 'terms': True})
        assert st == 200, r
        self.phone, self.password = phone, password
        return r


class ServerTest(unittest.TestCase):
    """Base class: one server shared by the tests of a class."""

    @classmethod
    def setUpClass(cls):
        cls.srv = Server()

    @classmethod
    def tearDownClass(cls):
        cls.srv.stop()

    def ok(self, res, status=200):
        self.assertEqual(res[0], status, res[1])
        return res[1]
