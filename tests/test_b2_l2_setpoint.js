#!/usr/bin/env node
'use strict';
// B2 v0.3 tests: run the real function bodies from flows/B2_Export_Phase_Setpoint_v0_3.json in a sandbox
// (flow context and clock simulated). No network, no Cerbo, no Home Assistant.
// The full scenario suite runs twice: B2_EXPORT_PHASE = 'L2' (default) and 'L3'.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', 'flows', 'B2_Export_Phase_Setpoint_v0_3.json');
const nodes = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byName = name => { const n = nodes.find(x => x.type === 'function' && x.name === name); if (!n) throw new Error('missing ' + name); return n; };
const CTRL = 'B2 controller (export phase -> L1 setpoint)';
let passed = 0;
function check(c, label) { if (!c) throw new Error('FAIL: ' + label); passed++; }
function eq(a, b, label) { if (a !== b) throw new Error(`FAIL: ${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); passed++; }

const INPUT_KEYS = ['b2_grid_l2', 'b2_grid_l3', 'b2_hub4mode', 'b2_bms_ccl', 'b2_bms_connected', 'b2_soc', 'b2_bat_v', 'b2_ess_setpoint', 'b2_dvcc'];
class Sim {
  constructor(phase) { this.phase = phase; this.now = Date.UTC(2026, 10, 25, 10, 0, 0); this.store = new Map(); this.warns = [];
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
  get key() { return 'b2_grid_' + this.phase.toLowerCase(); }
  get otherKey() { return this.phase === 'L2' ? 'b2_grid_l3' : 'b2_grid_l2'; }
  // inputs arrive every second on the Cerbo: re-stamp them on every tick unless frozen (stale tests)
  tick(n = 1) { const out = []; for (let i = 0; i < n; i++) { this.now += 5000;
    for (const k of INPUT_KEYS)
      if (this.store.has(k + '_ts') && !(this.frozen || []).includes(k)) this.store.set(k + '_ts', this.now);
    const r = this.run(CTRL); if (r) out.push(r.payload); } return out; }
  // p = power on the export phase (negative = export); other = power on the other non-L1 phase
  feed({ p = -2000, other = 1500, mode = 2, ccl = 145, conn = 1, soc = 60, v = 53, sp = 0, dvcc = -1 } = {}) {
    this.set(this.key, p); this.set(this.otherKey, other);
    this.set('b2_hub4mode', mode); this.set('b2_bms_ccl', ccl); this.set('b2_bms_connected', conn);
    this.set('b2_soc', soc); this.set('b2_bat_v', v); this.set('b2_ess_setpoint', sp); this.set('b2_dvcc', dvcc);
  }
}
function bootWith(phase) { const s = new Sim(phase); s.run('B2 CONFIG'); if (phase !== undefined) s.get('b2_cfg').B2_EXPORT_PHASE = phase; return s; }

// --- structure / safety ---
const outs = nodes.filter(n => n.type === 'victron-output-ess');
eq(outs.length, 1, 'exactly one Victron output');
eq(outs[0].path, '/Settings/CGwacs/AcPowerSetPoint', 'output writes only AcPowerSetPoint');
check(!nodes.some(n => /MaxChargeCurrent|Hub4Mode/.test(n.path || '') && n.type.startsWith('victron-output')), 'never writes DVCC or Hub4Mode');
const enableInj = nodes.find(n => n.type === 'inject' && n.payload === 'true');
eq(enableInj.once, false, 'ENABLE inject never fires automatically');
for (const n of nodes.filter(n => n.type === 'function')) new Function('msg', 'flow', 'node', 'env', n.func);
const gridIn = nodes.filter(n => n.type === 'victron-input-system' && /^\/Ac\/Grid\/L\d\/Power$/.test(n.path)).map(n => n.path).sort();
eq(JSON.stringify(gridIn), JSON.stringify(['/Ac/Grid/L2/Power', '/Ac/Grid/L3/Power']), 'reads L2 and L3 grid power (not L1)');
{ const s = new Sim('L2'); s.run('B2 CONFIG'); eq(s.get('b2_cfg').B2_EXPORT_PHASE, 'L2', 'default B2_EXPORT_PHASE = L2'); }

function suite(PH) {
  const boot = () => bootWith(PH);
  const T = label => `[${PH}] ${label}`;

  // 1. DRY RUN (default): computes, counts "would write", emits nothing
  { const s = boot(); s.feed({ p: -2000 }); s.run('B2 startup check');
    const out = s.tick(24);
    eq(out.length, 0, T('DRY RUN emits nothing'));
    check(s.get('b2_stats').would >= 1, T('DRY RUN counts would-be writes'));
    eq(s.get('b2_status').mode, 'DRY_RUN', T('status DRY_RUN'));
    eq(s.get('b2_status').phase, PH, T('status reports phase'));
    eq(s.get('b2_status').target, 1950, T('target = export - 50 W')); }

  // 1b. DRY RUN while Hub4Mode is still 1: computes as if mode 2 (counters meaningful), still emits nothing
  { const s = boot(); s.feed({ p: -2000, mode: 1 }); const out = s.tick(24);
    eq(out.length, 0, T('DRY RUN mode 1 emits nothing')); eq(s.get('b2_status').target, 1950, T('DRY RUN mode 1 computes target'));
    eq(s.get('b2_status').modeOk, false, T('modeOk false reported')); check(s.get('b2_stats').would >= 1, T('counts would-writes in mode 1')); }

  // 2. LIVE in Hub4Mode 2: ramps 250 W / tick, respects deadband and 30 s interval
  { const s = boot(); s.feed({ p: -2000 }); s.run('B2 enable / DRY RUN', { payload: true });
    eq(s.get('b2_enabled'), true, T('enabled'));
    const out = s.tick(1); eq(out[0], 250, T('first write after ramp step (no previous write)'));
    const more = s.tick(5); eq(more.length, 0, T('no write within 30 s'));
    const later = s.tick(1); eq(later[0], 1750, T('write after 30 s with ramped value'));
    s.tick(6); const fin = s.tick(1); check(fin.length === 0 || fin[0] === 1950, T('settles at 1950')); eq(s.get('b2_cur'), 1950, T('cur 1950')); }

  // 3. Cap: min(MAX_W 3000, CCL x U)
  { const s = boot(); s.feed({ p: -6000, ccl: 40, v: 50 }); s.run('B2 enable / DRY RUN', { payload: true });
    s.tick(30); eq(s.get('b2_status').capW, 2000, T('cap by CCL x U')); check(s.get('b2_cur') <= 2000, T('never above cap'));
    const t = boot(); t.feed({ p: -6000 }); t.run('B2 enable / DRY RUN', { payload: true }); t.tick(40); eq(t.get('b2_cur'), 3000, T('hard cap 3000 W')); }

  // 3b. DVCC limit: cap = min(CCL, DVCC, 100 A) x U; DVCC 0 -> 0; DVCC -1 -> no software limit; unknown DVCC -> 0
  { const s = boot(); s.feed({ p: -4000, dvcc: 20, v: 53 }); s.run('B2 enable / DRY RUN', { payload: true }); s.tick(30);
    eq(s.get('b2_status').capA, 20, T('capA = DVCC 20 A')); eq(s.get('b2_status').capW, 1060, T('capW = 20 A x 53 V')); check(s.get('b2_cur') <= 1060, T('never above DVCC cap'));
    const t = boot(); t.feed({ p: -4000, dvcc: 0 }); t.run('B2 enable / DRY RUN', { payload: true }); t.tick(10);
    eq(t.get('b2_cur'), 0, T('DVCC 0 -> 0')); check(t.get('b2_status').reasons.includes('DVCC_0'), T('reason DVCC_0'));
    const u = boot(); u.feed({ p: -4000, dvcc: -1, ccl: 30, v: 50 }); u.run('B2 enable / DRY RUN', { payload: true }); u.tick(30);
    eq(u.get('b2_status').capW, 1500, T('DVCC -1 -> cap by CCL 30 A x 50 V'));
    const w = boot(); w.feed({ p: -4000, dvcc: 80, ccl: 145 }); w.run('B2 enable / DRY RUN', { payload: true }); w.tick(40);
    eq(w.get('b2_status').capW, 3000, T('DVCC 80 A x 53 V capped by MAX_W'));
    const x = boot(); x.feed({ p: -2000 }); x.run('B2 enable / DRY RUN', { payload: true }); x.tick(20);
    x.store.delete('b2_dvcc'); const out = x.tick(1); eq(out[0], 0, T('DVCC unknown -> 0')); check(x.get('b2_status').reasons.includes('DVCC_UNKNOWN'), T('reason DVCC_UNKNOWN')); }

  // 4. Stale export-phase power -> 0 quickly (fast path, >= 5 s); the other phase staying fresh does not help
  { const s = boot(); s.feed({ p: -2000 }); s.run('B2 enable / DRY RUN', { payload: true }); s.tick(20);
    check(s.get('b2_last_sent') > 1000, T('running'));
    s.frozen = [s.key]; s.store.set(s.key + '_ts', s.now - 20000);
    const out = s.tick(1); eq(out[0], 0, T('stale export phase -> write 0 immediately'));
    check(s.get('b2_status').reasons.includes(PH + '_STALE'), T('reason ' + PH + '_STALE')); }

  // 5. Large drop (cloud) bypasses the 30 s limit
  { const s = boot(); s.feed({ p: -2500 }); s.run('B2 enable / DRY RUN', { payload: true }); s.tick(20);
    const before = s.get('b2_last_sent'); s.feed({ p: -600 }); const out = s.tick(1);
    eq(out[0], 550, T('drop >= 500 W written at once')); check(before - 550 >= 500, T('was a big drop')); }

  // 6. Hub4Mode != 2: ENABLE refused; if mode changes while LIVE -> 0
  { const s = boot(); s.feed({ mode: 1 }); s.run('B2 enable / DRY RUN', { payload: true });
    eq(s.get('b2_enabled'), false, T('ENABLE refused in Hub4Mode 1')); check(s.warns.some(w => /refuzat/.test(w)), T('warns'));
    const t = boot(); t.feed({ p: -2000 }); t.run('B2 enable / DRY RUN', { payload: true }); t.tick(20);
    t.set('b2_hub4mode', 1); const out = t.tick(1); eq(out[0], 0, T('mode 1 while LIVE -> 0')); }

  // 7. BMS limits: SOC full / CCL 0 / disconnected / invalid voltage -> 0
  for (const f of [{ soc: 99 }, { ccl: 0 }, { conn: 0 }, { v: 0 }]) {
    const s = boot(); s.feed({ p: -2000 }); s.run('B2 enable / DRY RUN', { payload: true }); s.tick(20);
    s.feed(Object.assign({ p: -2000 }, f)); const out = s.tick(1); eq(out[0], 0, T('limit ' + JSON.stringify(f) + ' -> 0')); }

  // 8. Import on the export phase (no export) -> 0, never negative
  { const s = boot(); s.feed({ p: 800 }); s.run('B2 enable / DRY RUN', { payload: true }); s.tick(10); eq(s.get('b2_cur'), 0, T('import -> 0')); }

  // 8b. Only the configured phase counts: big export on the OTHER phase, import on the export phase -> 0
  { const s = boot(); s.feed({ p: 300, other: -4000 }); s.run('B2 enable / DRY RUN', { payload: true }); s.tick(20);
    eq(s.get('b2_cur'), 0, T('export on the other phase is ignored'));
    const t = boot(); t.feed({ p: -2000, other: -4000 }); t.run('B2 enable / DRY RUN', { payload: true }); t.tick(20);
    eq(t.get('b2_status').target, 1950, T('target follows only the configured phase')); }

  // 9. Leaving LIVE writes 0 once; DRY RUN -> DRY RUN writes nothing
  { const s = boot(); s.feed({ p: -2000 }); s.run('B2 enable / DRY RUN', { payload: true }); s.tick(20);
    const r = s.run('B2 enable / DRY RUN', { payload: false }); eq(r.payload, 0, T('disable from LIVE -> 0'));
    const r2 = s.run('B2 enable / DRY RUN', { payload: false }); eq(r2, null, T('disable again -> nothing')); }

  // 10. Startup: non-zero setpoint is only logged in this DRY RUN version
  { const s = boot(); s.feed({ sp: 1500 }); const r = s.run('B2 startup check'); eq(r, null, T('no write at start (RESET_NONZERO_ON_START=false)'));
    check(s.warns.some(w => /nenul/.test(w)), T('warns about non-zero setpoint'));
    const t = boot(); const cfg = t.get('b2_cfg'); cfg.RESET_NONZERO_ON_START = true; t.feed({ sp: 1500 });
    eq(t.run('B2 startup check').payload, 0, T('with RESET_NONZERO_ON_START -> 0')); }

  // 11. Daily counters roll over
  { const s = boot(); s.feed({ p: -2000 }); s.tick(20); const w = s.get('b2_stats').would;
    s.now += 24 * 3600 * 1000; s.feed({ p: -2000 }); s.tick(1);
    eq(s.get('b2_stats_prev').would, w, T('yesterday kept')); check(s.get('b2_stats').would <= 1, T('today restarted')); }

  // 12. Write budget: a noisy hour (export jumping 0..3000 W every 5 s) stays <= 120 writes (1/30 s + fast drops; measured 103)
  { const s = boot(); s.feed({ p: -3000 }); s.run('B2 enable / DRY RUN', { payload: true });
    let n = 0; for (let i = 0; i < 720; i++) { s.feed({ p: (i % 7 < 4) ? -3000 : -200 }); n += s.tick(1).length; }
    check(n <= 120, T('noisy hour bounded: ' + n + ' writes')); }
}

suite('L2');
suite('L3');

// 13. Invalid phase (L1 = the MultiPlus phase, typo, missing): target 0, ENABLE refused
for (const bad of ['L1', 'l3', '', undefined]) {
  const s = new Sim('L2'); s.run('B2 CONFIG'); s.get('b2_cfg').B2_EXPORT_PHASE = bad; s.feed({ p: -2000, other: -2000 });
  s.store.set('b2_grid_l1', -2000); s.store.set('b2_grid_l1_ts', s.now);
  s.tick(10);
  eq(s.get('b2_status').target, 0, 'invalid phase ' + JSON.stringify(bad) + ' -> target 0');
  check(s.get('b2_status').reasons.some(r => r.startsWith('PHASE_INVALID')), 'reason PHASE_INVALID for ' + JSON.stringify(bad));
  s.run('B2 enable / DRY RUN', { payload: true });
  eq(s.get('b2_enabled'), false, 'ENABLE refused for phase ' + JSON.stringify(bad));
}

console.log(`PASS: ${passed} B2 checks (L2 + L3)`);
