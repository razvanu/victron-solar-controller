# Baseline diff — supplied v2.8.4 archive vs repository flow

Comparison was performed structurally after parsing both Node-RED JSON files.

- Same number and ordering of nodes.
- Only one node differs: `CONFIG v2.8.4 - Telegram complet + DVCC verification` (`2589328ae93145db`).
- Changes inside that node are publication sanitization only:
  - Home Assistant local URL -> `http://HOME_ASSISTANT_IP:8123` placeholder.
  - Telegram owner/chat ID -> `PASTE_TELEGRAM_CHAT_ID` placeholder.
- Existing environment-variable overrides remain in place:
  - `SOLAR_HA_TOKEN`
  - `SOLAR_TELEGRAM_TOKEN`
  - `SOLAR_TELEGRAM_CHAT_ID`
- No forecast, Grid Guard, FORCE, DVCC gate, charge-guard, energy-persistence or discharge-control algorithm was intentionally changed.
- `service/bridge.py` and `service/install.sh` match the supplied v2.8.4 baseline byte-for-byte; see `SOURCE_PROVENANCE.md`.
