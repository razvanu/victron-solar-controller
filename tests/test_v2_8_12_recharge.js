#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const f=JSON.parse(fs.readFileSync(path.join(__dirname,'../flows/Victron_Solar_Forecast_Charge_Controller_v2_8_12.json'),'utf8'));
function run212Tests(f){
 let assertions=0;
 function eq(a,b,m){if(a!==b)throw Error(m+': '+JSON.stringify(a)+' != '+JSON.stringify(b));assertions++;}
 const ids=new Set(f.map(n=>n.id));eq(ids.size,f.length,'unique IDs');
 for(const n of f){if(n.z)eq(ids.has(n.z),true,'tab ref');for(const id of n.scope||[])eq(ids.has(id),true,'scope');for(const out of n.wires||[])for(const id of out)eq(ids.has(id),true,'wire');if(n.type==='function')new Function('msg','flow','node','env','Date',n.func);}
 eq(f.filter(n=>n.type.startsWith('victron-output')&&n.path==='/Settings/SystemSetup/MaxChargeCurrent').length,1,'one DVCC writer');
 eq(f.find(n=>n.type==='tab').disabled,true,'disabled');
 function harness(){
  let now=1791964190553;
  class Clock extends Date {constructor(...args){if(args.length)super(...args);else super(now);}static now(){return now;}}
  const m=new Map(),flow={get:k=>m.get(k),set:(k,v)=>m.set(k,v)},node={status:()=>{}};
  function run(name,msg={}){const n=f.find(n=>n.name===name||n.name?.startsWith(name));if(!n)throw Error(name);return new Function('msg','flow','node','env','Date',n.func)(msg,flow,node,{get:()=>''},Clock);}
  run('CONFIG');const cfg=m.get('solar_cfg');cfg.antiTransferHuaweiDischargeSign=-1;
  const live={soc:11,battery_voltage:48.71,battery_current:0,grid_l1:-482,grid_l2:-2012,grid_l3:417,bms_connected:1,bms_ccl:145,bms_cvl:56.4,bms_max_cell:3.051,bms_min_cell:3.030,bms_temp:17,dvcc_actual:0};
  function set(k,v,ts=now){m.set(k,v);m.set(k+'_ts',ts);}
  for(const [k,v]of Object.entries(live))set(k,v);
  set('at_priority','Automat');set('at_huawei_soc',71);set('at_huawei_power',2895);set('at_hailei_soc',11);
  m.set('at_reserve_mode',true);m.set('controller_enabled',true);
  function plan(){run('FORECAST',{payload:now});return m.get('controller_status');}
  function pipeline(){const p=run('FORECAST',{payload:now});const g=run('RAW CELL',p[0]);const out=run('DVCC verify',g);return {s:m.get('controller_status'),out};}
  return {m,cfg,set,run,plan,pipeline,get now(){return now;},advance(ms){now+=ms;for(const k of [...Object.keys(live),'at_huawei_power','at_huawei_soc','at_priority'])m.set(k+'_ts',now);}};
 }
 let h=harness(),s=h.plan();
 eq(s.antiTransfer.blocked,false,'SOC11 reserve must not block recharge');
 eq(s.antiTransfer.reserveForDischarge,true,'reserve retained only for diagnosis');
 eq(s.antiTransfer.reason,'HUAWEI_CHARGING_ALLOWED','charging direction correct');
 eq(s.residualSolarCapA,41,'2077W net export minus150W reserve');
 eq(s.desiredA>0,true,'reported reproduction yields nonzero ceiling');
 for(const mode of ['Automat','Doar Huawei','Doar Hailei','Fără descărcare',null]){
  h=harness();h.set('at_priority',mode,mode===null?0:h.now);eq(h.plan().antiTransfer.blocked,false,'discharge selector not charge gate '+mode);
 }
 h=harness();h.set('at_huawei_soc',null,0);eq(h.plan().antiTransfer.blocked,false,'optional Huawei SOC');
 h=harness();h.set('soc',9);eq(h.plan().desiredA>0,true,'SOC9 can recover from PV');
 h=harness();h.set('at_huawei_power',0);eq(h.plan().antiTransfer.reason,'HUAWEI_IDLE_ALLOWED','idle allowed');
 h=harness();h.set('at_huawei_power',-1000);s=h.plan();eq(s.desiredA,0,'Huawei discharge stops charge');eq(s.antiTransfer.reason,'HUAWEI_DISCHARGING_CHARGE_INHIBIT','before current rises');
 h.set('battery_current',5);eq(h.plan().antiTransfer.reason,'POSSIBLE_HUAWEI_TO_HAILEI_TRANSFER','simultaneous flow diagnostic');
 h=harness();h.cfg.antiTransferHuaweiDischargeSign=1;h.set('at_huawei_power',-1000);eq(h.plan().antiTransfer.blocked,false,'opposite polarity charging');h.set('at_huawei_power',1000);eq(h.plan().desiredA,0,'opposite polarity discharge');
 h=harness();h.cfg.antiTransferHuaweiDischargeSign=0;eq(h.plan().antiTransfer.reason,'HUAWEI_POLARITY_UNCONFIRMED','unknown nonidle failclosed');
 h=harness();h.set('at_huawei_power',null,0);eq(h.plan().desiredA,0,'missing power blocked');
 h=harness();h.set('at_huawei_power',NaN);eq(h.plan().desiredA,0,'NaN power blocked');
 h=harness();h.set('at_huawei_power',0,h.now-150001);eq(h.plan().desiredA,0,'expired power blocked');
 h=harness();h.set('at_huawei_power',0,h.now+1);eq(h.plan().desiredA,0,'future power blocked');
 h=harness();h.set('at_huawei_power',-50);eq(h.plan().antiTransfer.blocked,false,'50W boundary');
 h=harness();h.set('at_huawei_power',-51);eq(h.plan().desiredA,0,'above50 blocked');
 h=harness();h.set('at_huawei_power',-1000);h.plan();h.advance(5000);h.set('at_huawei_power',2895);eq(h.plan().desiredA,0,'release hold starts');
 for(let i=0;i<2;i++){h.advance(5000);eq(h.plan().desiredA,0,'release waits15s');}
 h.advance(5000);eq(h.plan().desiredA>0,true,'charging resumes after15s');
 h=harness();h.set('at_huawei_power',-1000);h.plan();h.advance(5000);h.set('at_huawei_power',0);h.plan();h.advance(5000);h.set('at_huawei_power',-30);h.plan();h.advance(5000);h.set('at_huawei_power',0);eq(h.plan().desiredA,0,'30W resets release');h.advance(5000);eq(h.plan().desiredA,0,'not released early after reset');
 h=harness();h.set('at_huawei_power',-1000);h.plan();h.advance(5000);h.set('at_huawei_power',0);h.plan();h.advance(11000);eq(h.plan().desiredA,0,'execution gap resets dwell');
 h=harness();h.cfg.antiTransferReleaseThresholdW=100;eq(h.plan().desiredA,0,'invalid release config');
 h=harness();h.set('grid_l1',0);h.set('grid_l2',0);h.set('grid_l3',341);h.set('battery_current',.6);s=h.plan();eq(s.residualSolarCapA,0,'NET import with boiler leaves no new charge budget');
 h=harness();h.set('grid_l1',0);h.set('grid_l2',0);h.set('grid_l3',-14);h.set('battery_current',1.3);eq(h.plan().residualSolarCapA,0,'near balanced NET reserves boiler headroom');
 h=harness();h.set('grid_l1',0);h.set('grid_l2',0);h.set('grid_l3',-150);h.set('battery_current',20);eq(h.plan().residualSolarCapA,20,'steady charge not counted twice');
 h=harness();h.set('grid_l3',417,h.now-21000);eq(h.plan().desiredA,0,'stale phase blocks solar budget');
 h=harness();h.cfg.solarNetReserveW=NaN;eq(h.plan().desiredA,0,'invalid reserve budget config');
 h=harness();h.m.set('source_faults',{grid_l3:'offline'});eq(h.plan().desiredA,0,'phase fault blocks budget');
 h=harness();h.m.set('force_until',h.now+60000);h.m.set('force_current_a',50);h.set('at_huawei_power',-1000);eq(h.pipeline().s.desiredA,0,'FORCE cannot bypass Huawei block');
 h=harness();h.m.set('manual_target',{soc:100,solarOnly:true,until:h.now+60000});h.set('at_huawei_power',-1000);eq(h.pipeline().s.desiredA,0,'FORCE100 cannot bypass Huawei block');
 h=harness();h.m.set('manual_target',{soc:100,solarOnly:true,balance:true,until:h.now+60000});h.set('at_huawei_power',-1000);eq(h.pipeline().s.desiredA,0,'BALANCE cannot bypass Huawei block');
 h=harness();h.set('bms_ccl',0);eq(h.pipeline().s.desiredA,0,'CCL0 stops');
 h=harness();h.set('bms_max_cell',3.52);h.set('bms_min_cell',3.50);eq(h.pipeline().s.desiredA,0,'normal cell stop retained');
 h=harness();h.set('bms_temp',0);eq(h.pipeline().s.desiredA,0,'temperature stop');
 h=harness();h.set('bms_connected',0);eq(h.pipeline().s.desiredA,0,'BMS disconnected');
 h=harness();h.m.set('controller_enabled',false);eq(h.pipeline().out,null,'DRY RUN never writes');
 h=harness();h.m.set('pause_until',h.now+60000);eq(h.pipeline().out,null,'pause never writes');
 // Real parser requires per-register hardware-read proof, not a fresh HA/REST timestamp.
 h=harness();const iso=new Date(h.now).toISOString(),proof={huawei_read_protocol:1,huawei_read_ok:true,huawei_last_successful_read:iso};
 let states=[{entity_id:h.cfg.entityHuaweiBatteryPower,state:'2895',last_reported:iso,attributes:{unit_of_measurement:'W',...proof}}];
 h.run('Parse Solcast',{payload:states});eq(h.plan().antiTransfer.blocked,false,'proof power sufficient without SOC or priority');
 h.run('Parse Solcast',{payload:[{...states[0],attributes:{unit_of_measurement:'W'}}]});eq(h.plan().desiredA,0,'REST fresh without hardware proof rejected');
 h=harness();h.run('Parse Solcast',{payload:[{...states[0],entity_id:h.cfg.entityHuaweiBatteryPower,state:'2.895',attributes:{unit_of_measurement:'kW',...proof}}]});eq(h.m.get('at_huawei_power'),2895,'kW normalized');
 h=harness();h.run('HA unavailable',{});eq(h.plan().desiredA,0,'power telemetry loss still failclosed');
 h=harness();h.cfg.telegramEnabled=true;h.cfg.telegramChatId='owner';h.plan();const reply=h.run('Telegram commands + replies',{telegram_command:'/status',telegram_chat_id:'owner'});
 eq(reply[0].telegram_text.includes('Rezerva pentru descarcare: DA; nu blocheaza incarcarea.'),true,'Telegram explains reserve');
 eq(reply[0].telegram_text.includes('HUAWEI_CHARGING_ALLOWED'),true,'Telegram shows charging allowed');
 return assertions;
}
console.log('PASS v2.8.12: '+run212Tests(f)+' assertions (behavior, wiring, scope, syntax)');
