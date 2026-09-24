# Victron Solar Forecast v2.8.5 — Cerbo GX / Venus OS 3.80 Large

Pachet pentru sistem Victron Solar Forecast Controller: MultiPlus-II monofazat pe L2, ESS compensare NET trifazat, Hailei/PACE CAN device instance 512. Node-RED 4.1.11. Nu a fost testat pe un Cerbo fizic; testele sunt simulate. Importul nu incepe descarcarea.

## Actualizare v2.8.5 — SOC taper si FORCE

- Normal: SOC 90-95% -> plafon 20 A.
- Peste 95% -> maxim 15 A, cu scadere liniara la 0 A la 100%: aprox. 96%=12 A, 97%=9 A, 98%=6 A, 99%=3 A.
- `/force <A> [minute]`: `/force 50 15` = 50 A pentru 15 minute; `/force 50` = 50 A pentru 15 minute implicit.
- FORCE ocoleste numai plafonul SOC si target/forecast. Max-cell/delta, BMS CCL, watchdog/telemetrie si Grid Guard raman active.
- Protectiile brute raman: 3.40/3.43/3.45 V -> 10/5/2 A; delta >=50 mV cu max>=3.40 V -> 2 A; stop 3.50 V sau delta >=100 mV cu max>=3.40 V; reluare dupa 60 s safe.
- Helperul de descarcare nu se reinstaleaza: `bridge.py` si `install.sh` nu s-au schimbat.

## Actualizare de la v2.8.3 — corectie plafon 10 A
Eroarea era plafonul global temporar activ la orice SOC, inclusiv FORCE100. In v2.8.4 este dezactivat implicit. SOC <90% nu declanseaza taper SOC; la 90% plafonul este 10 A, la 95% 5 A, la 98% 2 A. Pragurile pe celule raman independente: max-cell >=3.40 V poate limita la 10 A chiar sub 90% SOC; limita scade la 5 A la 3.43 V si la 2 A la 3.45 V. Acestea sunt praguri preventive, sub pragul de oprire 3.50 V.

Daca helperul v2.8.3 este deja instalat, NU necesita reinstalare SSH: bridge.py si install.sh sunt identice. Salveaza un export al flow-ului curent. Opreste o eventuala descarcare cu /discharge off si confirma inactiv. Inlocuieste flow-ul cu JSON v2.8.4 (aceleasi ID-uri), pastreaza tokenurile/setarile locale si nu rula doua controlere. La CONFIG verifica explicit commissioningChargeCapEnabled: false, inclusiv daca ai copiat configuratia veche. Deploy, verifica /cells in DRY RUN, apoi ENABLE CONTROL si /limits. /cells trebuie sa arate Plafon temporar 10 A: INACTIV. Daca ramane 10 A, trimite /cells, /limits si /battery: pot exista alte limite active. Curentul real nu este garantat egal cu plafonul DVCC.

## Fisiere
- `flows/Victron_Solar_Forecast_Charge_Controller_v2_8_5.json`: flow complet, porneste DRY RUN.
- `service/bridge.py`: client local + serviciu independent de Node-RED pentru descarcare.
- `service/install.sh`: instalare serviciu si pornire la boot; nu descarca bateria.

## Instalare
1. Descarca si dezarhiveaza ZIP-ul pe PC. Pastreaza exportul flow-ului instalat pentru revenire.
2. Prin WinSCP/SCP copiaza `service/bridge.py` si `service/install.sh` in `/data/solar-discharge/` pe Cerbo (creeaza directorul ca root).
3. Prin SSH, ca root pe Cerbo:

```sh
sh /data/solar-discharge/install.sh
```

Installerul verifica python3/dbus, utilizatorul nodered si svc. Instaleaza un serviciu supervizat in `/service/solar-discharge` si adauga pornirea in `/data/rc.local`, pastrand celelalte comenzi si o copie a fisierului anterior. Nu reinstaleaza Node-RED si nu modifica setarile ESS/BMS. Daca lipseste o dependinta, se opreste si afiseaza cauza.

