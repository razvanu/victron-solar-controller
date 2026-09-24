#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const nodes = JSON.parse(fs.readFileSync(path.join(root, 'flows', 'Victron_Solar_Forecast_Charge_Controller_v2_8_5.json'), 'utf8'));
let count = 0;
for (const n of nodes) {
  if (n.type !== 'function') continue;
  try {
    // Compile only. Node-RED runtime globals are parameters, not executed here.
    new Function('msg','flow','node','env','Buffer','context','global', n.func || '');
    count++;
  } catch (e) {
    console.error(`Syntax error in function node ${n.id} (${n.name}): ${e.message}`);
    process.exit(1);
  }
}
console.log(`PASS: ${count} Node-RED function nodes compile`);
