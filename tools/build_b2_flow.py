#!/usr/bin/env python3
"""Builds flows/B2_Export_Phase_Setpoint_v0_3.json (separate Node-RED tab, DRY RUN by default).

B2: with ESS 'Multiphase regulation = Individual phase' (Hub4Mode 2) the MultiPlus regulates only L1.
To keep charging Hailei from the 4KTL (PV-only) inverter that sits on another phase, the L1 grid setpoint
(/Settings/CGwacs/AcPowerSetPoint) is set to the export measured on that phase (B2_EXPORT_PHASE = 'L2' default, or 'L3'),
so L1 imports exactly what that phase exports (net 0 on the vector-sum meter).
Everything runs locally on the Cerbo (grid meter via dbus), no Home Assistant dependency.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "flows", "B2_Export_Phase_Setpoint_v0_3.json")
TAB = "b2l2_00000000"
N = []
def nid(n): return "b2l2_%08x" % n

CONFIG = r"""// B2 v0.3 CONFIG – reviewed constants. DRY RUN is the default after every deploy/restart.
flow.set('b2_cfg', {
  version: 'B2 v0.3',
  B2_EXPORT_PHASE: 'L2',       // phase of the 4KTL (PV-only) inverter whose export B2 follows: 'L2' (today) or 'L3'. Never 'L1'.
  MAX_W: 3000,                 // hard cap for the L1 import setpoint (worst case if Node-RED hangs)
  OFFSET_W: 50,                // keep a little export on the export phase (never chase the last watts)
  STALE_MS: 10000,             // export-phase power older than this -> target 0
  DEADBAND_W: 100,             // write only when the value changes by >= 100 W ...
  MIN_INTERVAL_MS: 30000,      // ... and at most once per 30 s (AcPowerSetPoint is a persistent setting -> flash)
  FAST_MIN_MS: 5000,           // going to 0, or dropping >= FAST_DROP_W, may bypass the 30 s limit (min 5 s)
  FAST_DROP_W: 500,
  RAMP_UP_W_PER_TICK: 250,     // +250 W per 5 s tick (= 500 W / 10 s); decreases are immediate
  SOC_FULL: 98,                // Hailei SOC (Venus system) at/above this -> target 0
  REQUIRED_HUB4MODE: 2,        // 2 = Optimized, phase compensation DISABLED (Individual phase). Never write in mode 1/3.
  VBAT_MIN: 40, VBAT_MAX: 65,
  CHARGER_MAX_A: 100,          // MultiPlus-II 48/6k5/100 charger
  TICK_MS: 5000,
  DVCC_STALE_MS: 600000,      // DVCC is a setting: dbus sends it on change; refreshed by the startup/inject re-read
  RESET_NONZERO_ON_START: false // DRY RUN PR: only log. Set true when going LIVE (B2 then owns the setpoint).
});
if (flow.get('b2_enabled') === undefined) flow.set('b2_enabled', false);
node.status({fill: 'grey', shape: 'ring', text: 'B2 v0.3 config loaded (DRY RUN, export ' + flow.get('b2_cfg').B2_EXPORT_PHASE + ')'});
return null;"""

def store(key, lo, hi):
    return ("const r=msg.payload;\n"
            "const v=(r===null||r===undefined||typeof r===\"boolean\"||String(r).trim()===\"\")?NaN:Number(r);\n"
            "const valid=Number.isFinite(v)&&v>=%s&&v<=%s;\n"
            "flow.set(\"%s\",valid?v:null);flow.set(\"%s_ts\",valid?Date.now():0);\n"
            "return null;" % (lo, hi, key, key))

CONTROLLER = r"""// B2 v0.3 – L1 grid setpoint = export on B2_EXPORT_PHASE (L2/L3). Runs every 5 s. Output 1 -> AcPowerSetPoint (LIVE only).
const C = flow.get('b2_cfg');
if (!C) { node.status({fill: 'red', shape: 'dot', text: 'B2: no config'}); return null; }
const now = Date.now();
const g = k => flow.get(k);
const fresh = (k, ms) => { const ts = g(k + '_ts') || 0; return ts > 0 && now - ts <= ms; };
const live = g('b2_enabled') === true;
const day = new Date(now + 2 * 3600 * 1000).toISOString().slice(0, 10);   // local date (EET), only for daily counters
let st = g('b2_stats');
if (!st || st.day !== day) { if (st) flow.set('b2_stats_prev', st); st = {day, would: 0, sent: 0, fast: 0, maxTarget: 0, absorbedWh: 0, ticks: 0}; }

