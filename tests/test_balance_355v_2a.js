// Simulated boundaries for balance-only 3.55V/2A; not hardware validation.
const fs=require('fs');
const path=require('path');
const f=JSON.parse(fs.readFileSync(path.join(__dirname,'../flows/Victron_Solar_Forecast_Charge_Controller_v2_8_9.json'),'utf8'));
function runTests(f) {
 let count=0;
 function ok(v,m){if(!v)throw Error(m);count++;}
 const cfgNode=f.find(n=>n.name?.startsWith('CONFIG'));
 const guard=f.find(n=>n.name?.startsWith('RAW CELL'));
 const runGuard=new Function('msg','flow','node','Date',guard.func);
 const realNow=Date.now();
 function sample({balance=true,max=3.46,delta=.035,pack=55.21,soc=91,ccl=145,cvl=56.8,temp=20,current=1,patch={},stale=false}={}) {
  let clock=realNow; const data=new Map();
  const flow={get:k=>data.get(k),set:(k,v)=>data.set(k,v)};
  const node={status:()=>{}};
  new Function('msg','flow','node','env',cfgNode.func)({},flow,node,{get:()=>''});
  const cfg={...flow.get('solar_cfg'),...patch};flow.set('solar_cfg',cfg);flow.set('controller_enabled',true);
  if(balance)flow.set('manual_target',{soc:100,solarOnly:true,balance:true,until:clock+120*60000});
  const values={soc,bms_max_cell:max,bms_min_cell:max-delta,battery_voltage:pack,battery_current:current,bms_temp:temp,bms_ccl:ccl,bms_cvl:cvl,bms_connected:1,grid_l1:-500,grid_l2:0,grid_l3:0};
  for(const [k,v]of Object.entries(values)){flow.set(k,v);flow.set(k+'_ts',clock-(stale?21000:0));}
  function tick(){runGuard({payload:50},flow,node,{now:()=>clock});return flow.get('charge_guard');}
  return {flow,tick,g:tick(),advance(ms){clock+=ms;for(const k of Object.keys(values))flow.set(k+'_ts',clock);}};
 }
 let x=sample();ok(x.g.capA===2,'balance 3.46 capped2');ok(Math.abs(x.g.stopV-3.55)<1e-6,'balance stop3.55');ok(x.g.packStopV===56,'pack stop56');
 x=sample({max:3.54,delta:.03,pack:55.8});ok(x.g.capA===1&&!x.g.blocked,'3.54 safe delta ->1');
 x=sample({max:3.55,delta:.03,pack:55.8});ok(x.g.capA===0&&x.g.reason==='CELL_HIGH_STOP','3.55 stops');ok(x.g.blocked,'stop latch');
 x=sample({max:3.549,delta:.03,pack:55.8});ok(x.g.capA===1,'below3.55 remains1');
 x=sample({balance:false,max:3.52,delta:.03});ok(x.g.capA===0&&x.g.reason==='CELL_HIGH_STOP','normal stop unchanged3.52');
 x=sample({balance:false,max:3.46,delta:.035,soc:80});ok(x.g.capA===10,'normal taper unchanged10');
 x=sample({max:3.50,delta:.051});ok(x.g.reason==='TOP_DELTA_STOP'&&x.g.capA===0,'top delta retained');
 x=sample({max:3.49,delta:.1});ok(x.g.reason==='CELL_DELTA_STOP'&&x.g.capA===0,'severe delta retained');
 x=sample({max:3.50,delta:.05,pack:55.5});ok(x.g.capA===1&&!x.g.blocked,'delta50 equality permitted');
 x=sample({soc:100});ok(x.g.capA===2,'balance SOC100 still permitted');
 x=sample({balance:false,soc:100});ok(x.g.capA===0,'normal SOC100 stops');
 x=sample({ccl:0});ok(x.g.capA===0,'CCL0 stops');
 x=sample({ccl:1});ok(x.g.capA===1,'CCL1 respected');
 x=sample({cvl:55.3,pack:55.21});ok(x.g.capA===0&&x.g.reason==='PACK_HIGH_STOP','lower live CVL respected');
 x=sample({pack:56});ok(x.g.capA===0&&x.g.reason==='PACK_HIGH_STOP','pack56 stops');
 x=sample({pack:55.9});ok(x.g.capA===1,'pack final1');
 x=sample({temp:0});ok(x.g.capA===0,'cold stop');
 x=sample({temp:50});ok(x.g.capA===0,'hot stop');
 x=sample({stale:true});ok(x.g.capA===0&&!x.g.valid,'stale data stops');
 for(const patch of [{balanceMaxA:3},{balanceRequestedCellMaxV:3.56},{balanceCellAlarmMarginV:-.01},{balanceCellAlarmMarginV:NaN},{balanceCellProtectionMarginV:.01}]) {
  x=sample({patch});ok(x.g.capA===0&&x.g.reason==='BALANCE_LIMITS_INVALID','invalid config stops');
 }
 x=sample({patch:{balanceCellAlarmV:3.53}});ok(Math.abs(x.g.stopV-3.53)<1e-6,'lower alarm clips stop');
 x=sample();x.flow.set('discharge_request',{id:'test'});ok(x.tick().capA===0,'discharge interlock');
 x=sample({max:3.5,delta:.06}); x.flow.set('bms_max_cell',3.48);x.flow.set('bms_min_cell',3.42);x.tick();
 for(let i=0;i<6;i++){x.advance(10000);x.tick();}
 ok(!x.flow.get('charge_guard').blocked&&x.flow.get('charge_guard').capA===1,'top recovery stable60 then1');
 const ids=new Set(f.map(n=>n.id));ok(ids.size===f.length,'unique IDs');
 for(const n of f){if(n.z)ok(ids.has(n.z),'valid tab ref');for(const out of n.wires||[])for(const id of out)ok(ids.has(id),'valid wire ref');}
 ok(f.find(n=>n.type==='tab').disabled===true,'tab disabled');
 ok(sample().flow.get('solar_cfg').enableOutputDefault===false,'DRYRUN default');
 return count;
}
console.log('PASS v2.8.9: '+runTests(f)+' assertions');
