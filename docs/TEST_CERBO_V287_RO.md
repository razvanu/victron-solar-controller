# Test Cerbo — v2.8.7 PACE top charge

Aceasta este o versiune de test, pe ramura pace-top-charge-v2.8.7. Nu modifica SOC, praguri PACE, ESS sau bridge.py. Main ramane v2.8.5.

## Ce schimba

- Protectie pe date brute proaspete (maximum 20 s): stop max-cell >=3.52 V; pack >=min(56.10 V, CVL BMS).
- La max-cell >=3.50 V permite maximum 1 A numai daca delta <=50 mV. Delta >50 mV in aceasta zona opreste si memoreaza oprirea.
- Delta >=100 mV cu max-cell >=3.40 V ramane oprire.
- Taper celula la 3.45/3.47/3.49/3.50 V: 10/5/2/1 A. Pack >=55.90 V: maximum 1 A.
- Reluare dupa oprire top/pack: max-cell <=3.48 V, delta <=30 mV, pack <=min(55.80 V, CVL-0.20 V), stabile 60 s.
- Dupa oprire delta >=100 mV: max-cell <=3.43 V si delta <=50 mV, plus aceeasi limita pack, stabile 60 s.
- Telemetrie invalida/invechita, BMS deconectat, CCL zero, temperatura <=0 sau >=50 C: 0 A. Respecta intotdeauna limitele BMS.
- Regimul normal ramane 50 A cu boost-ul existent; taper SOC normal 20 A la 90–95%, apoi 15 spre 0 A.
- Tinta manuala 100% are plafon SOC minimum 1 A cat timp SOC <100%, pentru a evita rotunjirea la zero inainte de tinta. Celelalte limite pot impune zero.

## Mod temporar pentru balansare/sincronizare

- /balance 60: maximum 60 minute; durata permisa 1–120 minute.
- /balance status: informatii sesiune si observatie.
- /balance off: anuleaza sesiunea, revine la forecast.
- /target auto, alta tinta, /force sau /discharge inlocuiesc sesiunea.
- /balance este permis numai proprietarului chatului privat, cu CONTROL ON, fara pauza si cu telemetrie/readback sanatoase.
- Sesiunea foloseste surplusul NET trifazat si plafon maximum 31 A (sub 0.1 C pentru 314 Ah), apoi taper pe celule/pack. Nu programeaza incarcare din retea; tranzitoriile dintre esantioane raman posibile.
- Sesiunea poate continua si cand PACE raporteaza SOC 100%, fara a modifica acest SOC.
- Cand PACE raporteaza 100%, pack >=56.00 V, curent real 0..<2 A, delta <=30 mV si NET <=100 W, controllerul observa aceste conditii continuu 180 s. Apoi cere 0 A pana la expirarea/anularea sesiunii.
- Cele 180 s sunt o alegere software pentru observatie, nu un timp de sincronizare PACE confirmat.
- Curentul limitat sau lipsa soarelui nu demonstreaza singure incarcarea completa. Starea finala inseamna conditii observate, nu validare a capacitatii sau calibrare efectuata de controller.
- Nu necesita descarcare pana la pragul minim; nu reseteaza contorul de cicluri.

## Praguri din capturile furnizate

Cell OV alarm/protection/release: 3.55/3.60/3.35 V; pack OV alarm/protection: 56.20/57.60 V.
Balance start voltage/delta: 3.40 V/30 mV. Full charge voltage/current: 56.00 V/2 A.
Decodarea provizorie a registrelor nu a fost verificata independent fata de aplicatia oficiala PACE. Nu s-au modificat pragurile BMS. Marjele software nu garanteaza eliminarea alarmelor.
Flow-ul nu citeste separat registrele de alarma PACE; protejeaza dupa tensiune/celule/temperatura si CCL/conexiune.

## Import si test

1. Salveaza exportul fluxului functional si valorile CONFIG, inclusiv calea de energie care functioneaza deja. Nu publica tokenurile.
2. Descarca flows/Victron_Solar_Forecast_Charge_Controller_v2_8_7.json de pe aceasta ramura si importa ca flux nou. Are ID-uri separate si tab dezactivat implicit.
3. Copiaza setarile HA/Telegram si energyStateBase din fluxul functional. Sunt suportate SOLAR_HA_URL, SOLAR_HA_TOKEN, SOLAR_TELEGRAM_TOKEN, SOLAR_TELEGRAM_CHAT_ID si SOLAR_ENERGY_STATE_BASE. Nu reveni la o cale care a dat EACCES.
4. Dezactiveaza fluxul vechi inainte sa activezi tab-ul nou si sa faci Deploy. Un singur controller si un singur poller Telegram trebuie sa ruleze. Noul CONFIG porneste in DRY RUN.
5. Verifica /health, /battery si /cells; confirma BMS instance 512 si sursa SOC din Cerbo = Hailei/PACE. Verifica limitele/calea, apoi activeaza CONTROL ON local.
6. Cu surplus solar si sub supraveghere, trimite /balance 30 pentru primul test. Urmareste /balance status, /cells, /battery, /grid.
7. Pentru revenire: /balance off, dezactiveaza tab-ul nou, reactiveaza numai fluxul vechi si Deploy. CONFIG poate reveni in DRY RUN la deploy; confirma modul explicit.

Nu folosi /pause ca oprire de urgenta: suspenda scrierile si pastreaza limita DVCC anterioara.
Nu schimba pragurile PACE ca sa dispara o alarma.

## Verificari

59 de asertiuni JS: praguri/delta, stare memorata si reluare, telemetrie veche, temperatura, CCL, interlock descarcare,
autorizare Telegram, timp limitat, conditii full doar observate, reset la intreruperea observatiei,
integrare planner -> guard -> writer la SOC100 si oprire la import NET.
Toate cele 45 de noduri Function sunt compilate. Un singur writer DVCC; firele nu au tinte inexistente.
Rulare: node tests/test_pace_top_charge.js. Testele nu inlocuiesc verificarea fizica pe Cerbo.
