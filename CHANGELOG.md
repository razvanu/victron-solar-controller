# Changelog

Toate modificarile notabile ale proiectului sunt documentate aici.

## [2.8.4] - 2026-09-24

### Fixed
- Plafonul global temporar de 10 A este dezactivat implicit prin `commissioningChargeCapEnabled: false`.
- O setare absenta nu mai activeaza plafonul de commissioning.
- `/cells` raporteaza explicit starea plafonului temporar.

### Repository
- Proiect reorganizat in `flows/`, `service/`, `tests/`, `docs/`.
- Eliminat IP-ul Home Assistant local si Telegram chat ID-ul local din flow-ul destinat GitHub.
- Pastrate variabilele de mediu `SOLAR_HA_TOKEN`, `SOLAR_TELEGRAM_TOKEN`, `SOLAR_TELEGRAM_CHAT_ID`.
- Adaugate teste de regresie direct pe functia reala `RAW CELL STOP + SOC90 taper + optional manual cap` din flow.
- Adaugate verificari statice pentru DRY RUN implicit, writer DVCC unic, persistenta la 5 minute si igiena secretelor.
- `service/bridge.py` si `service/install.sh` sunt byte-for-byte identice cu fisierele din arhiva v2.8.4 furnizata.

## [2.8.3]
- Adaugat helper Python independent pentru descarcare/export fortat.
- Heartbeat 5 s / expirare 15 s; socket Unix local; override-uri ESS volatile.
- Comenzi `/discharge`, oprire sigura si interlock cu incarcarea comandata.

## [2.8.2]
- Protectie pe tensiunile brute min/max ale celulelor.
- Reducere curent la SOC ridicat si comanda `/cells`.

## [2.8.1]
- Energii zilnice masurate, persistenta la 5 minute, diagnostic, Telegram/watchdog si confirmare DVCC.
