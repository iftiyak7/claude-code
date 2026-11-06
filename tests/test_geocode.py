"""Area map points looked up by the server, against a stand-in for OpenStreetMap's search."""
import http.server
import json
import threading
import time
import unittest
import urllib.parse

from helpers import Server, free_port

PLACES = {   # what the stand-in "finds"
    'Barandipara': (23.1601, 89.2003),
    'Chitra Mor': (23.1655, 89.2155),          # found under the "Mor" spelling, not "More"
    'Bakchar': (24.9, 90.4),                    # a different Bakchar far away: outside Jashore, must be ignored
}


class FakeSearch(http.server.BaseHTTPRequestHandler):
    seen = []

    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        FakeSearch.seen.append((q['q'][0], self.headers.get('User-Agent')))
        name = q['q'][0].split(',')[0]
        body = json.dumps([{'lat': str(PLACES[name][0]), 'lon': str(PLACES[name][1])}] if name in PLACES else []).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class GeocodeTest(unittest.TestCase):
    def test_server_fills_missing_area_points(self):
        port = free_port()
        fake = http.server.ThreadingHTTPServer(('127.0.0.1', port), FakeSearch)
        threading.Thread(target=fake.serve_forever, daemon=True).start()
        srv = Server(env={'J360_GEOCODE_URL': f'http://127.0.0.1:{port}/search', 'J360_GEOCODE_GAP': '0'})
        try:
            adm = srv.admin()
            self.assertEqual(adm.put('/admin/settings/areas', ['বারান্দীপাড়া', 'চিত্রামোড়', 'বকচর', 'নিউমার্কেট'])[0], 200)
            set_by_admin = {'নিউমার্কেট': [23.18, 89.21]}
            self.assertEqual(adm.put('/admin/settings/areaGeo', set_by_admin)[0], 200)
            self.assertEqual(srv.client().post('/admin/areas/lookup')[0], 401)
            self.assertTrue(adm.post('/admin/areas/lookup')[1]['started'])
            for _ in range(200):
                geo = srv.client().get('/bootstrap')[1]['areaGeo']
                if 'চিত্রামোড়' in geo and any(q.startswith('বকচর') for q, _ in FakeSearch.seen):
                    break
                time.sleep(0.5)
            self.assertEqual(geo['বারান্দীপাড়া'], [23.1601, 89.2003])
            self.assertEqual(geo['চিত্রামোড়'], [23.1655, 89.2155])
            self.assertNotIn('বকচর', geo)                          # the far-away match is not used
            self.assertEqual(geo['নিউমার্কেট'], [23.18, 89.21])     # the admin's own point stays
            self.assertTrue(all(ua.startswith('Jashore360/') for _, ua in FakeSearch.seen))
        finally:
            srv.stop()
            fake.shutdown()


if __name__ == '__main__':
    unittest.main()
