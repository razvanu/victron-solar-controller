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

if (require.main === module) console.log(`PASS: ${passed} v2.8.13 checks`);