4. Dezactiveaza vechiul tab de control si importa flow-ul JSON nou. Daca Node-RED propune inlocuirea nodurilor cu aceleasi ID-uri, inlocuieste-le. Nu rula doua copii ale controlerului sau doua pollere pentru acelasi bot. Verifica tokenurile HA/Telegram si selectia bateriei in nodurile Victron.
5. Deploy. Asteapta 15-30 secunde. Verifica `/health`, `/cells`, `/discharge status`. Helperul trebuie sa raspunda cu stare IDLE si fara eroare. IDLE verifica prezenta helperului; verificarea completa D-Bus se face la pornirea unei comenzi. DRY RUN nu scrie DVCC.
6. Pastreaza manual limita DVCC de tensiune managed battery la 54.0 V conform discutiei despre dezechilibru. Flow-ul nu o scrie/verifica.
7. Apasa ENABLE CONTROL. Pentru prima verificare practica: `/discharge 5 1 50`, numai daca SOC actual este peste 50% si datele sunt normale. Vezi `/discharge status` dupa 5-10 secunde. Testul dureaza maximum un minut; curentul poate sa nu ajunga la 5 A inainte de expirare din cauza rampei sau limitelor ESS.
8. Verifica revenirea la stare TIME_REACHED/SOC_REACHED si lipsa sesiunii active. `/discharge off` poate opri oricand o sesiune.

## Comenzi

| Comanda | Actiune |
|---|---|
| `/discharge 20 30` | 20 A DC din baterie, max 30 min, SOC implicit 30% |
| `/discharge 20 120 50` | 20 A DC, max 120 min sau SOC 50%, primul atins |
| `/discharge 20 soc 50` | Pana la SOC 50%, cu limita suplimentara 120 min |
| `/discharge status` | Cerere, curent real, SOC, setpoint, motiv oprire |
| `/discharge off` | Anuleaza exportul fortat si revine la ESS normal |
| `/cells` | Praguri si starea protectiei de incarcare |

Intervale acceptate: 1-50 A DC, 1-240 minute, SOC 20-95%. Pragul efectiv SOC nu coboara sub minimum ESS/limita activa BatteryLife. Curentul este o tinta aproximativa de reglaj, nu un curent AC si nici un plafon fizic instantaneu garantat. Puterea DC de descarcare a Multi este limitata suplimentar la 3000 W (include aportul DC PV); setpointul NET cerut este limitat intre -12000 si 0 W. Limitele instalatiei pot impiedica atingerea curentului cerut.

O comanda noua anuleaza FORCE si tinta manuala de incarcare. In timpul sesiunii este cerut DVCC 0 prin singurul writer existent; comenzile noi de incarcare sunt refuzate pana la oprire. /pause sau dezactivarea locala anuleaza sesiunea la urmatorul heartbeat. Dupa oprire, strategia de incarcare revine la forecast.

## Protectii la descarcare

- Helperul foloseste doar overrideuri VOLATILE `com.victronenergy.hub4 /Overrides/Setpoint` si `/Overrides/MaxDischargePower`; nu modifica setpointul permanent, minSOC sau modul ESS. La final elibereaza overrideurile la null/-1, revenind la setarile normale.
- Necesita ESS net trifazat (Hub4Mode 1) si self-consumption, DESS oprit, fara incarcare programata activa, fara override existent si fara setpoint permanent negativ. Nu preia automat setari folosite de alte automatizari.
- Opreste la SOC, timp, lipsa retea, BMS deconectat, DCL 0, tensiune pack<=50V, min-cell<=3.10V, temperatura in afara 5-45C, date invalide, restart serviciu ESS sau conflict de scriere.
- DCL in scadere reduce plafonul. Curent observat peste DCL+1A opreste cererea; depasirea tintei cu >5A timp de 10s opreste cererea.
- Heartbeat la 5s, lease15s. Fara heartbeat valid, helperul anuleaza sesiunea independent de Node-RED. Timere monotone. Intervalul efectiv de reactie include timpii D-Bus si raspunsul invertorului.
- Jurnal de proprietate in `/run/solar-discharge` (RAM). Supervisorul reporneste helperul dupa crash; acesta incearca eliberarea overrideurilor proprii. Nu reia niciodata o sesiune veche. La restart complet Cerbo, overrideurile sunt volatile si flow-ul revine DRY RUN.
- Daca D-Bus nu accepta eliberarea, raporteaza RESTORE_PENDING si reincerca. Daca cineva modifica overrideurile, nu le suprascrie orbeste; raporteaza conflict. Nu folositi simultan alti writeri ESS/DESS.
- Oprirea exportului fortat NU interzice descarcarea normala spre consumatorii casei. Bateria poate continua sa alimenteze casa dupa stop.
- Readback confirma setarea, nu puterea fizica. Citirile repetate nu detecteaza un driver care republica masuratori vechi. BMS si ESS raman protectii independente. Nu poate garanta recuperare daca supervisorul, helperul si D-Bus devin indisponibile simultan.

