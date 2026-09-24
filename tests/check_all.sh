#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
python3 -m unittest discover -s tests -v
node tests/test_flow_syntax.js
node tests/test_charge_guard.js
python3 tests/secret_scan.py
sh -n service/install.sh
python3 -m py_compile service/bridge.py
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  git diff --check
fi
