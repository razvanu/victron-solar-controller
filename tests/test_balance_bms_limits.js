// Regression tests for the PACE top-charge test flow; run: node tests/test_pace_top_charge.js
const fs=require('fs');
const nodes=JSON.parse(fs.readFileSync('flows/Victron_Solar_Forecast_Charge_Controller_v2_8_8.json','utf8'));
function named(fragment){const n=nodes.find(n=>n.type==='function'&&n.name.includes(fragment));if(!n)throw Error('Missing '+fragment);return n;}
let checks=0;
function equal(actual,wanted,label){if(actual!==wanted)throw Error(label+': '+actual+' != '+wanted);checks++;}
for(const n of nodes.filter(n=>n.type==='function'))new Function('msg','flow','node','env',n.func);
let now=1780000000000;
const cfg={hardMaxA:100,rawCellStopV:3.52,rawPackStopV:56.10,topDeltaMaxV:0.05,balanceMaxA:5,balancePackMaxV:56,balanceBmsCvlMarginV:0.1,balancePackAlarmV:56.8,balancePackAlarmMarginV:0.1,balanceRequestedCellMaxV:3.56,balanceCellProtectionV:3.6,balanceCellProtectionMarginV:0.05,balanceCellAlarmV:3.55,balanceCellAlarmMarginV:0.03,balanceTopReleaseDeltaV:0.075,balanceRecoveryA:1,
 balanceFullVoltageV:56,balanceFullCurrentA:2,balanceObserveMs:180000,socTopTaperStartPct:90,
 socTopTaperMidPct:95,socTopTaperEndPct:100,socTopTaperTo95A:20,socTopTaperAbove95A:15,forceBypassSocTaper:true};
const keys=['soc','bms_max_cell','bms_min_cell','battery_voltage','battery_current','bms_temp','bms_ccl','bms_cvl','bms_connected','grid_l1','grid_l2','grid_l3'];
function setup(over={}){
 const d={solar_cfg:cfg,controller_enabled:true,soc:51,bms_max_cell:3.35,bms_min_cell:3.34,battery_voltage:53.5,
 battery_current:10,bms_temp:20,bms_ccl:145,bms_cvl:56.8,bms_connected:1,grid_l1:-500,grid_l2:-500,grid_l3:-500};
 for(const k of keys)d[k+'_ts']=now;
 return Object.assign(d,over);
}
function context(d){return {get:k=>d[k],set:(k,v)=>d[k]=v};}
const fn=new Function('msg','flow','node','Date',named('RAW CELL/PACK STOP').func);
function run(d,a=100){return fn({payload:a},context(d),{status:()=>{}},{now:()=>now});}
function check(label,over,wanted){equal(run(setup(over)).payload,wanted,label);}
check('SOC51 no permanent10A cap',{},100);
check('SOC91 taper20A',{soc:91},20);
check('SOC97 taper9A',{soc:97},9);
check('FORCE bypass SOC only',{soc:99,force_until:now+60000},100);
check('raw3.45 cap10',{bms_max_cell:3.45,bms_min_cell:3.44},10);
check('raw3.47 cap5',{bms_max_cell:3.47,bms_min_cell:3.44},5);
check('raw3.49 cap2',{bms_max_cell:3.49,bms_min_cell:3.46},2);
check('3.50 delta50 allows1A',{bms_max_cell:3.50,bms_min_cell:3.45},1);
check('3.51 delta51 stops',{bms_max_cell:3.51,bms_min_cell:3.459},0);
check('3.52 stops',{bms_max_cell:3.52,bms_min_cell:3.50},0);
check('pack56.1 stops',{battery_voltage:56.10},0);
check('lower CVL honored',{battery_voltage:55.6,bms_cvl:55.5},0);
check('delta100 stops',{bms_max_cell:3.45,bms_min_cell:3.35},0);
check('old51mV sample caps2A',{bms_max_cell:3.469,bms_min_cell:3.418},2);
check('CCL0 stops',{bms_ccl:0},0);
check('temp0 stops',{bms_temp:0},0);
check('temp50 stops',{bms_temp:50},0);
check('stale pack stops',{battery_voltage_ts:now-21000},0);
check('source fault stops',{source_faults:{bms_max_cell:true}},0);
check('invalid ordering stops',{bms_max_cell:3.3,bms_min_cell:3.4},0);
check('discharge interlock',{discharge_request:{id:'x'}},0);
check('SOC99.9 target100 floor1',{soc:99.9,manual_target:{soc:100,until:now+60000}},1);
check('ordinary SOC100 stops',{soc:100},0);
check('BALANCE SOC100 continues',{soc:100,manual_target:{soc:100,balance:true,until:now+7200000}},5);
const d=setup({bms_max_cell:3.52,bms_min_cell:3.50});run(d);
d.bms_max_cell=3.48;d.bms_min_cell=3.46;
for(let i=0;i<6;i++){now+=10000;for(const k of keys)d[k+'_ts']=now;equal(run(d).payload,0,'latched60s');}
now+=10000;for(const k of keys)d[k+'_ts']=now;equal(run(d).payload,5,'release after60s');
const b=setup({soc:100,bms_max_cell:3.515,bms_min_cell:3.49,battery_voltage:55.96,battery_current:1,
 manual_target:{soc:100,balance:true,until:now+7200000}});
