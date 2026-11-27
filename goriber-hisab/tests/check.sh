#!/bin/bash
# Everything that must pass before a release (also run by GitHub on every push).
# Usage: bash goriber-hisab/tests/check.sh
set -e
cd "$(dirname "$0")/.."
echo "== PHP syntax"
find src templates goriber-hisab.php -name '*.php' -print0 | xargs -0 -n1 php -l > /dev/null
echo "== JavaScript syntax"
for f in $(find assets/js -name '*.js' ! -name 'sticker-pdf.js'); do node --input-type=module --check < "$f"; done
node --check assets/js/sticker-pdf.js
echo "== Bangla translations file"
node -e "JSON.parse(require('fs').readFileSync('assets/i18n/bn.json','utf8'))"
echo "== Tests"
php tests/run.php
