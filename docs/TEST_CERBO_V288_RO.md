# Test Cerbo v2.8.8 — balansare la curent mic

Versiune de test pe balance-bms-limits-v2.8.8, bazata pe v2.8.7. Main ramane v2.8.5. Importul este dezactivat si DRY RUN; nu se instaleaza automat.

## Limite numai pentru /balance
- Plafon sesiune 5 A; treptele existente pe celule, temperatura, CCL si NET pot impune mai putin.
- Plafon pack = MIN(56.00 V, CVL BMS live - 0.10 V, alarma pack configurata - 0.10 V). La atingere se cere 0 A.
- Max celula CERUT 3.56 V, efectiv MIN(cerut, alarma celula - 0.03 V, protectie celula - 0.05 V).
- Cu valorile cunoscute alarma/protectie 3.55/3.60 V, pragul efectiv ramane 3.52 V. 3.56 V NU este activat peste alarma. Nu modifica alarmele BMS ca sa permita acest prag.
- Alarmele sunt snapshoturi configurate local, NU citiri RS485 live si NU dovada valorilor de fabrica. Verifica valorile actuale PACE inainte de CONTROL ON. Pack alarm 56.80 V este valoarea originala raportata de utilizator; daca actual este 56.20 V, configureaza valoarea actuala.
- Dupa TOP_DELTA_STOP, numai in /balance: max <=3.48 V, delta <=75 mV, pack <=MIN(55.80 V, plafon pack-0.20 V, CVL-0.20 V), stabile 60 s. Reluarea ramane <=1 A pana la expirarea sesiunii.
- Stop la max >=3.50 V cu delta >50 mV este pastrat: reluarea poate produce alte pauze controlate. 75 mV este o alegere software de test, nu o specificatie EVE/PACE.
- Delta >=100 mV cu max >=3.40 V ramane stop sever; prioritate fata de TOP_DELTA_STOP. Reluare severa max <=3.43 V si delta <=50 mV.
- Regim normal si /force100 nu folosesc limitele speciale /balance. Niciun SOC/PACE setting nu este scris.

## Tensiune: limita de oprire, nu setpoint
Flow-ul scrie numai plafonul de curent DVCC. Nu scrie MaxChargeVoltage/CVL si nu mentine pack la tensiune constanta. Limita de oprire software nu garanteaza absenta overshooturilor.
Documentatia Victron limiteaza optiunea Limit managed battery charge voltage la balansarea initiala Pylontech 15S; nu o activam automat pentru Hailei:
https://www.victronenergy.com/media/pg/Cerbo_GX/en/configuration.html

Observatia full foloseste pack >=55.95 V (56 V cu toleranta software 50 mV), sub plafon, SOC raportat 100%, delta <=30 mV, curent real 0..<2 A, timp 180 s. Nu calibreaza SOC. Daca CVL reduce plafonul sub aceasta zona, nu se declara finalizare. Durata sesiunii 1..120 minute nu garanteaza balansarea.

Balansare PACE este NECONFIRMATA: niciun indicator RS485 nu este conectat la acest flow. Balance raw=0 trebuie verificat separat in proiectul ESP32. Starea sesiunii nu inseamna balancer activ.

## Instalare si test
1. Exporta flow-ul functional si pastreaza CONFIG local (HA/Telegram, entitati, calea de energie care permite scriere).
2. Importa v2.8.8 cu ID-uri distincte. Pastreaza tab dezactivat pana cand flow-ul vechi este dezactivat. Un singur controller/poller/writer activ.
3. Copiaza setarile locale, fara secrete in GitHub. Verifica alarmele configurate cu citirile PACE actuale.
4. Activeaza tabul, Deploy, pastreaza DRY RUN si verifica /health /cells /battery.
5. CONTROL ON local, surplus solar, /balance 30. Urmareste plafon calculat, DVCC citit, curent real, max/min, delta si PACE.
6. /balance off revine forecast, NU este oprire universala. /pause suspenda scrierile, poate lasa ultimul plafon DVCC.
7. Rollback: dezactiveaza noul tab, reactiveaza numai flow-ul anterior, Deploy, verifica modul si DVCC.

## Validare
Teste simulate pentru pipeline planner/guard/writer, telemetrie, CCL/CVL, temperatura, NET import, limite celule, latch, gapuri, expirare/scop sesiune, autorizare Telegram si clipping 3.56 V. Nu inlocuiesc testarea fizica pe Cerbo.
