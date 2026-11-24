/*
 * Round of Applause: wheel physics.
 *
 * The wheel is simulated rather than tweened. A peg sits on every wedge
 * boundary and a sprung flapper rests between two of them. To reach the next
 * wedge the wheel has to bend the flapper until the peg slips past its tip,
 * and that costs a little energy every time. The ratchet is what makes a real
 * wheel tick, slow down unevenly and sometimes rock back off a peg at the end.
 *
 * Conventions: angles are radians measured clockwise from 12 o'clock, and a
 * positive omega is a clockwise spin. Peg k sits at wheel angle (k - 0.5) * d,
 * so wedge j is centred on j * d. J is the peg on the flapper's left; the
 * flapper is therefore always inside wedge J (mod n). Theta is how far the
 * wheel has turned, so wheel angle a appears on screen at a + theta.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.ROA = root.ROA || {}).Physics = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  // Tuned by simulation (tools/tune.js). Units are rad, s, rad/s and rad/s^2.
  var FEEL = {
    flapTravelDeg: 7.5,    // how far a peg pushes the flapper before slipping past
    flapTipDeg: 1.8,       // half-width of the flapper tip plus the peg radius
    pegEnergyPerTurn: 2.8, // energy the pegs take out of the wheel per revolution
    returnForce: 1.3,      // share of the flapper's force when it pushes the wheel back
    returnZeta: 0.48,      // ...through leather, so the push back is soft, not a bounce
    coulomb: 0.42,         // bearing friction
    stiction: 0.5,         // force needed to get a resting wheel moving again
    drag: 0.039,           // air drag, grows with speed squared
    viscous: 0.02,
    flapHz: 15,            // flapper's natural frequency once released
    flapZeta: 0.16,
    dt: 1 / 1000,
    maxTime: 30
  };

  function params(n, overrides) {
    var f = {};
    var key;
    for (key in FEEL) f[key] = FEEL[key];
    if (overrides) for (key in overrides) f[key] = overrides[key];
    var delta = TAU / n;
    var travel = Math.min(f.flapTravelDeg * DEG, 0.42 * delta);
    var tip = Math.min(f.flapTipDeg * DEG, 0.12 * delta);
    var pegEnergy = f.pegEnergyPerTurn / n;
    var k = (2 * pegEnergy) / (travel * travel);
    return {
      n: n,
      delta: delta,
      travel: travel,
      tip: tip,
      k: k,
      returnForce: f.returnForce,
      // Same softness whatever the number of wedges (stiffness scales with n).
      returnDamping: 2 * f.returnZeta * Math.sqrt(k * f.returnForce),
      coulomb: f.coulomb,
      stiction: Math.max(f.stiction, f.coulomb),
      drag: f.drag,
      viscous: f.viscous,
      flapW: TAU * f.flapHz,
      flapZeta: f.flapZeta,
      dt: f.dt,
      maxTime: f.maxTime
    };
  }

  function mod(a, n) {
    return ((a % n) + n) % n;
  }

  // Peg index on the flapper's left for a wheel resting at theta.
  function pegLeftOf(p, theta) {
    return Math.floor(0.5 - theta / p.delta);
  }

  function winnerOf(p, J) {
    return mod(J, p.n);
  }

  /*
   * Run the wheel from a starting state until it rests.
   * start: { theta, J, omega, pushAccel, pushTime, phi, phiV }
   * pushAccel is the peak of a half-sine shove applied for pushTime seconds,
   * which is how a hand (or the Spin button) gets the wheel going.
   */
  function simulate(p, start) {
    var dt = p.dt;
    var delta = p.delta;
    var tip = p.tip;
    var travel = p.travel;
    var theta = start.theta;
    var J = start.J;
    var omega = start.omega || 0;
    var pushA = start.pushAccel || 0;
    var pushT = start.pushTime || 0;
    var phi = start.phi || 0;
    var phiV = start.phiV || 0;
    var loOn = true;
    var hiOn = true;
    var W = p.flapW;
    var Z = p.flapZeta;
    var maxSteps = Math.ceil(p.maxTime / dt);
    var settleSteps = Math.round(0.45 / dt);

    var thetas = new Float64Array(maxSteps + settleSteps + 2);
    var phis = new Float32Array(maxSteps + settleSteps + 2);
    var events = [];
    var peakOmega = Math.abs(omega);
    var restStep = -1;
    var creep = 0;
    var step = 0;
    thetas[0] = theta;
    phis[0] = phi;

    while (step < maxSteps + settleSteps) {
      var t = step * dt;
      var xL = (J - 0.5) * delta + theta;
      var uL = xL + tip;
      var uR = tip - (xL + delta);
      // The flapper resists fully while a peg is bending it. When the wheel
      // retreats it pushes back a little more gently and through heavy
      // damping, so a wheel that fails to clear a peg eases back rather than
      // bouncing. At rest (omega 0) that gentler push decides whether the
      // wheel rocks back or stays pressed against the peg.
      var spring = 0;
      var retreating = false;
      if (uL > 0) {
        if (omega > 0) spring -= p.k * uL;
        else { spring -= p.k * uL * p.returnForce; retreating = true; }
      }
      if (uR > 0) {
        if (omega < 0) spring += p.k * uR;
        else { spring += p.k * uR * p.returnForce; retreating = true; }
      }
      var drive = spring;
      if (t < pushT) drive += pushA * Math.sin((Math.PI * t) / pushT);

      if (restStep < 0) {
        var a = drive;
        if (omega === 0) {
          // A resting wheel only moves if the push beats static friction.
          if (Math.abs(drive) <= p.stiction) {
            a = 0;
            if (t >= pushT) restStep = step;
          } else {
            a = drive - Math.sign(drive) * p.coulomb;
          }
        } else {
          a = drive - Math.sign(omega) * p.coulomb;
        }
        if (restStep < 0) {
          var damp = p.drag * Math.abs(omega) + p.viscous + (retreating ? p.returnDamping : 0);
          var next = (omega + a * dt) / (1 + damp * dt);
          // Friction can stop the wheel but cannot spin it backwards; the
          // flapper's spring can, from rest, on the next step.
          if (omega !== 0 && next * omega < 0) next = 0;
          omega = next;
          // A wheel easing back against damping approaches rest without ever
          // quite reaching it. Call it stopped once it has barely moved for
          // a moment.
          if (t > pushT && Math.abs(omega) < 0.006) creep += 1;
          else creep = 0;
          if (creep >= 80) { omega = 0; restStep = step; }
          theta += omega * dt;
          if (Math.abs(omega) > peakOmega) peakOmega = Math.abs(omega);

          // Has a peg slipped past the flapper tip?
          xL = (J - 0.5) * delta + theta;
          if (xL + tip >= travel) {
            J -= 1;
            hiOn = false;
            events.push({ t: t + dt, speed: Math.abs(omega), dir: 1 });
          } else if (tip - (xL + delta) >= travel) {
            J += 1;
            loOn = false;
            events.push({ t: t + dt, speed: Math.abs(omega), dir: -1 });
          }
        }
      }

      // The flapper itself: a damped spring held back by whichever peg is
      // touching it. This is only drawn, it doesn't feed back into the wheel
      // beyond the spring force above.
      xL = (J - 0.5) * delta + theta;
      var lo = xL + tip;
      var hi = xL + delta - tip;
      phiV += (-W * W * phi - 2 * Z * W * phiV) * dt;
      phi += phiV * dt;
      if (!loOn && phi >= lo) loOn = true;
      if (!hiOn && phi <= hi) hiOn = true;
      if (loOn && phi < lo) { phi = lo; if (phiV < omega) phiV = omega; }
      if (hiOn && phi > hi) { phi = hi; if (phiV > omega) phiV = omega; }

      step += 1;
      thetas[step] = theta;
      phis[step] = phi;
      if (restStep >= 0 && step - restStep >= settleSteps) break;
    }

    if (restStep < 0) restStep = step;
    return {
      dt: dt,
      steps: step,
      thetas: thetas,
      phis: phis,
      events: events,
      restTime: restStep * dt,
      endTime: step * dt,
      theta: theta,
      J: J,
      phi: phi,
      winner: winnerOf(p, J),
      peakOmega: peakOmega,
      turns: Math.abs(theta - start.theta) / TAU
    };
  }

  // Keep theta small between spins without moving anything on screen.
  function normalise(p, state) {
    var m = Math.floor(state.theta / TAU);
    return { theta: state.theta - m * TAU, J: state.J + m * p.n };
  }

  /*
   * Choose a throw. Each attempt is a genuine simulated spin with a random
   * strength; attempts whose winner is excluded, or that run too short or too
   * long, are thrown away. The result shown is always a real physical outcome.
   *
   * opts: { exclude: number[], minTime, maxTime, speed: [lo, hi],
   *         flickOmega (signed, optional), random }
   */
  function plan(p, state, opts) {
    var rnd = opts.random || Math.random;
    var exclude = opts.exclude || [];
    var lo = opts.speed ? opts.speed[0] : 14;
    var hi = opts.speed ? opts.speed[1] : 19;
    var minTime = opts.minTime || 6;
    var maxTime = opts.maxTime || 8.5;
    var pushTime = 0.22;
    var best = null;
    var bestScore = Infinity;

    for (var attempt = 0; attempt < 400; attempt++) {
      var start = { theta: state.theta, J: state.J, phi: state.phi || 0, phiV: 0 };
      var dir = 1;
      var speed;
      if (opts.flickOmega) {
        dir = opts.flickOmega < 0 ? -1 : 1;
        var base = Math.min(hi, Math.max(lo, Math.abs(opts.flickOmega)));
        speed = base * (1 + (rnd() - 0.5) * 0.16 * (1 + attempt / 40));
        start.omega = dir * speed;
      } else {
        speed = lo + (hi - lo) * rnd();
        start.pushAccel = dir * (Math.PI / 2) * (speed / pushTime);
        start.pushTime = pushTime;
      }
      var res = simulate(p, start);
      res.speed = speed;
      res.dir = dir;
      var excluded = exclude.indexOf(res.winner) !== -1;
      if (excluded) continue;
      if (res.restTime >= minTime && res.restTime <= maxTime) return res;
      // Keep the closest legal spin in case the window can't be met.
      var miss = res.restTime < minTime ? minTime - res.restTime : res.restTime - maxTime;
      if (miss < bestScore) { bestScore = miss; best = res; }
    }
    return best;
  }

  /*
   * The same flapper model, driven by a hand dragging the wheel. Returns a
   * stepper: call it with the new theta each frame and it reports clicks.
   */
  function dragger(p, state) {
    var J = state.J;
    var theta = state.theta;
    var phi = state.phi || 0;
    var phiV = 0;
    var loOn = true;
    var hiOn = true;
    return {
      step: function (newTheta, frameDt) {
        var clicks = [];
        var n = Math.max(1, Math.ceil(frameDt / p.dt));
        var from = theta;
        var h = frameDt / n;
        var omega = (newTheta - from) / Math.max(frameDt, 1e-6);
        for (var i = 1; i <= n; i++) {
          theta = from + ((newTheta - from) * i) / n;
          var xL = (J - 0.5) * p.delta + theta;
          if (xL + p.tip >= p.travel) { J -= 1; hiOn = false; clicks.push(Math.abs(omega)); }
          else if (p.tip - (xL + p.delta) >= p.travel) { J += 1; loOn = false; clicks.push(Math.abs(omega)); }
          xL = (J - 0.5) * p.delta + theta;
          var lo = xL + p.tip;
          var hi = xL + p.delta - p.tip;
          phiV += (-p.flapW * p.flapW * phi - 2 * p.flapZeta * p.flapW * phiV) * h;
          phi += phiV * h;
          if (!loOn && phi >= lo) loOn = true;
          if (!hiOn && phi <= hi) hiOn = true;
          if (loOn && phi < lo) { phi = lo; if (phiV < omega) phiV = omega; }
          if (hiOn && phi > hi) { phi = hi; if (phiV > omega) phiV = omega; }
        }
        return clicks;
      },
      state: function () {
        return { theta: theta, J: J, phi: phi };
      }
    };
  }

  return {
    TAU: TAU,
    FEEL: FEEL,
    params: params,
    simulate: simulate,
    plan: plan,
    normalise: normalise,
    pegLeftOf: pegLeftOf,
    winnerOf: winnerOf,
    dragger: dragger,
    mod: mod
  };
});
