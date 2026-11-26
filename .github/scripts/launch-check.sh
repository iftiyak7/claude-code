#!/usr/bin/env bash
# Install an APK on the running emulator, open it, and fail if the app died.
# Usage: launch-check.sh <apk> <package>
set -u
APK=$1
PKG=$2

adb install -r "$APK"
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1
sleep 40
adb logcat -d > logcat.txt
adb exec-out screencap -p > screen.png || true

echo "---- crash lines ----"
grep -E "FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|Hermes|Error:|Exception|libc .*Fatal|DEBUG +: " logcat.txt | grep -v "^.*W/.*StrictMode" | head -150

if adb shell pidof "$PKG" > /dev/null; then
  echo "App is running after 40 s"
else
  echo "::error::App is not running — it crashed on launch"
  exit 1
fi
