#!/usr/bin/env node
'use strict';
// B2 v0.1 tests: run the real function bodies from flows/B2_L2_Grid_Setpoint_v0_1.json in a sandbox
// (flow context and clock simulated). No network, no Cerbo, no Home Assistant.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', 'flows', 'B2_L2_Grid_Setpoint_v0_1.json');
const nodes = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byName = name => { const n = nodes.find(x => x.type === 'function' && x.name === name); if (!n) throw new Error('missing ' + name); return n; };
let passed = 0;
function check(c, label) { if (!c) throw new Error('FAIL: ' + label); passed++; }
function eq(a, b, label) { if (a !== b) throw new Error(`FAIL: ${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); passed++; }

class Sim {
  constructor() { this.now = Date.UTC(2026, 10, 25, 10, 0, 0); this.store = new Map(); this.warns = [];
    this.flow = { get: k => this.store.get(k), set: (k, v) => this.store.set(k, v) }; }
  run(name, msg = {}) {
    const self = this;
    const FakeDate = class extends Date { constructor(...a) { if (a.length) super(...a); else super(self.now); } static now() { return self.now; } };
    const ctx = vm.createContext({ msg, flow: this.flow, node: { status() {}, warn: m => self.warns.push(m), error() {} },
      Date: FakeDate, Math, Number, String, Object, Array, JSON, isFinite, parseFloat, console });
    return new vm.Script(`(function(){${byName(name).func}\n})()`).runInContext(ctx);
  }
  set(k, v) { this.store.set(k, v); this.store.set(k + '_ts', this.now); }
  get(k) { return this.store.get(k); }
  // inputs arrive every second on the Cerbo: re-stamp them on every tick unless frozen (stale tests)
  tick(n = 1) { const out = []; for (let i = 0; i < n; i++) { this.now += 5000;
    for (const k of ['b2_grid_l2', 'b2_hub4mode', 'b2_bms_ccl', 'b2_bms_connected', 'b2_soc', 'b2_bat_v', 'b2_ess_setpoint'])
      if (this.store.has(k + '_ts') && !(this.frozen || []).includes(k)) this.store.set(k + '_ts', this.now);
    const r = this.run('B2 controller (L2 export -> L1 setpoint)'); if (r) out.push(r.payload); } return out; }
  feed({ l2 = -2000, mode = 2, ccl = 145, conn = 1, soc = 60, v = 53, sp = 0 } = {}) {
    this.set('b2_grid_l2', l2); this.set('b2_hub4mode', mode); this.set('b2_bms_ccl', ccl); this.set('b2_bms_connected', conn);
    this.set('b2_soc', soc); this.set('b2_bat_v', v); this.set('b2_ess_setpoint', sp);
  }
}
function boot() { const s = new Sim(); s.run('B2 CONFIG'); return s; }

// --- structure / safety ---
const outs = nodes.filter(n => n.type === 'victron-output-ess');
eq(outs.length, 1, 'exactly one Victron output');
eq(outs[0].path, '/Settings/CGwacs/AcPowerSetPoint', 'output writes only AcPowerSetPoint');
check(!nodes.some(n => /MaxChargeCurrent|Hub4Mode/.test(n.path || '') && n.type.startsWith('victron-output')), 'never writes DVCC or Hub4Mode');
const enableInj = nodes.find(n => n.type === 'inject' && n.payload === 'true');
eq(enableInj.once, false, 'ENABLE inject never fires automatically');
for (const n of nodes.filter(n => n.type === 'function')) new Function('msg', 'flow', 'node', 'env', n.func);

// 1. DRY RUN (default): computes, counts "would write", emits nothing
{ const s = boot(); s.feed({ l2: -2000 }); s.run('B2 startup check');
  const out = s.tick(24);
  eq(out.length, 0, 'DRY RUN emits nothing');
  check(s.get('b2_stats').would >= 1, 'DRY RUN counts would-be writes');
  eq(s.get('b2_status').mode, 'DRY_RUN', 'status DRY_RUN');
  eq(s.get('b2_status').target, 1950, 'target = export - 50 W'); }

// 1b. DRY RUN while Hub4Mode is still 1: computes as if mode 2 (counters meaningful), still emits nothing
{ const s = boot(); s.feed({ l2: -2000, mode: 1 }); const out = s.tick(24);
  eq(out.length, 0, 'DRY RUN mode 1 emits nothing'); eq(s.get('b2_status').target, 1950, 'DRY RUN mode 1 computes target');
  eq(s.get('b2_status').modeOk, false, 'modeOk false reported'); check(s.get('b2_stats').would >= 1, 'counts would-writes in mode 1'); }

// 2. LIVE in Hub4Mode 2: ramps 250 W / tick, respects deadband and 30 s interval
{ const s = boot(); s.feed({ l2: -2000 }); s.run('B2 enable / DRY RUN', { payload: true });
  eq(s.get('b2_enabled'), true, 'enabled');
  const out = s.tick(1); eq(out[0], 250, 'first write after ramp step (no previous write)');
  const more = s.tick(5); eq(more.length, 0, 'no write within 30 s');
  const later = s.tick(1); eq(later[0], 1750, 'write after 30 s with ramped value');
  s.tick(6); const fin = s.tick(1); check(fin.length === 0 || fin[0] === 1950, 'settles at 1950'); eq(s.get('b2_cur'), 1950, 'cur 1950'); }

// 3. Cap: min(MAX_W 3000, CCL x U)
{ const s = boot(); s.feed({ l2: -6000, ccl: 40, v: 50 }); s.run('B2 enable / DRY RUN', { payload: true });
  s.tick(30); eq(s.get('b2_status').capW, 2000, 'cap by CCL x U'); check(s.get('b2_cur') <= 2000, 'never above cap');
  const t = boot(); t.feed({ l2: -6000 }); t.run('B2 enable / DRY RUN', { payload: true }); t.tick(40); eq(t.get('b2_cur'), 3000, 'hard cap 3000 W'); }

// 4. Stale L2 -> 0 quickly (fast path, >= 5 s)
{ const s = boot(); s.feed({ l2: -2000 }); s.run('B2 enable / DRY RUN', { payload: true }); s.tick(20);
  check(s.get('b2_last_sent') > 1000, 'running');
  s.frozen = ['b2_grid_l2']; s.store.set('b2_grid_l2_ts', s.now - 20000);
  const out = s.tick(1); eq(out[0], 0, 'stale L2 -> write 0 immediately'); check(s.get('b2_status').reasons.includes('L2_STALE'), 'reason L2_STALE'); }

// 5. Large drop (cloud) bypasses the 30 s limit
{ const s = boot(); s.feed({ l2: -2500 }); s.run('B2 enable / DRY RUN', { payload: true }); s.tick(20);
  const before = s.get('b2_last_sent'); s.feed({ l2: -600 }); const out = s.tick(1);
  eq(out[0], 550, 'drop >= 500 W written at once'); check(before - 550 >= 500, 'was a big drop'); }

// 6. Hub4Mode != 2: ENABLE refused; if mode changes while LIVE -> 0
{ const s = boot(); s.feed({ mode: 1 }); s.run('B2 enable / DRY RUN', { payload: true });
  eq(s.get('b2_enabled'), false, 'ENABLE refused in Hub4Mode 1'); check(s.warns.some(w => /refuzat/.test(w)), 'warns');
  const t = boot(); t.feed({ l2: -2000 }); t.run('B2 enable / DRY RUN', { payload: true }); t.tick(20);
  t.set('b2_hub4mode', 1); const out = t.tick(1); eq(out[0], 0, 'mode 1 while LIVE -> 0'); }

// 7. BMS limits: SOC full / CCL 0 / disconnected -> 0
for (const f of [{ soc: 99 }, { ccl: 0 }, { conn: 0 }, { v: 0 }]) {
  const s = boot(); s.feed({ l2: -2000 }); s.run('B2 enable / DRY RUN', { payload: true }); s.tick(20);
  s.feed(Object.assign({ l2: -2000 }, f)); const out = s.tick(1); eq(out[0], 0, 'limit ' + JSON.stringify(f) + ' -> 0'); }

// 8. Import on L2 (no export) -> 0, never negative
{ const s = boot(); s.feed({ l2: 800 }); s.run('B2 enable / DRY RUN', { payload: true }); s.tick(10); eq(s.get('b2_cur'), 0, 'L2 import -> 0'); }

// 9. Leaving LIVE writes 0 once; DRY RUN -> DRY RUN writes nothing
{ const s = boot(); s.feed({ l2: -2000 }); s.run('B2 enable / DRY RUN', { payload: true }); s.tick(20);
  const r = s.run('B2 enable / DRY RUN', { payload: false }); eq(r.payload, 0, 'disable from LIVE -> 0');
  const r2 = s.run('B2 enable / DRY RUN', { payload: false }); eq(r2, null, 'disable again -> nothing'); }

// 10. Startup: non-zero setpoint is only logged in this DRY RUN version
{ const s = boot(); s.feed({ sp: 1500 }); const r = s.run('B2 startup check'); eq(r, null, 'no write at start (RESET_NONZERO_ON_START=false)');
  check(s.warns.some(w => /nenul/.test(w)), 'warns about non-zero setpoint');
  const t = boot(); const cfg = t.get('b2_cfg'); cfg.RESET_NONZERO_ON_START = true; t.feed({ sp: 1500 });
  eq(t.run('B2 startup check').payload, 0, 'with RESET_NONZERO_ON_START -> 0'); }

// 11. Daily counters roll over
{ const s = boot(); s.feed({ l2: -2000 }); s.tick(20); const w = s.get('b2_stats').would;
  s.now += 24 * 3600 * 1000; s.feed({ l2: -2000 }); s.tick(1);
  eq(s.get('b2_stats_prev').would, w, 'yesterday kept'); check(s.get('b2_stats').would <= 1, 'today restarted'); }

// 12. Write budget: a noisy hour (L2 export jumping 0..3000 W every 5 s) stays <= 120 writes (1/30 s + fast drops; measured 103)
{ const s = boot(); s.run('B2 enable / DRY RUN', { payload: true }); s.feed({ l2: -3000 }); s.run('B2 enable / DRY RUN', { payload: true });
  let n = 0; for (let i = 0; i < 720; i++) { s.feed({ l2: (i % 7 < 4) ? -3000 : -200 }); n += s.tick(1).length; }
  check(n <= 120, 'noisy hour bounded: ' + n + ' writes'); }

console.log(`PASS: ${passed} B2 checks`);
