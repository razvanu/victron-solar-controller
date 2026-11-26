#!/usr/bin/env node
// Verifica flow-ul DOAR CITIRE pentru Node-RED pe 192.168.10.60.
// Utilizare (din radacina repo-ului): node tools/readonly60/verify.js
// Iesire: "TOATE VERIFICARILE OK" si cod 0, altfel lista erorilor si cod 1.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'flows', 'Solar_Controller_DOAR_CITIRE_60.json');
const SRC_CTRL = path.join(ROOT, 'flows', 'Victron_Solar_Forecast_Charge_Controller_v2_8_13.json');
const SRC_B2 = path.join(ROOT, 'flows', 'B2_Export_Phase_Setpoint_v0_3.json');
const BUILD = path.join(__dirname, 'build.py');

const errors = [];
let checks = 0;
function check(cond, msg) { checks++; if (!cond) errors.push(msg); }
const norm = (s) => s.replace(/\r\n/g, '\n');

const text = fs.readFileSync(OUT, 'utf8');
const flow = JSON.parse(text);
const byId = new Map(flow.map((n) => [n.id, n]));

// 1. Generatorul reproduce exact fisierul din repo.
{
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ro60-')), 'out.json');
  let r = null;
  for (const py of ['python3', 'python']) {
    r = spawnSync(py, [BUILD, SRC_CTRL, SRC_B2, tmp], { encoding: 'utf8' });
    if (!r.error) break;
  }
  check(r && !r.error && r.status === 0, 'build.py nu a rulat: ' + (r && (r.error || r.stderr)));
  if (r && r.status === 0) {
    check(norm(fs.readFileSync(tmp, 'utf8')) === norm(text),
      'flows/Solar_Controller_DOAR_CITIRE_60.json difera de iesirea build.py (regenereaza-l)');
  }
}

// 2. Structura: id-uri unice, fire si tab-uri valide.
check(byId.size === flow.length, 'id-uri duplicate');
for (const n of flow) {
  if (n.z !== undefined) check(byId.has(n.z) && byId.get(n.z).type === 'tab', `${n.id}: z inexistent (${n.z})`);
  for (const w of (n.wires || []).flat()) check(byId.has(w), `${n.id}: fir catre nod inexistent ${w}`);
  if (n.type === 'group') for (const x of n.nodes || []) check(byId.has(x), `grup ${n.id}: nod inexistent ${x}`);
  if (/^mqtt (in|out)$/.test(n.type)) check(byId.has(n.broker), `${n.id}: broker inexistent`);
}

