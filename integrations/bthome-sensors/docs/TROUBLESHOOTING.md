# Troubleshooting

## Device is visible but decoder outputs nothing

Verify:

- MAC exists in `DEVICES`
- `payload.serviceData` exists
- UUID `FCD2` is present
- BTHome v2 is selected
- advertisements are unencrypted

## Encrypted BTHome warning

The supplied decoder intentionally supports unencrypted BTHome v2 only. Configure PVVX/sensor advertising accordingly.

## Humidity or battery voltage sometimes disappears

The decoder keeps the latest state per MAC so advertisements that omit one value do not immediately erase the previous value.

## Wrong battery voltage

Do not hard-code it. Object `0x0C` is decoded as unsigned 16-bit little-endian multiplied by `0.001 V`. The tested sensor reported about `2.768 V`.

## Node-RED fails after editing bluez.js

Check:

```bash
node --check /data/home/nodered/.node-red/node_modules/node-red-contrib-gx-ble/lib/bluez.js
```

Restore the backup if needed:

```bash
cp /data/home/nodered/.node-red/node_modules/node-red-contrib-gx-ble/lib/bluez.js.bak_before_bthome    /data/home/nodered/.node-red/node_modules/node-red-contrib-gx-ble/lib/bluez.js
svc -t /service/node-red-venus
```

## Decoded values do not appear in Venus OS

Add Debug directly before the Victron Virtual Device. The payload should be:

```json
{
  "/Temperature": 16.7,
  "/Humidity": 49.78,
  "/BatteryVoltage": 2.768
}
```

Configure the Virtual Device as a Temperature sensor and enable humidity/battery-voltage fields.

## Multiple sensors

Add one MAC per sensor in `DEVICES`. Use separate Victron Virtual Temperature Sensor nodes if every physical sensor should appear as its own native device in Venus OS/VRM.
