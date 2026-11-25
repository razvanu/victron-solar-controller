#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'flows');
const files = fs.readdirSync(dir).filter(f => /^(?:Victron_Solar_Forecast_Charge_Controller|B2_L2_Grid_Setpoint|B2_Export_Phase_Setpoint)_v\d+(?:_\d+)*\.json$/.test(f)).sort();
if (!files.length) { console.error('No controller flow exports found'); process.exit(1); }
let count = 0;
for (const file of files) {
  const nodes = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const ids = nodes.map(n => n.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) { console.error(`${file}: duplicate node ids`); process.exit(1); }
  for (const n of nodes) {
    if (n.type !== 'function') continue;
    try {
      // Compile only. Node-RED runtime globals are parameters, not executed here.
      new Function('msg','flow','node','env','Buffer','context','global', n.func || '');
      count++;
    } catch (e) {
      console.error(`${file}: syntax error in function node ${n.id} (${n.name}): ${e.message}`);
      process.exit(1);
    }
  }
}
console.log(`PASS: ${count} Node-RED function nodes compile in ${files.length} flow export(s)`);
