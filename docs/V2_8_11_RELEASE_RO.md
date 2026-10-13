# v2.8.11 — telemetrie, puteri și observația opririi fizice

Data: 2026-10-13. Versiune de test pentru Cerbo GX / Node-RED4.1.11; disabled și DRY RUN la import. Include toate schimbările BALANCE și anti-transfer din 2.8.10 actualizat.

## Diferențe exacte
| Funcție | 2.8.10 actualizat | 2.8.11 |
|---|---|---|
| BALANCE | Max2 A; stop3.55 V; delta >50..<100 mV la max>=3.50 V permite1 A | Identic |
| Normal / FORCE100 | Stop3.52 V și TOP_DELTA_STOP păstrat | Identic |
| SOC pentru comutarea10/20% | Entitate MQTT HA configurată | /Dc/Battery/Soc local Cerbo; MQTT doar diagnostic |
| Prospețime Huawei | Moment REST | last_reported, fallback last_updated; timestamp viitor invalid |
| Eroare HA | Date expiră cu timpul | Date anti-transfer invalidate imediat |
| Putere Huawei | Diagnostic | Interlock conservator; semn configurabil, W/kW normalizat |
| Oprire după DVCC0 | Confirmarea setării | Diagnostic separat al curentului net și alerte Telegram |
| Transfer Hailei -> Huawei | Neconfirmat | Observație posibilă, nu blocare a descărcării/Huawei |
| Writer / BMS | Un writer DVCC; fără scrieri PACE | Identic |

## Anti-transfer
- Moduri HA: Automat, Doar Hailei, Doar Huawei, Fără descărcare. Mod necunoscut/date lipsă/NaN/future/stale ->0 A.
- Automat: Hailei <=10% intră în rezerva Huawei; >=20% iese. SOC Huawei este necesar ca telemetrie validă, dar nu introduce un prag nou de rezervă Huawei. Limitele de80%/15% sunt responsabilitatea controllerului HA separat.
- Prioritatea este helper de selecție: prospețime din REST reușit; nu trebuie să-și schimbe valoarea periodic.
- Pentru SOC și putere Huawei se folosește last_reported sau last_updated. Recuperarea REST nu reînnoiește timestamp-ul senzorului. Dacă REST nu expune last_reported, o valoare neschimbată poate părea veche: asigurați heartbeat/force_update valid în integrare. Nu mărește automat TTL.
- Senzorul putere trebuie să aibă unitatea W sau kW; altă unitate invalidează intrarea.
- SOC și curentul local Cerbo trebuie să fie fresh <=20 s și fără source_faults. **Verificați Battery monitor selectat PACE/Hailei**, nu BMV, înainte de control. Nodurile citesc com.victronenergy.system/0 /Dc/Battery/Soc și /Dc/Battery/Current.
- Config antiTransferHuaweiDischargeSign: implicit0 (necunoscut), configurați +1 dacă puterea pozitivă înseamnă descărcare, -1 dacă negativă înseamnă descărcare. Confirmați cu o descărcare reală, nu din numele entității.
- Cu semn necunoscut, putere Huawei absolută >50 W inhibă conservator încărcarea Hailei. Cu semn confirmat, descărcare Huawei >50 W inhibă încărcarea indiferent dacă Hailei a început deja să încarce. Astfel se evită reluarea imediată doar fiindcă DVCC0 a redus curentul Hailei.
- Dacă Huawei descarcă >50 W și Hailei încarcă >0.5 A, motiv POSSIBLE_HUAWEI_TO_HAILEI_TRANSFER. Este posibilitate, nu dovada provenienței: PV poate încărca simultan.
- Dacă Huawei încarcă >50 W și Hailei descarcă >0.5 A: possibleReverseTransfer=true și alertă. Nu scrie comenzi Huawei și nu oprește descărcarea Hailei; controllerul HA trebuie validat separat.
- Interlock-ul are prioritate față de FORCE, FORCE100 și BALANCE.
- Nu estimează proveniența PV pe fiecare fază și nu garantează absența transferului bidirecțional. Nu inventează senzori PV sau semnul puterii.

## Diagnostic curent net după DVCC0
Un readback egal0 confirmă setarea, nu curentul fizic. Dacă controlul este ON, nu este în pauză și plafonul final este0:
1. Așteaptă readback0 verificat.
2. Așteaptă30 s pentru stabilizare.
3. Observă continuu30 s curentul net local cu telemetrie fresh <=20 s. Gap de execuție >10 s resetează observația.
4. Peste0.5 A: CHARGE_CONTINUES_AFTER_ZERO și eveniment Telegram.
5. <=0.5 A (inclusiv descărcare): NET_CHARGE_STOP_OBSERVED, observație a curentului NET, nu izolare a MultiPlus.

