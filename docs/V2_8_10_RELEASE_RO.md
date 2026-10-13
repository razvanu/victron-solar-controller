# v2.8.10 — anti-transfer și BALANCE actualizat

Data: 2026-10-13. Export de test pentru review; nu este deploy automat. Ramură: feature/victron-2.8.10-anti-transfer-release, PR #6.

## Schimbări integrate
- Interlock HA pentru prioritatea bateriilor, în același writer DVCC.
- Automat: Hailei <=10% intră în rezerva Huawei; >=20% revine la Hailei.
- Doar Huawei / Fără descărcare cer DVCC 0 A. Date de prioritate/SOC lipsă sau mai vechi de 150 s cer 0 A.
- ID-uri, wires și scope-uri catch/status reparate și validate.
- BALANCE preia modificările 2.8.9: maximum 2 A, stop solicitat 3.55 V/celulă.
- La cererea utilizatorului, **numai în BALANCE**, max >=3.50 V cu delta >50 și <100 mV poate continua cu maximum 1 A; TOP_DELTA_STOP rămâne în normal și FORCE100.
- Delta >=100 mV cu max >=3.40 V rămâne oprire severă. BMS, CCL/CVL, pack, temperatură, watchdog, Grid Guard și interlock descărcare rămân active.
- Textul Telegram pentru începutul BALANCE nu mai afișează vechiul plafon 31 A.

## Tensiuni / curent
BALANCE: stop celulă MIN(3.55 V, alarma configurată minus marja, protecția configurată minus 0.05 V). Capturi PACE: alarmă 3.55 V, protecție 3.60 V; marja față de alarmă este explicit 0 V. **Oprirea coincide cu alarma; nu garantează evitarea alarmei/overshoot-ului.** Aceasta este politică software cerută, nu o procedură EVE/PACE certificată.

Normal și FORCE100: stop max 3.52 V; max >=3.50 V cu delta >50 mV oprește. Normal SOC 90–95% max20 A; >95% max15 A cu scădere spre0. FORCE de curent ocolește doar ținta/taperul SOC, nu protecțiile.

Pack BALANCE: MIN(56.00 V, CVL CAN live -0.10 V, alarma pack configurată -0.10 V). Snapshot conservator alarmă pack 56.20 V din capturile utilizatorului; verificați setarea actuală. Aproape de plafon pack: max1 A. Temperatură <=0 sau >=50 C:0 A.

Reluare normală: max <=3.48 V, delta <=30 mV, pack <=MIN(55.80, stop pack-0.20, CVL-0.20), stabil60 s. După delta severă: max <=3.43 V, delta <=50 mV. După un TOP_DELTA_STOP memorat și trecere în BALANCE: delta <=75 mV cu restul condițiilor normale, stabil60 s; apoi max1 A până la expirare.

## Comenzi
- /force100 [minute]: țintă100%, plafon din surplus NET; implicit360 min, maximum1440 min. Nu este100 A.
- /balance 120: țintă100%, sesiune solar-only max120 min; poate continua la SOC afișat100%, maximum2 A și taper final1 A.
- /balance status /cells /battery /limits /health: diagnostic.
- /balance off: revine la forecast. /target auto anulează ținta manuală și FORCE.
- /pause suspendă scrierile și păstrează setarea DVCC existentă; nu este oprire fizică.
- Observația de final BALANCE necesită SOC100%, pack >=55.95 V și sub stop, delta <=30 mV, curent real0..<2 A, temperatură validă, NET<=100 W, continuu180 s. Nu calibrează SOC-ul și nu dovedește capacitatea ori activitatea balancerului PACE.

## Limitări și diferența față de 2.8.11
2.8.10 citește SOC Hailei din entitatea MQTT configurată. Datele HA sunt datate la răspunsul REST; un senzor blocat dar repetat poate părea proaspăt. Puterea Huawei apare în diagnostic, dar nu decide interlock-ul. Nu dovedește transferul energetic și nu confirmă oprirea fizică după DVCC0 A.

[2.8.11](https://github.com/razvanu/victron-solar-controller/blob/feature/victron-2.8.11-telemetry-balance/docs/V2_8_11_RELEASE_RO.md) adaugă timestamp-uri ale senzorilor, SOC local Cerbo, verificarea polarității/puterii Huawei și observația curentului net după DVCC0.

Huawei HA v2 este separat în PR #5: controlează puterea maximă de descărcare Huawei și nu trebuie să scrie DVCC. MQTT -> Telegram este modul separat din #5; trebuie cablat la senderul existent, fără al doilea poller. Nu pretindem livrare verificată pe Cerbo prin prezența fișierului.

## Import / rollback
1. Exportați fluxul funcțional și configurația locală. Dezactivați-l înainte de activarea celui nou.
2. Importați flows/Victron_Solar_Forecast_Charge_Controller_v2_8_10_anti_transfer.json; tab disabled, DRY RUN implicit.
3. Copiați local HA URL, tokenuri/env, chat ID, dispozitivul BMS512, calea writable pentru energie. Snapshot-urile BMS trebuie verificate local; nu sunt registre live.
4. Verificați un singur writer DVCC și un singur getUpdates. Testați DRY RUN și antiTransfer.reason; activați controlul local numai după verificare.
5. Observați puterea reală PACE/BMV, CCL/CVL și fazele. DVCC0 citit nu dovedește curent0.
6. Deploy/restart resetează controlul și sesiunea; nu se reactivează automat.
7. Rollback: dezactivați noul tab, reactivați copia veche și verificați setarea DVCC.

## Teste
check_all.sh include testele istorice, 45 Function nodes, 8 scenarii anti-transfer și 204 aserțiuni BALANCE/wiring. Simulările nu înlocuiesc validarea fizică. Niciun deploy Cerbo/HA nu este efectuat de această publicare.
