# gx-ble ServiceData patch

## Why this patch exists

BTHome v2 advertisements use BLE Service Data, normally under UUID:

```text
0000fcd2-0000-1000-8000-00805f9b34fb
```

The tested `node-red-contrib-gx-ble` 0.1.0 scanner did not expose BlueZ `Device1.ServiceData` in the Node-RED payload. The working Cerbo GX installation therefore used a local modification of:

```text
/data/home/nodered/.node-red/node_modules/node-red-contrib-gx-ble/lib/bluez.js
```

The required behavior is:

1. read `p.ServiceData`
2. normalize UUID strings
3. convert byte arrays/Buffers to hex
4. publish the result as `payload.serviceData`
5. emit a new scan message when ServiceData changes

## Backup

```bash
GX_BLE_BLUEZ=/data/home/nodered/.node-red/node_modules/node-red-contrib-gx-ble/lib/bluez.js
cp "$GX_BLE_BLUEZ" "${GX_BLE_BLUEZ}.bak_before_bthome"
```

If the package is in another location:

```bash
find /data/home -path '*/node_modules/node-red-contrib-gx-ble/lib/bluez.js' -print
```

## Conversion helper

Equivalent logic can be used when building the outgoing payload:

```js
function serviceDataToHex(serviceData) {
    const out = {};
    if (!serviceData) return out;

    for (const [uuid, value] of Object.entries(serviceData)) {
        const normalizedUuid = String(uuid).toLowerCase();
        const raw = value && value.value !== undefined ? value.value : value;

        if (Buffer.isBuffer(raw)) {
            out[normalizedUuid] = raw.toString("hex");
        } else if (Array.isArray(raw)) {
            out[normalizedUuid] = Buffer.from(raw).toString("hex");
        } else if (raw && raw.data !== undefined) {
            out[normalizedUuid] = Buffer.from(raw.data).toString("hex");
        }
    }
    return out;
}

payload.serviceData = serviceDataToHex(p.ServiceData);
```

The BlueZ PropertiesChanged handler must also consider `ServiceData` changes.

## Validate before restart

```bash
node --check "$GX_BLE_BLUEZ"
```

No output means syntax is valid.

Then:

```bash
svc -t /service/node-red-venus
```

## Verify

Wire:

```text
Inject → gx-ble-scan → Debug
```

Expected shape:

```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "rssi": -66,
  "serviceData": {
    "0000fcd2-0000-1000-8000-00805f9b34fb": "..."
  }
}
```

## After package updates

An npm reinstall/update can overwrite the local file. First check whether upstream now exposes ServiceData natively. Only reapply the local modification when it is still necessary.
