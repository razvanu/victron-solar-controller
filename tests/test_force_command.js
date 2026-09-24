#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const nodes = JSON.parse(fs.readFileSync(path.join(root, 'flows', 'Victron_Solar_Forecast_Charge_Controller_v2_8_5.json'), 'utf8'));
const commandNode = nodes.find(n => n.id === '91b32ad72f6b4bae');
if (!commandNode) throw new Error('Telegram command node missing');

function assertEq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
function assertTrue(value, label) {
  if (!value) throw new Error(label);
}

function runForce(args) {
  const now = 1_700_000_000_000;
  const store = new Map();
  const cfg = {
    telegramEnabled:true, telegramChatId:'owner', telegramStatusMaxAgeMs:30000,
    liveMaxAgeMs:120000, bmsMaxAgeMs:120000, dvccReadbackMaxAgeMs:120000,
    forceDefaultMinutes:15, forceMinMinutes:1, forceMaxMinutes:60,
    forceMaxA:100, hardMaxA:100, timeZone:'Europe/Bucharest',
    targetDefaultMinutes:360, targetMaxMinutes:1440, targetMinSoc:20, targetMaxSoc:100,
    pauseMaxMinutes:1440, normalTargetSoc:86, socHysteresis:3,
    commissioningChargeCapEnabled:false
  };
  store.set('solar_cfg', cfg);
  store.set('controller_enabled', true);
  store.set('pause_until', 0);
  store.set('controller_status', {timestamp:now, bmsCcl:100, soc:92, desiredA:20});
  store.set('controller_health', {ok:true, timestamp:now, faults:[]});
  store.set('source_faults', {});
  const telemetry = {
    bms_max_cell:3.35, bms_min_cell:3.34, soc:92, battery_voltage:53.5,
    battery_current:10, grid_l1:-500, grid_l2:-500, grid_l3:-500,
    bms_connected:1, bms_ccl:100, bms_cvl:56.8, dvcc_actual:20
  };
  for (const [k,v] of Object.entries(telemetry)) {
    store.set(k,v); store.set(k+'_ts',now);
  }
  const flow = {get:k=>store.get(k), set:(k,v)=>store.set(k,v)};
  const msg = {telegram_command:'/force', telegram_args:args, telegram_chat_id:'owner', telegram_private_owner:true};
  const FakeDate = class extends Date { static now(){ return now; } };
  const context = vm.createContext({flow, msg, Date:FakeDate, Math, Number, String, Object, Array, JSON, Intl, console});
  const ret = new vm.Script(`(function(){${commandNode.func}\n})()`, {filename:'telegram_force.js'}).runInContext(context);
  return {store, ret, now};
}

let r = runForce(['50','15']);
assertEq(r.store.get('force_current_a'), 50, '/force 50 15 stores 50 A');
assertEq(r.store.get('force_until'), r.now + 15*60000, '/force 50 15 stores 15 min');
assertTrue(r.ret?.[0]?.telegram_text?.includes('50 A / 15 min'), 'reply confirms 50 A / 15 min');
assertTrue(r.ret?.[1]?.payload === r.now, 'force command triggers controller tick');

r = runForce(['50']);
assertEq(r.store.get('force_current_a'), 50, '/force 50 stores 50 A');
assertEq(r.store.get('force_until'), r.now + 15*60000, '/force 50 uses default 15 min');

console.log('PASS: /force uses amps first, minutes second/default 15');
