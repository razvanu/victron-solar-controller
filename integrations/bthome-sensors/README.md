# Victron BTHome BLE Sensors

Bridge low-power BLE environmental sensors broadcasting **BTHome v2** into **Victron Venus OS / Cerbo GX** through Node-RED, then expose them as native Victron **Virtual Temperature Sensors**.

Validated on a Cerbo GX MK2 / Venus OS Large / Node-RED setup with a Xiaomi Mi Temperature & Humidity Monitor 3 Mini (`MJWSD06MMC`) running PVVX and broadcasting **unencrypted BTHome v2**.

## Architecture

```text
BLE sensor
  → BTHome v2 advertisement (UUID FCD2)
  → BlueZ on Venus OS
  → node-red-contrib-gx-ble / gx-ble-scan
  → BTHome decoder Function
  → Victron Virtual Temperature Sensor
  → Venus OS GUI / VRM
```

## Tested data

The working setup decodes:

- temperature
- humidity
- battery percentage
- battery voltage
- RSSI
- packet id

Example decoded payload:

```json
{
  "name": "Xiaomi_Mi3_Mini",
  "location": "Room",
  "temperature": 16.7,
  "humidity": 49.78,
  "battery": 71,
  "battery_voltage": 2.768,
  "rssi": -66,
  "packet_id": 43
}
```

## Requirements

- Venus OS Large
- Node-RED
- official `@victronenergy/node-red-contrib-victron` nodes
- `node-red-contrib-gx-ble`
- BLE adapter visible to BlueZ
- sensor configured for **unencrypted BTHome v2**

Install gx-ble from the palette or over SSH:

```bash
cd /data/home/nodered/.node-red
npm install node-red-contrib-gx-ble
svc -t /service/node-red-venus
```

## Important: ServiceData

The tested `node-red-contrib-gx-ble` 0.1.0 scan payload exposed ManufacturerData but not BlueZ `Device1.ServiceData`. BTHome advertisements are carried in Service Data under UUID:

```text
0000fcd2-0000-1000-8000-00805f9b34fb
```

The working installation therefore patched:

```text
/data/home/nodered/.node-red/node_modules/node-red-contrib-gx-ble/lib/bluez.js
```

to:

1. read `p.ServiceData`
2. normalize UUIDs
3. convert service-data bytes to hex
4. expose the result as `payload.serviceData`
5. re-emit when ServiceData changes

Back up before editing:

```bash
GX_BLE_BLUEZ=/data/home/nodered/.node-red/node_modules/node-red-contrib-gx-ble/lib/bluez.js
cp "$GX_BLE_BLUEZ" "${GX_BLE_BLUEZ}.bak_before_bthome"
```

Validate syntax before restarting:

```bash
node --check "$GX_BLE_BLUEZ"
svc -t /service/node-red-venus
```

After a package upgrade, verify whether upstream exposes ServiceData natively before reapplying the local patch.

## Node-RED flow

```text
Inject → gx-ble-scan → Decode BTHome v2
                         ├→ Debug
                         └→ Map to Victron → Virtual Device (Temperature sensor)
```

Import:

```text
flows/bthome-victron-example.json
```

Then configure the sensor in the decoder:

```js
const DEVICES = {
    "AA:BB:CC:DD:EE:FF": {
        name: "Living_Room",
        location: "Living room"
    }
};
```

Real MAC addresses are intentionally not committed.

## Victron payload

The official Victron Virtual Device receives:

```js
msg.payload = {
    "/Temperature": 16.7,
    "/Humidity": 49.78,
    "/BatteryVoltage": 2.768
};
```

Configure the Virtual Device as a **Temperature sensor** and enable humidity / battery-voltage fields.

## Supported BTHome objects

| Object | Meaning | Encoding | Scale |
|---|---|---|---|
| `0x00` | Packet ID | uint8 | 1 |
| `0x01` | Battery | uint8 | 1 % |
| `0x02` | Temperature | sint16 LE | 0.01 °C |
| `0x03` | Humidity | uint16 LE | 0.01 % |
| `0x0C` | Voltage | uint16 LE | 0.001 V |

Battery voltage is read from the packet; it is **not** hard-coded. The tested sensor reported about `2.768 V`.

## Multiple sensors

The decoder keeps state per MAC. Add another entry to `DEVICES` for each sensor. Use separate Victron Virtual Temperature Sensor nodes when you want each sensor to appear as a separate native device in Venus OS/VRM.

## Troubleshooting

**Sensor appears in BLE scan, but decoder returns nothing**

Check that:

- the MAC exists in `DEVICES`
- `payload.serviceData` exists
- ServiceData contains `FCD2`
- the advertisement is BTHome v2
- encryption is disabled

**Temperature works but humidity or voltage is missing**

Some sensors may omit a measurement in a particular advertisement. The decoder keeps the latest known state per MAC.

**Values decode, but do not appear in Victron**

Put a Debug node immediately before the Virtual Device. The payload must use the D-Bus paths `/Temperature`, `/Humidity`, and `/BatteryVoltage`.

## Compatibility note

This integration was built around the tested local `gx-ble-scan` behavior. Upstream packages can change; always re-check the ServiceData patch after upgrades.

## License

MIT. This project is not affiliated with Victron Energy, Xiaomi, PVVX, or the maintainer of `node-red-contrib-gx-ble`.
