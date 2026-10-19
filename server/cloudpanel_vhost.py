#!/usr/bin/env python3
"""Route a CloudPanel site's traffic to the Jashore360 server without replacing the site.

    python3 cloudpanel_vhost.py /etc/nginx/sites-enabled/example.com.conf 8360

Inserts a regex location right after each server_name. Regex locations are matched before
prefix locations, and the first matching regex wins, so placing it first sends every request to
the app while /.well-known (Let's Encrypt) still reaches CloudPanel's own location. Running it
again replaces the block, so it is safe to repeat.
"""
import re
import sys

START, END = '# jashore360-proxy-start', '# jashore360-proxy-end'
BLOCK = '''
  %s (added by the Jashore360 installer; run it again if this block disappears)
  location ~ ^/(?!\\.well-known/) {
    proxy_pass http://127.0.0.1:%s;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
    client_max_body_size 100m;
  }
  %s'''


def main(path, port):
    s = open(path, encoding='utf-8').read()
    s = re.sub(r'\n[ \t]*' + START + r'.*?' + END + r'[^\n]*', '', s, flags=re.S)
    block = BLOCK % (START, port, END)
    s, n = re.subn(r'(\n[ \t]*server_name[^;]*;)', lambda m: m.group(1) + block, s)
    if not n:
        sys.exit('server_name not found in ' + path)
    open(path, 'w', encoding='utf-8').write(s)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
