/*
 * Round of Applause: the show itself. Plans each spin with the physics,
 * plays it back frame by frame with its clicks, then runs the landing:
 * light-box on, bulbs flashing, confetti, the audience, and the card.
 */
(function () {
  'use strict';

  var ROA = window.ROA;
  var Physics = ROA.Physics;
  var Sound = ROA.Audio;
  var config = window.ROUND_OF_APPLAUSE || {};
  var STORE = 'round-of-applause:v1';

  // Wheel inks, ordered so neighbours always contrast.
  var PALETTE = ['#ff4f8b', '#ffd23f', '#4d5cff', '#ff8a2a', '#1fb5f2', '#d94ce0', '#2bd99f', '#8f5bff'];

  var $ = function (id) { return document.getElementById(id); };
  var studio = $('studio');
  var canvas = $('wheel');
  var wrap = $('wheel-wrap');
  var spinBtn = $('spin-btn');
  var hint = $('hint');
  var sign = $('sign');
  var reveal = $('reveal');
  var card = $('card');
  var cardName = $('card-name');
  var cardMessage = $('card-message');
  var cardFrom = $('card-from');
  var againBtn = $('again-btn');
  var closeBtn = $('close-btn');
  var soundBtn = $('sound-btn');
  var lineupBtn = $('lineup-btn');
  var fullBtn = $('fullscreen-btn');
  var drawer = $('lineup');
  var roster = $('roster');
  var roundsToggle = $('rounds-toggle');
  var audienceEl = $('audience');
  var announcer = $('announcer');

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  // ---------- people ----------
  function validHex(c) {
    return typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
  }

  var people = (Array.isArray(config.people) ? config.people : [])
    .filter(function (p) { return p && String(p.name || '').trim(); })
    .map(function (p) {
      var name = String(p.name).trim();
      return {
        name: name,
        message: String(p.message || '').trim() || 'Thank you, ' + name + ', for everything you do.',
        from: p.from ? String(p.from).trim() : '',
        colour: validHex(p.colour) ? p.colour.trim() : ''
      };
    });

  (function assignColours() {
    var n = people.length;
    for (var i = 0; i < n; i++) {
      if (people[i].colour) continue;
      var prev = i > 0 ? people[i - 1].colour : null;
      var first = i === n - 1 && n > 2 ? people[0].colour : null;
      for (var k = 0; k < PALETTE.length; k++) {
        var c = PALETTE[(i + k) % PALETTE.length];
        if (c !== prev && c !== first) { people[i].colour = c; break; }
      }
    }
  })();

  var N = people.length;
  var P = N ? Physics.params(N) : null;
  var seconds = Array.isArray(config.spinSeconds) ? config.spinSeconds : [6, 8.5];

  // ---------- remembered state ----------
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { return {}; }
  }
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        history: state.history.map(function (i) { return people[i].name; }),
        round: state.round.map(function (i) { return people[i].name; }),
        fair: state.fair,
        muted: state.muted,
        n: N,
        theta: state.wheel ? state.wheel.theta : 0,
        J: state.wheel ? state.wheel.J : 0
      }));
    } catch (e) { /* private mode: nothing to remember */ }
  }

  var saved = load();
  function indexOfName(name) {
    for (var i = 0; i < N; i++) if (people[i].name === name) return i;
    return -1;
  }
  function namesToIndices(list) {
    return (Array.isArray(list) ? list : []).map(indexOfName).filter(function (i) { return i >= 0; });
  }

  var state = {
    phase: 'idle',
    history: namesToIndices(saved.history),
    round: namesToIndices(saved.round),
    fair: typeof saved.fair === 'boolean' ? saved.fair : !!config.everyoneOncePerRound,
    muted: !!saved.muted,
    wheel: null,
    plan: null,
    start: 0,
    eventIdx: 0,
    drag: null
  };

  if (P) {
    var theta0;
    if (saved.n === N && typeof saved.theta === 'number' && isFinite(saved.theta)) theta0 = saved.theta;
    else theta0 = -Math.floor(Math.random() * N) * P.delta + (Math.random() - 0.5) * P.delta * 0.5;
    var J0 = saved.n === N && typeof saved.J === 'number' && Math.abs(saved.J - Physics.pegLeftOf(P, theta0)) <= 1
      ? saved.J
      : Physics.pegLeftOf(P, theta0);
    state.wheel = { theta: theta0, J: J0, phi: 0 };
  }

  function lastWinner() {
    return state.history.length ? state.history[state.history.length - 1] : -1;
  }

  // Who can't come up on the next spin.
  function excluded() {
    var ex = [];
    var last = lastWinner();
    if (last >= 0 && N > 1) ex.push(last);
    if (state.fair) {
      state.round.forEach(function (i) { if (ex.indexOf(i) < 0) ex.push(i); });
      if (ex.length >= N) ex = last >= 0 && N > 1 ? [last] : [];
    }
    return ex;
  }

  // ---------- rendering state ----------
  var wheel = new ROA.Wheel(canvas);
  var confetti = new ROA.Confetti($('confetti'));
  var view = {
    theta: state.wheel ? state.wheel.theta : 0,
    omega: 0,
    phi: 0,
    time: 0,
    chase: 0,
    bulbs: 'idle',
    winT: 0,
    tint: null,
    highlight: -1,
    highlightT: 0,
    veiled: [],
    veil: 1
  };
  var targets = { highlight: 0, veil: 1 };
  var winStart = 0;
  var looping = false;
  var lastFrame = 0;

  wheel.setPeople(people);
  canvas.setAttribute(
    'aria-label',
    'Prize wheel with ' + N + ' names: ' + people.map(function (p) { return p.name; }).join(', ')
  );

  var stage = document.querySelector('.stage');
  var action = document.querySelector('.action');

  // The wheel takes whatever the stage has left after the button, and the
  // pair sits centred as one group.
  function layout() {
    var cs = getComputedStyle(stage);
    var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    var row = cs.flexDirection === 'row';
    var gap = parseFloat(cs.columnGap) || 0;
    var w = stage.clientWidth - padX - (row ? action.offsetWidth + gap : 0);
    var h = stage.clientHeight - padY - (row ? 0 : action.offsetHeight);
    var size = Math.max(160, Math.floor(Math.min(w, h)));
    if (Math.abs(size - wheel.cssSize) > 1) wheel.resize(size, window.devicePixelRatio || 1);
    var r = canvas.getBoundingClientRect();
    var s = studio.getBoundingClientRect();
    var m = wheel.metrics();
    if (m) {
      studio.style.setProperty('--wheel-x', Math.round(r.left - s.left + m.cx) + 'px');
      studio.style.setProperty('--wheel-y', Math.round(r.top - s.top + m.cy) + 'px');
    }
    render();
  }

  function render() {
    view.veiled = state.phase === 'celebrating' ? [] : excluded();
    wheel.draw(view);
  }

  function kick() {
    if (looping) return;
    looping = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  function approach(cur, target, rate, dt) {
    return cur + (target - cur) * Math.min(1, rate * dt);
  }

  function frame(now) {
    var dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    view.time = now / 1000;
    var busy = false;

    if (state.phase === 'spinning' || state.phase === 'settling' || (state.phase === 'celebrating' && state.plan)) {
      busy = true;
      var plan = state.plan;
      // rAF's timestamp can be a hair earlier than the click that started us.
      var t = Math.max(0, (now - state.start) / 1000);
      var fi = Math.min(plan.steps, t / plan.dt);
      var i0 = Math.floor(fi);
      var i1 = Math.min(plan.steps, i0 + 1);
      var f = fi - i0;
      view.theta = plan.thetas[i0] + (plan.thetas[i1] - plan.thetas[i0]) * f;
      view.phi = plan.phis[i0] + (plan.phis[i1] - plan.phis[i0]) * f;
      var j = Math.min(plan.steps, i0 + 12);
      view.omega = j > i0 ? (plan.thetas[j] - plan.thetas[i0]) / ((j - i0) * plan.dt) : 0;
      view.chase += view.omega * dt * 2.2;

      // Clicks: schedule each peg slightly ahead so they land on time.
      var evs = plan.events;
      if (dt > 0.2) {
        while (state.eventIdx < evs.length && evs[state.eventIdx].t < t - 0.05) state.eventIdx++;
      }
      while (state.eventIdx < evs.length && evs[state.eventIdx].t <= t + 0.04) {
        var ev = evs[state.eventIdx++];
        var slow = 1 - Math.min(1, ev.speed / 14);
        Sound.click(ev.t - t + 0.01, 0.3 + 0.7 * slow);
        if (ev.speed < 5 && navigator.vibrate) navigator.vibrate(7);
      }
      Sound.spinNoise(view.omega);

      if (state.phase === 'spinning' && t >= plan.restTime) land();
      if (t >= plan.endTime) {
        state.wheel = Physics.normalise(P, { theta: plan.theta, J: plan.J });
        state.wheel.phi = plan.phi;
        view.theta = state.wheel.theta;
        view.phi = plan.phi;
        view.omega = 0;
        state.plan = null;
        Sound.spinNoise(0);
        if (state.phase === 'settling') state.phase = 'idle';
        save();
      }
    } else if (state.phase === 'dragging') {
      busy = true;
      var d = state.drag;
      var clicks = d.stepper.step(d.theta, Math.max(dt, 1 / 240));
      var ds = d.stepper.state();
      view.omega = (ds.theta - view.theta) / Math.max(dt, 1e-3);
      view.theta = ds.theta;
      view.phi = ds.phi;
      view.chase += view.omega * dt * 2.2;
      clicks.forEach(function (sp) { Sound.click(0, 0.35 + 0.4 * (1 - Math.min(1, sp / 14))); });
    }

    // Bulbs and overlays.
    if (state.phase === 'celebrating') {
      view.bulbs = 'win';
      view.winT = (now - winStart) / 1000;
      busy = true;
    } else {
      view.bulbs = state.phase === 'idle' ? 'idle' : 'chase';
    }
    view.highlightT = approach(view.highlightT, targets.highlight, 6, dt);
    view.veil = approach(view.veil, targets.veil, 5, dt);
    if (Math.abs(view.highlightT - targets.highlight) > 0.01 || Math.abs(view.veil - targets.veil) > 0.01) busy = true;
    else {
      view.highlightT = targets.highlight;
      view.veil = targets.veil;
      if (targets.highlight === 0) view.highlight = -1;
    }

    render();
    if (busy) requestAnimationFrame(frame);
    else looping = false;
  }

  // ---------- the spin ----------
  // Where the wheel really is, even mid-playback.
  function currentWheel() {
    var plan = state.plan;
    if (!plan) return state.wheel;
    var t = (performance.now() - state.start) / 1000;
    if (t >= plan.restTime) {
      var w = Physics.normalise(P, { theta: plan.theta, J: plan.J });
      w.phi = view.phi;
      return w;
    }
    return { theta: view.theta, J: Physics.pegLeftOf(P, view.theta), phi: view.phi };
  }

  function press() {
    spinBtn.classList.add('is-pressed');
    setTimeout(function () { spinBtn.classList.remove('is-pressed'); }, 140);
  }

  function spin(flickOmega) {
    if (!N || state.phase === 'spinning' || state.phase === 'dragging') return;
    if (state.phase === 'celebrating') closeReveal(true);
    if (state.phase !== 'dragging') state.wheel = currentWheel();
    Sound.init();
    Sound.setMuted(state.muted);
    // A flick keeps its own strength (within reason): a gentle one gives a
    // shorter spin, a hard one a longer one. The button is always a good shove.
    var plan = Physics.plan(P, state.wheel, {
      exclude: excluded(),
      minTime: flickOmega ? 4 : seconds[0],
      maxTime: flickOmega ? 9.5 : seconds[1],
      speed: flickOmega ? [9, 24] : null,
      flickOmega: flickOmega || 0
    });
    if (!plan) return;
    state.plan = plan;
    state.phase = 'spinning';
    state.start = performance.now();
    state.eventIdx = 0;
    targets.veil = 1;
    targets.highlight = 0;
    if (!flickOmega) {
      press();
      Sound.whoosh();
    }
    spinBtn.disabled = true;
    spinBtn.setAttribute('aria-label', 'Spinning');
    kick();
  }

  function land() {
    var w = state.plan.winner;
    var p = people[w];
    state.phase = 'celebrating';
    state.history.push(w);
    if (state.history.length > 200) state.history.splice(0, state.history.length - 200);
    if (state.fair && state.round.indexOf(w) < 0) state.round.push(w);
    var roundDone = state.fair && state.round.length >= N;
    if (roundDone) state.round = [];
    state.roundJustFinished = roundDone;
    save();

    winStart = performance.now();
    view.highlight = w;
    view.tint = p.colour;
    targets.highlight = 1;
    targets.veil = 0;
    view.veil = 0;

    sign.classList.remove('is-lit');
    void sign.offsetWidth;
    sign.classList.add('is-lit');
    studio.classList.add('is-celebrating');
    audienceEl.classList.remove('is-cheering');
    void audienceEl.offsetWidth;
    audienceEl.classList.add('is-cheering');

    Sound.spinNoise(0);
    Sound.fanfare();
    setTimeout(Sound.applause, 180);
    if (navigator.vibrate) navigator.vibrate([24, 50, 24, 50, 60]);
    var inks = people.map(function (q) { return q.colour; }).concat(['#ffe2a0', '#ffffff', p.colour, p.colour]);
    setTimeout(function () { confetti.celebrate(inks, reduceMotion); }, reduceMotion ? 0 : 140);
    setTimeout(function () { showReveal(w); }, reduceMotion ? 200 : 700);
    announcer.textContent = 'A round of applause for ' + p.name + '. ' + p.message;
    renderRoster();
  }

  // ---------- the card ----------
  var lastFocus = null;

  function showReveal(i) {
    if (state.phase !== 'celebrating') return;
    var p = people[i];
    card.style.setProperty('--card', p.colour);
    card.style.setProperty('--card-ink', ROA.Wheel.inkFor(p.colour));
    card.style.setProperty('--card-deep', ROA.Wheel.shade(p.colour, 0.42));
    cardName.textContent = '';
    var idx = 0;
    p.name.split(/\s+/).forEach(function (word, wi) {
      if (wi) cardName.appendChild(document.createTextNode(' '));
      var ws = document.createElement('span');
      ws.style.whiteSpace = 'nowrap';
      ws.style.display = 'inline-block';
      Array.from(word).forEach(function (ch) {
        var s = document.createElement('span');
        s.className = 'ch';
        s.textContent = ch;
        s.style.setProperty('--i', idx++);
        ws.appendChild(s);
      });
      cardName.appendChild(ws);
    });
    cardName.setAttribute('aria-label', p.name);
    cardMessage.textContent = p.message;
    cardFrom.textContent = p.from || config.signOff || '';
    reveal.classList.remove('is-leaving');
    reveal.hidden = false;
    fitName();
    // Restart the entrance animations.
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = '';
    lastFocus = document.activeElement;
    studio.inert = true;
    againBtn.focus({ preventScroll: true });
  }

  // Long names shrink until their longest word fits the card; names with
  // several words wrap between words instead.
  function fitName() {
    cardName.style.fontSize = '';
    var size = parseFloat(getComputedStyle(cardName).fontSize);
    var words = cardName.children;
    for (var guard = 0; guard < 30 && size > 26; guard++) {
      var widest = 0;
      // offsetWidth ignores the entrance animation's scaling.
      for (var k = 0; k < words.length; k++) widest = Math.max(widest, words[k].offsetWidth);
      if (widest <= cardName.clientWidth) break;
      size *= 0.92;
      cardName.style.fontSize = size + 'px';
    }
  }

  function closeReveal(immediate) {
    if (state.phase !== 'celebrating') return;
    state.phase = state.plan ? 'settling' : 'idle';
    studio.inert = false;
    sign.classList.remove('is-lit');
    studio.classList.remove('is-celebrating');
    audienceEl.classList.remove('is-cheering');
    targets.highlight = 0;
    targets.veil = 1;
    view.veil = 0;
    spinBtn.disabled = false;
    spinBtn.removeAttribute('aria-label');
    if (immediate || reduceMotion) {
      reveal.hidden = true;
    } else {
      reveal.classList.add('is-leaving');
      setTimeout(function () {
        if (reveal.classList.contains('is-leaving')) {
          reveal.hidden = true;
          reveal.classList.remove('is-leaving');
        }
      }, 300);
    }
    updateHint();
    renderRoster();
    if (!immediate) (lastFocus && lastFocus !== document.body ? lastFocus : spinBtn).focus({ preventScroll: true });
    kick();
  }

  // ---------- words around the wheel ----------
  function updateHint() {
    if (!N) {
      hint.textContent = 'Add some names to people.js to fill the wheel.';
      spinBtn.disabled = true;
      return;
    }
    var last = lastWinner();
    if (state.fair && state.roundJustFinished) {
      hint.textContent = 'Everyone’s had their applause. The next spin starts a new round.';
    } else if (state.fair && state.round.length) {
      hint.textContent = state.round.length + ' of ' + N + ' applauded this round';
    } else if (last >= 0 && N > 1) {
      hint.textContent = people[last].name + ' sits out the next spin';
    } else {
      hint.textContent = coarse ? 'Tap Spin, or give the wheel a flick' : 'Press Space or click Spin';
    }
  }

  function countWord(c) {
    return c === 1 ? 'once' : c === 2 ? 'twice' : c + ' times';
  }

  function renderRoster() {
    var last = lastWinner();
    var counts = new Array(N).fill(0);
    state.history.forEach(function (i) { counts[i]++; });
    roster.textContent = '';
    people.forEach(function (p, i) {
      var li = document.createElement('li');
      var sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.setProperty('--c', p.colour);
      var who = document.createElement('span');
      who.className = 'who';
      who.textContent = p.name;
      var st = document.createElement('span');
      st.className = 'status';
      if (i === last && N > 1) {
        st.textContent = 'Sits out the next spin';
        li.className = 'is-last';
      } else if (state.fair && state.round.indexOf(i) >= 0) {
        st.textContent = 'Applauded this round';
        li.className = 'is-out';
      } else if (counts[i]) {
        st.textContent = 'Applauded ' + countWord(counts[i]);
      }
      li.appendChild(sw);
      li.appendChild(who);
      li.appendChild(st);
      roster.appendChild(li);
    });
  }

  // ---------- the audience ----------
  function buildAudience() {
    var W = 1600;
    var H = 110;
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMax slice');
    var rows = [
      { count: 31, base: H - 14, scale: 0.78, fill: '#0b1663', jitter: 18 },
      { count: 25, base: H + 4, scale: 1, fill: '#060c3f', jitter: 14 }
    ];
    var seed = 7;
    function rnd() {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    }
    rows.forEach(function (row, ri) {
      var gap = W / row.count;
      for (var k = 0; k < row.count; k++) {
        var x = gap * (k + 0.5) + (rnd() - 0.5) * row.jitter + (ri === 0 ? gap * 0.5 : 0);
        var s = row.scale * (0.88 + rnd() * 0.24);
        var sw = 30 * s;
        var sh = 34 * s;
        var hr = 14.5 * s;
        var y = row.base;
        var g = document.createElementNS(ns, 'g');
        g.setAttribute('class', 'person');
        g.setAttribute('fill', row.fill);
        g.style.setProperty('--delay', (rnd() * 0.3).toFixed(2) + 's');
        g.style.setProperty('--lift', (3 + rnd() * 6).toFixed(1) + 'px');
        if (ri === 1 && rnd() < 0.45) {
          var arms = document.createElementNS(ns, 'g');
          arms.setAttribute('class', 'arms');
          var hy = y - sh - hr * 2.1;
          [-1, 1].forEach(function (side) {
            var a = document.createElementNS(ns, 'path');
            var hx = x + side * hr * 0.55;
            a.setAttribute(
              'd',
              'M' + (x + side * sw * 0.55) + ' ' + (y - sh * 0.55) +
              ' Q' + (x + side * sw * 0.95) + ' ' + (hy + hr * 0.6) + ' ' + hx + ' ' + (hy - hr * 0.7) +
              ' l' + (-side * hr * 0.45) + ' ' + hr * 0.25 +
              ' Q' + (x + side * sw * 0.55) + ' ' + (hy + hr) + ' ' + (x + side * sw * 0.3) + ' ' + (y - sh * 0.55) + 'Z'
            );
            arms.appendChild(a);
          });
          g.appendChild(arms);
        }
        var body = document.createElementNS(ns, 'path');
        body.setAttribute(
          'd',
          'M' + (x - sw) + ' ' + (y + 2) +
          ' C' + (x - sw) + ' ' + (y - sh * 0.9) + ' ' + (x - sw * 0.5) + ' ' + (y - sh) + ' ' + x + ' ' + (y - sh) +
          ' C' + (x + sw * 0.5) + ' ' + (y - sh) + ' ' + (x + sw) + ' ' + (y - sh * 0.9) + ' ' + (x + sw) + ' ' + (y + 2) + 'Z'
        );
        g.appendChild(body);
        var head = document.createElementNS(ns, 'ellipse');
        head.setAttribute('cx', x);
        head.setAttribute('cy', y - sh - hr * 0.75);
        head.setAttribute('rx', hr * 0.92);
        head.setAttribute('ry', hr);
        g.appendChild(head);
        svg.appendChild(g);
      }
    });
    audienceEl.appendChild(svg);
  }

  // ---------- dragging and flicking ----------
  function pointerAngle(e) {
    var r = canvas.getBoundingClientRect();
    var m = wheel.metrics();
    var dx = e.clientX - r.left - m.cx;
    var dy = e.clientY - r.top - m.cy;
    return { a: Math.atan2(dy, dx), r: Math.hypot(dx, dy), m: m };
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (!N || state.phase === 'spinning' || state.phase === 'celebrating') return;
    var pa = pointerAngle(e);
    if (pa.r > pa.m.rOut || pa.r < pa.m.rFace * 0.22) return;
    Sound.init();
    Sound.setMuted(state.muted);
    var base = currentWheel();
    state.plan = null;
    state.phase = 'dragging';
    state.drag = {
      id: e.pointerId,
      lastA: pa.a,
      theta: base.theta,
      stepper: Physics.dragger(P, base),
      samples: [{ t: performance.now(), theta: base.theta }]
    };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-dragging');
    kick();
  });

  canvas.addEventListener('pointermove', function (e) {
    var d = state.drag;
    if (state.phase !== 'dragging' || !d || e.pointerId !== d.id) return;
    var pa = pointerAngle(e);
    var da = pa.a - d.lastA;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    d.lastA = pa.a;
    d.theta += da;
    var now = performance.now();
    d.samples.push({ t: now, theta: d.theta });
    while (d.samples.length > 2 && now - d.samples[0].t > 90) d.samples.shift();
  });

  function release(e) {
    var d = state.drag;
    if (state.phase !== 'dragging' || !d || e.pointerId !== d.id) return;
    canvas.classList.remove('is-dragging');
    var s = d.stepper.state();
    state.wheel = { theta: s.theta, J: s.J, phi: s.phi };
    state.drag = null;
    var a = d.samples[0];
    var b = d.samples[d.samples.length - 1];
    var now = performance.now();
    var omega = b.t > a.t && now - b.t < 80 ? (b.theta - a.theta) / ((b.t - a.t) / 1000) : 0;
    if (Math.abs(omega) > 2.5) {
      state.phase = 'idle';
      spin(omega);
    } else {
      // Let the flapper ease the wheel off any peg it was left pressing on.
      state.plan = Physics.simulate(P, { theta: s.theta, J: s.J, phi: s.phi, omega: 0 });
      state.phase = 'settling';
      state.start = performance.now();
      state.eventIdx = 0;
      kick();
    }
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // ---------- controls ----------
  spinBtn.addEventListener('click', function () { spin(); });
  againBtn.addEventListener('click', function () { spin(); });
  closeBtn.addEventListener('click', function () { closeReveal(false); });
  $('reveal-shade').addEventListener('click', function () { closeReveal(false); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (state.phase === 'celebrating') closeReveal(false);
      else if (drawer.classList.contains('is-open')) toggleDrawer(false);
      return;
    }
    if (e.key !== ' ' && e.key !== 'Enter') return;
    var tag = e.target && e.target.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'A' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (drawer.contains(e.target)) return;
    e.preventDefault();
    spin();
  });

  // Keep keyboard focus inside the card while it's open.
  card.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var first = againBtn;
    var lastEl = closeBtn;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  });

  function setMuted(m) {
    state.muted = m;
    soundBtn.setAttribute('aria-pressed', String(!m));
    soundBtn.setAttribute('aria-label', m ? 'Sound off' : 'Sound on');
    Sound.setMuted(m);
    save();
  }
  soundBtn.addEventListener('click', function () {
    Sound.init();
    setMuted(!state.muted);
  });

  function toggleDrawer(open) {
    drawer.classList.toggle('is-open', open);
    drawer.inert = !open;
    lineupBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      renderRoster();
      $('lineup-close').focus({ preventScroll: true });
    } else if (drawer.contains(document.activeElement)) {
      lineupBtn.focus({ preventScroll: true });
    }
  }
  lineupBtn.addEventListener('click', function () { toggleDrawer(!drawer.classList.contains('is-open')); });
  $('lineup-close').addEventListener('click', function () { toggleDrawer(false); });
  document.addEventListener('pointerdown', function (e) {
    if (drawer.classList.contains('is-open') && !drawer.contains(e.target) && !lineupBtn.contains(e.target)) toggleDrawer(false);
  });

  roundsToggle.checked = state.fair;
  roundsToggle.addEventListener('change', function () {
    state.fair = roundsToggle.checked;
    state.round = [];
    state.roundJustFinished = false;
    save();
    updateHint();
    renderRoster();
    kick();
  });

  $('reset-btn').addEventListener('click', function () {
    state.history = [];
    state.round = [];
    state.roundJustFinished = false;
    save();
    updateHint();
    renderRoster();
    kick();
  });

  var canFull = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  if (canFull) {
    fullBtn.hidden = false;
    fullBtn.addEventListener('click', function () {
      var el = document.documentElement;
      var isFull = document.fullscreenElement || document.webkitFullscreenElement;
      try {
        if (isFull) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else {
          var req = el.requestFullscreen || el.webkitRequestFullscreen;
          var r = req.call(el);
          if (r && r.catch) r.catch(function () {});
        }
      } catch (err) { /* refused: nothing to do */ }
    });
    var onFull = function () {
      var isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
      document.documentElement.classList.toggle('is-fullscreen', isFull);
      fullBtn.setAttribute('aria-label', isFull ? 'Exit full screen' : 'Full screen');
    };
    document.addEventListener('fullscreenchange', onFull);
    document.addEventListener('webkitfullscreenchange', onFull);
  }

  // ---------- start ----------
  buildAudience();
  setMuted(state.muted);
  updateHint();
  renderRoster();

  if (window.ResizeObserver) {
    var stageWatch = new ResizeObserver(layout);
    stageWatch.observe(stage);
    stageWatch.observe(action);
  }
  window.addEventListener('resize', function () {
    confetti.resize();
    layout();
  });
  layout();

  // Repaint the names once the signage face has loaded.
  if (document.fonts && document.fonts.load) {
    Promise.all([
      document.fonts.load('800 40px "Big Shoulders"', 'APPLAUSE'),
      document.fonts.load('italic 500 20px "Fraunces"', 'Round of')
    ]).then(function () {
      wheel.build();
      render();
    }).catch(function () {});
  }

  // Handy for testing from the console: ROA.debug.spin(), ROA.debug.state.
  ROA.debug = { spin: spin, state: state, people: people, view: view };
})();
