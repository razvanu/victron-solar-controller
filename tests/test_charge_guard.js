#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const nodes = JSON.parse(fs.readFileSync(path.join(root, 'flows', 'Victron_Solar_Forecast_Charge_Controller_v2_8_5.json'), 'utf8'));
const guardNode = nodes.find(n => n.id === 'v282_charge_guard');
if (!guardNode) throw new Error('charge guard node missing');

function assertEq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function runGuard({now=1_700_000_000_000, soc=51, max=3.35, min=3.34, requested=100, commissioning=false, commissioningPresent=true, stale=false, discharge=false, force=false, state=null}) {
  const store = new Map();
  const cfg = {hardMaxA:100, socTopTaperStartPct:90, socTopTaperMidPct:95, socTopTaperTo95A:20, socTopTaperAbove95A:15, socTopTaperEndPct:100, forceBypassSocTaper:true};
  if (commissioningPresent) cfg.commissioningChargeCapEnabled = commissioning;
  store.set('solar_cfg', cfg);
  const ts = stale ? now - 20001 : now;
  for (const [k,v] of Object.entries({soc, bms_max_cell:max, bms_min_cell:min})) {
    store.set(k, v); store.set(k+'_ts', ts);
  }
  store.set('source_faults', {});
  if (state) store.set('cell_guard_state', {...state});
  if (discharge) store.set('discharge_request', {id:'test'});
  store.set('force_until', force ? now + 60_000 : 0);

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
  [{soc:90, max:3.35, min:3.34}, 20, 'SOC 90 cap 20A'],
  [{soc:95, max:3.35, min:3.34}, 20, 'SOC 95 cap remains 20A'],
  [{soc:95.1, max:3.35, min:3.34}, 15, 'just above 95 starts at 15A'],
  [{soc:96, max:3.35, min:3.34}, 12, 'SOC 96 linear taper'],
  [{soc:97, max:3.35, min:3.34}, 9, 'SOC 97 linear taper'],
  [{soc:98, max:3.35, min:3.34}, 6, 'SOC 98 linear taper'],
  [{soc:99, max:3.35, min:3.34}, 3, 'SOC 99 linear taper'],
  [{soc:100, max:3.35, min:3.34}, 0, 'SOC 100 reaches zero in normal mode'],
  [{soc:99, max:3.35, min:3.34, requested:50, force:true}, 50, 'FORCE bypasses SOC taper'],
  [{soc:99, max:3.40, min:3.39, requested:50, force:true}, 10, 'FORCE still respects 3.40V cell cap'],
  [{soc:99, max:3.43, min:3.42, requested:50, force:true}, 5, 'FORCE still respects 3.43V cell cap'],
  [{soc:99, max:3.45, min:3.44, requested:50, force:true}, 2, 'FORCE still respects 3.45V cell cap'],
  [{soc:99, max:3.41, min:3.35, requested:50, force:true}, 2, 'FORCE still respects delta taper'],
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
