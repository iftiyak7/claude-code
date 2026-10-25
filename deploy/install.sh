#!/usr/bin/env bash
# Jashore360 — install or update on a VPS (Ubuntu/Debian, with or without CloudPanel).
#
#   curl -fsSL https://raw.githubusercontent.com/iftiyak7/claude-code/claude/vigilant-heisenberg-wpt1tp/deploy/install.sh | bash
#
# Optional: DOMAIN=example.com (auto-detected from CloudPanel when a site name contains "jashore360").
# Moving to a new domain: DOMAIN=new.com OLD_DOMAINS=old.com — both are remembered for later runs. Browsers on the old
# domain are sent to the new one (once its SSL works); the installed Android app keeps working there until updated.
# When the admin dashboard shows no phones on the old address any more, finish with REMOVE_OLD=1 to delete the old site.
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
mkdir -p "$APP/android"; cp "$TMP/android/base.apk" "$TMP/android/version.json" "$APP/android/" 2>/dev/null || true
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
CFG=/etc/jashore360; mkdir -p "$CFG"
if [ -n "${DOMAIN:-}" ]; then echo "$DOMAIN" > "$CFG/domain"; elif [ -s "$CFG/domain" ]; then DOMAIN=$(cat "$CFG/domain"); fi
if [ -n "${OLD_DOMAINS:-}" ]; then echo "$OLD_DOMAINS" > "$CFG/old-domains"; elif [ -s "$CFG/old-domains" ]; then OLD_DOMAINS=$(cat "$CFG/old-domains"); fi
reload_nginx() { systemctl reload nginx 2>/dev/null || nginx -s reload; }
if command -v clpctl >/dev/null; then
  CLP=1
  if [ -z "${DOMAIN:-}" ]; then
    D=$(ls -d /home/*/htdocs/*jashore360* 2>/dev/null | head -1 || true)
    DOMAIN=$(basename "${D:-}")
  fi
  [ -n "$DOMAIN" ] || { warn "CloudPanel-এ jashore360 নামের সাইট পাওয়া যায়নি। DOMAIN=yourdomain.com দিয়ে আবার চালান।"; exit 1; }
  find_conf() { grep -ls "server_name[^;]*[[:space:]]$1[[:space:];]" /etc/nginx/sites-enabled/* 2>/dev/null | head -1 || true; }
  CONF=$(find_conf "$DOMAIN")
  if [ -z "$CONF" ]; then
    say "CloudPanel-এ $DOMAIN সাইট তৈরি করা হচ্ছে"
    SU=$(echo "$DOMAIN" | tr -cd 'a-z0-9' | cut -c1-24)
    clpctl site:add:static --domainName="$DOMAIN" --siteUser="$SU" --siteUserPassword="$(openssl rand -hex 10)Aa1" >/dev/null 2>&1 || true
    CONF=$(find_conf "$DOMAIN")
  fi
  [ -n "$CONF" ] || { warn "$DOMAIN এর সাইট পাওয়া যায়নি। CloudPanel → Sites → + Add Site → Create a Static HTML Site → Domain Name: $DOMAIN দিয়ে সাইট বানিয়ে এই কমান্ড আবার চালান।"; exit 1; }
  say "CloudPanel সাইট $DOMAIN অ্যাপের সাথে যুক্ত করা হচ্ছে"
  BK="/root/jashore360-vhost-backup-$(date +%Y%m%d%H%M%S).conf"
  cp "$CONF" "$BK"
  python3 "$APP/server/cloudpanel_vhost.py" "$CONF" "$PORT"
  if nginx -t -q 2>/dev/null; then
    systemctl reload nginx 2>/dev/null || nginx -s reload
  else
    cp "$BK" "$CONF"
    warn "nginx নতুন কনফিগ গ্রহণ করেনি — আগের অবস্থায় ফেরানো হয়েছে। নিচের লেখার স্ক্রিনশট পাঠান:"
    nginx -t || true; exit 1
  fi
  if ! openssl x509 -in "/etc/nginx/ssl-certificates/$DOMAIN.crt" -noout -issuer 2>/dev/null | grep -qi "let's encrypt"; then
    say "SSL সার্টিফিকেট (Let's Encrypt)"
    clpctl lets-encrypt:install:certificate --domainName="$DOMAIN" --subjectAlternativeName="www.$DOMAIN" \
      || clpctl lets-encrypt:install:certificate --domainName="$DOMAIN" \
      || warn "SSL হয়নি — Hostinger DNS-এ $DOMAIN এর A রেকর্ড 72.62.198.94 আছে কি না দেখুন, তারপর CloudPanel → Sites → $DOMAIN → SSL/TLS থেকে Let's Encrypt চালান"
    nginx -t -q 2>/dev/null && (systemctl reload nginx 2>/dev/null || nginx -s reload) || true
  fi
  if openssl x509 -in "/etc/nginx/ssl-certificates/$DOMAIN.crt" -noout -issuer 2>/dev/null | grep -qi "let's encrypt" \
     && openssl x509 -in "/etc/nginx/ssl-certificates/$DOMAIN.crt" -noout -checkend 0 >/dev/null 2>&1; then
    python3 "$APP/server/cloudpanel_vhost.py" "$CONF" "$PORT" https      # valid certificate: send http visitors to https
    if nginx -t -q 2>/dev/null; then reload_nginx; else python3 "$APP/server/cloudpanel_vhost.py" "$CONF" "$PORT"; fi
    NEW_OK=1
  else
    SSL_WARN="SSL সার্টিফিকেট এখনো ঠিক হয়নি — সাইট ও Android অ্যাপ https ছাড়া ঠিকমতো চলবে না। Hostinger DNS-এ $DOMAIN ও www.$DOMAIN এর A রেকর্ড 72.62.198.94 কি না দেখুন, তারপর CloudPanel → Sites → $DOMAIN → SSL/TLS → Actions → New Let's Encrypt Certificate চাপুন, তারপর এই কমান্ড আবার চালান।"
  fi
  # REMOVE_OLD=1: the move is finished (the admin dashboard shows no phones on the old address) — delete the old sites.
  if [ "${REMOVE_OLD:-}" = 1 ] && [ -n "${OLD_DOMAINS:-}" ]; then
    if [ "${NEW_OK:-}" != 1 ]; then
      warn "$DOMAIN এর SSL এখনো ঠিক হয়নি — পুরনো ঠিকানা মোছা হলো না"
    else
      for OD in $(echo "$OLD_DOMAINS" | tr ',' ' '); do
        [ "$OD" = "$DOMAIN" ] && continue
        say "পুরনো ঠিকানা $OD মুছে ফেলা হচ্ছে"
        OC=$(find_conf "$OD")
        [ -n "$OC" ] && cp "$OC" "/root/jashore360-vhost-backup-$OD-$(date +%Y%m%d%H%M%S).conf"
        clpctl site:delete --domainName="$OD" --force >/dev/null 2>&1 || true
        if [ -n "$(find_conf "$OD")" ]; then
          LEFT=1; warn "$OD নিজে থেকে মোছা গেল না — CloudPanel → Sites → $OD → Delete থেকে মুছে দিন, তারপর এই কমান্ড আবার চালান"
        fi
      done
      nginx -t -q 2>/dev/null && reload_nginx || true
      if [ -z "${LEFT:-}" ]; then OLD_DOMAINS=""; rm -f "$CFG/old-domains"; REMOVED=1; fi
    fi
  fi
  # Old domains: browsers go to the new domain (only once its SSL works); the installed app is still served.
  for OD in $(echo "${OLD_DOMAINS:-}" | tr ',' ' '); do
    [ "$OD" = "$DOMAIN" ] && continue
    OC=$(find_conf "$OD")
    [ -n "$OC" ] || { warn "$OD এর সাইট পাওয়া যায়নি — বাদ দেওয়া হলো"; continue; }
    say "পুরনো ঠিকানা $OD → $DOMAIN"
    OBK="/root/jashore360-vhost-backup-$OD-$(date +%Y%m%d%H%M%S).conf"
    cp "$OC" "$OBK"
    if [ "${NEW_OK:-}" = 1 ]; then python3 "$APP/server/cloudpanel_vhost.py" "$OC" "$PORT" --move-to="$DOMAIN"
    else python3 "$APP/server/cloudpanel_vhost.py" "$OC" "$PORT" https; warn "$DOMAIN এর SSL ঠিক না হওয়া পর্যন্ত $OD আগের মতোই চলবে"; fi
    if nginx -t -q 2>/dev/null; then reload_nginx; else cp "$OBK" "$OC"; warn "$OD এর কনফিগ বদলানো যায়নি — আগের অবস্থায় রাখা হলো"; fi
  done
  URL="https://$DOMAIN"
else
  command -v nginx >/dev/null || { apt-get update -qq && apt-get install -y -qq nginx; }
  cat > /etc/nginx/sites-enabled/jashore360.conf <<NGINX
server {
    listen 80;
    server_name ${DOMAIN:-_};
    client_max_body_size 100m;
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
# ---------------------------------------------------------------- Android app
# base.apk is built from android/ in the repo; here it gets this site's URL and is signed with a
# key that is created on this server (/root/jashore360-signing) and never leaves it.
if [ -f "$APP/android/base.apk" ] && [ -n "${CLP:-}" ] && [ "${NEW_OK:-}" != 1 ]; then
  warn "SSL ঠিক না হওয়া পর্যন্ত নতুন অ্যাপ (APK) বানানো হয়নি — আগের অ্যাপ আগের মতোই চলবে"
elif [ -f "$APP/android/base.apk" ]; then
  say "অ্যান্ড্রয়েড অ্যাপ (APK)"
  if ! command -v apksigner >/dev/null || ! command -v zipalign >/dev/null || ! command -v keytool >/dev/null; then
    (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq apksigner zipalign default-jre-headless) >/dev/null 2>&1 || true
  fi
  VNAME=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["versionName"])' "$APP/android/version.json")
  VCODE=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["versionCode"])' "$APP/android/version.json")
  VNOTES=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("notes",""))' "$APP/android/version.json")
  OUTAPK=$(mktemp --suffix=.apk)
  if python3 "$APP/server/sign_apk.py" "$APP/android/base.apk" "$OUTAPK" "$URL/app/" /root/jashore360-signing "${OLD_DOMAINS:-}" 2>/tmp/jashore360-apk.log; then
    chmod 644 "$OUTAPK"
    sudo -u "$SVC_USER" python3 "$APP/server/server.py" --data "$DATA" import-apk "$OUTAPK" "$VNAME" "$VCODE" "$VNOTES" \
      && systemctl restart "$SVC" || warn "APK যোগ করা যায়নি"
  else
    warn "APK সাইন করা যায়নি (বিস্তারিত: /tmp/jashore360-apk.log)। বাকি সব ঠিকঠাক চলছে; অ্যাডমিন প্যানেল → অ্যাপ থেকে নিজে APK আপলোড করতে পারবেন।"
  fi
  rm -f "$OUTAPK"
fi

[ "${RELOAD:-}" = 1 ] && (nginx -t -q && (systemctl reload nginx 2>/dev/null || nginx -s reload)) || true

echo
[ -n "${SSL_WARN:-}" ] && warn "$SSL_WARN"
[ "${REMOVED:-}" = 1 ] && say "পুরনো ঠিকানা সার্ভার থেকে বাদ দেওয়া হয়েছে — এখন শুধু $DOMAIN চলছে। Hostinger-এ পুরনো ডোমেইনের auto-renew বন্ধ করে দিতে পারেন।"
echo "════════════════════════════════════════════"
echo " ✅ Jashore360 চালু হয়েছে"
echo "    অ্যাপ:          $URL"
echo "    অ্যাডমিন প্যানেল: $URL/admin"
echo "    APK ডাউনলোড:     $URL/download/jashore360.apk"
if [ -n "$CREDS" ]; then
  echo
  echo " 🔑 অ্যাডমিন লগইন (এখনই কোথাও লিখে রাখুন):"
  printf '%s\n' "$CREDS" | sed 's/^/    /'
  echo "    (/root/jashore360-admin.txt ফাইলেও রাখা আছে। লগইনের পর পাসওয়ার্ড বদলে নিন)"
else
  echo "    অ্যাডমিন লগইন আগের মতোই আছে। প্রথম পাসওয়ার্ড: cat /root/jashore360-admin.txt"
fi
echo "════════════════════════════════════════════"
