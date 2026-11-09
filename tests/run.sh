#!/usr/bin/env bash
# Runs every automated check. Used before each release; exits non-zero if anything fails.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m py_compile server/*.py server/j360/*.py
for f in public/*.js; do node --check "$f"; done; for f in public/js/*.js public/admin/js/*.js; do node --input-type=module --check < "$f" || { echo "syntax error in $f"; exit 1; }; done 2>/dev/null || command -v node >/dev/null || echo "(node not installed: JavaScript syntax not checked)"
if python3 -m pyflakes --version >/dev/null 2>&1; then python3 -m pyflakes server tests; else echo '(pyflakes not installed: names not checked)'; fi
python3 -m unittest discover -s tests -t tests "$@"
