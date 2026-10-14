# v2.8.12 — Hailei se incarca din surplus, fara blocare prin rezerva Huawei

Data: 2026-10-14. Baza: feature/victron-2.8.11-huawei-read-confirmation. Export de test, disabled / DRY RUN; nu este instalare automata pe Cerbo.

## Problema confirmata
Raport real: SOC Hailei11%, LUNA71%, putere Huawei+2895W cu semn descarcare-1 (deci LUNA incarca), BMS CCL145A/celule3.030–3.051V fara stop. AUTO_HUAWEI_RESERVE reducea plafonul la0A din cauza unei rezerve memorate la<=10%, cu reluare abia la>=20%. Aceasta regula amesteca prioritatea descarcarii cu permisiunea de incarcare si poate impiedica recuperarea SOC.

## Schimbarea
- Rezerva10/20% si selectorul HA de prioritate descarcare nu mai impun DVCC0A. Sunt metadate pentru diagnostic; controllerul Huawei HA separat isi pastreaza responsabilitatea descarcarii.
- SOC Huawei si helperul prioritate sunt optionale pentru permisiunea de incarcare Hailei. SOC local Cerbo/PACE, BMS si puterea reala LUNA raman necesare.
- LUNA incarcand sau in repaus permite incarcarea Hailei, sub plafonul real din surplus si celelalte protectii.
- LUNA descarcand peste50W cere imediat DVCC0A, chiar daca Hailei nu a inceput inca sa incarce.
- Dupa o descarcare detectata, reluare numai la putere de descarcare<=20W (sau incarcare LUNA) stabil15s. Gap de executie>10s / date invalide reseteaza observatia.
- Semn Huawei implicit0, necunoscut: puterea ne-idle blocheaza conservator. Configurati local -1 numai daca ati confirmat pozitiv=incarcare/negativ=descarcare, cum este in raportul utilizatorului. Configurarea nu se ghiceste.
- Puterea Huawei necesita in continuare confirmarea Modbus de la patch-ul instalat: protocol1, read_ok=true, last_successful_read valid si varsta<=150s. Nu pretinde independenta de HA; cititorul direct pe Cerbo este proiect separat, neimplementat aici.
- Transferul invers Hailei->LUNA este doar diagnostic. Userul a dezactivat incarcare Huawei din retea in FusionSolar; acest flux nu modifica setarea si nu presupune ca ea impiedica LUNA->Hailei.

## Boiler / surplus
FreeDS ramane prioritar, fara comenzi sau schimbari de automatizari din acest export. Bugetul foloseste NET Shelly trifazat si curentul Hailei, nu puterea Solcast estimata.

Plafon surplus = MAX(0, FLOOR(MAX(0, I_baterie) - (NET_W + 150W)/(V_baterie * eficienta))).

Plafonul se intersecteaza cu strategia, BMS, celule, temperatura, Grid Guard si watchdog. Curentul existent este inclus pentru a nu numara puterea deja absorbita de baterie ca fiind pierduta. Boilerul este deja in NET: nu i se scade puterea a doua oara. Marja150W permite o rezerva de export; nu este dovada provenientei PV. Datele de curent/tensiune/faze trebuie sa fie fresh<=20s; absenta/fault/date viitoare/config invalid=>plafon0.

Exemple simulate:
- NET export2077W,48.71V,I0: plafon41A cu eficienta0.95 si marja150W, apoi celelalte limite.
- NET import341W,I0.6A: plafon0.
- NET export150W,I20A: buget20A, fara dubla numarare.
Echilibrul FreeDS/ESS trebuie verificat live pentru tranzitorii/oscilatii. Nu pretinde arbitrare unica cu FreeDS; acesta are propriul regulator. Modul manual/temperatura tinta boilerului nu sunt modificate.

## Protectii pastrate
Normal/FORCE100 stop celula3.52V si TOP_DELTA_STOP; BALANCE<=2A, stop3.55V limitat de alarma/protectia configurata. BALANCE la max>=3.50V cu delta>50..<100mV permite max1A. Delta>=100mV cu max>=3.40V opreste. Pack, CCL/CVL, temperatura, watchdog, telemetrie, interlock descarcare si observatia fizica dupa DVCC0 raman.

Pragul BALANCE3.55V coincide cu alarma PACE cunoscuta: nu garanteaza evitarea alarmei. Acest export nu modifica BMS, ESS, tensiunea chargerului sau SOC. /force, /force100 si /balance nu ocolesc blocarea la descarcare LUNA ori bugetul surplusului real.

## Limite reale
ZeroA este un plafon DVCC cerut, nu dovada opririi fizice. Detectia depinde de intervalul citirii Huawei/REST si raspunsul actuatorului; transferuri tranzitorii sau sub pragul50W pot ramane. Nu se poate promite absenta absoluta a energiei LUNA->Hailei doar prin software si masuratori asincrone. Diagnostic fizic separat ramane activ.

## Import si verificare
1. Backup fluxuri/configuratie. Pastrati local tokenuri/env, BMS512, HA entity IDs, calea de energie writable.
2. Importati flows/Victron_Solar_Forecast_Charge_Controller_v2_8_12.json cu ID-uri v212 distincte; disabled/DRY RUN.
3. Verificati PACE ca monitor local, semnul Huawei-1 confirmat si citirile hardware valide. Un writer DVCC si un poller Telegram activ.
4. In DRY RUN, cu LUNA incarcand si Hailei11%, reason trebuie HUAWEI_CHARGING_ALLOWED, chiar daca reserveForDischarge=true. Cu surplus NET bugetul trebuie >0; cu boiler consumand tot surplusul, bugetul poate fi0.
5. Activare control numai dupa verificare. Testati oprirea/reluarea boilerului, LUNA in incarcare/repaus/descarcare, date stale, restart, /force100 si protectiile fara a provoca alarme de celule.
6. /status /limits /health /battery /why raporteaza motivul. /limits si /why includ plafonul surplusului.
7. DRY RUN/dezactivare/pauza nu restaureaza automat DVCC anterior. Daca ramane0, verificati readback si restabiliti manual plafonul valid cu controllerul oprit, pastrand DVCC/BMS.
8. Rollback: dezactivati212, reactivati copia veche; aceasta poate avea din nou AUTO_HUAWEI_RESERVE. Verificati limita efectiva, nu doar starea tabului. Deploy/restart reseteaza controlul si sesiunile.

## Teste
test_v2_8_12_recharge.js reproduce SOC11%/Huawei+2895W/reserve=true si valideaza optionalitatea SOC/helperului, ambele polaritati, read-proof/freshness, descarcarea si reluarea15s, pauza/DRY RUN, FORCE/FORCE100/BALANCE, BMS/celule/temperatura si bugetul NET. 254 asertiuni simulate, incluzand wiring/scopes;45 functii compilate. test_release_balance.js ruleaza suplimentar pe noul export in CI. Testele istorice si patch-ul Huawei raman nemodificate. Verificarea fizica pe Cerbo nu a fost efectuata aici.
