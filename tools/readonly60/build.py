#!/usr/bin/env python3
"""Transforma flow-urile de pe Cerbo (controller v2.8.13 + B2 v0.3) intr-o varianta
DOAR CITIRE pentru Node-RED-ul din containerul solar-dashboard (serverul ".60") (fara noduri Victron dbus).

- nodurile victron-input-*  -> function "emitator" (acelasi id, aceleasi fire) care citeste
  valoarea din cache-ul MQTT (global 'vic_cache') la fiecare 2 s
- nodurile victron-output-* -> function "BLOCAT" fara iesiri (nu scrie nimic)
- nodul exec (helper descarcare de pe Cerbo) -> function care raspunde "READONLY"
- injecturile ENABLE -> payload false; CONFIG si 'Set controller enable' fortate pe DRY RUN
- un tab separat "Victron MQTT bridge" citeste Cerbo prin MQTT; publica DOAR pe R/...
"""
import json, re, sys

SRC_CTRL = sys.argv[1]
SRC_B2 = sys.argv[2]
OUT = sys.argv[3]

def svc_key(service, path):
    s = service.replace("com.victronenergy.", "")
    if "/" not in s:
        s = s + "/0"
    return s + path

EMIT_FUNC = r"""// DOAR CITIRE: emitator din cache-ul MQTT (inlocuieste nodul Victron dbus)
// Valorile constante sunt reimprospatate prin cereri R/ la 10 s (tab-ul bridge), deci o
// valoare mai veche de MAX_AGE_MS nu mai este trimisa: nodul 'store' isi pastreaza _ts
// vechi, controllerul o vede expirata, iar statusul rosu marcheaza source_faults.
const KEY = %(key)s, ROUND = %(round)s, NAME = %(name)s, MAX_AGE_MS = 20000;
const c = (global.get('vic_cache') || {})[KEY];
if (!c) { node.status({fill:'grey', shape:'ring', text:'astept date MQTT'}); return null; }
const age = Date.now() - c.t;
if (!(age >= 0 && age <= MAX_AGE_MS)) { node.status({fill:'red', shape:'ring', text:'date vechi ' + Math.round(age/1000) + ' s'}); return null; }
let v = c.v;
if (typeof v === 'number' && ROUND !== null) v = Number(v.toFixed(ROUND));
node.status({fill:'green', shape:'dot', text:String(v)});
return {payload: v, topic: NAME};"""

BLOCK_FUNC = r"""// DOAR CITIRE: scrierea catre Victron este BLOCATA in aceasta varianta.
// Yellow Box (Yellow Grid) controleaza setpoint-ul ESS, DVCC si limita de feed-in.
const p = %(path)s;
flow.set('blocked_write_last', {path: p, value: msg.payload, ts: Date.now()});
node.status({fill:'grey', shape:'ring', text:'BLOCAT (doar citire): ' + JSON.stringify(msg.payload)});
return null;"""

EXEC_FUNC = r"""// DOAR CITIRE: helperul de descarcare fortata ruleaza doar pe Cerbo; aici nu exista.
node.status({fill:'grey', shape:'ring', text:'helper indisponibil (doar citire)'});
return [{payload: JSON.stringify({ok:false, error:'READONLY_NO_HELPER'})}, null, null];"""

QUOTED = re.compile(r"([\"'])([A-Za-z0-9_.-]+)\1")

