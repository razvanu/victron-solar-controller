# Architecture

## Node-RED flow

Flow-ul citeste forecastul Home Assistant, energia zilnica, telemetria Victron/BMS si puterea de retea pe cele trei faze. Strategia calculeaza un plafon de incarcare. Protectia RAW CELL/SOC aplica limita suplimentara, apoi **un singur gate DVCC** valideaza telemetria/readback si alimenteaza singurul writer catre:

`com.victronenergy.settings /Settings/SystemSetup/MaxChargeCurrent`

Controlul porneste in DRY RUN.

## Charge safety chain

Ordinea conceptuala este:

1. forecast/strategie de incarcare;
2. CCL/CVL si taper battery-aware;
3. Grid NET guard;
4. RAW cell + SOC top taper;
5. interlock descarcare;
6. gate DVCC + watchdog/readback;
7. writer DVCC unic.

FORCE nu ocoleste lantul de siguranta.

## Forced discharge service

`service/bridge.py` ruleaza separat de Node-RED si foloseste un socket Unix local. Sesiunile sunt volatile, cu heartbeat/lease. Foloseste numai:

- `com.victronenergy.hub4 /Overrides/Setpoint`
- `com.victronenergy.hub4 /Overrides/MaxDischargePower`

Nu modifica permanent modul ESS, minSOC sau setpointul permanent. La oprire incearca sa elibereze numai override-urile pe care le detine.

## Persistence

Energiile zilnice sunt salvate la 300000 ms (5 minute) in `/data/solar-forecast`. Heartbeat-ul descarcarii foloseste RAM/socket si nu genereaza scrieri frecvente pe flash.
