# Activare control Huawei v2 — 2026-10-13

## Stare operationala (aprox. 11:22 EEST, Romania)

Trecerea de la automatizarea HA veche la controlerul Huawei v2 STAGED s-a efectuat fara schimbarea limitelor BMS, ESS, DVCC sau a fluxurilor Cerbo Node-RED.

- `automation.prioritate_baterii_hailei_huawei_control_descarcare`: **off** (controler vechi)
- `automation.huawei_v2_control_staged_disabled`: **on** (controler nou; sufixul "disabled" este ramas in entity_id/alias istoric)
- `input_boolean.huawei_v2_permitere_control`: **on** (interblocare)
- `automation.huawei_v2_test_anti_import_shadow_fara_comenzi`: **on** (simulator / diagnostic)
- Configuratia HA: `valid=true`, zero erori.
- Comanda reala `number.batteries_maximum_discharging_power_2`: **0 W** in primul test real.
- Prag Huawei end-of-discharge: **15%**; limita ESS Hailei: **10%**; PACE ramane BMS de control.

## Verificare de teren la activare

- SOC Hailei (Cerbo, sursa PACE): 27%
- SOC Huawei: 80%
- Fronius pe L2: cca. 0.9 kW; Huawei PV: cca. 0.46 kW
- Baterie Hailei: cca. +0.88 kW, incarcare; baterie Huawei: cca. +0.71 kW, incarcare
- Flux retea Shelly: aproape 0 W (fluctuatii usoare)
- Shadow: `HAILEI_CHARGING | P=0W`, contor anti-import 0.
- Trace live `automation.huawei_v2_control_staged_disabled`: ambele conditii de interblocare trecute (`permitere_control=on`, vechiul controller `off`), `valid=true`, `report_age < 75s`, `safe=false` din cauza incarcarii bateriilor, `command=0`, finalizat fara eroare.

## Limitele concluziei

Activarea si executia in siguranta in conditii de incarcare sunt confirmate. **Nu este inca validata** functionarea reala anti-import cu Huawei descarcand, deoarece la test bateriile se incarcau si controllerul a blocat in mod intentionat descarcarea. La prima ocazie cu import stabil >250 W, baterie Hailei neincarcata si baterie Huawei neincarcata, se vor urmari puterea ceruta, puterea reala Huawei, fluxul de retea, semnul curentilor, exportul si protectia anti-transfer.

## Revenire / oprire de urgenta

1. `input_boolean.huawei_v2_permitere_control` -> off (blocheaza executiile de control v2).
2. `automation.huawei_v2_control_staged_disabled` -> off.
3. Readuceti `number.batteries_maximum_discharging_power_2` la **0 W** daca este nenul (verificati intai starea reala a bateriilor).
4. `automation.prioritate_baterii_hailei_huawei_control_descarcare` -> on doar dupa ce noul controller este oprit.
5. Pastrati shadow activ pentru observare daca este util.

Atentie: butonul de permitere control OFF **nu** reseteaza automat puterea deja scrisa, fiind o conditie de intrare in automatizare. Asigurati resetarea explicita la 0 W la rollback in cazul unei comenzi ramase nenule.

Aceasta nota consemneaza verificarea initiala, nu un test de sarcina complet sau dovada ca nu este posibil un transfer prin reteaua AC.
