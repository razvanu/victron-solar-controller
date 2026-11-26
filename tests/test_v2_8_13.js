#!/usr/bin/env node
'use strict';
// v2.8.13 regression tests. They execute the real Node-RED function bodies from the flow export
// in a sandbox (flow context, env and clock are simulated). No network, no Cerbo, no Home Assistant.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', 'flows', 'Victron_Solar_Forecast_Charge_Controller_v2_8_13.json');
const nodes = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = id => { const n = nodes.find(x => x.id === id); if (!n) throw new Error('missing node ' + id); return n; };
const ID = { config: 'v212_00000004', parser: 'v212_00000009', controller: 'v212_00000028', guard: 'v212_00000061', events: 'v212_00000039', telegram: 'v212_00000036' };

let passed = 0;
function check(cond, label) { if (!cond) throw new Error('FAIL: ' + label); passed++; }
function eq(a, b, label) { if (a !== b) throw new Error(`FAIL: ${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); passed++; }

class Sim {
  constructor(now = Date.UTC(2026, 10, 20, 9, 0, 0), env = {}) {
    this.now = now; this.store = new Map(); this.env = env;
    this.flow = { get: k => this.store.get(k), set: (k, v) => this.store.set(k, v) };
  }
  run(id, msg = {}) {
    const self = this;
    const FakeDate = class extends Date {
      constructor(...a) { if (a.length) super(...a); else super(self.now); }
      static now() { return self.now; }
    };
    const ctx = vm.createContext({ msg, flow: this.flow, node: { status() {}, warn() {}, error() {} },
      env: { get: k => this.env[k] }, Date: FakeDate, Math, Number, String, Object, Array, JSON, Intl, Set, Map,
      isFinite, parseFloat, parseInt, console, Buffer });
    return new vm.Script(`(function(){${byId(id).func}\n})()`, { filename: id + '.js' }).runInContext(ctx);
  }
  advance(ms) { this.now += ms; }
  set(k, v, ageMs = 0) { this.store.set(k, v); this.store.set(k + '_ts', this.now - ageMs); }
  get(k) { return this.store.get(k); }
}

// ---------- helpers ----------
function haEntity(id, state, { reportedAgoMs = 10000, unit, attrs = {} } = {}, now) {
  const t = new Date(now - reportedAgoMs).toISOString();
  return { entity_id: id, state: String(state), last_updated: t, last_reported: t, last_changed: t,
    attributes: Object.assign(unit ? { unit_of_measurement: unit } : {}, attrs) };
}

function boot(env = {}, now) {
  const sim = new Sim(now, env);
  sim.run(ID.config, {});
  return sim;
}

function parse(sim, { soc = 43, power = 0, socAgo = 10000, powerAgo = 10000, powerUnit = 'W', omitPower = false, powerState } = {}) {
  const cfg = sim.get('solar_cfg');
  const payload = [haEntity(cfg.entityHuaweiSoc, soc, { reportedAgoMs: socAgo, unit: '%' }, sim.now),
                   haEntity(cfg.entityBatteryPriority, 'Automat', {}, sim.now)];
  if (!omitPower) payload.push(haEntity(cfg.entityHuaweiBatteryPower, powerState ?? power, { reportedAgoMs: powerAgo, unit: powerUnit }, sim.now));
  sim.run(ID.parser, { payload });
}

module.exports = { Sim, boot, parse, haEntity, byId, ID, check, eq, nodes };

// ======================= Huawei data validity (parser) =======================
{
  const sim = boot();
  parse(sim, { power: -250, powerAgo: 30000 });
  eq(sim.get('at_huawei_power'), -250, 'standard entity without huawei_read_* is valid when 30 s old');
  eq(sim.get('at_huawei_power_ts'), sim.now, 'freshness is counted from receipt');
  eq(sim.get('at_huawei_soc'), 43, 'Huawei SOC valid without huawei_read_*');

  parse(sim, { power: 100, powerAgo: 121000 });
  eq(sim.get('at_huawei_power'), null, 'value older than 120 s is invalid');

  parse(sim, { powerState: 'unavailable' });
  eq(sim.get('at_huawei_power'), null, '"unavailable" is invalid');

  parse(sim, { power: 1.5, powerUnit: 'kW' });
  eq(sim.get('at_huawei_power'), 1500, 'kW converted to W');

  parse(sim, { omitPower: true });
  eq(sim.get('at_huawei_power'), null, 'missing entity is invalid');

  const sim2 = boot();
  sim2.get('solar_cfg').huaweiDataMaxAgeMs = 60000;
  parse(sim2, { power: 10, powerAgo: 90000 });
  eq(sim2.get('at_huawei_power'), null, 'max age is configurable');

  // Control: the v2.8.12 baseline rejects the same fresh standard entity (root cause of 0 A).
  const base = JSON.parse(fs.readFileSync(FILE.replace('v2_8_13', 'v2_8_12'), 'utf8'));
  const sim3 = boot();
  const cfg = sim3.get('solar_cfg');
  const payload = [haEntity(cfg.entityHuaweiBatteryPower, -250, { reportedAgoMs: 5000, unit: 'W' }, sim3.now)];
  const ctx = vm.createContext({ msg: { payload }, flow: sim3.flow, node: { status() {} }, Date, Math, Number, String, Object, Array, JSON });
  new vm.Script(`(function(){${base.find(n => n.id === ID.parser).func}\n})()`).runInContext(ctx);
  eq(sim3.get('at_huawei_power'), null, 'baseline v2.8.12 parser rejects standard huawei_solar entity');
}

// ======================= controller helpers =======================
function live(sim, { soc = 40, V = 53, I = 40, g1 = 0, g2 = 0, g3 = 0, setpoint = 0, maxCell = 3.30, minCell = 3.28,
  ccl = 145, cvl = 56.4, temp = 15, pvOut = {}, consOut = {} } = {}) {
  for (const [k, v] of Object.entries({ soc, battery_voltage: V, battery_current: I, grid_l1: g1, grid_l2: g2, grid_l3: g3,
    ess_grid_setpoint: setpoint, bms_connected: 1, bms_ccl: ccl, bms_cvl: cvl, bms_max_cell: maxCell, bms_min_cell: minCell, bms_temp: temp }))
    if (v !== undefined) sim.set(k, v);
  for (const ph of ['l1', 'l2', 'l3']) {
    if (pvOut[ph] !== undefined) sim.set('pv_on_output_' + ph, pvOut[ph]);
    if (consOut[ph] !== undefined) sim.set('cons_on_output_' + ph, consOut[ph]);
  }
}
function tick(sim, telemetry, huawei) {
  if (huawei !== undefined) parse(sim, huawei);
  if (telemetry) live(sim, telemetry);
  const ret = sim.run(ID.controller, {});
  return { out: ret && ret[0] ? ret[0].payload : null, s: sim.get('controller_status') };
}
function guard(sim, requested) { const r = sim.run(ID.guard, { payload: requested }); return r ? r.payload : null; }
const HUAWEI_IDLE = { power: 0, soc: 43 };

// ======================= (a) SURPLUS-FIRST =======================
{
  // Sun + Huawei valid: export starts surplus-first; ceiling ratchets until the export is absorbed.
  const sim = boot();
  let r = tick(sim, { soc: 40, I: 47, g1: 1600, g2: -100, g3: -3500 }, HUAWEI_IDLE);   // NET -2000 W
  eq(r.s.surplusFirstActive, true, 'export enters surplus-first');
  eq(r.s.energyDecision, 'SURPLUS_FIRST_MAX', 'strategy ignores Solcast target while exporting');
  eq(r.s.strategyA, 100, 'strategy = hardMaxA');
  eq(r.s.residualMode, 'EXPORT_UP', 'residual ceiling ratchets up on export');
  check(r.out > 50, `ceiling above old 50 A normal limit (got ${r.out})`);
  const first = r.out;
  sim.advance(5000);
  r = tick(sim, { soc: 40, I: 69, g1: 1600, g2: -100, g3: -1800 });                      // still -300 W
  check(r.out > first, `ceiling keeps rising while export remains (${first} -> ${r.out})`);
  const high = r.out;
  sim.advance(5000);
  r = tick(sim, { soc: 40, I: 74, g1: 1600, g2: -100, g3: -1520 });                      // NET -20 W (absorbed)
  eq(r.s.residualMode, 'HOLD', 'inside deadband the ceiling is held');
  eq(r.out, high, 'held ceiling does not decay while the export is absorbed');

  // Sudden cloud: import appears -> ceiling falls back to measured current immediately.
  sim.advance(5000);
  r = tick(sim, { soc: 40, I: 60, g1: 1600, g2: -100, g3: -1100 });                      // NET +400 W import
  eq(r.s.residualMode, 'IMPORT_DOWN', 'import switches to measured-current ceiling');
  check(r.out < 60, `ceiling below measured current on import (got ${r.out})`);
  for (let i = 0; i < 12; i++) { sim.advance(5000); r = tick(sim, { soc: 40, I: 20, g1: 1600, g2: -100, g3: -1100 }); }
  eq(r.s.surplusFirstActive, false, 'sustained filtered import leaves surplus-first');
  eq(r.s.residualMode, 'MEASURED', 'outside surplus-first the legacy residual formula is used');
}
{
  // Surplus-first is held while Hailei keeps absorbing, then expires after the hold time.
  const sim = boot();
  tick(sim, { soc: 40, I: 30, g3: -2000 }, HUAWEI_IDLE);
  let r;
  for (let i = 0; i < 3; i++) { sim.advance(300000); parse(sim, HUAWEI_IDLE); r = tick(sim, { soc: 40, I: 60, g3: 0 }); }
  eq(r.s.surplusFirstActive, true, 'kept active while charging above keep-charging current');
  sim.advance(300000); parse(sim, HUAWEI_IDLE);
  r = tick(sim, { soc: 40, I: 1, g3: 0 });
  eq(r.s.surplusFirstActive, false, 'expires after hold when Hailei stopped charging and no export');
}
{
  // ESS setpoint asking for import disables surplus-first (ESS must only charge from surplus).
  const sim = boot();
  const r = tick(sim, { soc: 40, I: 40, g3: -2000, setpoint: 500 }, HUAWEI_IDLE);
  eq(r.s.surplusFirstActive, false, 'surplus-first refused when ESS setpoint > 50 W');
  eq(r.s.essSetpointOk, false, 'status flags the ESS setpoint');
  // The flow never writes ESS setpoint / ForceCharge: the only Victron output is the DVCC writer.
  const outputs = nodes.filter(n => String(n.type).startsWith('victron-output'));
  eq(outputs.length, 1, 'exactly one Victron output node');
  eq(outputs[0].path, '/Settings/SystemSetup/MaxChargeCurrent', 'the only output is DVCC MaxChargeCurrent');
}
{
  // Target reached (SOC above Solcast target) no longer stops surplus charging; SOC taper still applies.
  const sim = boot();
  const r = tick(sim, { soc: 92, I: 10, g3: -2500 }, HUAWEI_IDLE);
  eq(r.s.blocked, true, 'Solcast target reached (plan only)');
  eq(r.s.surplusFirstActive, true, 'surplus-first still active above target');
  check(r.out > 20, `controller ceiling above taper before guard (got ${r.out})`);
  eq(guard(sim, r.out), 20, 'charge guard: SOC 90-95% -> 20 A');
  sim.set('soc', 99);
  eq(guard(sim, 100), 3, 'charge guard: SOC 99% -> 3 A');
  sim.set('soc', 100);
  eq(guard(sim, 100), 0, 'charge guard: SOC 100% -> 0 A');
}
{
  // Max cell >= 3.45 V: raw cell protection (v2.8.12 thresholds) wins over surplus-first.
  const sim = boot();
  const r = tick(sim, { soc: 70, I: 40, g3: -3000, maxCell: 3.45, minCell: 3.43 }, HUAWEI_IDLE);
  eq(r.s.surplusFirstActive, true, 'surplus-first active');
  check(r.out > 10, 'controller requests more than the cell cap');
  eq(guard(sim, r.out), 10, 'cell >= 3.45 V -> 10 A');
  live(sim, { maxCell: 3.49, minCell: 3.47 }); eq(guard(sim, 100), 2, 'cell >= 3.49 V -> 2 A');
  const sim2 = boot();
  tick(sim2, { soc: 70, I: 40, g3: -3000, maxCell: 3.52, minCell: 3.50 }, HUAWEI_IDLE);
  eq(guard(sim2, 100), 0, 'cell >= 3.52 V -> stop 0 A');
  const sim3 = boot();
  tick(sim3, { soc: 50, I: 40, g3: -3000, temp: 50 }, HUAWEI_IDLE);
  eq(guard(sim3, 100), 0, 'temperature >= 50 C -> stop 0 A');
}
{
  // Huawei discharging for real: anti-transfer still blocks, even during surplus-first.
  const sim = boot();
  const r = tick(sim, { soc: 40, I: 5, g3: -2000 }, { power: -1500, soc: 60 });
  eq(r.s.antiTransfer.blocked, true, 'real Huawei discharge blocks');
  eq(r.out, 0, 'DVCC request 0 A while Huawei discharges');
}
{
  // Grid Guard still trips on import while charging (unchanged).
  const sim = boot();
  let r;
  for (let i = 0; i < 10; i++) { r = tick(sim, { soc: 40, I: 40, g1: 900 }, HUAWEI_IDLE); sim.advance(5000); }
  eq(r.s.gridGuard, true, 'Grid Guard trips on sustained import while charging');
  check(r.out < 40, 'Grid Guard lowers the ceiling');
}

// ======================= (b) ANTI-TRANSFER DEGRADED MODE =======================
const SUN_L1 = { soc: 40, V: 53, I: 40, g1: -500, g3: -1500, pvOut: { l1: 3000 }, consOut: { l1: 500 } };
const HUAWEI_GONE = { powerState: 'unavailable', soc: 43 };
function expectedPvCap(sim, pv, cons, V) {
  const cfg = sim.get('solar_cfg');
  return Math.max(0, Math.floor(Math.max(0, pv - cons - cfg.degradedVictronPvMarginW) * cfg.chargeEfficiency / V));
}
{
  // Sun + Huawei invalid right after start (no previous valid decision): straight to Victron-PV-only cap, never 0 A.
  const sim = boot();
  const r = tick(sim, SUN_L1, HUAWEI_GONE);
  eq(r.s.antiTransfer.degradedState, 'DEGRADED', 'no valid Huawei history -> DEGRADED immediately');
  eq(r.s.antiTransfer.reason, 'DEGRADED_VICTRON_PV_ONLY', 'reason');
  eq(r.s.antiTransfer.blocked, false, 'degraded mode does not block');
  const cap = expectedPvCap(sim, 3000, 500, 53);
  eq(r.s.antiTransfer.degradedCapA, cap, 'cap = (PV AC-OUT - consumption AC-OUT - margin) * eff / V');
  check(cap > 0 && r.out === cap, `ceiling limited to Victron PV only (${r.out} A)`);
}
{
  // Huawei valid -> invalid: 5 min grace keeps the last valid decision, then degraded, then automatic recovery.
  const sim = boot();
  let r = tick(sim, SUN_L1, HUAWEI_IDLE);
  eq(r.s.antiTransfer.degradedState, 'NORMAL', 'valid Huawei data -> NORMAL');
  const normalOut = r.out;
  sim.advance(5000);
  r = tick(sim, SUN_L1, HUAWEI_GONE);
  eq(r.s.antiTransfer.degradedState, 'GRACE', 'invalid -> GRACE');
  eq(r.s.antiTransfer.blocked, false, 'grace keeps last decision (not blocked)');
  check(r.out >= normalOut, 'grace does not cut the ceiling to the PV-only cap');
  sim.advance(299000);
  r = tick(sim, SUN_L1, HUAWEI_GONE);
  eq(r.s.antiTransfer.degradedState, 'GRACE', 'still GRACE at 4 min 59 s');
  sim.advance(2000);
  r = tick(sim, SUN_L1, HUAWEI_GONE);
  eq(r.s.antiTransfer.degradedState, 'DEGRADED', 'DEGRADED after 5 min');
  eq(r.out, expectedPvCap(sim, 3000, 500, 53), 'PV-only cap applied after grace');
  sim.advance(5000);
  r = tick(sim, SUN_L1, HUAWEI_IDLE);
  eq(r.s.antiTransfer.degradedState, 'NORMAL', 'automatic recovery when Huawei data is valid again');
}
{
  // Grace after a blocking decision (Huawei was discharging): stays blocked during grace, then PV-only cap.
  const sim = boot();
  let r = tick(sim, SUN_L1, { power: -1500, soc: 60 });
  eq(r.out, 0, 'Huawei discharging -> 0 A');
  sim.advance(5000);
  r = tick(sim, SUN_L1, HUAWEI_GONE);
  eq(r.s.antiTransfer.degradedState, 'GRACE', 'GRACE after blocking decision');
  eq(r.out, 0, 'grace keeps the block');
  sim.advance(301000);
  r = tick(sim, SUN_L1, HUAWEI_GONE);
  eq(r.s.antiTransfer.degradedState, 'DEGRADED', 'then DEGRADED');
  eq(r.out, expectedPvCap(sim, 3000, 500, 53), 'PV-only energy cannot come from the Huawei battery');
}
{
  // Degraded + Victron PV telemetry missing: fail safe at 0 A with an explicit reason.
  const sim = boot();
  const r = tick(sim, { soc: 40, I: 40, g3: -2000 }, HUAWEI_GONE);
  eq(r.s.antiTransfer.reason, 'DEGRADED_VICTRON_PV_MISSING', 'missing PV-on-output telemetry');
  eq(r.out, 0, 'no PV telemetry -> 0 A');
  // Night: Fronius 0 W -> nothing to charge from in degraded mode.
  const sim2 = boot();
  eq(tick(sim2, { soc: 40, I: 0, g1: 300, pvOut: { l1: 0 }, consOut: { l1: 400 } }, HUAWEI_GONE).out, 0, 'night in degraded mode -> 0 A');
}
{
  // Victron data missing -> 0 A (unchanged LIVE_MISSING path).
  const sim = boot();
  parse(sim, HUAWEI_IDLE);
  live(sim, { soc: 40, I: 40, g3: -2000 });
  sim.store.set('battery_voltage', null);
  const ret = sim.run(ID.controller, {});
  eq(ret[0].payload, 0, 'Victron telemetry missing -> 0 A');
  eq(sim.get('controller_status').controllerFault, 'LIVE_MISSING', 'LIVE_MISSING fault');
}
{
  // Telegram: DEGRADED enter/exit alerts are sent even with /alerts OFF.
  const sim = boot();
  sim.get('solar_cfg').telegramEnabled = true;
  sim.store.set('alerts_enabled', false);
  const alerts = () => { const r = sim.run(ID.events, {}); return (r && r[0] || []).filter(m => m.telegram_command === '__alert_safety'); };
  tick(sim, SUN_L1, HUAWEI_IDLE);
  eq(alerts().length, 0, 'no alert in NORMAL');
  sim.advance(5000); tick(sim, SUN_L1, HUAWEI_GONE); eq(alerts().length, 0, 'no alert during GRACE');
  sim.advance(301000); tick(sim, SUN_L1, HUAWEI_GONE);
  const a = alerts(); eq(a.length, 1, 'alert on entering DEGRADED');
  check(/ANTI-TRANSFER DEGRADAT/.test(a[0].telegram_event_text), 'degraded alert text');
  sim.advance(5000); tick(sim, SUN_L1, HUAWEI_IDLE);
  const b = alerts(); eq(b.length, 1, 'alert on leaving DEGRADED');
  check(/ANTI-TRANSFER NORMAL/.test(b[0].telegram_event_text), 'recovery alert text');
  // The Telegram node delivers __alert_safety regardless of /alerts.
  sim.store.set('controller_status', sim.get('controller_status'));
  const sent = sim.run(ID.telegram, { telegram_internal: true, telegram_command: '__alert_safety', telegram_event_text: 'x' });
  check(Array.isArray(sent) && sent[0] !== null, '__alert_safety is not dropped when /alerts is OFF');
}

// ======================= (c) CONFIGURABLE PHASES =======================
{
  const sim = boot();
  const cfg = sim.get('solar_cfg');
  eq(cfg.victronPhase, 'L1', 'default Victron phase L1 (MultiPlus + Fronius moved 2026-11-08)');
  eq(cfg.huaweiPhase, 'L3', 'default Huawei hybrid phase L3');
  const configText = byId(ID.config).func;
  check(!/Hailei\/Victron L2/.test(configText), 'no hard-coded "Victron L2" comment left');
  // Degraded cap follows the configured Victron phase.
  cfg.victronPhase = 'L2';
  let r = tick(sim, { soc: 40, I: 40, g3: -2000, pvOut: { l1: 3000, l2: 1100 }, consOut: { l1: 500, l2: 100 } }, HUAWEI_GONE);
  eq(r.s.antiTransfer.degradedCapA, expectedPvCap(sim, 1100, 100, 53), 'degraded cap uses PV/consumption of victronPhase=L2');
  eq(r.s.antiTransfer.victronPhase, 'L2', 'status reports Victron phase');
  cfg.victronPhase = 'L4';
  r = tick(sim, { soc: 40, I: 40, g3: -2000 }, HUAWEI_GONE);
  eq(r.s.antiTransfer.reason, 'DEGRADED_PHASE_CONFIG_INVALID', 'invalid phase config is explicit');
  eq(r.out, 0, 'invalid phase config -> 0 A in degraded mode');
  // All three PV/consumption-on-output paths are read.
  for (const ph of ['L1', 'L2', 'L3'])
    for (const p of ['PvOnOutput', 'ConsumptionOnOutput'])
      eq(nodes.filter(n => n.path === `/Ac/${p}/${ph}/Power`).length, 1, `input ${p} ${ph}`);
  // /phases labels follow the configuration.
  const sim2 = boot();
  sim2.get('solar_cfg').telegramEnabled = true;
  sim2.get('solar_cfg').telegramChatId = '1';
  tick(sim2, SUN_L1, HUAWEI_IDLE);
  const ret = sim2.run(ID.telegram, { telegram_chat_id: '1', telegram_command: '/phases', telegram_args: [] });
  const text = JSON.stringify(ret);
  check(/L1 \(Victron\)/.test(text) && /L3 \(Huawei\)/.test(text), '/phases shows Victron L1 and Huawei L3');
}

// ======================= (d) START AFTER RESTART =======================
{
  // Default: DRY RUN after every restart/deploy.
  const sim = boot();
  eq(sim.get('controller_enabled'), false, 'default start is DRY RUN');
  check(/activeAfterRestart: false,/.test(byId(ID.config).func), 'activeAfterRestart defaults to false');

  // Opt-in: active after restart, and missing Huawei data right after boot does not lock 0 A.
  const cfgNode = byId(ID.config);
  const original = cfgNode.func;
  try {
    cfgNode.func = original.replace('activeAfterRestart: false,', 'activeAfterRestart: true,');
    const sim2 = boot();
    eq(sim2.get('controller_enabled'), true, 'activeAfterRestart=true starts ACTIVE');
    eq(sim2.get('controller_events')[0].kind, 'RESTART_ACTIVE', 'restart-active event queued for Telegram');
    const r = tick(sim2, SUN_L1, HUAWEI_GONE);
    eq(r.s.enabled, true, 'controller reports enabled');
    check(r.out > 0, `restart without Huawei data -> degraded ceiling ${r.out} A, not 0 A`);
  } finally { cfgNode.func = original; }
}

// ======================= (e) /why and /limits =======================
function telegram(sim, cmd) {
  const cfg = sim.get('solar_cfg'); cfg.telegramEnabled = true; cfg.telegramChatId = '1';
  const ret = sim.run(ID.telegram, { telegram_chat_id: '1', telegram_command: cmd, telegram_args: [] });
  return JSON.stringify(ret);
}
{
  const sim = boot();
  let r = tick(sim, { soc: 40, I: 47, g3: -2000 }, HUAWEI_IDLE);
  eq(r.s.capSource, 'RESIDUAL_NET_SURPLUS', 'binding ceiling while ratcheting is the residual NET surplus');
  check(r.s.surplusAvailableW >= 2000, 'surplus available = export + Hailei charging power');
  for (const cmd of ['/why', '/limits']) {
    const t = telegram(sim, cmd);
    check(/Mod ANTI-TRANSFER: NORMAL/.test(t), `${cmd} shows anti-transfer mode`);
    check(/Surplus-first: ACTIV/.test(t), `${cmd} shows surplus-first`);
    check(/Sursa plafonului: RESIDUAL_NET_SURPLUS/.test(t), `${cmd} shows ceiling source`);
    check(/Surplus disponibil \d+ W/.test(t), `${cmd} shows available surplus`);
  }
  const sim2 = boot();
  r = tick(sim2, SUN_L1, HUAWEI_GONE);
  eq(r.s.capSource, 'DEGRADED_VICTRON_PV', 'binding ceiling in degraded mode');
  const t = telegram(sim2, '/why');
  check(/DEGRADAT \(numai PV Victron\)/.test(t) && /Plafon PV Victron \d+ A/.test(t), '/why explains degraded cap');
  const sim3 = boot();
  r = tick(sim3, { soc: 40, I: 5, g3: -2000 }, { power: -1500, soc: 60 });
  eq(r.s.capSource, 'ANTI_TRANSFER_BLOCK', 'binding ceiling when Huawei discharges');
}

module.exports.tick = tick; module.exports.live = live; module.exports.guard = guard;
if (require.main === module) console.log(`PASS: ${passed} v2.8.13 checks`);
