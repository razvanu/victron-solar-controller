# Huawei + Hailei anti-import — Home Assistant (subproiect)

> **Stadiu: STAGING / SHADOW — 13 octombrie 2026.** Noua automatizare de control NU este activată. Automatizarea veche continuă să controleze Huawei. Nu folosiți două automatizări care scriu simultan `number.batteries_maximum_discharging_power_2`.

Acest subproiect este separat logic de **Victron Solar Forecast Controller** pentru Cerbo GX/Node-RED. Nu scrie DVCC, ESS minimum SOC sau parametrii BMS. Repo-ul este comun doar pentru versionare și documentație.

## Arhitectura live și configurația nouă

- **Vechi, ACTIV:** `automation.prioritate_baterii_hailei_huawei_control_descarcare`, id `065039e3-5838-448d-83e8-796c22687ac5`.
- **Nou, ACTIV numai în simulare:** `automation.huawei_v2_test_anti_import_shadow_fara_comenzi`, id `915b1f2f-8748-49fc-96d3-09d8138cf9f0`. Scrie **exclusiv helperii** `huawei_v2_shadow_*`.
- **Nou, DEZACTIVAT:** `automation.huawei_v2_control_staged_disabled`, id `18e79a77-d2e7-4da3-b990-1b00231620d9`. Necesită în plus `input_boolean.huawei_v2_permitere_control=on` și automatizarea veche `off`. În prezent permisiunea este **off**.
- **Controlul de încărcare Victron** rămâne în Node-RED 2.8.10; **un singur DVCC writer**. BMS-ul PACE rămâne autoritatea finală pentru CCL, DCL, CVL, celule și alarmare.
- SOC sursă: **PACE prin Cerbo GX**, `sensor.gx_device_dc_battery_charge`; BMV-712 rămâne monitor secundar. ESS fără BatteryLife și Minimum SOC de 10%.

## Entități de intrare

| Funcție | HA entity | Interpretare |
|---|---|---|
| SOC Hailei (PACE → GX) | `sensor.gx_device_dc_battery_charge` | % |
| SOC Huawei | `sensor.batteries_state_of_capacity_2` | % |
| Hailei P, I, V | `sensor.gx_device_dc_battery_power`, `sensor.gx_device_dc_battery_current`, `sensor.gx_device_dc_battery_voltage` | **P/I pozitive = încărcare** |
| Huawei P, I, V (bus) | `sensor.battery_2_charge_discharge_power`, `sensor.battery_2_bus_current`, `sensor.battery_2_bus_voltage` | **P/I pozitive = încărcare** (verificat și cu contoarele de energie); descărcarea cu semn negativ necesită confirmare pe interval real |
| Grid NET | `sensor.shellypro3em_fce8c0d9b740_total_active_power` | **+ import, − export** |
| Fronius PV L2 | `sensor.fronius_5kw_power_l2` | W, doar diagnostic / disponibilitate; **nu** autorizează momentan depășirea gardului anti-transfer |
| Prioritate | `input_select.prioritate_descarcare_baterii` | Automat / Doar Huawei / Doar Hailei / Fără descărcare |
| Limită descărcare Huawei | `number.batteries_maximum_discharging_power_2` | **singura comandă de putere** a noului controller staged |

## Praguri v2 (shadow)

- Huawei: oprire preventivă la **≤15,5%**, reluare la **≥17%**; întocmai ca histerezis de limitare software, peste EOD SOC Huawei de **15%**.
- Rezervă Huawei: **80%**, dar anti-import poate coborî până la **15,5%** dacă nu se declanșează gardurile.
- Prioritate Hailei: comutare de urgență la **≤10%**, revenire la **≥20%**.
- Pornire anti-import: grid **>250 W**, 3 cicluri consecutive de 30s (aprox. 60–90s).
- Oprire: grid **<80 W** timp de 4 cicluri de 30s (aprox. 90–120s). La export **<−150 W**, oprire imediată la ciclul de evaluare.
- Rampă anti-import: **±200 W/ciclu**, max. **2000 W**; țintă import rezidual **150 W**. În modul explicit `Doar Huawei` sau `rezervă Hailei activă` se aplică limita prioritară configurată, max. 5000 W.
- **Anti-transfer conservator:** oprește descărcarea Huawei când Hailei încarcă peste **120 W / 2,5 A** ori Huawei este încă în încărcare peste **180 W / 0,5 A**. În stadiul actual poate bloca și încărcarea legitimă din Fronius; acest compromis este intenționat până se validează bilanțul energetic pe faze.
- **Calitatea datelor:** senzorii obligatorii trebuie numerici, raportați în ultimele **90s** (`last_reported`), SOC în 0–100%, iar `P≈V×I` cu toleranță `max(180 W, 40% din |P|)`. Dacă nu, simularea cere **0 W**.
- **Nu se permit încărcări intenționate din rețea**: controlerul staged verifică suplimentar `switch.batteries_charge_from_grid_2=off`.

## Limitări și verificări neîncheiate

1. Testele de politică sunt sintetice; nu au demonstrat încă descărcarea fizică Huawei și semnul curentului în descărcare.
2. Nu există un contor care identifică perfect originea fiecărui watt pe AC; gardul anti-transfer rămâne conservator.
3. O pierdere totală HA nu poate fi corectată de o automatizare HA care nu mai rulează. Limitele BMS și EOD Huawei trebuie să funcționeze independent.
4. Controllerul staged preia **decizia calculată de shadow**; acesta din urmă trebuie să fie activ și sănătos când se face cutover.
5. Nu activa noul controller doar pe baza validării sintactice. Vezi [planul de teste și rollback](TEST_PLAN.md).

## Fișiere

- [shadow-automation.json](shadow-automation.json) — export exact al automatizării de simulare din HA
- [controller-staged-automation.json](controller-staged-automation.json) — export exact al controllerului dezactivat
- [TEST_PLAN.md](TEST_PLAN.md) — testare și pași de migrare fără dual writer

Fișierele JSON reprezintă configurația HA (nu fluxuri Node-RED), și includ identificatori adaptați acestei instalații. Nu conțin parole sau tokenuri.
