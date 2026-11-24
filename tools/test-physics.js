// Correctness checks for js/physics.js. Run: node tools/test-physics.js
const assert = require('assert');
const Physics = require('../js/physics.js');

function run(n, spins, mode) {
  const p = Physics.params(n);
  let state = { theta: 0, J: Physics.pegLeftOf(p, 0), phi: 0 };
  let last = -1;
  let round = new Set();
  const counts = new Array(n).fill(0);
  let offTop = 0;
  for (let i = 0; i < spins; i++) {
    let exclude = last >= 0 ? [last] : [];
    if (mode === 'rounds') {
      if (round.size === n) round = new Set();
      exclude = [...new Set([...exclude, ...round])];
      if (exclude.length >= n) exclude = [last];
    }
    const r = Physics.plan(p, state, { exclude, minTime: 6, maxTime: 8.5 });
    assert.ok(r, 'planner returned a spin');
    assert.notStrictEqual(r.winner, last, `n=${n}: back-to-back repeat at spin ${i}`);
    if (mode === 'rounds') {
      assert.ok(!round.has(r.winner), `n=${n}: repeat within a round at spin ${i}`);
      round.add(r.winner);
    }
    // The drawn flapper tip must sit inside the winning wedge.
    const xL = (r.J - 0.5) * p.delta + r.theta;
    assert.ok(r.phi >= xL - 1e-6 && r.phi <= xL + p.delta + 1e-6, `n=${n}: flapper outside wedge`);
    // The tip keeps a visible margin from both boundaries. Rarely, the wheel
    // rests pressed on a peg with the flapper bent, so the boundary has just
    // crossed 12 o'clock while the tip is still (correctly) in the winner.
    const margin = Math.min(r.phi - xL, xL + p.delta - r.phi);
    assert.ok(margin >= p.tip - 1e-6, `n=${n}: tip margin ${margin}`);
    const top = Physics.mod(Math.round(-r.theta / p.delta), n);
    if (top !== r.winner) offTop++;
    counts[r.winner]++;
    last = r.winner;
    state = Physics.normalise(p, { theta: r.theta, J: r.J });
    state.phi = r.phi;
  }
  counts.offTop = offTop;
  return counts;
}

for (const n of [2, 3, 5, 12, 25]) {
  const c = run(n, 600, 'back-to-back');
  console.log(`n=${n} no back-to-back ok, counts ${c.join(' ')}; rested bent across 12 o'clock: ${c.offTop}/600`);
}
for (const n of [3, 7, 12]) {
  run(n, 300, 'rounds');
  console.log(`n=${n} fair rounds ok`);
}

// Determinism: the same throw always produces the same spin.
{
  const p = Physics.params(12);
  const start = { theta: 1.234, J: Physics.pegLeftOf(p, 1.234), pushAccel: 120, pushTime: 0.22 };
  const a = Physics.simulate(p, start);
  const b = Physics.simulate(p, start);
  assert.strictEqual(a.theta, b.theta);
  assert.strictEqual(a.events.length, b.events.length);
  console.log('deterministic ok');
}

// Flick spins in either direction.
{
  const p = Physics.params(10);
  const state = { theta: 0.3, J: Physics.pegLeftOf(p, 0.3), phi: 0 };
  const cw = Physics.plan(p, state, { exclude: [], flickOmega: 9 });
  const ccw = Physics.plan(p, state, { exclude: [], flickOmega: -16 });
  assert.ok(cw.theta > state.theta && ccw.theta < state.theta);
  console.log(`flick ok (cw ${cw.restTime.toFixed(1)}s, ccw ${ccw.restTime.toFixed(1)}s)`);
}

// Dragging the wheel through pegs clicks and keeps J consistent.
{
  const p = Physics.params(12);
  const d = Physics.dragger(p, { theta: 0, J: Physics.pegLeftOf(p, 0) });
  let clicks = 0;
  for (let i = 1; i <= 60; i++) clicks += d.step((i / 60) * Math.PI, 1 / 60).length;
  const s = d.state();
  assert.strictEqual(clicks, 6, `expected 6 clicks for half a turn, got ${clicks}`);
  assert.strictEqual(Physics.winnerOf(p, s.J), Physics.mod(Math.round(-s.theta / p.delta), 12));
  console.log('drag ok');
}
console.log('all physics tests passed');
