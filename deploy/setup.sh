#!/usr/bin/env bash
# Jashore360 VPS setup / update (Ubuntu or Debian).
#
# প্রথমবার:   sudo DOMAIN=jashore360.com EMAIL=you@example.com bash deploy/setup.sh
# ডোমেইন ছাড়া: sudo bash deploy/setup.sh            (http://<server-ip> এ চলবে)
# আপডেট:      git pull && sudo DOMAIN=... bash deploy/setup.sh
set -euo pipefail

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
ROOT="${ROOT:-/var/www/jashore360}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "sudo দিয়ে চালান: sudo bash deploy/setup.sh"; exit 1; }

echo "==> nginx ইনস্টল"
if ! command -v nginx >/dev/null; then
  apt-get update -qq && apt-get install -y -qq nginx rsync
fi
command -v rsync >/dev/null || apt-get install -y -qq rsync

echo "==> ফাইল কপি: $SRC → $ROOT"
mkdir -p "$ROOT"
rsync -a --delete --exclude '.git' --exclude 'deploy' --exclude 'README.md' --exclude '*.png' "$SRC/" "$ROOT/"
chown -R www-data:www-data "$ROOT"
find "$ROOT" -type d -exec chmod 755 {} + ; find "$ROOT" -type f -exec chmod 644 {} +

echo "==> nginx কনফিগ"
SERVER_NAME="${DOMAIN:-_}"
[ -n "$DOMAIN" ] && SERVER_NAME="$DOMAIN www.$DOMAIN"
CONF=/etc/nginx/sites-available/jashore360
# certbot যে HTTPS ব্লক যোগ করে, আপডেটের সময় সেটা মুছে না দিতে কনফিগ শুধু প্রথমবার লেখা হয়
if [ ! -f "$CONF" ] || ! grep -q "managed by Certbot" "$CONF"; then
  sed -e "s|__SERVER_NAME__|$SERVER_NAME|" -e "s|__ROOT__|$ROOT|" "$SRC/deploy/nginx.conf" > "$CONF"
  # IPv6 নেই এমন সার্ভারে [::]:80 লাইন রাখলে nginx চালু হয় না
  [ -s /proc/net/if_inet6 ] || sed -i '/listen \[::\]/d' "$CONF"
fi
ln -sf "$CONF" /etc/nginx/sites-enabled/jashore360
[ -z "$DOMAIN" ] && rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx >/dev/null 2>&1 || true
systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null
fi

if [ -n "$DOMAIN" ] && ! grep -q "managed by Certbot" "$CONF"; then
  echo "==> HTTPS (Let's Encrypt)"
  command -v certbot >/dev/null || apt-get install -y -qq certbot python3-certbot-nginx
  if [ -n "$EMAIL" ]; then M=(-m "$EMAIL"); else M=(--register-unsafely-without-email); fi
  certbot --nginx --non-interactive --agree-tos --redirect "${M[@]}" -d "$DOMAIN" -d "www.$DOMAIN" \
    || certbot --nginx --non-interactive --agree-tos --redirect "${M[@]}" -d "$DOMAIN" \
    || echo "!! HTTPS চালু হয়নি — ডোমেইনের DNS A রেকর্ড এই সার্ভারের IP-তে আছে কি না দেখুন, তারপর আবার চালান।"
fi

echo
if [ -n "$DOMAIN" ]; then echo "✓ Jashore360 চালু: https://$DOMAIN"
else echo "✓ Jashore360 চালু: http://$(hostname -I | awk '{print $1}')  (অফলাইন/ইনস্টল/লোকেশনের জন্য ডোমেইন + HTTPS দরকার)"; fi
