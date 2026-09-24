# Source provenance — v2.8.4

Original archive: `Victron_Solar_Forecast_v2_8_4(1).zip`

SHA-256 of the four files supplied as the v2.8.4 baseline:

- `README_RO.md`: `7b92f0f8b8c58264df2de39af3590835a09e56dc8907835b14b74700687c07f6`
- `Victron_Solar_Forecast_Charge_Controller_v2_8_4.json`: `a3e8a59d214c24b1c499812b15d1550202dba6a138e2c14438024c681974e440`
- `bridge.py`: `6e3e10b556107d8ecebfe0cb35ea869e0329c6e0f6b7a3dafb5f89ec8e0286c0`
- `install.sh`: `669ba0fed1074688dd2d7d4a8dfaea520a71ec5db968da406c455023f940d873`

Repository organization changes:

- `service/bridge.py` SHA-256: `6e3e10b556107d8ecebfe0cb35ea869e0329c6e0f6b7a3dafb5f89ec8e0286c0` — unchanged from baseline.
- `service/install.sh` SHA-256: `669ba0fed1074688dd2d7d4a8dfaea520a71ec5db968da406c455023f940d873` — unchanged from baseline.
- The flow keeps the original node IDs and logic, with the supplied local Home Assistant URL and Telegram owner/chat ID replaced by placeholders.
- Documentation is reorganized and generalized for repository use.
- Tests are newly added because the supplied archive did not contain the historical simulated regression suite.