// 3. Nimic care poate scrie pe Victron sau rula comenzi locale.
for (const n of flow) {
  check(!/^victron-/.test(n.type), `nod Victron ramas: ${n.id} ${n.type}`);
  check(n.type !== 'exec', `nod exec ramas: ${n.id}`);
  check(!['tcp out', 'udp out', 'websocket out', 'modbus-write', 'modbus-flex-write'].includes(n.type),
    `nod de scriere nepermis: ${n.id} ${n.type}`);
  if (n.type === 'function') check(!/require\s*\(|child_process|process\.binding/.test(n.func || ''),
    `${n.id}: functie cu acces la sistem`);
  if (n.type === 'function' && /^BLOCAT/.test(n.name || '')) {
    check(n.outputs === 0 && n.wires.length === 0, `${n.id}: nodul BLOCAT are iesiri`);
  }
}
const mqttOut = flow.filter((n) => n.type === 'mqtt out');
check(mqttOut.length === 1, 'trebuie exact un nod mqtt out (R/ -> Cerbo)');
for (const o of mqttOut) {
  check(o.topic === '', 'mqtt out trebuie sa ia topicul din mesaj (filtrat R/)');
  const feeders = flow.filter((n) => (n.wires || []).flat().includes(o.id));
  check(feeders.length === 1 && feeders[0].id === 'ro60_ka_fn', 'mqtt out alimentat de alt nod decat keepalive R/');
}
for (const n of flow.filter((x) => x.type === 'mqtt in')) {
  check(/^N\/\+\//.test(n.topic), `${n.id}: abonare in afara N/+/...`);
}

// 4. Functia keepalive publica numai pe R/<portal>/...
function runFn(node, msg, env, globals) {
  const ctx = new Map(); const glob = new Map(Object.entries(globals || {}));
  const api = { get: (k) => ctx.get(k), set: (k, v) => ctx.set(k, v) };
  const g = { get: (k) => glob.get(k), set: (k, v) => glob.set(k, v) };
  const nodeApi = { status() {}, warn() {}, error() {}, log() {} };
  const fn = new Function('msg', 'node', 'context', 'flow', 'global', 'env', node.func);
  const res = [];
  for (let i = 0; i < 3; i++) res.push(fn(msg, nodeApi, api, api, g, { get: (k) => (env || {})[k] }));
  return { res, glob };
}
{
  const ka = byId.get('ro60_ka_fn');
  const { res } = runFn(ka, {}, { PORTAL_ID: 'c0ffee000000' });
  const topics = res.flatMap((r) => (r ? r[0] : [])).map((m) => m.topic);
  check(topics.length > 0, 'keepalive nu publica nimic');
  check(topics.every((t) => /^R\/c0ffee000000\/[^/]+/.test(t)), 'keepalive publica in afara R/<portal>/');
  check(!topics.some((t) => /^W\//.test(t)), 'keepalive publica pe W/');
  const noPortal = runFn(ka, {}, { PORTAL_ID: 'COMPLETEAZA' }).res;
  check(noPortal.every((r) => r === null), 'fara PORTAL_ID keepalive trebuie sa nu publice');
}
// singura aparitie permisa a lui 'W/' este filtrul de siguranta din keepalive
check(!/["'`]W\//.test(text.replace("!m.topic.startsWith('W/')", '')), 'textul flow-ului contine un topic W/');

// 5. Emitatorii: fiecare cheie e acoperita de o abonare MQTT si e ceruta prin R/.
{
  const subs = flow.filter((n) => n.type === 'mqtt in').map((n) => n.topic.replace(/^N\/\+\//, '').replace(/#$/, ''));
  const ka = byId.get('ro60_ka_fn').func;
  const emit = flow.filter((n) => n.type === 'function' && /^MQTT> /.test(n.name || ''));
  check(emit.length > 0, 'niciun emitator');
  for (const e of emit) {
    const key = JSON.parse(e.func.match(/const KEY = ("[^"]+")/)[1]);
    check(subs.some((s) => key.startsWith(s)), `cheia ${key} nu e acoperita de nicio abonare N/`);
    check(ka.includes(JSON.stringify(key)), `cheia ${key} nu e ceruta prin R/`);
  }
  const ticks = flow.filter((n) => n.type === 'inject' && /tick MQTT/.test(n.name || ''));
  const wired = new Set(ticks.flatMap((t) => t.wires.flat()));
  for (const e of emit) check(wired.has(e.id), `emitatorul ${e.id} nu e legat la tick`);
  // emitator executat pe cache: valoare proaspata -> mesaj; lipsa -> nimic
  const e0 = emit[0]; const key0 = JSON.parse(e0.func.match(/const KEY = ("[^"]+")/)[1]);
  const fresh = runFn(e0, {}, {}, { vic_cache: { [key0]: { v: 12.345, t: Date.now() } } }).res[0];
  check(fresh && fresh.payload !== undefined, 'emitatorul nu emite valoarea proaspata din cache');
  check(runFn(e0, {}, {}, {}).res[0] === null, 'emitatorul emite fara date in cache');
}

// 6. Controlul nu poate fi activat.
for (const n of flow) {
  if (n.type === 'inject' && /ENABLE/i.test(n.name || '')) check(n.payload === 'false', `${n.id}: inject ENABLE nu e false`);
  if (n.type === 'function' && n.name === 'Set controller enable') {
    check(/const enabled=false;/.test(n.func), 'Set controller enable nu e fortat pe false');
  }
  if (n.type === 'function' && /const startActive=/.test(n.func || '')) {
    check(/const startActive=false&&\(/.test(n.func), `${n.id}: startActive nu e fortat pe false`);
  }
  if (n.type === 'function') {
    try { new Function('msg', 'node', 'context', 'flow', 'global', 'env', 'RED', `return (async()=>{${n.func}\n})`); }
    catch (err) { check(false, `${n.id} (${n.name}): sintaxa: ${err.message}`); }
  }
}

// 7. Fara secrete in fisier.
for (const n of flow.filter((x) => x.type === 'tab')) {
  for (const v of n.env || []) {
    if (v.type === 'cred') check(!v.value, `tab ${n.id}: ${v.name} contine o valoare`);
  }
}
check(!/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/.test(text), 'pare sa contina un token Telegram');
check(!/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/.test(text), 'pare sa contina un token JWT (Home Assistant)');

if (errors.length) {
  console.error(`ESEC: ${errors.length} din ${checks} verificari`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`TOATE VERIFICARILE OK (${checks} verificari, ${flow.length} noduri)`);
