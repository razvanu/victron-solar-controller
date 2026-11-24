# B2 v0.1 – setpoint L1 = exportul de pe L2 (DRY RUN)

Flow separat: `flows/B2_L2_Grid_Setpoint_v0_1.json` (tab „B2 v0.1 L2 -> L1 grid setpoint - DRY RUN”). Generat din `tools/build_b2_flow.py`; testat de `tests/test_b2_l2_setpoint.js` (rulează codul real al nodurilor, simulat).

## De ce

- Faze (măsurate): Victron MultiPlus + Fronius pe **L1**, invertor Huawei 4 kW **doar PV** pe **L2**, Huawei 5 kW + LUNA pe **L3** (LUNA va fi controlată de un agregator extern).
- Ca Victron să nu mai oglindească LUNA (transfer Hailei ↔ LUNA), ESS trebuie pus pe **Multiphase regulation = Individual phase** (`/Settings/CGwacs/Hub4Mode = 2`). Atunci MultiPlus reglează doar L1 și nu mai absoarbe exportul 4 kW de pe L2.
- B2 readuce acel export în Hailei: `AcPowerSetPoint` (setpoint-ul buclei ESS pentru L1) = **exportul de pe L2 − 50 W**, deci L1 importă cât exportă L2 (net 0 la contorul care face suma vectorială), iar MultiPlus încarcă diferența în baterie.
- Totul rulează local pe Cerbo: contorul de rețea vine de pe dbus (`com.victronenergy.system/0 /Ac/Grid/L2/Power`), fără Home Assistant.

## Ce face

| Element | Valoare |
|---|---|
| Intrări | `/Ac/Grid/L2/Power`, `/Settings/CGwacs/Hub4Mode`, `/Settings/CGwacs/AcPowerSetPoint` (citire), BMS 512 `/Info/MaxChargeCurrent` + `/Connected`, system `/Dc/Battery/Soc` + `/Dc/Battery/Voltage` |
| Ieșire (singura) | `/Settings/CGwacs/AcPowerSetPoint` – **doar în LIVE** |
| Țintă | `clamp(−P_L2 − 50 W, 0, min(3000 W, min(CCL, 100 A) × U_bat))` |
| Țintă 0 dacă | date L2 mai vechi de 10 s, `Hub4Mode ≠ 2` (doar în LIVE), BMS deconectat, CCL 0, SOC ≥ 98 %, tensiune invalidă |
| Rampă | +250 W / 5 s (500 W / 10 s) la creștere; scădere imediată |
| Uzură flash | scrie doar la schimbare ≥ **100 W** și cel mult o dată la **30 s**; excepții (min. 5 s): scădere la 0 sau cu ≥ 500 W |
| DRY RUN | implicit după fiecare deploy/restart; calculează tot, **nu scrie nimic**, numără „ar fi scris” pe zi |
| ENABLE (LIVE) | buton manual; refuzat dacă `Hub4Mode ≠ 2`; nepersistent (restart = DRY RUN) |
| DRY RUN din LIVE | scrie o dată 0 |
| Start | dacă `AcPowerSetPoint ≠ 0`: în v0.1 doar avertizare (`RESET_NONZERO_ON_START=false`); pentru LIVE se pune `true` |

Nu scrie DVCC (`MaxChargeCurrent`) și nu schimbă `Hub4Mode`. DVCC/BMS rămân limitele bateriei; controllerul v2.8.13 nu e atins.

## Scrieri estimate (simulare pe istoricul L2, 15–24.11, 07:00–18:00)

| Zi | Export L2 | Variabilitate | 100 W / 30 s | 100 W / 15 s | 200 W / 30 s |
|---|---|---|---|---|---|
| 20.11 (senină) | 5,7 kWh | mică | **58** | 60 | 34 |
| 23.11 (slabă) | 1,2 kWh | mică | 20 | 20 | 8 |
| 22.11 (nori) | 4,2 kWh | mare | **101** | 112 | 46 |
| 24.11 (nori variabili) | 4,9 kWh | foarte mare | **154** | 183 | 107 |

→ cu 100 W / 30 s: **≈ 20–60 scrieri/zi senină, ≈ 100–160/zi cu nori variabili** (pentru comparație: v2.8.13 scrie DVCC, tot o setare persistentă, de ~1000 de ori pe zi). Plafonul teoretic într-o oră cu nori foarte agitați: ~120 (test 12). În DRY RUN contorul `would` din „B2 show counters” dă valoarea reală.

## Import (DRY RUN) – îl face utilizatorul

1. Node-RED pe Cerbo → Import → `flows/B2_L2_Grid_Setpoint_v0_1.json` → **new tab** (nu Replace) → Deploy.
2. Tab-ul nou apare cu status gri „DRY_RUN … ar fi scris azi: N”. Nu se apasă ENABLE.
3. Verificare (doar citire): butonul „B2 show counters” (debug), sau `curl http://127.0.0.1:1880/context/flow/b2l2_00000000` pe Cerbo: `b2_status` (target, reasons), `b2_stats` (would, maxTarget, absorbedWh).
4. Cu `Hub4Mode = 1` (azi) DRY RUN calculează **ca și cum** modul ar fi 2 (statusul arată „(Hub4Mode 1)”), deci contoarele „ar fi scris” sunt reale pentru decizia LIVE. În LIVE, `Hub4Mode ≠ 2` blochează orice scriere (ENABLE refuzat; schimbarea modului în timpul LIVE → setpoint 0).

Rollback DRY RUN: se șterge tab-ul B2 și Deploy. Nu a scris nimic.

## Înainte de LIVE (aprobare separată)

1. Testul de faze (L1 = MultiPlus, L2 = 4 kW) confirmat.
2. `Hub4Mode = 2` setat de utilizator din GX (Settings → ESS → Multiphase regulation → Individual phase); verificat `GetValue`.
3. `RESET_NONZERO_ON_START = true` în CONFIG.
4. Gardă secundară în Home Assistant (poate doar pune setpoint-ul pe 0 + notificare) activă.
5. Primul test LIVE cu `MAX_W = 200` (confirmă că setpoint-ul se aplică pe L1, nu pe total), apoi 3000.

## Riscuri rămase

- Victron nu are timeout pentru `AcPowerSetPoint` în modul 2: dacă Node-RED se blochează ziua cu setpoint > 0 și vine un nor, L1 importă din rețea cel mult `MAX_W` (3000 W) până intervine garda HA / se repornește Node-RED.
- Node-RED + HA căzute împreună: setpoint-ul rămâne până la intervenția manuală (limitat la 3000 W).
- Varianta B3 (`Hub4Mode = 3`, `/Hub4/L1/AcPowerSetpoint` pe vebus, fără flash, cu timeout) acoperă aceste cazuri, dar mută toată reglarea L1 în Node-RED – vezi propunerea plan10 din repo-ul de automatizări HA.
