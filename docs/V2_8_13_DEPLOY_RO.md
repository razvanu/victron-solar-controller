# v2.8.13 — import, verificare si revenire

Fisier de import: `flows/Victron_Solar_Forecast_Charge_Controller_v2_8_13.json`
(numai tab-ul controllerului, aceleasi ID-uri `v212_*` ca v2.8.12, deci Node-RED propune **Replace**).

Versiunea porneste in **DRY RUN** si ramane asa dupa orice restart (`activeAfterRestart: false`).
Activarea controlului o decide proprietarul.

## Ce se schimba fata de v2.8.12

| Zona | v2.8.12 | v2.8.13 |
| --- | --- | --- |
| Date Huawei | valide numai cu atribute `huawei_read_*` (integrare modificata) | valide daca `state` e numeric si `last_reported`/`last_updated` are cel mult 120 s (`huaweiDataMaxAgeMs`) |
| Date Huawei lipsa | `HUAWEI_POWER_OR_LOCAL_DATA_INVALID` → 0 A | 5 min gratie (ultima decizie valida), apoi plafon numai din PV Victron; revenire automata |
| Surplus | 50 A normal; 70/100 A doar la SOC mic si export ≥ 2,5/4 kW; plafonul rezidual lasa ~300 W export | cat timp exista export si nu e import: plafon 100 A, apoi limitele BMS/celule/taper; plafonul rezidual urca pana dispare exportul |
| Faze | comentarii „Victron L2” | `victronPhase: "L1"`, `huaweiPhase: "L3"` configurabile |
| Restart | DRY RUN | DRY RUN implicit; optional `activeAfterRestart: true` |
| `/why`, `/limits` | — | mod anti-transfer, sursa plafonului, surplus disponibil, faze |

Neschimbate: Grid Guard, CCL BMS, taper celule/pack, taper SOC 90–100 %, oprire la temperatura (≤0 °C / ≥50 °C),
watchdog/readback DVCC, singurul writer DVCC. Fluxul nu scrie setpoint ESS si nici ForceCharge.

## 1. Inainte de import (backup)

1. Node-RED → meniu → **Export** → tab-ul `TEST v2.8.12 ANTI-TRANSFER - DRY RUN` → **Download**.
   Pastreaza fisierul local (contine token-uri: nu il urca nicaieri).
2. Optional, pe Cerbo (numai citire/copie): `cp -a /data/home/nodered/.node-red/flows.json /data/home/nodered/.node-red/flows.json.bak-before-v2813`.
3. Din nodul **CONFIG v2.8.12** noteaza local cele 4 valori ale instalatiei:
   `haUrl`, `haToken`, `telegramBotToken`, `telegramChatId`.
   Daca token-ul botului Telegram a fost expus, genereaza unul nou din BotFather (`/revoke`) si foloseste-l pe cel nou.

## 2. Import → Replace → valori locale → Deploy

1. Node-RED → meniu → **Import** → selecteaza fisierul v2.8.13 → **Import**.
2. La mesajul despre noduri existente alege **Replace** (nu „Import copy”).
3. Pune valorile locale **intr-una** din variante:
   - recomandat: tab → **Edit properties** → **Environment variables**:
     `SOLAR_HA_URL`, `SOLAR_HA_TOKEN` (tip *credential*), `SOLAR_TELEGRAM_TOKEN` (*credential*), `SOLAR_TELEGRAM_CHAT_ID`;
   - sau direct in nodul **CONFIG** (`haUrl`, `haToken`, `telegramBotToken`, `telegramChatId`).
   Un import viitor cu Replace inlocuieste si tab-ul, deci valorile trebuie puse din nou.
4. Verifica in CONFIG: `victronPhase: "L1"`, `huaweiPhase: "L3"`, `enableOutputDefault: false`, `activeAfterRestart: false`.
5. **Deploy** (Full).

## 3. Verificare in DRY RUN (Telegram)

Asteapta 2–3 minute (HA se citeste la 60 s), apoi:

- `/why` — prima parte trebuie sa arate:
  - `Mod ANTI-TRANSFER: NORMAL` (date Huawei valide). Daca apare `GRATIE` sau `DEGRADAT`, vezi motivul din aceeasi linie.
  - **nu** trebuie sa mai apara `HUAWEI_POWER_OR_LOCAL_DATA_INVALID`.
  - `Surplus-first: ACTIV` cand exista export; `Sursa plafonului: ...`; `Surplus disponibil ... W`.
- `/limits` — aceleasi linii, plus CCL/CVL/celule si „Plafon surplus NET ramas”.
- `/phases` — `L1 (Victron)`, `L3 (Huawei)`.

In DRY RUN nu se scrie DVCC; `/why` arata ce ar fi scris.

## 4. Activare (decizia proprietarului)

Injecteaza **ENABLE CONTROL** in tab. Dupa 1–2 minute: `/limits` → „Ultima scriere” si „DVCC citit” egale, „Confirmat DA”.

Atentie la automatizarile de paza din Home Assistant care scriu `number.gx_device_ess_max_charge_current = -1`
cand senzorul de heartbeat Node-RED lipseste: v2.8.13 nu publica acel heartbeat. Cu controlul activ,
o astfel de automatizare ar intra in conflict cu singurul writer DVCC. Dezactiveaza-le (sau adapteaza-le) inainte de activare.

## 5. Revenire

1. Node-RED → **Import** fisierul exportat la pasul 1 → **Replace** → **Deploy**; sau
2. pe Cerbo: `cp -a /data/home/nodered/.node-red/flows.json.bak-before-v2813 /data/home/nodered/.node-red/flows.json`
   si `svc -t /service/node-red-venus`.
3. Controlul porneste in DRY RUN; DVCC ramane la ultima valoare scrisa pana la o noua scriere.
