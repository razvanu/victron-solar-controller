# Architecture

## Data flow

The controller combines four independent data groups:

1. **Home Assistant / Solcast forecast** — tomorrow P10/P50/P90, remaining today P10/P50/P90, power now/+30m/+1h.
2. **Home Assistant energy accounting** — daily PV production sources plus cumulative grid and battery-energy counters.
3. **Victron live data** — SOC, battery voltage/current, three grid phases and ESS/DVCC state.
4. **BMS telemetry** — connected state, CCL, CVL, DCL, min/max cell voltage and temperature.

Home Assistant is read through the REST API. Entity IDs are explicit configuration values; the parser does not guess by friendly name.

Detailed HA/Solcast mapping is documented in [HOME_ASSISTANT_SOLCAST.md](HOME_ASSISTANT_SOLCAST.md).

## Node-RED control path

Conceptual order:

1. fetch Home Assistant states;
2. parse Solcast data and validate timestamps;
3. calculate forecast target and automatic 50/70/100 A strategy;
4. apply battery-aware BMS CCL/CVL/headroom limits;
5. apply three-phase NET Grid Guard;
6. apply raw max-cell/delta protection and normal high-SOC taper;
7. apply discharge interlock;
8. validate live telemetry and DVCC readback in one gate;
9. feed the single DVCC writer.

The only DVCC setting written by the controller is:

```text
com.victronenergy.settings
/Settings/SystemSetup/MaxChargeCurrent
```

`MaxChargeCurrent` is a ceiling. It is not a command that guarantees the battery will physically charge at that current.

Control starts in DRY RUN.

## FORCE semantics

`/force <A> [minutes]` replaces the forecast/target current request and bypasses only the **SOC-based top taper**.

It does not bypass:

- BMS CCL;
- max-cell voltage limits;
- cell-delta limits;
- telemetry/watchdog validity;
- three-phase Grid Guard;
- the single DVCC verification gate.

`/force100` is a separate manual target mode and means target SOC 100%, not 100 A.

## High-SOC / cell safety chain

Normal SOC taper in v2.8.5:

```text
<90%      no SOC ceiling
90-95%    20 A
>95%      <=15 A, linearly reducing to 0 A at 100%
```

Independent raw-cell limits:

```text
max >=3.40 V -> <=10 A
max >=3.43 V -> <=5 A
max >=3.45 V -> <=2 A
max >=3.50 V -> stop

delta >=50 mV and max >=3.40 V -> <=2 A
delta >=100 mV and max >=3.40 V -> stop
```

After a hard cell stop, safe max/delta conditions must remain stable for 60 seconds before release.

## Daily energy accounting

`entityDailyPvSources` contains sensors that already represent today's PV energy. The reference install uses three sources and sums them only when all configured sources are valid and updated today.

`energyCumulativeEntities` contains lifetime/cumulative counters. The flow creates daily deltas and stores alternating checkpoints under:

```text
/data/solar-forecast
```

Persistence interval is 300000 ms (5 minutes). The design avoids a frequent flash heartbeat.

## Forced discharge service

`service/bridge.py` runs independently from Node-RED and communicates through a local Unix socket. Sessions use heartbeat/lease semantics and volatile ESS overrides only:

```text
com.victronenergy.hub4 /Overrides/Setpoint
com.victronenergy.hub4 /Overrides/MaxDischargePower
```

The helper does not permanently change ESS mode, minimum SOC or the permanent grid setpoint. It does not automatically resume an old discharge session after restart.
