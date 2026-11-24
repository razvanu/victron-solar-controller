# Changelog

Toate modificarile notabile ale proiectului sunt documentate aici.

## B2 v0.1 — 2026-11-24 (branch feature/b2-l2-setpoint-dryrun, DRY RUN)

- Flow separat `flows/B2_L2_Grid_Setpoint_v0_1.json`: `AcPowerSetPoint` (L1) = exportul de pe L2 − 50 W, pentru ESS „Individual phase” (`Hub4Mode = 2`); date locale de pe dbus, fără Home Assistant.
- Limite: max 3000 W și min(CCL, 100 A) × U; 0 la date L2 > 10 s, BMS deconectat, CCL 0, SOC ≥ 98 %; în LIVE și la `Hub4Mode ≠ 2`.
- Uzură flash: scriere la schimbare ≥ 100 W, cel mult o dată la 30 s (scădere la 0 / ≥ 500 W: min. 5 s). Simulare 15–24.11: ~20–60 scrieri/zi senină, ~100–160/zi cu nori.
- DRY RUN implicit (nepersistent): nu scrie nimic, numără scrierile pe care le-ar fi făcut; ENABLE manual, refuzat fără `Hub4Mode = 2`; din LIVE în DRY RUN → 0.
- Teste: `tests/test_b2_l2_setpoint.js` (42 verificări); `test_flow_syntax.js` include și flow-ul B2.
- Ghid: `docs/B2_L2_SETPOINT_RO.md`. Generator: `tools/build_b2_flow.py`.

## v2.8.13 — 2026-11-20 (branch fix/winter-surplus-degraded)

- Baseline v2.8.12 exact ca pe Cerbo (`flows/..._v2_8_12.json`, valori locale inlocuite cu placeholderi).
- Date Huawei valide din `last_reported`/`last_updated` (≤ 120 s, configurabil), fara atributele `huawei_read_*`.
- Mod degradat ANTI-TRANSFER: 5 min gratie, apoi plafon numai din PV Victron (AC-OUT); alerta Telegram la intrare/iesire.
- Surplus-first: cat timp exista export si nu e import, plafon 100 A sub limitele BMS/celule/taper; plafon rezidual fara export permanent.
- Faze configurabile `victronPhase` / `huaweiPhase` (implicit L1 / L3).
- `activeAfterRestart` optional (implicit false = DRY RUN).
- `/why` si `/limits`: mod anti-transfer, sursa plafonului, surplus disponibil.
- Teste: `tests/test_v2_8_13.js` (cod real din flow, simulat); `test_bridge.py` sare numai fara `fcntl` (Windows).
- Ghid: `docs/V2_8_13_DEPLOY_RO.md`.

## Unreleased — public-release preparation

- Added public Home Assistant + Solcast setup documentation with exact v2.8.5 entity mappings, units, P10/P50/P90 semantics, freshness limits and REST authentication.
- Documented the three reference daily-PV entities and four cumulative energy counters, including how other installations should replace them.
- Rewrote README/operations text to remove stale v2.8.4 instructions and clarify current FORCE behaviour.
- Added MIT license, public-release security checklist and GitHub Actions test workflow.
- No controller or helper runtime logic changed in this documentation release.

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