const reasons = [];
const ph = C.B2_EXPORT_PHASE;
const phaseOk = ph === 'L2' || ph === 'L3';           // L1 is the MultiPlus phase itself -> never valid
let p = null;
if (!phaseOk) reasons.push('PHASE_INVALID_' + ph);
else {
  const key = 'b2_grid_' + ph.toLowerCase();
  p = g(key);
  if (p === null || p === undefined || !fresh(key, C.STALE_MS)) reasons.push(ph + '_STALE');
}
const mode = g('b2_hub4mode');
const modeOk = mode === C.REQUIRED_HUB4MODE;
// LIVE: wrong ESS mode blocks everything. DRY RUN: computed as if Hub4Mode were 2, so the counters show what B2 WOULD do.
if (!modeOk && live) reasons.push('HUB4MODE_' + mode);
if (g('b2_bms_connected') !== 1) reasons.push('BMS_DISCONNECTED');
const ccl = g('b2_bms_ccl');
if (!(ccl > 0)) reasons.push('CCL_0');
const soc = g('b2_soc');
if (Number.isFinite(soc) && soc >= C.SOC_FULL) reasons.push('SOC_FULL');
const v = g('b2_bat_v');
if (!(Number.isFinite(v) && v >= C.VBAT_MIN && v <= C.VBAT_MAX)) reasons.push('VBAT_INVALID');

// DVCC limit currently applied (set by the v2.8.13 controller or Victron): -1 = no software limit, 0 = no charging.
const dvcc = g('b2_dvcc');
if (!Number.isFinite(dvcc) || !fresh('b2_dvcc', C.DVCC_STALE_MS)) reasons.push('DVCC_UNKNOWN');
else if (dvcc === 0) reasons.push('DVCC_0');
let capW = 0, capA = 0, target = 0;
if (!reasons.length) {
  capA = Math.min(ccl, C.CHARGER_MAX_A, dvcc > 0 ? dvcc : Infinity);   // min(BMS CCL, DVCC, charger)
  capW = Math.min(C.MAX_W, capA * v);
  target = Math.max(0, Math.min(capW, -p - C.OFFSET_W));
}
let cur = g('b2_cur') || 0;
cur = target > cur ? Math.min(target, cur + C.RAMP_UP_W_PER_TICK) : target;   // ramp up, drop immediately
flow.set('b2_cur', cur);
const want = Math.round(cur / 10) * 10;
const last = g('b2_last_sent') || 0;
const lastTs = g('b2_last_sent_ts') || 0;
const fast = (want === 0 && last > 0) || (last - want >= C.FAST_DROP_W);
const write = (Math.abs(want - last) >= C.DEADBAND_W && now - lastTs >= C.MIN_INTERVAL_MS) || (fast && now - lastTs >= C.FAST_MIN_MS);
if (write) {
  flow.set('b2_last_sent', want); flow.set('b2_last_sent_ts', now);
  if (live) st.sent++; else st.would++;
  if (fast) st.fast++;
}
const applied = write ? want : last;
st.ticks++;
st.maxTarget = Math.max(st.maxTarget, target);
if (Number.isFinite(p)) st.absorbedWh += Math.min(applied, Math.max(0, -p)) * C.TICK_MS / 3600000;
flow.set('b2_stats', st);
const status = {mode: live ? 'LIVE' : 'DRY_RUN', phase: ph, p, l2: g('b2_grid_l2'), l3: g('b2_grid_l3'), hub4mode: mode, modeOk, dvcc, capA,
                target, want, applied, capW, reasons, write, writesToday: live ? st.sent : st.would, ts: now};
flow.set('b2_status', status);
node.status({fill: live ? 'green' : 'grey', shape: live ? 'dot' : 'ring',
  text: `${status.mode}${modeOk ? '' : ' (Hub4Mode ' + mode + ')'} ${ph}=${Number.isFinite(p) ? Math.round(p) : '?'}W sp=${applied}W ${reasons.join(',') || 'OK'} | ${live ? 'scrieri' : 'ar fi scris'} azi: ${status.writesToday}`});
