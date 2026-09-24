#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const nodes = JSON.parse(fs.readFileSync(path.join(root, 'flows', 'Victron_Solar_Forecast_Charge_Controller_v2_8_4.json'), 'utf8'));
const guardNode = nodes.find(n => n.id === 'v282_charge_guard');
if (!guardNode) throw new Error('charge guard node missing');

function assertEq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function runGuard({now=1_700_000_000_000, soc=51, max=3.35, min=3.34, requested=100, commissioning=false, commissioningPresent=true, stale=false, discharge=false, state=null}) {
  const store = new Map();
  const cfg = {hardMaxA:100};
  if (commissioningPresent) cfg.commissioningChargeCapEnabled = commissioning;
  store.set('solar_cfg', cfg);
  const ts = stale ? now - 20001 : now;
  for (const [k,v] of Object.entries({soc, bms_max_cell:max, bms_min_cell:min})) {
    store.set(k, v); store.set(k+'_ts', ts);
  }
  store.set('source_faults', {});
  if (state) store.set('cell_guard_state', {...state});
  if (discharge) store.set('discharge_request', {id:'test'});

  const flow = {get:k=>store.get(k), set:(k,v)=>store.set(k,v)};
  const node = {status:()=>{}};
  const msg = {payload:requested};
  const FakeDate = class extends Date { static now(){ return now; } };
  const context = vm.createContext({flow, node, msg, Date:FakeDate, Math, Number, String, Object, Array, JSON, console});
  const wrapped = `(function(){${guardNode.func}\n})()`;
  const ret = new vm.Script(wrapped, {filename:'charge_guard.js'}).runInContext(context);
  return {payload: ret ? ret.payload : null, guard: store.get('charge_guard'), state: store.get('cell_guard_state')};
}

const cases = [
  [{soc:51, max:3.35, min:3.34, requested:50}, 50, 'normal 50A below 90%'],
  [{soc:51, max:3.35, min:3.34, requested:100}, 100, '100A request not globally capped'],
  [{soc:90, max:3.35, min:3.34}, 10, 'SOC 90 cap'],
  [{soc:95, max:3.35, min:3.34}, 5, 'SOC 95 cap'],
  [{soc:98, max:3.35, min:3.34}, 2, 'SOC 98 cap'],
  [{soc:51, max:3.40, min:3.39}, 10, 'max cell 3.40 cap'],
  [{soc:51, max:3.43, min:3.42}, 5, 'max cell 3.43 cap'],
  [{soc:51, max:3.45, min:3.44}, 2, 'max cell 3.45 cap'],
  [{soc:51, max:3.41, min:3.35}, 2, 'delta >=50mV with max>=3.40 cap'],
  [{soc:51, max:3.50, min:3.49}, 0, '3.50V hard stop'],
  [{soc:51, max:3.50, min:3.39}, 0, 'high delta hard stop'],
  [{soc:51, max:3.35, min:3.34, stale:true}, 0, 'stale telemetry stops charge'],
  [{soc:51, max:3.35, min:3.34, commissioning:true}, 10, 'commissioning boolean true caps 10A'],
  [{soc:51, max:3.35, min:3.34, commissioningPresent:false}, 100, 'missing commissioning setting does not cap'],
  [{soc:51, max:3.35, min:3.34, discharge:true}, 0, 'discharge interlock'],
];

for (const [input, expected, label] of cases) assertEq(runGuard(input).payload, expected, label);

// Recovery requires 60 seconds continuously safe after a latched stop.
const t0 = 1_700_000_000_000;
let r = runGuard({now:t0, soc:51, max:3.42, min:3.40, state:{blocked:true,safeSince:0,started:t0-1000}});
assertEq(r.payload, 0, 'latched stop remains during recovery window');
const safeSince = r.state.safeSince;
r = runGuard({now:safeSince+60001, soc:51, max:3.42, min:3.40, state:r.state});
assertEq(r.state.blocked, false, 'latched stop releases after 60s safe');
assertEq(r.payload, 10, 'charge resumes under preventive 3.40V cell cap');

console.log(`PASS: ${cases.length + 3} charge-guard regression checks`);
