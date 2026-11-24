// Tuning harness for js/physics.js. Run: node tools/tune.js [n]
// Prints how long spins take at different strengths, how the final clicks are
// spaced, how often the wheel rocks back off a peg, and whether outcomes are fair.
const Physics = require('../js/physics.js');

const n = Number(process.argv[2] || 12);
const p = Physics.params(n);
const deg = (r) => (r * 180) / Math.PI;

console.log(`n=${n} travel=${deg(p.travel).toFixed(2)}deg tip=${deg(p.tip).toFixed(2)}deg k=${p.k.toFixed(1)}`);

function spin(speed, theta = 0.1, J) {
  const pushTime = 0.22;
  const state = { theta, J: J ?? Physics.pegLeftOf(p, theta) };
  return Physics.simulate(p, {
    theta: state.theta,
    J: state.J,
    pushAccel: (Math.PI / 2) * (speed / pushTime),
    pushTime,
  });
}

console.log('\nspeed  peak  rest(s)  turns  clicks  last gaps (s)                   rockback(deg)');
for (let s = 10; s <= 30; s += 2) {
  const r = spin(s);
  const ev = r.events;
  const gaps = [];
  for (let i = Math.max(1, ev.length - 5); i < ev.length; i++) gaps.push((ev[i].t - ev[i - 1].t).toFixed(2));
  const tail = r.restTime - (ev.length ? ev[ev.length - 1].t : 0);
  // Rock-back: how far the wheel went backwards at the very end.
  let maxTheta = -Infinity;
  for (let i = 0; i <= Math.round(r.restTime / r.dt); i++) maxTheta = Math.max(maxTheta, r.thetas[i]);
  const rock = deg(maxTheta - r.theta);
  console.log(
    `${String(s).padStart(5)} ${r.peakOmega.toFixed(1).padStart(5)} ${r.restTime.toFixed(2).padStart(8)} ${r.turns
      .toFixed(2)
      .padStart(6)} ${String(ev.length).padStart(7)}  ${gaps.join(' ').padEnd(30)} +${tail.toFixed(2)}  ${rock.toFixed(2)}`
  );
}

// Velocity profile of one mid-strength spin, sampled every 0.5 s.
const mid = spin(20);
const prof = [];
for (let t = 0; t <= mid.restTime + 0.01; t += 0.5) {
  const i = Math.min(mid.steps - 1, Math.round(t / mid.dt));
  const w = (mid.thetas[i + 1] - mid.thetas[i]) / mid.dt;
  prof.push(`${t.toFixed(1)}s:${w.toFixed(1)}`);
}
console.log('\nprofile @20:', prof.join('  '));

// Fairness and back-to-back rule through the planner.
let state = { theta: 0, J: Physics.pegLeftOf(p, 0), phi: 0 };
let last = -1;
const counts = new Array(n).fill(0);
const times = [];
let repeats = 0;
let attempts = 0;
const t0 = Date.now();
const N = 3000;
for (let i = 0; i < N; i++) {
  const r = Physics.plan(p, state, { exclude: last >= 0 ? [last] : [], minTime: 6, maxTime: 9 });
  if (r.winner === last) repeats++;
  counts[r.winner]++;
  times.push(r.restTime);
  last = r.winner;
  state = Physics.normalise(p, { theta: r.theta, J: r.J });
  state.phi = r.phi;
}
times.sort((a, b) => a - b);
const ms = (Date.now() - t0) / N;
console.log(`\nplanner: ${N} spins, ${ms.toFixed(2)} ms/spin, back-to-back repeats: ${repeats}`);
console.log('winner counts:', counts.join(' '));
console.log(
  `rest time p5=${times[Math.floor(N * 0.05)].toFixed(2)} p50=${times[Math.floor(N * 0.5)].toFixed(2)} p95=${times[
    Math.floor(N * 0.95)
  ].toFixed(2)} max=${times[N - 1].toFixed(2)}`
);
