#!/usr/bin/env bash
# Builds the Android app from android/ in two forms, both unsigned and without the site's own files:
#   base.apk  — the app people download from the website (package cloud.jashore360.app)
#   base.aab  — the App Bundle for Google Play (package com.jashore360.app)
# Needs Ubuntu packages:
#   apt install aapt android-sdk-platform-23 dalvik-exchange openjdk-17-jdk-headless
# The server installer adds assets (site address, app files, today's data) and signs them on the VPS
# (server/sign_apk.py and server/sign_aab.py).
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_SDK:-/usr/lib/android-sdk}
JAR=$SDK/platforms/android-23/android.jar
DX=$(ls "$SDK"/build-tools/*/dx | head -n1)
PLAY_PACKAGE=com.jashore360.app
PLAY_MIN_SDK=24
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

vname=$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' AndroidManifest.xml)
vcode=$(sed -n 's/.*android:versionCode="\([^"]*\)".*/\1/p' AndroidManifest.xml)

# resources: compiled once, linked twice with the same ids (the code refers to them by number)
aapt2 compile --dir res -o "$OUT/res.zip"
mkdir -p "$OUT/gen" "$OUT/classes"
aapt2 link -o "$OUT/res.apk" --manifest AndroidManifest.xml -I "$JAR" --java "$OUT/gen" \
  --emit-ids "$OUT/ids.txt" "$OUT/res.zip"
# Google Play's automatic protection needs Android 7 (API 24) or newer; the website APK still runs on Android 5+.
sed 's/android:minSdkVersion="[0-9]*"/android:minSdkVersion="'"$PLAY_MIN_SDK"'"/' AndroidManifest.xml > "$OUT/PlayManifest.xml"
aapt2 link --proto-format -o "$OUT/proto.zip" --manifest "$OUT/PlayManifest.xml" -I "$JAR" \
  --stable-ids "$OUT/ids.txt" --rename-manifest-package "$PLAY_PACKAGE" "$OUT/res.zip"

# code
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$JAR" \
  -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java')
"$DX" --dex --min-sdk-version=21 --output="$OUT/classes.dex" "$OUT/classes"

# website APK: resources + code
cp "$OUT/res.apk" base.apk
python3 - "$OUT/classes.dex" <<'EOF'
import sys, zipfile
with zipfile.ZipFile('base.apk', 'a', zipfile.ZIP_DEFLATED) as z:
    z.write(sys.argv[1], 'classes.dex')
EOF

# Google Play bundle
python3 make_aab.py "$OUT/proto.zip" "$OUT/classes.dex" base.aab

notes=$(python3 -c 'import json;print(json.load(open("version.json")).get("notes",""))' 2>/dev/null || true)
python3 - "$vname" "$vcode" "$PLAY_PACKAGE" "$notes" <<'EOF'
import json, sys
vname, vcode, pkg, notes = sys.argv[1:5]
json.dump({'versionName': vname, 'versionCode': int(vcode), 'notes': notes, 'playPackage': pkg},
          open('version.json', 'w'), ensure_ascii=False)
open('version.json', 'a').write('\n')
EOF
echo "built base.apk and base.aab v$vname ($vcode)"
