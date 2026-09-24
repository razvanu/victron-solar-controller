# Home Assistant + Solcast setup

This document describes the Home Assistant data contract used by `Victron_Solar_Forecast_Charge_Controller_v2_8_5.json`.

The controller does **not** call the Solcast API directly. It periodically reads states already exposed by Home Assistant. Solcast API polling and quota management remain the responsibility of the Home Assistant Solcast integration.

## 1. Home Assistant REST access

The Node-RED flow reads Home Assistant through the standard REST API. Configure:

```text
haUrl: http://HOME_ASSISTANT_IP:8123
SOLAR_HA_TOKEN: <Home Assistant Long-Lived Access Token>
```

Home Assistant REST requests use:

```text
Authorization: Bearer <token>
```

Create a dedicated Long-Lived Access Token from the Home Assistant user profile and store it locally. Do not commit the token to GitHub.

Useful API test from another machine on the same trusted network:

```sh
curl \
  -H "Authorization: Bearer $SOLAR_HA_TOKEN" \
  -H "Content-Type: application/json" \
  http://HOME_ASSISTANT_IP:8123/api/
```

The flow reads `/api/states` and selects entities by **exact entity ID**. There is deliberately no fuzzy entity-name fallback.

Official Home Assistant REST documentation:
- https://developers.home-assistant.io/docs/api/rest/
- https://developers.home-assistant.io/docs/auth_api/#long-lived-access-token

## 2. Solcast integration for Home Assistant

The reference installation uses the community `BJReplay/ha-solcast-solar` integration (shown in Home Assistant as **Solcast PV Forecast**).

Recommended upstream project:
- https://github.com/BJReplay/ha-solcast-solar

The integration can be installed through HACS, then configured with a Solcast API key and correctly configured rooftop site(s). Follow the upstream integration documentation for the current installation procedure and supported Home Assistant versions.

Solcast Home PV/Hobbyist access is intended for personal, non-commercial home use. At the time this document was prepared, new Home PV accounts allow one residential location with up to two tilt/azimuth combinations and up to 10 API requests per day. Always check Solcast's current terms and limits:
- https://www.solcast.com/free-rooftop-solar-forecasting
- https://solcast.com/terms-of-use

This repository contains controller code only. It does not distribute Solcast API keys or Solcast forecast datasets.

## 3. Required Solcast entities

The v2.8.5 flow expects the following IDs by default:

| Config key | Default entity ID | Unit / data used |
| --- | --- | --- |
| `entityTomorrow` | `sensor.solcast_pv_forecast_forecast_tomorrow` | state=P50 kWh; `estimate10` and `estimate90` attributes |
| `entityRemainingToday` | `sensor.solcast_pv_forecast_forecast_remaining_today` | state=P50 kWh; `estimate10` and `estimate90` attributes |
| `entityPowerNow` | `sensor.solcast_pv_forecast_power_now` | W |
| `entityPower30m` | `sensor.solcast_pv_forecast_power_in_30_minutes` | W |
| `entityPower1h` | `sensor.solcast_pv_forecast_power_in_1_hour` | W |

The Solcast integration exposes three probabilistic forecast values on supported sensors:

- `estimate10` = P10 / cloudier, conservative case;
- `estimate` = P50 / central forecast;
- `estimate90` = P90 / less-cloudy, high-production case.

For the daily `Forecast Tomorrow` sensor, the flow uses the sensor state as P50 and reads `estimate10` / `estimate90` from attributes. The same pattern is used for `Forecast Remaining Today` when those attributes are present.

Entity IDs can differ after integration renames, migrations or user customisation. Verify them in **Developer Tools -> States** and then edit the CONFIG Function node:

```text
CONFIG v2.8.5 - Telegram complet + DVCC verification
```

Do not create duplicate entities just to match these names; changing the five config strings is enough.

## 4. Forecast freshness used by the controller

The controller distinguishes valid data from fresh data:

```text
Forecast Tomorrow       max age: 6 hours
Forecast Remaining Today max age: 60 minutes
Power now/+30m/+1h      max age: 60 minutes
```

The flow uses Home Assistant's `last_updated` / `last_changed` timestamps. A valid numeric state can therefore still be rejected as stale.

The Node-RED polling interval does not equal the Solcast API polling interval. Reading an HA sensor every minute simply reads Home Assistant's current state; it does not by itself request a new forecast from Solcast.

If Solcast auto-update is disabled, configure an HA automation using the integration action `solcast_solar.update_forecasts`, while respecting your current Solcast API quota.

## 5. How P10/P50/P90 are used

For tomorrow:

```text
P50 = state of Forecast Tomorrow
P10 = attribute estimate10
P90 = attribute estimate90
```

When P10/P50/P90 are available, the flow derives a simple confidence heuristic from their spread. The target planner then classifies tomorrow using P50 thresholds from CONFIG.

For remaining solar today, the conservative energy path is:

```text
P10 Remaining Today
    or, if unavailable:
P50 Remaining Today * p50ToConservativeFactor (default 0.70)

then:
conservative remaining * pvUsableFractionForBattery (default 0.65)
```

These are controller heuristics, not Solcast confidence guarantees.

## 6. Reference daily PV entities from Home Assistant

The reference installation has three PV sources and the flow sums their **daily energy** values:

```text
sensor.primo_5_0_1_energy_day
sensor.inverter_daily_yield
sensor.inverter_daily_yield_2
```

They are configured in:

```javascript
entityDailyPvSources: [
    "sensor.primo_5_0_1_energy_day",
    "sensor.inverter_daily_yield",
    "sensor.inverter_daily_yield_2"
]
```

Requirements for each entry:

- state must be numeric and non-negative;
- unit must be `Wh` or `kWh`;
- the sensor must represent **energy produced today**, not a lifetime counter;
- its `last_updated` must belong to the current local day.

The array may contain a different number of PV sources. Replace the example IDs with the daily-yield sensors from your own inverters.

If one configured source is missing/invalid for the day, the combined daily PV value is marked incomplete rather than silently under-counted.

## 7. Reference cumulative energy entities

The controller also reads cumulative counters and converts them into daily deltas:

```text
Grid import:      sensor.shelly_pro_3em_id_40_consumption
Grid export:      sensor.shelly_pro_3em_id_40_feed_in
Battery charge:   sensor.gx_device_dc_battery_charge_energy
Battery discharge:sensor.gx_device_dc_battery_discharge_energy
```

CONFIG:

```javascript
energyCumulativeEntities: {
    import: "sensor.shelly_pro_3em_id_40_consumption",
    export: "sensor.shelly_pro_3em_id_40_feed_in",
    charge: "sensor.gx_device_dc_battery_charge_energy",
    discharge: "sensor.gx_device_dc_battery_discharge_energy"
}
```

Each counter must be numeric, non-negative and use Wh or kWh. The flow stores checkpoints every 5 minutes in `/data/solar-forecast` and derives today's energy from counter differences. Counter resets/replacements are detected and cause the result to be marked partial rather than adding an incorrect full counter value.

These four IDs are also installation-specific and should be replaced where necessary.

## 8. Minimum HA verification before enabling control

In Home Assistant **Developer Tools -> States**, verify:

1. `Forecast Tomorrow` has a numeric kWh state.
2. It exposes `estimate10` and `estimate90` attributes if P10/P90 operation is desired.
3. `Forecast Remaining Today` is numeric and reasonably current.
4. Power now/+30m/+1h are numeric W sensors.
5. Every configured daily PV source reports Wh or kWh and is updating today.
6. Every configured cumulative energy counter reports Wh or kWh and is monotonic under normal operation.

Then in Telegram/Node-RED, while still in DRY RUN, check:

```text
/forecast
/health
/limits
/battery
```

Do not enable DVCC writes until forecast freshness, battery/BMS telemetry and grid polarity are correct.

## 9. Common problems

### `Solcast TOMORROW lipseste`
The exact `entityTomorrow` ID is not present in `/api/states`. Check Developer Tools -> States and update CONFIG.

### Tomorrow exists but controller says stale
Check the entity's `last_updated`. v2.8.5 allows 6 hours for Tomorrow, but only 60 minutes for Remaining Today and the power forecast sensors.

### P10/P90 are `N/A`
The entity can still operate with P50, but check whether your Solcast integration exposes `estimate10` and `estimate90` attributes and whether the selected integration version/configuration has those attributes enabled.

### Daily PV is `partial` / `N/A`
At least one ID in `entityDailyPvSources` is missing, has a unit other than Wh/kWh, is not numeric, or has not updated during the current local day.

### Home Assistant returns 401
The Long-Lived Access Token is invalid, expired/revoked, incomplete, or not being sent as `Authorization: Bearer ...`.

## 10. Privacy / public repository note

Before publishing an exported flow, remove:

- Home Assistant IP/hostname if it identifies a private network you do not want public;
- Long-Lived Access Token;
- Telegram bot token and owner/chat ID;
- Node-RED credential files;
- serial numbers, local usernames or other installation-specific secrets.

The public repository intentionally ships placeholders and example entity IDs only.