if (write && live) return {payload: want, topic: 'b2_setpoint'};
return null;"""

ENABLE = r"""// ENABLE (payload true) / DRY RUN (payload false). Not persistent: every restart/deploy = DRY RUN.
const C = flow.get('b2_cfg') || {REQUIRED_HUB4MODE: 2};
const wantLive = msg.payload === true;
const wasLive = flow.get('b2_enabled') === true;
if (wantLive) {
  const ph = C.B2_EXPORT_PHASE;
  if (ph !== 'L2' && ph !== 'L3') {
    flow.set('b2_enabled', false);
    node.warn('B2: ENABLE refuzat – B2_EXPORT_PHASE=' + ph + ' (doar L2 sau L3)');
    return null;
  }
  const mode = flow.get('b2_hub4mode');
  if (mode !== C.REQUIRED_HUB4MODE) {
    flow.set('b2_enabled', false);
    node.warn('B2: ENABLE refuzat – Hub4Mode=' + mode + ' (trebuie ' + C.REQUIRED_HUB4MODE + ' = Individual phase)');
    return null;
  }
  const sp = flow.get('b2_ess_setpoint');
  flow.set('b2_enabled', true); flow.set('b2_cur', 0);
  flow.set('b2_last_sent', Number.isFinite(sp) ? sp : 0); flow.set('b2_last_sent_ts', 0);
  node.warn('B2: LIVE');
  return null;
}
flow.set('b2_enabled', false);
flow.set('b2_cur', 0);
if (wasLive) {   // leave LIVE -> put the setpoint back to 0 once
  flow.set('b2_last_sent', 0); flow.set('b2_last_sent_ts', Date.now());
  node.warn('B2: DRY RUN – AcPowerSetPoint -> 0');
  return {payload: 0, topic: 'b2_setpoint'};
}
node.warn('B2: DRY RUN');
return null;"""

STARTUP = r"""// 20 s after start: B2 is DRY RUN; a non-zero AcPowerSetPoint can only be a leftover of a LIVE session.
const C = flow.get('b2_cfg') || {};
flow.set('b2_enabled', false); flow.set('b2_cur', 0);
const sp = flow.get('b2_ess_setpoint');
flow.set('b2_last_sent', Number.isFinite(sp) ? sp : 0); flow.set('b2_last_sent_ts', 0);
if (Number.isFinite(sp) && sp !== 0) {
  if (C.RESET_NONZERO_ON_START === true) {
    node.warn('B2 start: AcPowerSetPoint=' + sp + ' W -> 0');
    flow.set('b2_last_sent', 0); flow.set('b2_last_sent_ts', Date.now());
    return {payload: 0, topic: 'b2_setpoint'};
  }
  node.warn('B2 start: AcPowerSetPoint=' + sp + ' W (nenul) – DRY RUN: NU resetez (RESET_NONZERO_ON_START=false)');
}
return null;"""

SHOW = r"""// Show today's / yesterday's counters (button).
msg.payload = {status: flow.get('b2_status'), today: flow.get('b2_stats'), yesterday: flow.get('b2_stats_prev'), cfg: flow.get('b2_cfg')};
return msg;"""

def fn(i, name, func, x, y, wires, outputs=1):
    N.append({"id": nid(i), "type": "function", "z": TAB, "name": name, "func": func, "outputs": outputs, "timeout": 0,
              "noerr": 0, "initialize": "", "finalize": "", "libs": [], "x": x, "y": y, "wires": wires})
def inj(i, name, x, y, wires, repeat="", once=False, delay=0.1, payload="", ptype="date"):
    N.append({"id": nid(i), "type": "inject", "z": TAB, "name": name, "props": [{"p": "payload"}], "repeat": repeat, "crontab": "",
              "once": once, "onceDelay": delay, "topic": "", "payload": payload, "payloadType": ptype, "x": x, "y": y, "wires": wires})
def vin(i, typ, service, sname, path, pname, ptype, name, x, y, store_id):
    # Device identifiers as the Victron nodes 1.7.27 editor writes them on the Cerbo (user export 25.11, nodes reselected):
    # system service without "/0" + communityTag "system" -> the nodes do not show "disconnected" after import.
    so = {"service": service, "name": sname}
    if typ == "victron-input-system": so["communityTag"] = "system"
    n = {"id": nid(i), "type": typ, "z": TAB, "outputs": 1, "service": service, "path": path,
         "serviceObj": so, "pathObj": {"path": path, "type": ptype, "name": pname},
         "initial": "", "name": name, "onlyChanges": False, "roundValues": "no"}
    if typ == "victron-input-system":
        n.update({"conditionalMode": False, "condition1HysteresisEnabled": False, "condition1HysteresisThreshold": "",
                  "outputTrue": "", "outputFalse": "", "debounce": ""})
    n.update({"x": x, "y": y, "wires": [[nid(store_id)]]})
    N.append(n)

N.append({"id": TAB, "type": "tab", "label": "B2 v0.3 export (L2/L3) -> L1 grid setpoint - DRY RUN", "disabled": False,
          "info": "B2: setpoint L1 = export pe faza 4KTL (B2_EXPORT_PHASE in CONFIG: L2 implicit sau L3). Ruleaza doar cu ESS Individual phase (Hub4Mode 2). DRY RUN implicit; nu scrie nimic pana la ENABLE manual. Vezi docs/B2_L2_SETPOINT_RO.md."})
inj(1, "B2 CONFIG (startup)", 140, 40, [[nid(2)]], once=True, delay=1)
fn(2, "B2 CONFIG", CONFIG, 340, 40, [[]])
# inputs + stores
INPUTS = [
    (10, "victron-input-system", "com.victronenergy.system", "Venus system", "/Ac/Grid/L2/Power", "Grid L2 (W)", "float", "Grid L2 (Shelly B)", "b2_grid_l2", -30000, 30000),
    (26, "victron-input-system", "com.victronenergy.system", "Venus system", "/Ac/Grid/L3/Power", "Grid L3 (W)", "float", "Grid L3 (Shelly C)", "b2_grid_l3", -30000, 30000),
    (12, "victron-input-custom", "com.victronenergy.settings", "com.victronenergy.settings", "/Settings/CGwacs/Hub4Mode", "ess_mode", "float", "ESS Hub4Mode", "b2_hub4mode", 1, 3),
    (14, "victron-input-custom", "com.victronenergy.settings", "com.victronenergy.settings", "/Settings/CGwacs/AcPowerSetPoint", "ess_grid_setpoint", "float", "ESS AcPowerSetPoint (read)", "b2_ess_setpoint", -100000, 100000),
    (24, "victron-input-custom", "com.victronenergy.settings", "com.victronenergy.settings", "/Settings/SystemSetup/MaxChargeCurrent", "dvcc_max_charge_current", "float", "DVCC MaxChargeCurrent (read)", "b2_dvcc", -1, 1000),
    (16, "victron-input-custom", "com.victronenergy.battery/512", "VICTRON_CAN / CAN-bus BMS (512)", "/Info/MaxChargeCurrent", "/Info/MaxChargeCurrent", "number", "BMS CCL", "b2_bms_ccl", 0, 1000),
    (18, "victron-input-custom", "com.victronenergy.battery/512", "VICTRON_CAN / CAN-bus BMS (512)", "/Connected", "/Connected", "number", "BMS connected", "b2_bms_connected", 0, 1),
    (20, "victron-input-system", "com.victronenergy.system", "Venus system", "/Dc/Battery/Soc", "Battery State of Charge (%)", "float", "SOC Hailei (system)", "b2_soc", 0, 100),
    (22, "victron-input-system", "com.victronenergy.system", "Venus system", "/Dc/Battery/Voltage", "Battery voltage (V)", "float", "U baterie", "b2_bat_v", 0, 100),
]
y = 100
for i, typ, svc, sname, path, pname, ptype, name, key, lo, hi in INPUTS:
    vin(i, typ, svc, sname, path, pname, ptype, name, 160, y, i + 1)
    fn(i + 1, "store " + key, store(key, lo, hi), 420, y, [[]])
    y += 50
inj(30, "B2 tick / 5 sec", 140, 540, [[nid(31)]], repeat="5", once=True, delay=10)
fn(31, "B2 controller (export phase -> L1 setpoint)", CONTROLLER, 420, 540, [[nid(40)]])
inj(32, "B2 ENABLE (LIVE) - doar cu aprobare", 170, 600, [[nid(33)]], payload="true", ptype="bool")
inj(34, "B2 DRY RUN / disable", 150, 640, [[nid(33)]], payload="false", ptype="bool")
fn(33, "B2 enable / DRY RUN", ENABLE, 420, 620, [[nid(40)]])
inj(35, "B2 startup check (20 s)", 150, 690, [[nid(36)]], once=True, delay=20)
fn(36, "B2 startup check", STARTUP, 420, 690, [[nid(40)]])
N.append({"id": nid(40), "type": "victron-output-ess", "z": TAB, "outputs": 0, "service": "com.victronenergy.settings",
          "path": "/Settings/CGwacs/AcPowerSetPoint",
          "serviceObj": {"service": "com.victronenergy.settings", "name": "Venus settings", "communityTag": "ess"},
          "pathObj": {"path": "/Settings/CGwacs/AcPowerSetPoint", "type": "float", "name": "ESS control loop setpoint (W)", "mode": "both"},
          "initial": "", "name": "AcPowerSetPoint – B2 ONLY WRITER", "onlyChanges": False, "conditionalMode": False,
          "outputTrue": "", "outputFalse": "", "debounce": "", "x": 720, "y": 620, "wires": []})
inj(50, "B2 show counters", 140, 760, [[nid(51)]])
fn(51, "B2 counters", SHOW, 380, 760, [[nid(52)]])
N.append({"id": nid(52), "type": "debug", "z": TAB, "name": "B2 counters", "active": True, "tosidebar": True, "console": False,
          "tostatus": False, "complete": "payload", "targetType": "msg", "statusVal": "", "statusType": "auto", "x": 600, "y": 760, "wires": []})
with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    json.dump(N, f, ensure_ascii=False, indent=2); f.write("\n")
print("wrote", OUT, len(N), "nodes")
