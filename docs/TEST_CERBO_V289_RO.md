# v2.8.9 — BALANCE 3.55 V / maximum 2 A

Modificare exclusiv BALANCE: maximum 2 A, oprire la maximum celula >=3.55 V. De la 3.50 V ramane maximum 1 A; limitele mai restrictive au prioritate. Normal/FORCE100 raman cu oprire 3.52 V. Delta >50 mV cu max >=3.50 V si delta >=100 mV cu max >=3.40 V opresc in continuare; nu s-a implementat ocolirea TOP_DELTA_STOP.

Pragul BALANCE este MIN(3.55 V, alarma celula configurata minus marja, protectie configurata minus 0.05 V). Capturile utilizatorului: alarma 3.55 V, protectie 3.60 V; marja fata de alarma este acum explicit 0.00 V la cererea utilizatorului. Pragul de oprire coincide cu alarma: nu garanteaza evitarea alarmei sau a unui overshoot. Configuratiile sunt capturi introduse local, nu citiri dinamice ale registrelor PACE. Nu sunt scrise pragurile PACE.

Pack: MIN(56.00 V, CVL CAN live -0.10 V, alarma pack configurata -0.10 V). Snapshot pack conservator 56.20 V din capturile utilizatorului; verifica valoarea actuala local. Temperatura, CCL, validitatea telemetriei si interlock descarcare raman active.

Controlul cere un plafon DVCC; nu seteaza tensiunea chargerului. DVCC confirmat nu confirma oprirea curentului fizic. Problema de curent pozitiv dupa DVCC0 necesita diagnostic separat. Conform documentatiei Victron, exportul surplusului DC activ poate face ca MPPT sa ignore limita DVCC pentru PV -> baterie:
https://www.victronenergy.com/media/pg/Cerbo_GX/en/dvcc---distributed-voltage-and-current-control.html

Import:
1. Exporta copia functionala si configurația locala. Dezactiveaza vechiul flux; un singur writer DVCC si un singur poller Telegram.
2. Importa noul JSON (ID-uri v289 distincte). Tab dezactivat si DRY RUN implicit.
3. Copiaza URL HA, credențialele locale/env, dispozitivele si calea de energie care functioneaza. Nu pune secrete in GitHub.
4. Verifica /health, /cells, /limits si curentul real PACE/BMV. Controlul se activeaza local.
5. /balance 120; /balance status. /balance off revine la forecast, nu este oprire universala.
6. La Deploy/restart se reseteaza controlul si sesiunea. Nu activeaza controlul automat.
7. Rollback: dezactiveaza v289, apoi reactiveaza copia functionala si verifica DVCC.

Teste: 45 Function nodes compilate si 203 asertiuni simulate (include referinte/ID-uri si limite), nu validare fizica pe Cerbo. Testul nou este inclus in check_all.sh.
