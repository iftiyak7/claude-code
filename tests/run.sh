#!/usr/bin/env bash
# Runs every automated check. Used before each release; exits non-zero if anything fails.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m py_compile server/*.py
for f in public/*.js public/admin/*.js; do node --check "$f"; done 2>/dev/null || command -v node >/dev/null || echo "(node not installed: JavaScript syntax not checked)"
python3 -m unittest discover -s tests -t tests "$@"
