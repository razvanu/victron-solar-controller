# Controller v2.8.13 + B2 v0.3 — DOAR CITIRE pe serverul .60

## De ce

Yellow Grid (Yellow Box) controlează acum Victron-ul: setpoint ESS, DVCC/`MaxChargeCurrent` și `MaxFeedIn`, și dezactivează Node-RED pe Cerbo. Controllerul v2.8.13 și B2 v0.3 nu mai scriu nimic. Rulează pe Node-RED-ul din containerul `solar-dashboard` (CT 102, serverul „.60”) **numai ca să citească și să calculeze**: rapoarte, Telegram, ce ar fi făcut controllerul.

## Ce conține fișierul

`flows/Solar_Controller_DOAR_CITIRE_60.json` este generat de `tools/readonly60/build.py` din `flows/Victron_Solar_Forecast_Charge_Controller_v2_8_13.json` și `flows/B2_Export_Phase_Setpoint_v0_3.json`. Are trei tab-uri:

| Tab | Rol |
|---|---|
| `Victron MQTT bridge (doar citire)` | Se abonează la `N/+/system/0/#`, `N/+/battery/512/#` și `N/+/settings/0/Settings/#` pe Cerbo și pune valorile în `global.vic_cache`. Publică doar pe `R/<portal>/…`: un keepalive la 30 s și cereri de citire pentru cele 27 de chei, la pornire și apoi la 60 s. |
| `Solar Controller v2.8.13 - DOAR CITIRE (.60)` | Controllerul neschimbat, cu aceste înlocuiri: |
| `B2 v0.3 - DOAR CITIRE / calcul (.60)` | B2 neschimbat, cu aceleași înlocuiri. |

Înlocuirile:

- fiecare nod `victron-input-*` devine o funcție `MQTT> …` cu același id și aceleași fire, care emite valoarea din cache la fiecare 2 s;
- fiecare nod `victron-output-*` devine o funcție `BLOCAT (doar citire)` fără ieșiri: ultima scriere refuzată ajunge în `flow.blocked_write_last`;
- nodul `exec` (helperul de descărcare `/data/solar-discharge/bridge.py`) devine o funcție care răspunde `READONLY_NO_HELPER`;
- injecturile ENABLE trimit `false`, `Set controller enable` este forțat pe `false`, iar `activeAfterRestart` este ignorat. Controllerul rămâne în DRY RUN.

Id-urile au prefixele `ro60c_`, `ro60b_` și `ro60_`, deci importul nu se ciocnește cu flow-urile originale.

## Înainte de import

1. Pe Cerbo, MQTT pe rețeaua locală trebuie să fie pornit (Settings → Services → MQTT). Bridge-ul folosește portul 1883, fără TLS. Dacă profilul de securitate al rețelei de pe Cerbo cere conexiune criptată cu parolă, setează în nodul broker portul 8883, TLS și utilizatorul și parola. Nu le pune în repo.
2. Ai nevoie de **PORTAL_ID**: Cerbo → Settings → VRM online portal → VRM Portal ID.
3. Nu modifica nimic pe Cerbo.

## Import pe .60

1. Node-RED pe .60 → meniu → Import → selectează `flows/Solar_Controller_DOAR_CITIRE_60.json` → Import. Nu sunt necesare noduri Victron, doar nodurile MQTT din nucleul Node-RED.
2. Deschide nodul de configurare `Cerbo GX MQTT (ro60) - CERBO_IP` și înlocuiește `CERBO_IP` cu adresa Cerbo.
3. Completează variabilele în proprietățile tab-urilor (dublu-click pe tab → Environment variables):

| Tab | Variabilă | Ce pui |
|---|---|---|
| Victron MQTT bridge | `PORTAL_ID` | VRM Portal ID (în locul lui `COMPLETEAZA`) |
| Solar Controller | `SOLAR_HA_URL` | `http://<ip-home-assistant>:8123` |
| Solar Controller | `SOLAR_HA_TOKEN` | Long-lived token HA (tip *credential*) |
| Solar Controller | `SOLAR_TELEGRAM_TOKEN` | Tokenul botului (tip *credential*) — vezi nota Telegram |
| Solar Controller | `SOLAR_TELEGRAM_CHAT_ID` | Chat ID-ul tău |
| Solar Controller | `SOLAR_ENERGY_STATE_BASE` | Lasă `/data/solar-forecast/daily-energy-v1`. În containerul Node-RED, `/data` este directorul de date (volum persistent); directorul se creează automat. |

4. Deploy.

> **Telegram:** același bot nu poate fi interogat simultan cu `getUpdates` de pe Cerbo și de pe .60. Cele două instanțe își „fură” mesajele, iar Telegram răspunde cu 409 Conflict. Pornește Telegram pe .60 doar dacă flow-ul de pe Cerbo este oprit (Yellow Grid oprește acum Node-RED pe Cerbo). Altfel, folosește un bot separat. Comenzile care ar acționa ceva (`/force`, descărcare etc.) nu au efect pe .60.

## Verificare

1. Tab-ul bridge: nodul `cache global vic_cache` arată `N valori, ultima HH:MM:SS`, cu N de cel puțin 27. Nodul keepalive arată `keepalive … + 27 citiri`. Dacă apare `PORTAL_ID lipsa`, completează variabila.
2. Nodurile `MQTT> …` din controller și B2 sunt verzi și afișează valori. Gri înseamnă că încă nu au venit date, roșu înseamnă date vechi.
3. Controllerul raportează DRY RUN. Nodurile `BLOCAT` arată gri ce ar fi scris.
4. Nimic nou pe topicurile `W/…` ale Cerbo. Opțional: `mosquitto_sub -h <cerbo> -t 'W/#' -v` nu trebuie să afișeze nimic venit de la .60.
5. În repo: `node tools/readonly60/verify.js` afișează `TOATE VERIFICARILE OK`. Rulează și în `tests/check_all.sh` / CI.

## Regenerare

Rulează din rădăcina repo-ului:

```sh
python3 tools/readonly60/build.py \
  flows/Victron_Solar_Forecast_Charge_Controller_v2_8_13.json \
  flows/B2_Export_Phase_Setpoint_v0_3.json \
  flows/Solar_Controller_DOAR_CITIRE_60.json
node tools/readonly60/verify.js
```

`verify.js` rulează generatorul și pică dacă fișierul din repo diferă de rezultat.

## Revenire

Șterge sau dezactivează cele trei tab-uri și nodul broker `ro60`, apoi Deploy. Cerbo nu se schimbă în niciun fel, pentru că bridge-ul doar citește.

## Limitări cunoscute (din verificarea codului, 2026-11-26)

1. **Prospețimea datelor.** Emitatorii retrimit la fiecare 2 s valoarea din cache cât timp aceasta are sub **150 s**. Nodurile `store …` pun `_ts = Date.now()` la fiecare mesaj. Pragul de 20 s din controller verifică deci doar că emitatorul rulează: o valoare veche de până la ~150 s trece drept proaspătă. Cerbo publică `N/` doar la schimbare, iar valorile constante sunt reîmprospătate prin `R/` la 60 s. Corecția propusă: prag de 20 s în emitator și cereri `R/` la cel mult 10 s.
2. **Defectele de conexiune nu se mai înregistrează.** `Store connection faults` caută id-urile originale (`v212_…`), dar nodurile au acum prefixul `ro60c_`. `flow.source_faults` rămâne gol. Pragul de vechime (punctul 1) rămâne singura protecție.
3. Controllerul nu poate fi activat pe .60. Toate scrierile și helperul de descărcare sunt blocate.