equal(run(b).payload,1,'full observation begins');
for(let i=0;i<17;i++){now+=10000;for(const k of keys)b[k+'_ts']=now;equal(run(b).payload,1,'continuous dwell');}
now+=10000;for(const k of keys)b[k+'_ts']=now;
equal(run(b).payload,0,'full observation completed');equal(b.balance_session.complete,true,'observation only flag');
// Small current and voltage WITHOUT PACE SOC100 must not complete.
const notFull=setup({soc:99,bms_max_cell:3.515,bms_min_cell:3.49,battery_voltage:55.96,battery_current:1,
 manual_target:{soc:100,balance:true,until:now+7200000}});
run(notFull);equal(notFull.balance_session.since,0,'forced current alone not full');
// A telemetry/execution gap resets dwell instead of counting unobserved minutes.
const gap=setup({soc:100,bms_max_cell:3.515,bms_min_cell:3.49,battery_voltage:55.96,battery_current:1,
 manual_target:{soc:100,balance:true,until:now+7200000}});
run(gap);now+=190000;for(const k of keys)gap[k+'_ts']=now;run(gap);
equal(gap.balance_session.complete,false,'gap cannot complete');
// Telegram authorization and bounded duration.
const tg=new Function('msg','flow','node',named('Telegram commands + replies').func);
const t=setup();t.solar_cfg={...cfg,telegramEnabled:true,telegramChatId:'123',telegramStatusMaxAgeMs:30000,
 liveMaxAgeMs:120000,bmsMaxAgeMs:120000,dvccReadbackMaxAgeMs:120000,timeZone:'Europe/Bucharest',balanceMaxMinutes:120};
const realNow=Date.now();t.controller_status={timestamp:realNow,bmsCcl:145};t.controller_health={timestamp:realNow,ok:true};
for(const k of [...keys,'dvcc_actual']){t[k]=t[k]??0;t[k+'_ts']=realNow;}
const msg={telegram_command:'/balance',telegram_args:['60'],telegram_chat_id:'123',telegram_private_owner:true};
tg({...msg,telegram_private_owner:false},context(t),{status:()=>{}});equal(!!t.manual_target,false,'owner required');
tg({...msg,telegram_args:['121']},context(t),{status:()=>{}});equal(!!t.manual_target,false,'duration bounded');
tg(msg,context(t),{status:()=>{}});equal(t.manual_target.balance,true,'balance starts');
tg({...msg,telegram_args:['off']},context(t),{status:()=>{}});equal(t.manual_target,null,'balance off');

// Full planner -> raw guard -> DVCC gate: SOC100 permits 1 A only while NET surplus exists.
{
 const data={},flow={get:k=>data[k],set:(k,v)=>data[k]=v},node={status:()=>{}};
 new Function('msg','flow','node','env',named('CONFIG ').func)({},flow,node,{get:()=>''});
 const ts=Date.now();
 Object.assign(data,{controller_enabled:true,soc:100,battery_voltage:55.96,battery_current:1,bms_max_cell:3.515,
 bms_min_cell:3.49,bms_temp:20,bms_connected:1,bms_ccl:145,bms_cvl:56.8,grid_l1:-500,grid_l2:-500,
 grid_l3:-500,dvcc_actual:1,manual_target:{soc:100,balance:true,solarOnly:true,until:ts+3600000}});
 for(const k of [...keys,'dvcc_actual'])data[k+'_ts']=ts;
 const plan=new Function('msg','flow','node',named('FORECAST +').func);
 const protect=new Function('msg','flow','node',named('RAW CELL/PACK').func);
 const write=new Function('msg','flow','node',named('DVCC verify').func);
 function tick(){write(protect(plan({},flow,node)[0],flow,node),flow,node);}
 tick();equal(data.controller_status.desiredA,1,'pipeline SOC100 top charge1A');
 Object.assign(data,{grid_l1:1000,grid_l2:1000,grid_l3:1000});
 tick();equal(data.controller_status.desiredA,0,'pipeline NET import stops solar-only balance');
}

