# Victron BTHome BLE Sensors — documentație în română

Integrarea citește senzori BLE care emit **BTHome v2** direct cu Cerbo GX, decodează temperatura, umiditatea și bateria în Node-RED și îi publică în Venus OS ca **Virtual Temperature Sensor**.

## Configurația validată

- Cerbo GX MK2
- Venus OS Large
- Node-RED 4.x
- `node-red-contrib-gx-ble`
- nodurile oficiale Victron pentru Node-RED
- Xiaomi Mi 3 Mini / `MJWSD06MMC`
- PVVX `MJ6_v59`
- BTHome v2 necriptat

## Flux

```text
Xiaomi/PVVX
 → BLE / BTHome FCD2
 → BlueZ
 → gx-ble-scan
 → decoder BTHome
 → Virtual Temperature Sensor
 → Venus OS GUI / VRM
```

## Ce trebuie publicat către Victron

```js
msg.payload = {
    "/Temperature": payload.temperature,
    "/Humidity": payload.humidity,
    "/BatteryVoltage": payload.battery_voltage
};
```

Tensiunea bateriei se citește din pachetul BTHome. În testul real a fost aproximativ `2.768 V`; nu se folosește o valoare fixă de `3.2 V`.

## Adăugarea unui senzor nou

În Function node-ul decoder se modifică doar tabela `DEVICES`:

```js
const DEVICES = {
    "AA:BB:CC:DD:EE:FF": {
        name: "Senzor_Camera",
        location: "Camera"
    }
};
```

MAC-ul real nu este publicat în repository.

## Patch ServiceData

BTHome folosește BLE Service Data cu UUID `FCD2`. Versiunea testată de `node-red-contrib-gx-ble` nu publica `ServiceData` în payload, așa că `lib/bluez.js` a fost modificat local ca să expună `p.ServiceData`.

Înainte de orice modificare:

```bash
GX_BLE_BLUEZ=/data/home/nodered/.node-red/node_modules/node-red-contrib-gx-ble/lib/bluez.js
cp "$GX_BLE_BLUEZ" "${GX_BLE_BLUEZ}.bak_before_bthome"
```

După editare:

```bash
node --check "$GX_BLE_BLUEZ"
svc -t /service/node-red-venus
```

După update-ul pachetului, verifică dacă upstream oferă deja ServiceData înainte să reaplici patch-ul.

## Verificare

În Debug trebuie să apară valori asemănătoare cu:

```json
{
  "temperature": 16.7,
  "humidity": 49.78,
  "battery": 71,
  "battery_voltage": 2.768,
  "rssi": -66
}
```

Iar înainte de Virtual Temperature Sensor:

```json
{
  "/Temperature": 16.7,
  "/Humidity": 49.78,
  "/BatteryVoltage": 2.768
}
```

Vezi README-ul principal pentru schema completă și troubleshooting.
