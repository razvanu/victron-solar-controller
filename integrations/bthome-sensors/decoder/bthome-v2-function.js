// Node-RED Function: Generic BTHome v2 decoder for BLE ServiceData
// Unencrypted BTHome v2 advertisements (UUID 0xFCD2).
// Expected input from patched gx-ble-scan:
// msg.payload.mac, msg.payload.rssi, msg.payload.serviceData

const DEVICES = {
    "AA:BB:CC:DD:EE:FF": {
        name: "Xiaomi_Mi3_Mini",
        location: "Room"
    }
};

const BTHOME_UUID_SHORT = "fcd2";

function normalizeMac(mac) {
    return String(mac || "").trim().toUpperCase();
}

function bytesToHex(value) {
    if (value == null) return null;
    if (typeof value === "string") {
        return value.replace(/^0x/i, "").replace(/[^0-9a-f]/gi, "").toLowerCase();
    }
    if (Buffer.isBuffer(value)) return value.toString("hex");
    if (Array.isArray(value)) return Buffer.from(value).toString("hex");
    if (value && value.value !== undefined) return bytesToHex(value.value);
    if (value && value.data !== undefined) return bytesToHex(value.data);
    return null;
}

function findBTHomeServiceData(serviceData) {
    if (!serviceData || typeof serviceData !== "object") return null;

    for (const [uuid, value] of Object.entries(serviceData)) {
        const normalized = String(uuid).toLowerCase().replace(/[^0-9a-f]/g, "");
        if (normalized.includes(BTHOME_UUID_SHORT)) {
            return bytesToHex(value);
        }
    }
    return null;
}

function decodeBTHomeV2(hex) {
    const buf = Buffer.from(hex, "hex");
    if (buf.length < 2) return null;

    const deviceInfo = buf[0];

    // BTHome v2 encryption flag
    if (deviceInfo & 0x01) {
        node.warn("Encrypted BTHome v2 packet ignored");
        return null;
    }

    let i = 1;
    const out = {};

    while (i < buf.length) {
        const objectId = buf[i++];

        switch (objectId) {
            case 0x00:
                if (i + 1 > buf.length) return out;
                out.packet_id = buf.readUInt8(i);
                i += 1;
                break;

            case 0x01:
                if (i + 1 > buf.length) return out;
                out.battery = buf.readUInt8(i);
                i += 1;
                break;

            case 0x02:
                if (i + 2 > buf.length) return out;
                out.temperature = buf.readInt16LE(i) * 0.01;
                i += 2;
                break;

            case 0x03:
                if (i + 2 > buf.length) return out;
                out.humidity = buf.readUInt16LE(i) * 0.01;
                i += 2;
                break;

            case 0x0c:
                if (i + 2 > buf.length) return out;
                out.battery_voltage = buf.readUInt16LE(i) * 0.001;
                i += 2;
                break;

            default:
                // Stop instead of guessing an unknown object's size.
                return out;
        }
    }

    return out;
}

const src = msg.payload || {};
const mac = normalizeMac(src.mac || src.address);
const device = DEVICES[mac];

if (!device) return null;

const serviceData =
    src.serviceData ||
    src.service_data ||
    msg.serviceData ||
    msg.service_data;

const hex = findBTHomeServiceData(serviceData);
if (!hex) return null;

const decoded = decodeBTHomeV2(hex);
if (!decoded) return null;

const key = `bthome:${mac}`;
const previous = context.get(key) || {};

const state = {
    ...previous,
    ...decoded,
    name: device.name,
    location: device.location,
    mac,
    rssi: Number(src.rssi),
    last_seen: Date.now()
};

context.set(key, state);

msg.topic = device.name;
msg.payload = state;
return msg;
