# Changelog

Toate modificarile notabile ale proiectului sunt documentate aici.

## v2.8.5 — 2026-09-24

- Schimba sintaxa FORCE la `/force <A> [minute]`; `/force 50 15` inseamna 50 A pentru 15 minute.
- Durata implicita pentru `/force <A>` este 15 minute.
- FORCE ocoleste targetul/forecastul si numai taperul bazat pe SOC; max-cell/delta, BMS CCL, watchdog-ul, telemetria si Grid Guard raman obligatorii.
- Taper normal SOC: 20 A intre 90-95%; peste 95% porneste de la 15 A si scade liniar spre 0 A la 100% (aprox. 96/97/98/99% = 12/9/6/3 A).
- Pragurile de protectie celule raman neschimbate: max-cell 3.40/3.43/3.45 V -> 10/5/2 A; delta >=50 mV cu max-cell >=3.40 V -> 2 A; stop la 3.50 V sau delta >=100 mV cu max-cell >=3.40 V.
- `bridge.py` si `install.sh` sunt neschimbate fata de v2.8.4.

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
