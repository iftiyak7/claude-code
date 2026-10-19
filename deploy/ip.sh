#!/usr/bin/env bash
# Jashore360 — এক কমান্ডে VPS-এর IP দিয়ে চালু (ডোমেইন লাগবে না, CloudPanel থাকলেও চলবে)
#   curl -fsSL https://raw.githubusercontent.com/iftiyak7/claude-code/claude/vigilant-heisenberg-wpt1tp/deploy/ip.sh | sudo bash
# আপডেট করতেও একই কমান্ড আবার চালান।
set -euo pipefail
BRANCH="claude/vigilant-heisenberg-wpt1tp"
ROOT=/var/www/jashore360
[ "$(id -u)" -eq 0 ] || { echo "root হিসেবে চালান (sudo)"; exit 1; }

echo "==> অ্যাপ ডাউনলোড"
TMP=$(mktemp -d)
curl -fsSL "https://codeload.github.com/iftiyak7/claude-code/tar.gz/refs/heads/$BRANCH" | tar xz -C "$TMP" --strip-components=1
mkdir -p "$ROOT"
cp -r "$TMP"/index.html "$TMP"/sw.js "$TMP"/manifest.webmanifest "$TMP"/icon.svg "$TMP"/css "$TMP"/js "$ROOT"/
rm -rf "$TMP"
find "$ROOT" -type d -exec chmod 755 {} + ; find "$ROOT" -type f -exec chmod 644 {} +

if ! command -v nginx >/dev/null; then
  echo "==> nginx ইনস্টল"; apt-get update -qq && apt-get install -y -qq nginx
fi

CONF=/etc/nginx/sites-enabled/jashore360-ip.conf
# আগে চালানো থাকলে একই পোর্ট রাখা; নাহলে খালি একটা পোর্ট বেছে নেওয়া
PORT=$(grep -oP 'listen \K[0-9]+' "$CONF" 2>/dev/null | head -1 || true)
if [ -z "$PORT" ]; then
  for p in 8080 8090 8888 3360; do ss -ltn | grep -q ":$p " || { PORT=$p; break; }; done
fi
echo "==> nginx কনফিগ (পোর্ট $PORT)"
mkdir -p /etc/nginx/sites-enabled
cat > "$CONF" <<NGINX
server {
    listen $PORT;
    root $ROOT;
    index index.html;
    charset utf-8;
    gzip on;
    gzip_types text/css application/javascript application/manifest+json image/svg+xml;
    location / { try_files \$uri \$uri/ /index.html; add_header Cache-Control "no-cache"; }
    location = /manifest.webmanifest { default_type application/manifest+json; }
}
NGINX
grep -q "sites-enabled" /etc/nginx/nginx.conf || sed -i 's|^\(\s*\)include /etc/nginx/conf.d/\*.conf;|&\n\1include /etc/nginx/sites-enabled/*.conf;|' /etc/nginx/nginx.conf
nginx -t -q
systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow "$PORT"/tcp >/dev/null; fi

IP=$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
echo
echo "✅ Jashore360 চালু হয়েছে:  http://$IP:$PORT"
echo "   (না খুললে CloudPanel → Admin Area → Security → Firewall এ পোর্ট $PORT যোগ করুন)"
