# Victron Solar Forecast Controller

Node-RED controller for Victron ESS systems that adjusts the DVCC `MaxChargeCurrent` ceiling from solar forecast, battery/BMS state and three-phase NET grid power. The project also includes an optional local Python helper for temporary forced battery discharge/export sessions.

**Current release:** v2.8.5  
**Default state after import:** **DRY RUN** — no DVCC write is performed until control is enabled locally in Node-RED.

> [!CAUTION]
> This project can write charge-current limits and temporary ESS overrides. It is not a replacement for the battery BMS, Victron protections or correct electrical design. Test in DRY RUN first and verify all device paths, limits and polarity on your own installation.

## What it does

- forecasts the next-day charging requirement using Solcast data exposed by Home Assistant;
- uses three-phase NET power (`L1 + L2 + L3`) to avoid intentional grid charging;
- keeps one and only one DVCC writer for `/Settings/SystemSetup/MaxChargeCurrent`;
- applies BMS CCL/CVL, max-cell, cell-delta, watchdog and Grid Guard protections;
- supports Telegram status/control commands including `/force`, `/force100` and `/discharge`;
- stores daily PV/grid/battery energy checkpoints every 5 minutes;
- starts safely in DRY RUN and does not auto-deploy from GitHub to the Cerbo GX.

## Reference installation

The project was developed around this installation. These devices are **reference hardware, not universal requirements**:

- Cerbo GX MK2, Venus OS v3.80 Large;
- Node-RED 4.1.11 with `node-red-contrib-victron`;
- MultiPlus-II 48/6k5 single-phase on L2;
- Fronius Primo 5 kW on AC-OUT L2;
- Huawei PV inverters on the other phases;
- Hailei LiFePO4 battery with PACE CAN BMS, reference device instance 512;
- Shelly Pro 3EM as three-phase grid meter;
- Home Assistant providing Solcast forecast and daily/cumulative energy sensors.

Automated tests in this repository are simulated/static. They do not constitute validation on every battery, BMS, inverter or ESS topology.

## Home Assistant and Solcast

The flow reads Home Assistant through its REST API and expects five Solcast forecast entities plus installation-specific energy sensors.

The reference Solcast mapping is:

| Purpose | Home Assistant entity | Expected value |
| --- | --- | --- |
| Tomorrow forecast | `sensor.solcast_pv_forecast_forecast_tomorrow` | state=P50 kWh, attributes `estimate10` / `estimate90` |
| Remaining today | `sensor.solcast_pv_forecast_forecast_remaining_today` | state=P50 kWh, attributes `estimate10` / `estimate90` |
| Power now | `sensor.solcast_pv_forecast_power_now` | W |
| Power +30 min | `sensor.solcast_pv_forecast_power_in_30_minutes` | W |
| Power +1 h | `sensor.solcast_pv_forecast_power_in_1_hour` | W |

The reference installation also sums these three **daily PV energy** sensors:

```text
sensor.primo_5_0_1_energy_day
sensor.inverter_daily_yield
sensor.inverter_daily_yield_2
```

Those three IDs are installation-specific. Other users should replace them with their own daily PV energy entities in Wh or kWh.

See **[Home Assistant + Solcast setup](docs/HOME_ASSISTANT_SOLCAST.md)** for installation, entity mapping, REST authentication, Solcast P10/P50/P90 semantics, API-update behaviour and troubleshooting.

## Charge-current policy in v2.8.5

Normal SOC taper:

- below 90%: no additional SOC ceiling;
- 90–95%: maximum 20 A;
- above 95%: starts at 15 A and decreases linearly to 0 A at 100% (approximately 96/97/98/99% = 12/9/6/3 A).

Independent raw-cell protection remains active:

- max cell >=3.40 / 3.43 / 3.45 V -> maximum 10 / 5 / 2 A;
- delta >=50 mV while max cell >=3.40 V -> maximum 2 A;
- stop at max cell >=3.50 V;
- stop at delta >=100 mV while max cell >=3.40 V;
- resume only after max cell <=3.43 V and delta <=50 mV remain safe for 60 seconds.

`/force <A> [minutes]` bypasses the **SOC-only taper and forecast target**, but it never bypasses max-cell/delta protection, BMS CCL, telemetry/watchdog checks or Grid Guard. Example: `/force 50 15` requests a 50 A ceiling for 15 minutes, subject to those safety limits.

`/force100` is different: it requests a 100% SOC target; it does **not** mean 100 A.

## Repository layout

```text
flows/      Node-RED v2.8.5 export
service/    optional forced-discharge helper and Cerbo installer
tests/      regression, syntax and secret-scan checks
docs/       architecture, HA/Solcast setup, operations, security, testing
.github/    CI workflow
README.md
CHANGELOG.md
LICENSE
.gitignore
.env.example
```

## Secrets and local configuration

Never commit real Home Assistant or Telegram credentials. The flow supports:

```text
SOLAR_HA_TOKEN
SOLAR_TELEGRAM_TOKEN
SOLAR_TELEGRAM_CHAT_ID
```

`haUrl` is intentionally shipped as `http://HOME_ASSISTANT_IP:8123`. Configure the actual URL locally after import. See [SECURITY.md](docs/SECURITY.md).

## Tests

Run the same suite used by CI:

```sh
sh tests/check_all.sh
```

This includes Python unit tests, Node-RED Function-node syntax checks, charge-guard regressions, `/force` command parsing, secret scanning, shell syntax and Python compilation.

See [TESTING.md](docs/TESTING.md) for the release checklist.

## Install / operate

1. Read [Home Assistant + Solcast setup](docs/HOME_ASSISTANT_SOLCAST.md).
2. Read the Romanian operational guide: [OPERATIONS_RO.md](docs/OPERATIONS_RO.md).
3. Import `flows/Victron_Solar_Forecast_Charge_Controller_v2_8_5.json` into Node-RED.
4. Keep it in DRY RUN until `/health`, `/cells`, `/limits`, `/battery` and forecast data are correct.
5. Install `service/` only if you want the optional forced-discharge feature.

GitHub changes do **not** install themselves on the Cerbo GX.

## Related Victron integrations

- **[BTHome BLE sensors → Victron Virtual Temperature Sensor](integrations/bthome-sensors/)** — read unencrypted BTHome v2 temperature/humidity sensors directly on a GX device through BlueZ + Node-RED and expose them as native Venus OS temperature devices.

## Project scope

This repository does not include the separate SystemCalc L2 patch or unrelated Huawei/Home Assistant projects.

The project is not affiliated with or endorsed by Victron Energy, Home Assistant, Solcast, Fronius, Huawei, Shelly, Hailei or PACE. Product and project names belong to their respective owners.

## License

MIT License. See [LICENSE](LICENSE).