## Incarcare pastrata din 2.8.2
Plafonul global temporar 10 A este INACTIV implicit (`commissioningChargeCapEnabled: false`); numai valoarea booleana true il activeaza. Sub 90% SOC, fara alte limitari, curentul cerut de strategia normala trece nemodificat. SOC>=90% reduce de la 10A spre 2A la 98%. Max-cell brut>=3.40/3.43/3.45V limiteaza 10/5/2A. Delta>=50mV cu max>=3.40V limiteaza 2A. Stop la max>=3.50V sau delta>=100mV cu max>=3.40V. Reluare dupa max<=3.43V si delta<=50mV stabile 60s. Date max/min/SOC invalide sau vechi>20s cer 0A. Protectiile se aplica si FORCE. DRY RUN/pause nu scriu DVCC; BMS ramane independent.

Salvarea energiilor ramane la 5min, HA la 60s, fara scrieri de heartbeat pe flash. Tokenurile/configuratia provin din exportul furnizat; daca exportul are placeholder, completeaza-le local.

## Diagnostic local, fara pornirea descarcarii

```sh
python3 /data/solar-discharge/bridge.py probe
svstat /service/solar-discharge
```

`probe` citeste datele D-Bus pentru bateria 512. Daca serviciile/path-urile necesare nu exista, nu porni descarcarea si trimite eroarea. Un status IDLE singur nu valideaza toate path-urile.

Oprire explicita din SSH:

```sh
python3 /data/solar-discharge/bridge.py client eyJhY3Rpb24iOiJzdG9wIn0
```

## Revenire
Mai intai `/discharge off` si confirma sesiune inactiva/fara RESTORE_PENDING. Dezactiveaza tabul nou, reactiveaza vechiul flow si ENABLE CONTROL daca este DRY RUN. Helperul inactiv nu modifica ESS. Pentru oprirea serviciului: `svc -d /service/solar-discharge`; pentru a nu porni la boot elimina numai linia marcata `solar-discharge-watchdog` din `/data/rc.local` si legatura `/service/solar-discharge`, dupa confirmarea opririi sesiunii.

## Validare efectuata
Compilarea tuturor functiilor Node-RED, referinte noduri/wires, un singur writer DVCC; 23 scenarii charge guard plus integrare CCL/DRY RUN; 22 scenarii pentru helper plus verificare recuperare jurnal; autorizare Telegram, validare argumente, comenzi SOC/timp, anulare la stale DCL sau helper indisponibil. Testele folosesc D-Bus simulat, nu hardware real.

## Surse tehnice verificate
- https://github.com/victronenergy/venus/wiki/dbus (hub4 overrideuri, ESS state, date baterie)
- https://github.com/victronenergy/dbus-systemcalc-py/blob/master/delegates/dynamicess.py (override null/-1 la dezactivare, cap DC cu aport PV)
- https://www.victronenergy.com/live/ess:ess_mode_2_and_3 (semantica setpointului de retea)

Teste de regresie v2.8.4: CONFIG real, SOC 51% la cereri 50/100 A si FORCE100, praguri SOC, setare absenta/text/true, protectii celule si interlock descarcare; toate trecute in simulare.


## Configuratie GitHub-safe
In repository nu se pastreaza IP-ul local Home Assistant, chat ID-ul Telegram sau tokenuri reale. Flow-ul livrat foloseste placeholder pentru `haUrl` si `telegramChatId`; tokenurile/chat ID-ul se pot furniza prin `SOLAR_HA_TOKEN`, `SOLAR_TELEGRAM_TOKEN`, `SOLAR_TELEGRAM_CHAT_ID`. Completeaza URL-ul HA local dupa import sau mentine o copie locala necomisa.