def transform(nodes, prefix, tab_label, tab_env, keys):
    idmap = {n["id"]: prefix + n["id"] for n in nodes}
    tick_id = prefix + "tick2s"
    out = []
    tab = None
    emitters = []
    stats = {"emit": 0, "block": 0, "exec": 0, "enable": 0}
    for n in nodes:
        n = json.loads(json.dumps(n))
        n["id"] = idmap[n["id"]]
        if "z" in n and n["z"] in idmap:
            n["z"] = idmap[n["z"]]
        if "g" in n and n["g"] in idmap:
            n["g"] = idmap[n["g"]]
        if "wires" in n:
            n["wires"] = [[idmap.get(w, w) for w in ws] for ws in n["wires"]]
        if "scope" in n and isinstance(n["scope"], list):
            n["scope"] = [idmap.get(s, s) for s in n["scope"]]
        if n.get("type") == "group" and "nodes" in n:
            n["nodes"] = [idmap.get(x, x) for x in n["nodes"]]
        t = n.get("type", "")
        if t == "tab":
            n["label"] = tab_label
            n["env"] = tab_env
            n["info"] = ("DOAR CITIRE pe serverul .60 (solar-dashboard). Datele vin prin MQTT de la Cerbo (tab-ul "
                         "'Victron MQTT bridge'). Nicio scriere catre Victron. Generat automat din "
                         "flow-ul de pe Cerbo; vezi docs/READONLY_60_RO.md.")
            tab = n
        elif t.startswith("victron-input"):
            key = svc_key(n["service"], n["path"])
            keys.add(key)
            rv = n.get("roundValues")
            rnd = int(rv) if (rv not in (None, "", "no") and str(rv).isdigit()) else None
            new = {
                "id": n["id"], "type": "function", "z": n["z"],
                "name": "MQTT> " + (n.get("name") or key),
                "func": EMIT_FUNC % {"key": json.dumps(key), "round": json.dumps(rnd),
                                     "name": json.dumps(n.get("name") or key)},
                "outputs": 1, "timeout": 0, "noerr": 0, "initialize": "", "finalize": "", "libs": [],
                "x": n.get("x", 100), "y": n.get("y", 100), "wires": n["wires"],
            }
            if "g" in n: new["g"] = n["g"]
            emitters.append(new["id"])
            n = new
            stats["emit"] += 1
        elif t.startswith("victron-output"):
            new = {
                "id": n["id"], "type": "function", "z": n["z"],
                "name": "BLOCAT (doar citire): " + (n.get("name") or n.get("path")),
                "func": BLOCK_FUNC % {"path": json.dumps(n.get("service", "") + n.get("path", ""))},
                "outputs": 0, "timeout": 0, "noerr": 0, "initialize": "", "finalize": "", "libs": [],
                "x": n.get("x", 100), "y": n.get("y", 100), "wires": [],
            }
            if "g" in n: new["g"] = n["g"]
            n = new
            stats["block"] += 1
        elif t == "exec":
            new = {
                "id": n["id"], "type": "function", "z": n["z"],
                "name": "Helper descarcare: indisponibil (doar citire)",
                "func": EXEC_FUNC, "outputs": 3, "timeout": 0, "noerr": 0,
                "initialize": "", "finalize": "", "libs": [],
                "x": n.get("x", 100), "y": n.get("y", 100), "wires": n["wires"],
            }
            if "g" in n: new["g"] = n["g"]
            n = new
            stats["exec"] += 1
        elif t == "inject" and str(n.get("payload")) == "true" and re.search(r"ENABLE", n.get("name", ""), re.I):
            n["payload"] = "false"
            n["payloadType"] = "bool"
            n["name"] = "(dezactivat) " + n["name"] + " - doar citire"
            stats["enable"] += 1
        elif t == "function":
            f = n.get("func", "")
            # id-urile de noduri scrise in cod (ex. msg.status.source.id in 'Store connection
            # faults', msg.error.source.id in 'Telegram error') primesc acelasi prefix ca nodurile
            f = QUOTED.sub(lambda m: m.group(1) + idmap.get(m.group(2), m.group(2)) + m.group(1), f)
            n["func"] = f
            if "const startActive=" in f:
                f = f.replace("const startActive=", "const startActive=false&&(")
                f = f.replace("cfg.activeAfterRestart===true;", "cfg.activeAfterRestart===true);", 1)
                n["func"] = f
            if n.get("name") == "Set controller enable":
                n["func"] = f.replace("const enabled=msg.payload===true;",
                                      "const enabled=false; // DOAR CITIRE: controlul nu se poate activa pe .60")
        out.append(n)
    # tick comun pentru emitatori
    out.append({"id": tick_id, "type": "inject", "z": tab["id"], "name": "tick MQTT > emitatori / 2 s",
                "props": [], "repeat": "2", "crontab": "", "once": True, "onceDelay": "5",
                "topic": "", "x": 140, "y": 40, "wires": [emitters]})
    return out, stats

ctrl = json.load(open(SRC_CTRL, encoding="utf-8"))
b2 = json.load(open(SRC_B2, encoding="utf-8"))
keys = set()
env_ctrl = [
    {"name": "SOLAR_HA_URL", "value": "http://HOME_ASSISTANT_IP:8123", "type": "str"},
    {"name": "SOLAR_HA_TOKEN", "value": "", "type": "cred"},
    {"name": "SOLAR_TELEGRAM_TOKEN", "value": "", "type": "cred"},
    {"name": "SOLAR_TELEGRAM_CHAT_ID", "value": "", "type": "str"},
    {"name": "SOLAR_ENERGY_STATE_BASE", "value": "/data/solar-forecast/daily-energy-v1", "type": "str"},
]
out_ctrl, s1 = transform(ctrl, "ro60c_", "Solar Controller v2.8.13 - DOAR CITIRE (.60)", env_ctrl, keys)
out_b2, s2 = transform(b2, "ro60b_", "B2 v0.3 - DOAR CITIRE / calcul (.60)", [], keys)

KEYS = sorted(keys)
BRIDGE_TAB = "ro60_bridge_tab"
BROKER = "ro60_broker"
KA_FUNC = r"""// Publica DOAR pe R/<portal>/... : keepalive + cereri de citire. Niciodata W/.
const id = env.get('PORTAL_ID') && env.get('PORTAL_ID') !== 'COMPLETEAZA' ? env.get('PORTAL_ID') : global.get('vic_portal');
if (!id) { node.status({fill:'red', shape:'ring', text:'PORTAL_ID lipsa (proprietatile tab-ului)'}); return null; }
const KEYS = %(keys)s;
// la fiecare tick (10 s): keepalive + cerere pentru toate valorile, ca si cele constante
// (publicate de Cerbo doar la schimbare) sa ramana sub pragul de 20 s al emitatorilor
const msgs = [{topic: 'R/' + id + '/keepalive', payload: JSON.stringify({'keepalive-options': ['suppress-republish']})}];
for (const k of KEYS) msgs.push({topic: 'R/' + id + '/' + k, payload: ''});
const safe = msgs.filter(m => /^R\/[^/]+\//.test(m.topic) && !m.topic.startsWith('W/'));
node.status({fill:'green', shape:'dot', text:'keepalive ' + new Date().toLocaleTimeString() + (safe.length > 1 ? ' + ' + (safe.length-1) + ' citiri' : '')});
return [safe];"""

