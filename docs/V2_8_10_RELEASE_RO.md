# Propunere release v2.8.10 – anti-transfer Victron / Huawei / Hailei

**Data:** 2026-10-13  
**Statut:** propunere pentru review; export de referinta al versiunii TEST v2.8.10, **nu** instructiune de deploy automat.

## Relatia dintre proiecte

- **Cerbo / Node-RED v2.8.10**: plafon de incarcare DVCC al bateriei Hailei. Un singur nod scrie `MaxChargeCurrent`; nu comanda puterea Huawei.
- **Home Assistant / Huawei v2**: comanda puterea maxima de descarcare Huawei, cu interlock, reglare anti-import si conditii conservative anti-transfer.
- **Telegram**: botul existent din Cerbo; evenimentele Huawei pot veni din HA prin MQTT, folosind modulul separat din [PR #5](https://github.com/razvanu/victron-solar-controller/pull/5). Modulul MQTT->Telegram necesita import si cablare in tabul Node-RED existent; prezenta fisierului pe GitHub **nu** inseamna ca mesajele sunt deja livrate pe Telegram.

Acestea sunt doua controllere **independente**, fiecare cu propria tinta de scriere. Un plafon DVCC de 0 A nu reprezinta o dovada ca incarcarea AC-OUT s-a oprit complet.

## Ce contine exportul v2.8.10

Fisier: `flows/Victron_Solar_Forecast_Charge_Controller_v2_8_10_anti_transfer.json`.

Derivat din exportul v2.8.8 de test furnizat anterior, cu:
1. Referinte HA read-only pentru prioritatea descarcarii, SOC Huawei, puterea bateriei Huawei si SOC Hailei.
2. Stare diagnostic `antiTransfer` (`blocked`, `reason`, `priority`, SOC-uri, putere Huawei).
3. Interlock DVCC in **acelasi writer** existent: `Doar Huawei`, `Fără descărcare`, respectiv modul automat de rezerva Huawei, pot plafona la 0 A. In `Automat`, comutare la Hailei <=10% si revenire la >=20%.
4. Lipsa datelor necesare implica `DATA_MISSING_FAIL_CLOSED` in decizia plafonului.
5. Protectiile BMS/CCL/CVL, celule/delta, FORCE, BALANCE, GRID GUARD si verificarile DVCC raman in cod.

**Remediere strict pentru exportul GitHub:** toate ID-urile `v288_` sunt migrate coerent la `v210_`, inclusiv scope-urile catch/status si doua functii care foloseau ID-uri hardcodate. Exportul local initial v2.8.10 avea aceste referinte ramase; varianta propusa contine reparatia. Aceasta diferenta necesita test in Node-RED dupa import.

## Starea sistemului HA la activarea Huawei v2 (consemnata pe 13 octombrie)

- Huawei v2 CONTROL: activ; vechiul controller Huawei: dezactivat; shadow: activ.
- Victron ESS minimum SOC: 10%; Huawei end-of-discharge: 15%.
- Cerbo foloseste SOC-ul PACE/Hailei; BMV-712 ramane monitor independent.
- La testul initial bateriile **se incarcau**, deci Huawei v2 a comandat 0 W. **Descarcarea efectiva Huawei si bilantul anti-transfer sub import sustained nu sunt inca validate complet.**
- Controlul Huawei nu trebuie sa faca scrieri DVCC; Node-RED ramane singurul writer DVCC.

Vezi si [jurnalul de activare Huawei v2](https://github.com/razvanu/victron-solar-controller/blob/feature/ha-huawei-anti-import-shadow-v2/integrations/huawei-ha-anti-import/ACTIVATION_2026-10-13.md).

## Siguranta la import si teste

- Tabul de export este **disabled** implicit; `enableOutputDefault: false` (DRY RUN).
- Tokenurile HA/Telegram si chat ID-ul sunt **placeholders**. Nu adaugati credentiale in GitHub.
- Nu porniti simultan doua taburi care scriu DVCC.
- Dupa import, verificati dispozitivul BMS in nodurile Victron, nodul unic de iesire DVCC si toate scope-urile de status/catch.
- Testati intai DRY RUN, inspectati `antiTransfer.reason` si puterea reala a bateriilor; abia apoi hotarati mutarea in productie.
- Nu conectati un al doilea `getUpdates` Telegram pentru acelasi bot.
- Nu opriti BMS-ul pentru a ocoli limitele de incarcare/descarcare.

## Teste offline incluse

`node tests/test_v2_8_10_anti_transfer.js` valideaza:
- ID-uri unice, wires/scopes fara referinte inexistente;
- sintaxa tuturor celor 45 functii Node-RED;
- un singur writer DVCC, tab disabled si placeholder-uri;
- 8 scenarii de guard (10/20% SOC, manual, telemetrie lipsa/veche).

**Aceste teste nu inlocuiesc** verificarea in Cerbo si HA cu date fizice.

## Limitari si pasii recomandati pentru v2.8.11

- v2.8.10 nu demonstreaza provenienta energiei folosind putere/curent si productia PV pe fiecare faza; detectia bidirectionala completa necesita testare.
- `entityHaileiSoc` din export pointeaza inca spre senzorul MQTT PACE; evaluati trecerea la `sensor.gx_device_dc_battery_charge` cu detectarea actualizarii datelor.
- Semnul puterii Huawei, erorile de tip stale, anti-import si reluarea dupa restart trebuie confirmate in operare reala.
- `antiTransferStrictHuawei` si `antiTransferHuaweiReserveSoc` exista in configuratie, dar nu definesc singure o interblocare energetica completa.
- Modul MQTT pentru alerte Huawei din PR #5 este **optional**, separat de fluxul v2.8.10, si trebuie conectat la expeditorul Telegram existent, fara duplicarea botului.
