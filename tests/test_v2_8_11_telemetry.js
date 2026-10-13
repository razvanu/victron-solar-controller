#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const f=JSON.parse(fs.readFileSync(path.join(__dirname,'../flows/Victron_Solar_Forecast_Charge_Controller_v2_8_11.json'),'utf8'));
let assertions=0;function eq(a,b,message){assert.equal(a,b,message);assertions++;}
const ids=new Set(f.map(n=>n.id));eq(ids.size,f.length,'unique IDs');
for(const n of f){for(const id of n.scope||[])assert.ok(ids.has(id),'scope');for(const ws of n.wires||[])for(const id of ws)assert.ok(ids.has(id),'wire');if(n.type==='function')new Function('msg','flow','node','env','Date',n.func);}
eq(f.filter(n=>n.type==='function').length,45,'45 functions');
eq(f.filter(n=>n.type.startsWith('victron-output')&&n.path==='/Settings/SystemSetup/MaxChargeCurrent').length,1,'one writer');
eq(f.find(n=>n.type==='tab').disabled,true,'disabled');
eq(JSON.stringify(f).includes('v210_'),false,'IDs migrated');
function harness(){
 let now=1700000000000;
 class FakeDate extends Date{constructor(...args){if(args.length)super(...args);else super(now);}static now(){return now;}}
 const m=new Map(),flow={get:k=>m.get(k),set:(k,v)=>m.set(k,v)},node={status:()=>{}};
 function run(name,msg={}){const n=f.find(n=>n.name===name||n.name?.startsWith(name));assert.ok(n,name);return new Function('msg','flow','node','env','Date',n.func)(msg,flow,node,{get:()=>''},FakeDate);}
 run('CONFIG');const cfg=m.get('solar_cfg');
 const samples={soc:75,battery_voltage:54,battery_current:0,grid_l1:-2000,grid_l2:0,grid_l3:0,bms_connected:1,bms_ccl:145,bms_cvl:56.8,bms_max_cell:3.38,bms_min_cell:3.37,bms_temp:20,dvcc_actual:0};
 function set(k,v,ts=now){m.set(k,v);m.set(k+'_ts',ts);}
 for(const [k,v]of Object.entries(samples))set(k,v);
 set('at_priority','Automat');set('at_huawei_soc',80);set('at_huawei_power',0);set('at_hailei_soc',9);
 m.set('controller_enabled',true);
 return {m,cfg,flow,run,set,get now(){return now;},advance(ms,refresh=true){now+=ms;if(refresh)for(const k of Object.keys(samples))m.set(k+'_ts',now);},
  plan(){run('FORECAST',{payload:now});return m.get('controller_status');},
  pipeline(){const p=run('FORECAST',{payload:now});const g=run('RAW CELL',p[0]);return run('DVCC verify',g);}};
}
function stateData(h,{power=0,soc=80,reportedAge=0,updatedAge=0,unit='W'}={}){
 const date=age=>new Date(h.now-age).toISOString();
 return [{entity_id:h.cfg.entityHuaweiSoc,state:String(soc),last_reported:date(reportedAge),last_updated:date(updatedAge)},
 {entity_id:h.cfg.entityHuaweiBatteryPower,state:String(power),attributes:{unit_of_measurement:unit},last_reported:date(reportedAge),last_updated:date(updatedAge)},
 {entity_id:h.cfg.entityHaileiSoc,state:'8',last_reported:date(reportedAge)},
 {entity_id:h.cfg.entityBatteryPriority,state:'Automat',last_updated:date(86400000)}];
}
let h=harness();eq(h.cfg.balanceMaxA,2,'merged balance2');eq(h.cfg.antiTransferHuaweiDischargeSign,0,'unknown polarity default');
eq(h.plan().antiTransfer.haileiSoc,75,'local SOC used instead of MQTT9');
eq(h.plan().antiTransfer.blocked,false,'idle allows local Hailei priority');
h.set('soc',10);eq(h.plan().antiTransfer.reason,'AUTO_HUAWEI_RESERVE','local threshold10');
h.set('soc',15);eq(h.plan().antiTransfer.blocked,true,'reserve hysteresis');
h.set('soc',20);eq(h.plan().antiTransfer.blocked,false,'resume20');
h.set('at_priority','Wrong mode');eq(h.plan().antiTransfer.reason,'DATA_MISSING_FAIL_CLOSED','unknown mode fails closed');
h=harness();h.set('at_huawei_power',NaN);eq(h.plan().antiTransfer.blocked,true,'NaN invalid');
h=harness();h.set('at_huawei_power',null);eq(h.plan().antiTransfer.blocked,true,'null not coerced to0');
h=harness();h.set('soc',75,h.now+1);eq(h.plan().antiTransfer.blocked,true,'future local timestamp rejected');
h=harness();h.set('at_huawei_power',0,h.now-150001);eq(h.plan().antiTransfer.blocked,true,'old Huawei data blocked');
h=harness();h.cfg.antiTransferHuaweiDischargeSign=-1;h.set('at_huawei_power',-2000);h.set('battery_current',2);
eq(h.plan().antiTransfer.reason,'POSSIBLE_HUAWEI_TO_HAILEI_TRANSFER','possible direction+charging');eq(h.plan().desiredA,0,'possible transfer prevents new charge');
h.set('battery_current',0);eq(h.plan().antiTransfer.reason,'HUAWEI_DISCHARGING_CHARGE_INHIBIT','inhibit retained with no charge to avoid oscillation');
h.cfg.antiTransferHuaweiDischargeSign=1;h.set('at_huawei_power',2000);eq(h.plan().desiredA,0,'positive discharge polarity works');
h=harness();h.set('at_huawei_power',-1000);eq(h.plan().antiTransfer.reason,'HUAWEI_POLARITY_UNCONFIRMED','unknown sign nonidle blocked');
h=harness();h.cfg.antiTransferHuaweiDischargeSign=-1;h.set('at_huawei_power',1000);h.set('battery_current',-2);
eq(h.plan().antiTransfer.possibleReverseTransfer,true,'reverse transfer observation');eq(h.plan().antiTransfer.blocked,false,'reverse only diagnostic, no Huawei output');
h=harness();h.cfg.antiTransferHuaweiDischargeSign=3;eq(h.plan().antiTransfer.reason,'ANTI_TRANSFER_CONFIG_INVALID','bad polarity');
h=harness();h.run('Parse Solcast',{payload:stateData(h,{power:2,unit:'kW'})});eq(h.m.get('at_huawei_power'),2000,'kW normalized');eq(h.plan().antiTransfer.blocked,true,'power unknown polarity');
h=harness();h.run('Parse Solcast',{payload:stateData(h,{reportedAge:200000})});eq(h.m.get('at_huawei_soc_ts'),h.now-200000,'REST does not refresh stale sensor');eq(h.plan().antiTransfer.blocked,true,'stale source fails closed');
h=harness();h.run('Parse Solcast',{payload:stateData(h,{updatedAge:86400000})});eq(h.plan().antiTransfer.blocked,false,'fresh unchanged reported value accepted');
h=harness();let a=stateData(h);delete a[0].last_reported;a[0].last_updated=new Date(h.now-1000).toISOString();h.run('Parse Solcast',{payload:a});eq(h.m.get('at_huawei_soc_ts'),h.now-1000,'last_updated fallback');
h=harness();h.run('Parse Solcast',{payload:stateData(h,{unit:'VA'})});eq(h.m.get('at_huawei_power'),null,'unknown units invalid');
h=harness();h.run('Parse Solcast',{payload:{error:true}});eq(h.m.get('at_priority'),null,'invalid REST clears priority');
h=harness();h.run('HA unavailable',{payload:'failure'});eq(h.m.get('at_huawei_soc_ts'),0,'HA failure clears timestamps');
h=harness();h.m.set('manual_target',{soc:100,solarOnly:true,balance:true,until:h.now+60000});h.set('soc',100);h.set('bms_max_cell',3.50);h.set('bms_min_cell',3.44);h.set('battery_voltage',55.3);
h.pipeline();eq(h.m.get('controller_status').desiredA,1,'full pipeline balance delta60 allowed1 atSOC100');
h=harness();h.m.set('force_until',h.now+60000);h.m.set('force_current_a',50);h.cfg.antiTransferHuaweiDischargeSign=-1;h.set('at_huawei_power',-2000);h.pipeline();eq(h.m.get('controller_status').desiredA,0,'FORCE cannot bypass transfer guard');
h=harness();h.m.set('manual_target',{soc:100,solarOnly:true,until:h.now+60000});h.cfg.antiTransferHuaweiDischargeSign=-1;h.set('at_huawei_power',-2000);h.pipeline();eq(h.m.get('controller_status').desiredA,0,'FORCE100 cannot bypass transfer guard');
// Physical monitoring test: simulate fresh telemetry every5s, same verified0 setting.
function zeroTick(h,current=1){h.set('battery_current',current);h.m.set('charge_guard',{timestamp:h.now,valid:true,capA:100,reason:'NONE'});h.run('DVCC verify',{payload:0});return h.m.get('physical_charge_status').state;}
h=harness();eq(zeroTick(h),'SETTLING','zero readback starts grace');
for(let i=0;i<6;i++){h.advance(5000);zeroTick(h);}
eq(h.m.get('physical_charge_status').state,'OBSERVING','grace30 then observation');
for(let i=0;i<6;i++){h.advance(5000);zeroTick(h);}
eq(h.m.get('physical_charge_status').state,'CHARGE_CONTINUES_AFTER_ZERO','sustained physical charge warns');
eq(h.m.get('controller_status').dvccConfirmed,true,'setting stays confirmed');eq(h.m.get('controller_health').warnings[0],'PHYSICAL_CHARGE_CONTINUES','separate warning');
eq(h.m.get('controller_events').filter(e=>e.kind==='PHYSICAL_CHARGE_CONTINUES_AFTER_ZERO').length,1,'one transition event');
eq(zeroTick(h,0),'OBSERVING','current drop resets candidate');
for(let i=0;i<6;i++){h.advance(5000);zeroTick(h,0);}
eq(h.m.get('physical_charge_status').state,'NET_CHARGE_STOP_OBSERVED','observed net stop after30');
h.m.set('controller_enabled',false);eq(zeroTick(h,2),'DRY_RUN','dry run has no physical stop claim');
h=harness();h.m.set('pause_until',h.now+60000);eq(zeroTick(h),'PAUSED','pause has no stop claim');
h=harness();h.set('dvcc_actual',5);eq(zeroTick(h),'SETTING_UNCONFIRMED','wrong setting cannot confirm physicalstop');
h=harness();zeroTick(h);for(let i=0;i<9;i++){h.advance(5000);zeroTick(h);}h.advance(15000);eq(zeroTick(h),'OBSERVING','execution gap resets dwell');
h=harness();zeroTick(h);h.m.set('source_faults',{battery_current:'offline'});eq(zeroTick(h),'TELEMETRY_INVALID','source fault resets');
h=harness();h.cfg.physicalStopToleranceA=10;eq(zeroTick(h),'CONFIG_INVALID','bad tolerance rejected');
h=harness();zeroTick(h);h.run('DVCC verify',{payload:5});eq(h.m.get('physical_charge_status').state,'NOT_REQUESTED','nonzero cancels stop observation');
h=harness();h.m.set('controller_status',{timestamp:h.now,physicalCharge:{state:'CHARGE_CONTINUES_AFTER_ZERO',netBatteryCurrentA:1},antiTransfer:{blocked:true,reason:'POSSIBLE_HUAWEI_TO_HAILEI_TRANSFER'}});
h.cfg.telegramEnabled=true;h.cfg.telegramChatId='owner';const tg=h.run('Telegram commands + replies',{telegram_command:'/health',telegram_chat_id:'owner'});
assert.ok(tg[0].telegram_text.includes('INCARCARE CONTINUA DUPA DVCC 0 A'));assert.ok(tg[0].telegram_text.includes('POSSIBLE_HUAWEI_TO_HAILEI_TRANSFER'));
console.log('PASS v2.8.11 '+assertions+' behavior assertions +45 syntax and wiring/scope checks');
