#!/usr/bin/env bash
# Jashore360 — install or update on a VPS (Ubuntu/Debian, with or without CloudPanel).
#
#   curl -fsSL https://raw.githubusercontent.com/iftiyak7/claude-code/claude/vigilant-heisenberg-wpt1tp/deploy/install.sh | bash
#
# Optional: DOMAIN=example.com (auto-detected from CloudPanel when a site name contains "jashore360").
# Re-run the same command to update. Data (database, uploaded photos) lives in /var/lib/jashore360 and is never touched by updates.
set -euo pipefail

BRANCH="${BRANCH:-claude/vigilant-heisenberg-wpt1tp}"
APP=/opt/jashore360
DATA=/var/lib/jashore360
PORT=8360
SVC=jashore360
SVC_USER=j360svc   # not "jashore360": CloudPanel deletes the site user of that name when the site is replaced
say() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\n\033[1;33m!!\033[0m %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "root হিসেবে চালান (sudo)"; exit 1; }

say "অ্যাপ ডাউনলোড"
command -v python3 >/dev/null || { apt-get update -qq && apt-get install -y -qq python3; }
TMP=$(mktemp -d)
curl -fsSL "https://codeload.github.com/iftiyak7/claude-code/tar.gz/refs/heads/$BRANCH" | tar xz -C "$TMP" --strip-components=1
mkdir -p "$APP"
rm -rf "$APP/public.new" "$APP/server.new"
cp -r "$TMP/public" "$APP/public.new"; cp -r "$TMP/server" "$APP/server.new"
rm -rf "$APP/public" "$APP/server"; mv "$APP/public.new" "$APP/public"; mv "$APP/server.new" "$APP/server"
rm -rf "$TMP"
chmod -R a+rX "$APP"

say "সার্ভিস চালু"
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin "$SVC_USER"
mkdir -p "$DATA"; chown -R "$SVC_USER:$SVC_USER" "$DATA"; chmod 750 "$DATA"
cat > /etc/systemd/system/$SVC.service <<UNIT
[Unit]
Description=Jashore360 app server
After=network.target

[Service]
User=$SVC_USER
ExecStart=/usr/bin/env python3 $APP/server/server.py --data $DATA --port $PORT
Restart=always
RestartSec=2
Environment=PYTHONUNBUFFERED=1
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1
systemctl restart "$SVC"
for i in $(seq 1 20); do curl -fs -o /dev/null "http://127.0.0.1:$PORT/api/bootstrap" && break; sleep 0.5; done
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/bootstrap" || { journalctl -u "$SVC" -n 30 --no-pager; echo "সার্ভিস চালু হয়নি"; exit 1; }

CREDS=$(sudo -u "$SVC_USER" python3 "$APP/server/server.py" --data "$DATA" ensure-admin admin || true)
if [ -n "$CREDS" ]; then
  printf '%s\n' "$CREDS" > /root/jashore360-admin.txt; chmod 600 /root/jashore360-admin.txt
fi

# Leftovers from the earlier static-only setup
if [ -f /etc/nginx/sites-enabled/jashore360-ip.conf ]; then rm -f /etc/nginx/sites-enabled/jashore360-ip.conf; RELOAD=1; fi
rm -rf /var/www/jashore360

# ---------------------------------------------------------------- web server
if command -v clpctl >/dev/null; then
  if [ -z "${DOMAIN:-}" ]; then
    D=$(ls -d /home/*/htdocs/*jashore360* 2>/dev/null | head -1 || true)
    DOMAIN=$(basename "${D:-}")
  fi
  [ -n "$DOMAIN" ] || { warn "CloudPanel-এ jashore360 নামের সাইট পাওয়া যায়নি। DOMAIN=yourdomain.com দিয়ে আবার চালান।"; exit 1; }
  CONF=$(ls /etc/nginx/sites-enabled/"$DOMAIN".conf 2>/dev/null || true)
  if [ -f "$DATA/.cloudpanel-$DOMAIN" ] || grep -qs "127.0.0.1:$PORT" /etc/nginx/sites-enabled/*"$DOMAIN"*; then
    say "CloudPanel সাইট $DOMAIN আগে থেকেই সংযুক্ত"
  else
    say "CloudPanel সাইট $DOMAIN কে অ্যাপের সাথে সংযুক্ত করা হচ্ছে"
    clpctl list --raw 2>/dev/null | grep -q 'site:add:reverse-proxy' || { warn "এই CloudPanel সংস্করণে reverse-proxy কমান্ড নেই।"; exit 1; }
    HT=$(ls -d /home/*/htdocs/"$DOMAIN" 2>/dev/null | head -1 || true)
    SITEUSER=$( [ -n "$HT" ] && stat -c %U "$HT" || echo jashore360 )
    tar czf "/root/jashore360-static-backup-$(date +%Y%m%d%H%M).tgz" ${HT:+"$HT"} ${CONF:+"$CONF"} 2>/dev/null || true
    PASS=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
    if [ -n "$HT" ] || [ -n "$CONF" ]; then clpctl site:delete --domainName="$DOMAIN" --force; fi
    if ! clpctl site:add:reverse-proxy --domainName="$DOMAIN" --reverseProxyUrl="http://127.0.0.1:$PORT" --siteUser="$SITEUSER" --siteUserPassword="$PASS"; then
      warn "reverse proxy সাইট বানানো যায়নি — আগের মতো স্ট্যাটিক সাইট ফিরিয়ে দেওয়া হচ্ছে"
      clpctl site:add:static --domainName="$DOMAIN" --siteUser="$SITEUSER" --siteUserPassword="$PASS" || true
      exit 1
    fi
    touch "$DATA/.cloudpanel-$DOMAIN"
    say "SSL সার্টিফিকেট (Let's Encrypt)"
    if [[ "$DOMAIN" != www.* ]]; then
      clpctl lets-encrypt:install:certificate --domainName="$DOMAIN" --subjectAlternativeName="www.$DOMAIN" \
        || clpctl lets-encrypt:install:certificate --domainName="$DOMAIN" \
        || warn "SSL হয়নি — CloudPanel → Sites → $DOMAIN → SSL/TLS থেকে Let's Encrypt চালান"
    else
      clpctl lets-encrypt:install:certificate --domainName="$DOMAIN" || warn "SSL হয়নি — CloudPanel থেকে Let's Encrypt চালান"
    fi
  fi
  # Room for photo uploads (nginx defaults to 1 MB) if nothing sets a limit already
  if ! grep -rqs client_max_body_size /etc/nginx/nginx.conf /etc/nginx/conf.d/ && grep -qs 'conf.d/\*' /etc/nginx/nginx.conf; then
    echo 'client_max_body_size 16m;' > /etc/nginx/conf.d/jashore360-upload.conf
    nginx -t -q 2>/dev/null || rm -f /etc/nginx/conf.d/jashore360-upload.conf
  fi
  nginx -t -q && (systemctl reload nginx 2>/dev/null || nginx -s reload)
  URL="https://$DOMAIN"
else
  command -v nginx >/dev/null || { apt-get update -qq && apt-get install -y -qq nginx; }
  cat > /etc/nginx/sites-enabled/jashore360.conf <<NGINX
server {
    listen 80;
    server_name ${DOMAIN:-_};
    client_max_body_size 16m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
  [ -z "${DOMAIN:-}" ] && rm -f /etc/nginx/sites-enabled/default
  nginx -t -q && (systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || nginx)
  URL="http://$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  if [ -n "${DOMAIN:-}" ]; then
    command -v certbot >/dev/null || apt-get install -y -qq certbot python3-certbot-nginx
    certbot --nginx --non-interactive --agree-tos --redirect --register-unsafely-without-email -d "$DOMAIN" && URL="https://$DOMAIN" || warn "SSL হয়নি — DNS ঠিক আছে কি না দেখুন"
  fi
fi
[ "${RELOAD:-}" = 1 ] && (nginx -t -q && (systemctl reload nginx 2>/dev/null || nginx -s reload)) || true

echo
echo "════════════════════════════════════════════"
echo " ✅ Jashore360 চালু হয়েছে"
echo "    অ্যাপ:          $URL"
echo "    অ্যাডমিন প্যানেল: $URL/admin"
if [ -n "$CREDS" ]; then
  echo
  echo " 🔑 অ্যাডমিন লগইন (এখনই কোথাও লিখে রাখুন):"
  printf '%s\n' "$CREDS" | sed 's/^/    /'
  echo "    (/root/jashore360-admin.txt ফাইলেও রাখা আছে। লগইনের পর পাসওয়ার্ড বদলে নিন)"
else
  echo "    অ্যাডমিন লগইন আগের মতোই আছে। প্রথম পাসওয়ার্ড: cat /root/jashore360-admin.txt"
fi
echo "════════════════════════════════════════════"
