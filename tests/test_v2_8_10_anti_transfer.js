#!/usr/bin/env node
'use strict';
// Offline regression tests. No Cerbo, MQTT or inverter connection.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const nodes=JSON.parse(fs.readFileSync(path.join(__dirname,'../flows/Victron_Solar_Forecast_Charge_Controller_v2_8_10_anti_transfer.json'),'utf8'));
const ids=new Set(nodes.map(n=>n.id));
assert.equal(ids.size,nodes.length,'unique node IDs');
for(const n of nodes){
 for(const outputs of n.wires||[])for(const id of outputs)assert.ok(ids.has(id),'broken wire '+n.id+' -> '+id);
 for(const id of n.scope||[])assert.ok(ids.has(id),'broken catch/status scope '+n.id+' -> '+id);
 if(n.type==='function')new Function('msg','node','flow','context','global','env','Buffer',n.func);
}
assert.equal(nodes.find(n=>n.type==='tab').disabled,true,'tab defaults disabled');
assert.ok(!JSON.stringify(nodes).includes('v288_'),'all v2.8.8 IDs fixed');
assert.equal(nodes.filter(n=>n.type==='victron-output-ess'&&n.name.includes('ONLY WRITER')).length,1,'one DVCC writer');
const config=nodes.find(n=>n.id==='v210_00000004').func;
for(const key of ['enableOutputDefault: false','antiTransferEnabled: true','entityBatteryPriority','entityHuaweiSoc','entityHaileiSoc','PASTE_LONG_LIVED_ACCESS_TOKEN','PASTE_TELEGRAM_BOT_TOKEN'])assert.ok(config.includes(key),'missing '+key);
const controller=nodes.find(n=>n.id==='v210_00000028').func;
const start=controller.indexOf('// ---- ANTI-TRANSFER FINAL CEILING');
const sentinel='flow.set("anti_transfer_status",antiTransfer);';
const end=controller.indexOf(sentinel,start);
assert.ok(start>=0&&end>start,'guard not found');
const guard=controller.slice(start,end+sentinel.length);
function run(opts={}){
 const now=1700000000000,ts=opts.stale?now-200000:now-1000;
 const m=new Map(Object.entries({
  at_priority:opts.missing?null:(opts.priority||'Automat'),at_priority_ts:opts.missing?0:ts,
  at_hailei_soc:opts.hailei??25,at_hailei_soc_ts:ts,
  at_huawei_soc:opts.huawei??80,at_huawei_soc_ts:ts,
  at_huawei_power:0,at_huawei_power_ts:ts,at_reserve_mode:opts.reserve===true
 }));
 const flow={get:k=>m.get(k),set:(k,v)=>m.set(k,v)};
 const cfg={antiTransferEnabled:true,antiTransferMaxHaAgeMs:150000,antiTransferHaileiSwitchSoc:10,antiTransferHaileiResumeSoc:20};
 const fakeDate=class extends Date{static now(){return now;}};
 return new Function('cfg','flow','Date','let desiredA=50;\n'+guard+'\nreturn {desiredA,status:flow.get("anti_transfer_status"),reserve:flow.get("at_reserve_mode")};')(cfg,flow,fakeDate);
}
assert.equal(run({hailei:26}).desiredA,50,'normal priority');
assert.equal(run({hailei:9}).desiredA,0,'switch at 10%');
assert.equal(run({hailei:15,reserve:true}).desiredA,0,'hysteresis hold');
assert.equal(run({hailei:20,reserve:true}).desiredA,50,'release at 20%');
assert.equal(run({priority:'Doar Huawei'}).desiredA,0,'manual Huawei');
assert.equal(run({priority:'Fără descărcare'}).desiredA,0,'manual stop');
assert.equal(run({missing:true}).desiredA,0,'HA missing fails closed');
assert.equal(run({stale:true}).desiredA,0,'HA stale fails closed');
console.log('PASS v2.8.10: 45 function syntax checks, valid wiring/scopes, single writer and 8 anti-transfer scenarios');