DRY RUN, PAUSED, SETTING_UNCONFIRMED, TELEMETRY_INVALID și CONFIG_INVALID nu confirmă oprirea fizică. O cerere nenulă anulează observația. Warning separat de erorile writerului; nu dezactivează BMS, nu forțează ESS mode3, nu trimite alt setpoint și nu repornește Cerbo. Monitorul nu rezolvă mecanismul încărcării persistente. Nu poate detecta un driver care republică telemetrie hardware înghețată ca nouă.

Telegram /health /battery /limits /status /why afișează diagnostic anti-transfer și fizic. Evenimentele noi folosesc senderul existent; nu adaugă poller sau token.

## BALANCE și protecții
Max2 A pe sesiune, max1 A de la3.50 V/celulă. Numai BALANCE permite delta >50 și <100 mV peste3.50 V; normal/FORCE100 păstrează TOP_DELTA_STOP. Stop sever la delta>=100 mV cu max>=3.40 V. Stop celulă3.55 V limitat de alarma/protecția configurată; normal3.52 V.

Alarmă PACE capturată3.55 V și protecție3.60 V: pragul cerut coincide cu alarma, fără marjă. Nu garantează evitarea alarmei/overshoot-ului. Nu este instrucțiune a producătorului pentru delta acceptabilă. Pack MIN(56 V,CVL-0.10,alarmă pack-0.10); snapshot conservator56.20 V. CCL/CVL/temperatură/watchdog/Grid Guard/interlock descărcare și reluările rămân active. /balance 120 permite continuare la SOC100%; nu scrie/calibrează SOC, nu confirmă balansarea PACE.

## Import / test recomandat
1. Faceți backup; păstrați tokenurile și calea de energie writable local. Nu publicați secrete.
2. Dezactivați tabul vechi. Importați flows/Victron_Solar_Forecast_Charge_Controller_v2_8_11.json; tab disabled/DRY RUN.
3. Copiați maparea HA/Victron, verificați monitorul PACE și snapshot-urile alarmelor. Verificați unitatea și semnul Huawei. Lăsați0 dacă semnul nu este confirmat; încărcarea poate fi inhibată conservator.
4. Verificați /health /limits /cells /battery și antiTransfer.reason în DRY RUN. Nu porniți două controllere DVCC sau pollere Telegram.
5. Control ON local; test de surplus PV, Huawei descărcând, Huawei idle, HA indisponibil, senzor stale, restart și rollback. Nu generați intenționat supratensiune pentru test.
6. Testați observația curentului după DVCC0. O alertă nu dovedește sursa energiei: comparați PACE/BMV și puterile AC-OUT/MPPT.
7. /balance 120; /balance status. Anulare /balance off revine la forecast; /pause doar suspendă scrierile.
8. Rollback: dezactivați211, activați copia funcțională, verificați limita DVCC. Deploy/restart resetează sesiunea/controlul.

## Validare
Testele simulate includ parserul HA, timestamp-uri stale/viitoare, valori nule/NaN, W/kW, ambele polarități, semn necunoscut, SOC local/histerezis, interlock FORCE/FORCE100, pipeline BALANCE la SOC100%, delta60 mV, readback și cronometrele de observație fizică, pauză/DRY RUN/fault/gap și textul Telegram.
Suite: 16 teste Python, teste istorice JS, 204 aserțiuni BALANCE pentru fiecare export, 52 aserțiuni de comportament211 plus sintaxa45 noduri/wiring/scopes și scanarea secretelor. Hardware Cerbo/HA nu este testat prin această publicare.

## Surse / limitări
- Home Assistant last_reported: https://developers.home-assistant.io/blog/2024/03/20/state_reported_timestamp/
- State object: https://www.home-assistant.io/docs/configuration/state_object/
- Victron DVCC: https://www.victronenergy.com/media/pg/CCGX/en/dvcc---distributed-voltage-and-current-control.html
DVCC poate să nu aplice plafonul PV->baterie pentru MPPT când exportul surplusului DC este activ. Fără scrieri noi de tensiune charger/ESS/BMS; remedierile fizice necesită diagnostic al instalației.
