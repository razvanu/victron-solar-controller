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

module.exports.tick = tick; module.exports.live = live; module.exports.guard = guard;
if (require.main === module) console.log(`PASS: ${passed} v2.8.13 checks`);
