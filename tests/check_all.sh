#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
python3 -m unittest discover -s tests -v
node tests/test_flow_syntax.js
node tests/test_charge_guard.js
node tests/test_force_command.js
node tests/test_pace_top_charge.js
node tests/test_balance_bms_limits.js
node tests/test_v2_8_10_anti_transfer.js
node tests/test_release_balance.js Victron_Solar_Forecast_Charge_Controller_v2_8_10_anti_transfer.json Victron_Solar_Forecast_Charge_Controller_v2_8_11.json
node tests/test_v2_8_11_telemetry.js
node tests/test_huawei_read_confirmation.js
python3 deployment/huawei-read-confirmation/custom_components/huawei_solar/test_read_confirmation.py
python3 tests/secret_scan.py
sh -n service/install.sh
python3 -m py_compile service/bridge.py
if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  git diff --check
fi
