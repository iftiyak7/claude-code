#!/usr/bin/env bash
# Builds android/base.apk (unsigned). Needs Ubuntu packages:
#   apt install android-sdk-platform-23 aapt dalvik-exchange openjdk-17-jdk-headless
# The server installer adds assets/config.json, zipaligns and signs it on the VPS.
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_SDK:-/usr/lib/android-sdk}
JAR=$SDK/platforms/android-23/android.jar
DX=$(ls "$SDK"/build-tools/*/dx | head -n1)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

mkdir -p "$OUT/gen" "$OUT/classes"
aapt package -f -m -J "$OUT/gen" -M AndroidManifest.xml -S res -I "$JAR"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$JAR" \
  -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java')
"$DX" --dex --min-sdk-version=21 --output="$OUT/classes.dex" "$OUT/classes"
aapt package -f -M AndroidManifest.xml -S res -I "$JAR" -F base.apk
(cd "$OUT" && aapt add -k "$OLDPWD/base.apk" classes.dex >/dev/null)

vname=$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' AndroidManifest.xml)
vcode=$(sed -n 's/.*android:versionCode="\([^"]*\)".*/\1/p' AndroidManifest.xml)
printf '{"versionName": "%s", "versionCode": %s}\n' "$vname" "$vcode" > version.json
echo "built base.apk v$vname ($vcode)"
