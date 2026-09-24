# Baseline diff — supplied v2.8.4 archive and current repository

## Initial GitHub baseline (v2.8.4)

The supplied archive was parsed structurally before repository publication.

- Same number and ordering of Node-RED nodes as the supplied v2.8.4 flow.
- The initial repository baseline changed only the CONFIG node (`2589328ae93145db`) for publication sanitization:
  - Home Assistant local URL -> `http://HOME_ASSISTANT_IP:8123` placeholder.
  - Telegram owner/chat ID -> `PASTE_TELEGRAM_CHAT_ID` placeholder.
- Existing environment-variable overrides remained in place:
  - `SOLAR_HA_TOKEN`
  - `SOLAR_TELEGRAM_TOKEN`
  - `SOLAR_TELEGRAM_CHAT_ID`
- `service/bridge.py` and `service/install.sh` match the supplied v2.8.4 baseline byte-for-byte; see `SOURCE_PROVENANCE.md`.

## v2.8.5 intentional logic changes

Compared structurally with the published v2.8.4 repository baseline:

- Node count remains 102 and node IDs remain in the same order.
- Seven existing nodes change; no new runtime Node-RED node IDs are introduced.
- Runtime changes are limited to:
  - CONFIG values for the new SOC taper and FORCE defaults;
  - charge guard SOC taper behavior;
  - Telegram `/force` argument order, help/status text and diagnostics;
  - version/comment labels.
- Normal SOC taper is now 20 A from 90% through 95%; above 95% it starts at 15 A and falls linearly to 0 A at 100%.
- `/force <A> [minute]` uses amps first. FORCE bypasses only the SOC-derived cap; raw cell/delta protection, BMS CCL, watchdog/telemetry, DVCC gate and NET Grid Guard remain active.
- Existing raw cell safety thresholds are unchanged: max-cell 3.40/3.43/3.45 V -> 10/5/2 A; delta >=50 mV with max-cell >=3.40 V -> 2 A; stop at max-cell >=3.50 V or delta >=100 mV with max-cell >=3.40 V.
- Forecast, energy persistence and forced-discharge helper logic are not intentionally changed.
- `service/bridge.py` and `service/install.sh` remain byte-for-byte identical to the supplied v2.8.4 files.
