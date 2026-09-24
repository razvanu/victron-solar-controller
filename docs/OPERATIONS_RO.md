# Victron Solar Forecast v2.8.5 — ghid de operare

Acest ghid este pentru instalarea de referinta: Cerbo GX MK2 / Venus OS Large, Node-RED 4.1.11, MultiPlus-II, ESS NET trifazat, baterie cu BMS CAN si Home Assistant + Solcast.

Flow-ul porneste in **DRY RUN**. Testele automate sunt simulate; configuratia trebuie verificata pe instalatia reala inainte de a permite scrierea DVCC.

## 1. Inainte de import

1. Fa backup/export la flow-ul Node-RED instalat.
2. Citeste `docs/HOME_ASSISTANT_SOLCAST.md` si configureaza entitatile HA reale.
3. Confirma ca exista `node-red-contrib-victron` si ca nodurile Victron pot vedea serviciile corecte.
4. Pastreaza un singur controller activ si un singur poller Telegram pentru botul respectiv.
5. Nu introduce tokenuri sau IP-uri private in copia destinata GitHub.

## 2. Home Assistant / Solcast

Flow-ul de referinta foloseste cinci entitati Solcast:

```text
sensor.solcast_pv_forecast_forecast_tomorrow
sensor.solcast_pv_forecast_forecast_remaining_today
sensor.solcast_pv_forecast_power_now
sensor.solcast_pv_forecast_power_in_30_minutes
sensor.solcast_pv_forecast_power_in_1_hour
```

Si trei surse PV zilnice din instalatia de referinta:

```text
sensor.primo_5_0_1_energy_day
sensor.inverter_daily_yield
sensor.inverter_daily_yield_2
```

Aceste trei entitati PV sunt specifice instalatiei si trebuie inlocuite pentru alt sistem. Sunt acceptate valori Wh/kWh pentru energia produsa azi.

Contoarele cumulative de referinta sunt:

```text
sensor.shelly_pro_3em_id_40_consumption
sensor.shelly_pro_3em_id_40_feed_in
sensor.gx_device_dc_battery_charge_energy
sensor.gx_device_dc_battery_discharge_energy
```

Configurarea completa, P10/P50/P90 si autentificarea REST sunt descrise in `docs/HOME_ASSISTANT_SOLCAST.md`.

## 3. Import flow

Importa:

```text
flows/Victron_Solar_Forecast_Charge_Controller_v2_8_5.json
```

In nodul CONFIG verifica:

- `haUrl` — seteaza URL-ul local HA;
- cele 5 entitati Solcast;
- `entityDailyPvSources`;
- `energyCumulativeEntities`;
- `bmsDeviceInstance` si selectia bateriei in nodurile Victron;
- `commissioningChargeCapEnabled: false` daca nu doresti plafonul temporar de commissioning.

Tokenurile pot fi furnizate prin:

```text
SOLAR_HA_TOKEN
SOLAR_TELEGRAM_TOKEN
SOLAR_TELEGRAM_CHAT_ID
```

Deploy-ul trebuie sa ramana initial in DRY RUN.

## 4. Verificare DRY RUN

Dupa 15-30 secunde verifica:

```text
/health
/forecast
/battery
/cells
/limits
/grid
```

Nu activa controlul daca:

- forecastul lipseste/este stale;
- CCL/CVL sau celulele BMS sunt invalide;
- polaritatea NET este gresita;
- DVCC readback lipseste;
- `/cells` arata stop/taper neasteptat.

## 5. Politica de incarcare v2.8.5

Normal:

```text
SOC <90%       fara plafon SOC suplimentar
SOC 90-95%     max 20 A
SOC >95%       max 15 A, apoi scade liniar spre 0 A la 100%
96/97/98/99%   aproximativ 12/9/6/3 A
```

Protectiile de celula sunt independente de SOC:

```text
max-cell >=3.40 V -> max 10 A
max-cell >=3.43 V -> max 5 A
max-cell >=3.45 V -> max 2 A
max-cell >=3.50 V -> 0 A

delta >=50 mV si max>=3.40 V -> max 2 A
delta >=100 mV si max>=3.40 V -> 0 A
```

Dupa un stop de celule, reluarea necesita max<=3.43 V si delta<=50 mV stabile 60 s.

BMS CCL, CVL/headroom, Grid Guard si watchdog-ul pot impune limite si mai mici.

## 6. `/force`

Sintaxa v2.8.5:

```text
/force <A> [minute]
```

Exemple:

```text
/force 50 15   # 50 A timp de 15 minute
/force 50      # 50 A timp de 15 minute implicit
/forceoff      # anulare
```

FORCE:

- ignora temporar targetul/forecastul;
- ocoleste numai taperul bazat pe SOC;
- NU ocoleste BMS CCL;
- NU ocoleste max-cell/delta;
- NU ocoleste telemetria/watchdog-ul;
- NU ocoleste NET Grid Guard.

`MaxChargeCurrent` ramane un plafon; curentul fizic poate fi mai mic.

`/force100` inseamna tinta SOC 100%, nu 100 A.

## 7. Salvarea energiilor

Flow-ul citeste HA aproximativ periodic si salveaza checkpointurile energiei la 5 minute in:

```text
/data/solar-forecast
```

Cele trei surse PV zilnice sunt insumate numai daca toate sursele configurate sunt valide pentru ziua curenta. Contoarele cumulative import/export/charge/discharge sunt convertite in delta zilnica. Istoricul incomplet este marcat `partial`.

## 8. Helper optional pentru descarcare fortata

`service/bridge.py` si `service/install.sh` sunt neschimbate in v2.8.5 fata de v2.8.4. Daca helperul este deja instalat si functional, nu necesita reinstalare pentru schimbarea de flow 2.8.5.

Pentru instalare noua:

```sh
mkdir -p /data/solar-discharge
# copiaza bridge.py si install.sh in director
sh /data/solar-discharge/install.sh
```

Verificare fara pornirea unei descarcari:

```sh
python3 /data/solar-discharge/bridge.py probe
svstat /service/solar-discharge
```

Comenzi Telegram:

| Comanda | Actiune |
| --- | --- |
| `/discharge 20 30` | aprox. 20 A DC, max 30 min, SOC implicit 30% |
| `/discharge 20 120 50` | 20 A, max 120 min sau SOC 50% |
| `/discharge 20 soc 50` | pana la SOC 50%, cu limita de timp interna |
| `/discharge status` | status sesiune/helper |
| `/discharge off` | opreste sesiunea fortata |

Helperul foloseste override-uri ESS volatile:

```text
com.victronenergy.hub4 /Overrides/Setpoint
com.victronenergy.hub4 /Overrides/MaxDischargePower
```

Nu modifica permanent ESS mode, minSOC sau setpointul permanent. Nu reia automat o sesiune dupa restart.

## 9. Activare control

Activeaza `ENABLE CONTROL` numai dupa ce DRY RUN este curat. Dupa activare verifica din nou:

```text
/health
/limits
/battery
/cells
```

Readback-ul DVCC confirma setarea scrisa, nu garanteaza curentul fizic de incarcare.

## 10. Revenire

1. `/discharge off` daca exista o sesiune de descarcare.
2. Dezactiveaza controlul nou.
3. Reactiveaza flow-ul anterior din backup.
4. Nu lasa doua controlere sa scrie simultan acelasi DVCC.

Pentru oprirea helperului:

```sh
svc -d /service/solar-discharge
```

## 11. Scope

Patch-ul separat SystemCalc L2 nu face parte din acest repository si nu trebuie amestecat cu acest proiect.