CACHE_FUNC = r"""// Cache global cu valorile Victron primite prin MQTT (N/<portal>/<serviciu>/<instanta>/<cale>)
const parts = String(msg.topic || '').split('/');
if (parts[0] !== 'N' || parts.length < 4) return null;
if (!global.get('vic_portal')) global.set('vic_portal', parts[1]);
const key = parts.slice(2).join('/');
const val = (msg.payload !== null && typeof msg.payload === 'object' && 'value' in msg.payload) ? msg.payload.value : msg.payload;
const c = global.get('vic_cache') || {};
c[key] = {v: val, t: Date.now()};
global.set('vic_cache', c);
global.set('vic_health', {last: Date.now()});
const k = (context.get('k') || 0) + 1; context.set('k', k);
if (k % 50 === 1) node.status({fill:'green', shape:'dot', text: Object.keys(c).length + ' valori, ultima ' + new Date().toLocaleTimeString()});
return null;"""

bridge = [
    {"id": BRIDGE_TAB, "type": "tab", "label": "Victron MQTT bridge (doar citire)", "disabled": False,
     "info": "Citeste Cerbo GX (CERBO_IP: completeaza in nodul broker) prin MQTT si pune valorile in global 'vic_cache'.\n"
             "Publica DOAR pe R/<portal>/... (keepalive + cereri de citire la 10 s). Nu exista niciun W/.\n"
             "PORTAL_ID: Cerbo > Settings > VRM online portal > VRM Portal ID.",
     "env": [{"name": "PORTAL_ID", "value": "COMPLETEAZA", "type": "str"}]},
    {"id": BROKER, "type": "mqtt-broker", "name": "Cerbo GX MQTT (ro60) - CERBO_IP", "broker": "CERBO_IP",
     "port": "1883", "clientid": "", "autoConnect": True, "usetls": False, "protocolVersion": "4",
     "keepalive": "60", "cleansession": True, "autoUnsubscribe": True,
     "birthTopic": "", "closeTopic": "", "willTopic": ""},
    {"id": "ro60_c1", "type": "comment", "z": BRIDGE_TAB,
     "name": "DOAR CITIRE - nu adauga noduri mqtt out pe W/...", "info": "", "x": 230, "y": 40, "wires": []},
    {"id": "ro60_ka_inj", "type": "inject", "z": BRIDGE_TAB, "name": "keepalive + citiri / 10 s", "props": [],
     "repeat": "10", "crontab": "", "once": True, "onceDelay": "2", "topic": "", "x": 160, "y": 100,
     "wires": [["ro60_ka_fn"]]},
    {"id": "ro60_ka_fn", "type": "function", "z": BRIDGE_TAB, "name": "keepalive + cereri R/ (fara W/)",
     "func": KA_FUNC % {"keys": json.dumps(KEYS)}, "outputs": 1, "timeout": 0, "noerr": 0,
     "initialize": "", "finalize": "", "libs": [], "x": 400, "y": 100, "wires": [["ro60_mqtt_out"]]},
    {"id": "ro60_mqtt_out", "type": "mqtt out", "z": BRIDGE_TAB, "name": "R/ -> Cerbo", "topic": "", "qos": "0",
     "retain": "false", "respTopic": "", "contentType": "", "userProps": "", "correl": "", "expiry": "",
     "broker": BROKER, "x": 640, "y": 100, "wires": []},
]
y = 180
for i, topic in enumerate(["N/+/system/0/#", "N/+/battery/512/#", "N/+/settings/0/Settings/#"]):
    bridge.append({"id": "ro60_in_%d" % i, "type": "mqtt in", "z": BRIDGE_TAB, "name": topic, "topic": topic,
                   "qos": "0", "datatype": "json", "broker": BROKER, "nl": False, "rap": True, "rh": 0,
                   "inputs": 0, "x": 170, "y": y, "wires": [["ro60_cache"]]})
    y += 50
bridge.append({"id": "ro60_cache", "type": "function", "z": BRIDGE_TAB, "name": "cache global vic_cache",
               "func": CACHE_FUNC, "outputs": 1, "timeout": 0, "noerr": 0, "initialize": "", "finalize": "",
               "libs": [], "x": 450, "y": 230, "wires": [[]]})

final = bridge + out_ctrl + out_b2
ids = [n["id"] for n in final]
assert len(ids) == len(set(ids)), "id duplicat"
with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(final, fh, ensure_ascii=False, indent=1)
print("controller:", s1, "| B2:", s2, "| chei MQTT:", len(KEYS), "| noduri total:", len(final))
print("\n".join(KEYS))