// BALANCE-only low-current recovery; normal and severe stops retain original conditions.
const until=now+7200000;
const recover=setup({manual_target:{soc:100,balance:true,until},bms_max_cell:3.50,bms_min_cell:3.431,battery_voltage:55.54});
equal(run(recover).payload,0,'top delta trips even in balance');
recover.bms_max_cell=3.478;recover.bms_min_cell=3.418;
for(let i=0;i<7;i++){now+=10000;for(const k of keys)recover[k+'_ts']=now;run(recover);}
equal(run(recover).payload,1,'balance resumes at delta60 capped1A');
equal(recover.charge_guard.balanceRecovery,true,'recovery is explicit');
recover.manual_target=null;equal(run(recover).payload,2,'balance ceiling removed outside session');
const normal=setup({cell_guard_state:{blocked:true,tripReason:'TOP_DELTA_STOP'},bms_max_cell:3.478,bms_min_cell:3.418});
for(let i=0;i<8;i++){now+=10000;for(const k of keys)normal[k+'_ts']=now;run(normal);}
equal(run(normal).payload,0,'normal delta60 stays held');
check('balance lowered CVL stops before CVL',{manual_target:{soc:100,balance:true,until:now+60000},bms_cvl:55.5,battery_voltage:55.41},0);
const low=setup({manual_target:{soc:100,balance:true,until:now+60000},bms_cvl:55.5});
run(low);equal(Math.round(low.charge_guard.packStopV*100),5540,'balance CVL margin calculated');
check('balance invalid snapshot fails closed',{manual_target:{soc:100,balance:true,until:now+60000},solar_cfg:{...cfg,balanceCellAlarmV:null}},0);
check('balance max5A',{manual_target:{soc:100,balance:true,until:now+60000}},5);
check('balance pack56 stop',{manual_target:{soc:100,balance:true,until:now+60000},battery_voltage:56},0);
check('balance delta100 stays protected',{manual_target:{soc:100,balance:true,until:now+60000},bms_max_cell:3.48,bms_min_cell:3.38},0);
const tooWide=setup({manual_target:{soc:100,balance:true,until:now+60000},cell_guard_state:{blocked:true,tripReason:'TOP_DELTA_STOP'},bms_max_cell:3.478,bms_min_cell:3.398});
run(tooWide);equal(tooWide.cell_guard_state.safeSince,0,'delta80 cannot start recovery');
const clipped=setup({manual_target:{soc:100,balance:true,until:now+60000}});
run(clipped);equal(Math.round(clipped.charge_guard.stopV*1000),3520,'requested3.56 clipped below known3.55 alarm');
const verified=setup({manual_target:{soc:100,balance:true,until:now+60000},
 solar_cfg:{...cfg,balanceCellAlarmV:3.60,balanceCellProtectionV:3.65}});
run(verified);equal(Math.round(verified.charge_guard.stopV*1000),3560,'3.56 only when configured BMS margins permit');
const severe=setup({manual_target:{soc:100,balance:true,until:now+7200000},bms_max_cell:3.50,bms_min_cell:3.39});
run(severe);equal(severe.cell_guard_state.tripReason,'CELL_DELTA_STOP','delta110 wins over top delta');
severe.bms_max_cell=3.478;severe.bms_min_cell=3.418;
for(let i=0;i<8;i++){now+=10000;for(const k of keys)severe[k+'_ts']=now;run(severe);}
equal(run(severe).payload,0,'severe delta cannot use relaxed top recovery');
console.log('PACE top-charge: '+checks+' assertions passed; all function nodes compiled.');
