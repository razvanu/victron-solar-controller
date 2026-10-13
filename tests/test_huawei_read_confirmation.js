'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const nodes=JSON.parse(fs.readFileSync(path.join(__dirname,'../flows/Victron_Solar_Forecast_Charge_Controller_v2_8_11.json'),'utf8'));
let count=0;const now=1791890000000;
class Clock extends Date { static now(){return now;} }
function execute(change=()=>{}){
 const m=new Map(),flow={get:k=>m.get(k),set:(k,v)=>m.set(k,v)},node={status:()=>{}};
 function run(name,msg={}){return new Function('msg','flow','node','env','Date',nodes.find(n=>n.name?.startsWith(name)).func)(msg,flow,node,{get:()=>''},Clock)}
 run('CONFIG');const cfg=m.get('solar_cfg');cfg.antiTransferHuaweiDischargeSign=-1;
 for(const [k,v] of Object.entries({soc:54,battery_current:0,battery_voltage:53.3,grid_l1:-500,grid_l2:0,grid_l3:0,bms_connected:1,bms_ccl:145,bms_cvl:56.4,bms_max_cell:3.34,bms_min_cell:3.32,bms_temp:20,dvcc_actual:0})){m.set(k,v);m.set(k+'_ts',now)}
 const iso=ms=>new Date(ms).toISOString(),proof=()=>({huawei_read_protocol:1,huawei_read_ok:true,huawei_last_successful_read:iso(now-30000)});
 const states=[{entity_id:cfg.entityHuaweiSoc,state:'99',last_reported:iso(now-86400000),attributes:proof()},{entity_id:cfg.entityHuaweiBatteryPower,state:'0',last_reported:iso(now-86400000),attributes:{unit_of_measurement:'W',...proof()}},{entity_id:cfg.entityBatteryPriority,state:'Automat',last_reported:iso(now-86400000)}];
 change(states,iso,m);run('Parse Solcast',{payload:states});run('FORECAST',{payload:now});return {m,states,run,status:m.get('controller_status')};
}
function test(name,change,blocked){const h=execute(change);assert.equal(h.status.antiTransfer.blocked,blocked,name);count++;return h;}
test('constant SOC and idle power remain valid after a day',()=>{},false);
for(const index of [0,1]){
 test('missing proof '+index,s=>delete s[index].attributes.huawei_last_successful_read,true);
 test('read failed '+index,s=>s[index].attributes.huawei_read_ok=false,true);
 test('wrong protocol '+index,s=>s[index].attributes.huawei_read_protocol=2,true);
 test('fresh HA timestamp cannot substitute missing proof '+index,(s,iso)=>{s[index].attributes={unit_of_measurement:'W'};s[index].last_reported=iso(now)},true);
 test('expired read '+index,(s,iso)=>s[index].attributes.huawei_last_successful_read=iso(now-150001),true);
 test('future read '+index,(s,iso)=>s[index].attributes.huawei_last_successful_read=iso(now+1),true);
 test('timezone absent '+index,s=>s[index].attributes.huawei_last_successful_read='2026-10-13T11:00:00',true);
 test('unavailable '+index,s=>s[index].state='unavailable',true);
 test('NaN '+index,s=>s[index].state='NaN',true);
 test('null value '+index,s=>s[index].state=null,true);
}
test('TTL boundary allowed',(s,iso)=>{for(const e of s.slice(0,2))e.attributes.huawei_last_successful_read=iso(now-150000)},false);
test('negative power is discharge',s=>s[1].state='-500',true);
test('kW is normalized',s=>{s[1].state='-0.5';s[1].attributes.unit_of_measurement='kW'},true);
test('wrong power unit fails',s=>s[1].attributes.unit_of_measurement='VA',true);
const h=execute();h.run('HA unavailable',{});h.run('FORECAST',{payload:now});assert.equal(h.m.get('controller_status').antiTransfer.blocked,true);count++;
const dry=execute();assert.equal(dry.run('DVCC verify',{payload:0}),null);count++;
console.log('PASS: '+count+' hardware-read confirmation scenarios');
