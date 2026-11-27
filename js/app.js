/*
 * Round of Applause: the show itself. Plans each spin with the physics,
 * plays it back frame by frame with its clicks, then runs the landing:
 * light-box on, bulbs flashing, confetti, the audience, and the card.
 *
 * The line-up starts as people.js and can be edited from the Line-up panel.
 * Edits are kept in this browser; people.js itself never changes.
 */
(function () {
  'use strict';

  var ROA = window.ROA;
  var Physics = ROA.Physics;
  var Sound = ROA.Audio;
  var config = window.ROUND_OF_APPLAUSE || {};
  var STORE = 'round-of-applause:v1';
  var LIST_STORE = 'round-of-applause:people:v1';
  var TAU = Math.PI * 2;
  var MIN_PEOPLE = 2;
  var MAX_PEOPLE = 40;

  // Wheel inks, ordered so neighbours always contrast.
  var PALETTE = ['#ff4f8b', '#ffd23f', '#4d5cff', '#ff8a2a', '#1fb5f2', '#d94ce0', '#2bd99f', '#8f5bff'];
  // Pairs too alike to sit side by side, so new names avoid them.
  var ALIKE = {
    '#4d5cff|#8f5bff': 1, '#d94ce0|#8f5bff': 1, '#ffd23f|#ff8a2a': 1,
    '#4d5cff|#d94ce0': 1, '#ff4f8b|#d94ce0': 1
  };

  var $ = function (id) { return document.getElementById(id); };
  var studio = $('studio');
  var canvas = $('wheel');
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
  function cleanName(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }
  function messageFor(p) {
    return p.message || 'Thank you, ' + p.name + ', for everything you do.';
  }
  function clonePerson(p) {
    return { id: p.id, name: p.name, message: p.message, from: p.from, fixed: p.fixed, colour: p.colour };
  }
  function newId() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // people.js as written: the starting line-up. `fixed` is a colour chosen
  // there; `colour` is the one the wedge actually wears.
  var defaults = (Array.isArray(config.people) ? config.people : [])
    .filter(function (p) { return p && String(p.name || '').trim(); })
    .map(function (p) {
      return {
        id: '',
        name: String(p.name).trim(),
        message: String(p.message || '').trim(),
        from: p.from ? String(p.from).trim() : '',
        fixed: validHex(p.colour) ? p.colour.trim().toLowerCase() : '',
        colour: ''
      };
    });

  // Ids follow names in people.js, so a reordered file keeps everyone's history.
  (function () {
    var seen = {};
    defaults.forEach(function (p) {
      var id = 'n:' + p.name;
      for (var k = 2; seen[id]; k++) id = 'n:' + p.name + '~' + k;
      seen[id] = true;
      p.id = id;
    });
  })();

  // The palette in order, skipping any colour that would sit next to itself.
  function startingColours(list) {
    var n = list.length;
    list.forEach(function (p) { p.colour = p.fixed; });
    for (var i = 0; i < n; i++) {
      if (list[i].colour) continue;
      var prev = i > 0 ? list[i - 1].colour : null;
      var first = i === n - 1 && n > 2 ? list[0].colour : null;
      for (var k = 0; k < PALETTE.length; k++) {
        var c = PALETTE[(i + k) % PALETTE.length];
        if (c !== prev && c !== first) { list[i].colour = c; break; }
      }
    }
    return list;
  }
  startingColours(defaults);

  function alike(a, b) {
    return !!(a && b && (ALIKE[a + '|' + b] || ALIKE[b + '|' + a]));
  }

  // After an edit, everyone keeps their colour unless it now matches the
  // wedge beside theirs. Newcomers get a colour that stands apart from both
  // neighbours, favouring whichever is least used on the wheel.
  function recolour(list) {
    var n = list.length;
    for (var i = 0; i < n; i++) {
      var p = list[i];
      if (p.fixed) { p.colour = p.fixed; continue; }
      var prev = i > 0 ? list[i - 1].colour : null;
      var first = i === n - 1 && n > 2 ? list[0].colour : null;
      if (validHex(p.colour) && p.colour !== prev && p.colour !== first) continue;
      var next = i < n - 1 ? list[i + 1].colour : null;
      p.colour = pickColour(list, i, [prev, first, next]);
    }
    return list;
  }

  function pickColour(list, i, near) {
    var used = {};
    list.forEach(function (q, k) { if (k !== i && q.colour) used[q.colour] = (used[q.colour] || 0) + 1; });
    var best = PALETTE[i % PALETTE.length];
    var bestKey = null;
    for (var k = 0; k < PALETTE.length; k++) {
      var c = PALETTE[(i + k) % PALETTE.length];
      if (near.indexOf(c) >= 0) continue;
      var key = [near.filter(function (m) { return alike(c, m); }).length, used[c] || 0, k];
      if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
        best = c;
        bestKey = key;
      }
    }
    return best;
  }

  function fingerprint(list) {
    var s = JSON.stringify(list.map(function (p) { return [p.name, p.message, p.from, p.fixed]; }));
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  var baseline = fingerprint(defaults);

  function sameAsDefaults(list) {
    if (list.length !== defaults.length) return false;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var b = defaults[i];
      if (a.name !== b.name || a.message !== b.message || a.from !== b.from || a.fixed !== b.fixed) return false;
    }
    return true;
  }

  // ---------- the edited line-up, kept in this browser ----------
  function loadList() {
    try {
      var raw = JSON.parse(localStorage.getItem(LIST_STORE) || 'null');
      if (!raw || !Array.isArray(raw.people)) return null;
      var seen = {};
      var list = [];
      raw.people.forEach(function (q) {
        if (!q || typeof q !== 'object' || list.length >= MAX_PEOPLE) return;
        var name = typeof q.name === 'string' ? q.name.trim() : '';
        if (!name) return;
        var id = typeof q.id === 'string' && q.id && !seen[q.id] ? q.id : newId();
        seen[id] = true;
        list.push({
          id: id,
          name: name,
          message: typeof q.message === 'string' ? q.message.trim() : '',
          from: typeof q.from === 'string' ? q.from.trim() : '',
          fixed: validHex(q.fixed) ? q.fixed.trim().toLowerCase() : '',
          colour: validHex(q.colour) ? q.colour.trim().toLowerCase() : ''
        });
      });
      return { base: typeof raw.base === 'string' ? raw.base : '', people: list };
    } catch (e) {
      return null;
    }
  }

  var stored = loadList();
  var people;
  var edited = false;
  var listBase = baseline; // people.js as it was when this browser's edits began
  if (stored && stored.people.length && !sameAsDefaults(stored.people)) {
    people = recolour(stored.people);
    edited = true;
    listBase = stored.base;
  } else {
    people = defaults.map(clonePerson);
  }

  function storeList() {
    try {
      if (!edited) localStorage.removeItem(LIST_STORE);
      else localStorage.setItem(LIST_STORE, JSON.stringify({ base: listBase, people: people.map(clonePerson) }));
    } catch (e) { /* private mode: edits last until the page closes */ }
  }

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
        history: state.history,
        round: state.round,
        fair: state.fair,
        muted: state.muted,
        n: N,
        theta: state.wheel ? state.wheel.theta : 0,
        J: state.wheel ? state.wheel.J : 0
      }));
    } catch (e) { /* private mode: nothing to remember */ }
  }

  function indexOfId(id) {
    for (var i = 0; i < N; i++) if (people[i].id === id) return i;
    return -1;
  }

  // History is kept by id. Older saves kept names, so map those across.
  var saved = load();
  function toIds(list) {
    return (Array.isArray(list) ? list : [])
      .filter(function (v) { return typeof v === 'string' && v; })
      .map(function (v) {
        if (indexOfId(v) >= 0) return v;
        for (var i = 0; i < N; i++) if (people[i].name === v) return people[i].id;
        return v;
      });
  }

  var state = {
    phase: 'idle',
    history: toIds(saved.history),
    round: toIds(saved.round),
    fair: typeof saved.fair === 'boolean' ? saved.fair : !!config.everyoneOncePerRound,
    muted: !!saved.muted,
    wheel: null,
    plan: null,
    start: 0,
    eventIdx: 0,
    drag: null,
    morph: null
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
    return state.history.length ? indexOfId(state.history[state.history.length - 1]) : -1;
  }

  function roundIndices() {
    return state.round.map(indexOfId).filter(function (i) { return i >= 0; });
  }

  // Who can't come up on the next spin.
  function excluded() {
    var ex = [];
    var last = lastWinner();
    if (last >= 0 && N > 1) ex.push(last);
    if (state.fair) {
      roundIndices().forEach(function (i) { if (ex.indexOf(i) < 0) ex.push(i); });
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
    veil: 1,
    morph: null,
    morphFade: 0,
    thetaEnd: null
  };
  var targets = { highlight: 0, veil: 1 };
  var winStart = 0;
  var looping = false;
  var lastFrame = 0;

  function labelWheel() {
    canvas.setAttribute(
      'aria-label',
      'Prize wheel with ' + N + ' names: ' + people.map(function (p) { return p.name; }).join(', ')
    );
  }

  wheel.setPeople(people);
  labelWheel();

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
    if (Math.abs(size - wheel.cssSize) > 1) {
      // A new size means a fresh face; a re-flow in progress can't carry over.
      finishMorph();
      wheel.resize(size, window.devicePixelRatio || 1);
    }
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
    syncLock();
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

  function smooth(e0, e1, v) {
    var t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  function frame(now) {
    var dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    view.time = now / 1000;
    var busy = false;

    if (state.morph) {
      busy = true;
      var m = state.morph;
      var mt = Math.min(1, Math.max(0, (now - m.start) / m.dur));
      var e = mt < 0.5 ? 4 * mt * mt * mt : 1 - Math.pow(2 - 2 * mt, 3) / 2;
      view.morph = e;
      view.theta = morphTheta(m, e);
      view.morphFade = smooth(0.8, 1, mt);
      view.thetaEnd = state.wheel.theta;
      if (mt >= 1) finishMorph();
    }

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
    flushFace();
    finishMorph();
    wheel.ensureBlur();
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
    state.history.push(p.id);
    if (state.history.length > 200) state.history.splice(0, state.history.length - 200);
    if (state.fair && state.round.indexOf(p.id) < 0) state.round.push(p.id);
    var roundDone = state.fair && roundIndices().length >= N;
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
    announcer.textContent = 'A round of applause for ' + p.name + '. ' + messageFor(p);
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
    cardMessage.textContent = messageFor(p);
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
      hint.textContent = 'Open the line-up and add some names to fill the wheel.';
      spinBtn.disabled = true;
      return;
    }
    if (state.phase === 'idle') spinBtn.disabled = false;
    var last = lastWinner();
    var inRound = roundIndices().length;
    if (state.fair && state.roundJustFinished) {
      hint.textContent = 'Everyone’s had their applause. The next spin starts a new round.';
    } else if (state.fair && inRound) {
      hint.textContent = inRound + ' of ' + N + ' applauded this round';
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
    state.history.forEach(function (id) {
      var i = indexOfId(id);
      if (i >= 0) counts[i]++;
    });
    var inRound = roundIndices();
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
      } else if (state.fair && inRound.indexOf(i) >= 0) {
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

  // ---------- changing the line-up ----------
  // Rest the wheel with wedge i under the pointer, f of a wedge off centre,
  // kept clear of the pegs so the flapper isn't left pressing on one.
  function restingAt(i, f) {
    var lim = Math.max(0, 0.5 - (P.tip * 1.6) / P.delta);
    f = Math.max(-lim, Math.min(lim, f || 0));
    var w = Physics.normalise(P, { theta: -(i + f) * P.delta, J: i });
    w.phi = 0;
    return w;
  }

  function wrapPi(a) {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  }

  // The old and new line-ups side by side in wheel order, for the re-flow.
  // Returns null if anyone changed places (edits never reorder, but undo
  // across a reload could), and the wheel simply switches instead.
  function mergeLineups(a, b) {
    var inA = {};
    var inB = {};
    a.forEach(function (p, i) { inA[p.id] = i; });
    b.forEach(function (p, i) { inB[p.id] = i; });
    var out = [];
    var i = 0;
    var j = 0;
    while (i < a.length || j < b.length) {
      var pa = a[i];
      var pb = b[j];
      if (pa && pb && pa.id === pb.id) {
        out.push({ id: pa.id, i0: i, i1: j, w0: 1, w1: 1, n0: pa.name, n1: pb.name, c0: pa.colour, c1: pb.colour });
        i++;
        j++;
      } else if (pa && !(pa.id in inB)) {
        out.push({ id: pa.id, i0: i, i1: -1, w0: 1, w1: 0, n0: pa.name, n1: null, c0: pa.colour, c1: null });
        i++;
      } else if (pb && !(pb.id in inA)) {
        out.push({ id: pb.id, i0: -1, i1: j, w0: 0, w1: 1, n0: null, n1: pb.name, c0: null, c1: pb.colour });
        j++;
      } else {
        return null;
      }
    }
    return out;
  }

  function morphTheta(m, e) {
    var sp = ROA.Wheel.morphSpans(m.merged, e)[m.a];
    return -(sp.mid + (m.f0 + (m.f1 - m.f0) * e) * sp.span);
  }

  var blurTimer = 0;
  function scheduleBlur() {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(function () {
      if (!state.morph && state.phase === 'idle') wheel.blurLater();
    }, 150);
  }

  function finishMorph() {
    if (!state.morph) return;
    state.morph = null;
    wheel.endMorph();
    view.morph = null;
    view.morphFade = 0;
    view.thetaEnd = null;
    view.theta = state.wheel ? state.wheel.theta : 0;
    scheduleBlur();
  }

  // A wheel still rocking from the last spin comes to rest at once, so an
  // edit always starts from a wheel at rest.
  function settleNow() {
    if (state.phase !== 'settling' || !state.plan) return;
    var plan = state.plan;
    state.wheel = Physics.normalise(P, { theta: plan.theta, J: plan.J });
    state.wheel.phi = 0;
    state.plan = null;
    state.phase = 'idle';
    view.theta = state.wheel.theta;
    view.phi = 0;
    view.omega = 0;
    Sound.spinNoise(0);
  }

  /*
   * Put a new line-up on the wheel. The wedges re-flow into place, and
   * whoever is under the pointer stays there (if they've just been removed,
   * the next name round slides under it instead).
   */
  function setLineup(next) {
    facePending = false;
    clearTimeout(faceTimer);
    settleNow();
    finishMorph();
    var before = people;
    var oldWheel = state.wheel;
    var oldN = N;
    var veiledBefore = excluded();

    people = recolour(next);
    N = people.length;
    P = N ? Physics.params(N) : null;

    var anchor = null;
    if (!P) {
      state.wheel = null;
    } else if (!oldWheel || !oldN) {
      state.wheel = restingAt(0, 0);
    } else {
      var jOld = Physics.mod(oldWheel.J, oldN);
      var f = -oldWheel.theta / (TAU / oldN) - oldWheel.J;
      var target = indexOfId(before[jOld].id);
      if (target < 0) {
        f = 0;
        for (var k = 1; k < oldN && target < 0; k++) target = indexOfId(before[(jOld + k) % oldN].id);
      }
      if (target >= 0) {
        anchor = people[target].id;
        state.wheel = restingAt(target, f);
      } else {
        state.wheel = restingAt(0, 0);
      }
    }

    wheel.setPeople(people, { quick: true });
    view.theta = state.wheel ? state.wheel.theta : 0;
    view.phi = 0;
    if (anchor && !reduceMotion && wheel.g && oldN) startMorph(before, oldWheel, veiledBefore, anchor);
    else scheduleBlur();

    labelWheel();
    state.roundJustFinished = false;
    save();
    afterChange();
    kick();
  }

  function startMorph(before, oldWheel, veiledBefore, anchorId) {
    var merged = mergeLineups(before, people);
    if (!merged) { scheduleBlur(); return; }
    var veiledAfter = excluded();
    var a = -1;
    merged.forEach(function (en, k) {
      en.v0 = en.i0 >= 0 && veiledBefore.indexOf(en.i0) >= 0 ? 1 : 0;
      en.v1 = en.i1 >= 0 && veiledAfter.indexOf(en.i1) >= 0 ? 1 : 0;
      if (en.id === anchorId) a = k;
    });
    var sp0 = ROA.Wheel.morphSpans(merged, 0)[a];
    var dOld = TAU / before.length;
    // The pointer's place, measured from the anchor wedge's centre in wedges.
    var f0 = wrapPi(-oldWheel.theta + dOld / 2 - sp0.mid) / sp0.span;
    var f1 = -state.wheel.theta / P.delta - state.wheel.J;
    state.morph = { merged: merged, a: a, f0: f0, f1: f1, start: performance.now(), dur: 560 };
    wheel.startMorph(merged);
    view.morph = 0;
    view.morphFade = 0;
    view.thetaEnd = state.wheel.theta;
    view.theta = morphTheta(state.morph, 0);
  }

  var storeTimer = 0;
  function scheduleStore() {
    clearTimeout(storeTimer);
    storeTimer = setTimeout(storeList, 250);
  }

  function afterChange() {
    var was = edited;
    edited = !sameAsDefaults(people);
    // A fresh set of edits starts from people.js as it is now.
    if (!edited || !was) listBase = baseline;
    scheduleStore();
    updateHint();
    renderRoster();
    renderEditorMeta();
  }

  // Name and message edits change no wedges, so names redraw in place, a
  // moment after typing pauses.
  var faceTimer = 0;
  var facePending = false;
  function flushFace() {
    if (!facePending) return;
    facePending = false;
    clearTimeout(faceTimer);
    settleNow();
    finishMorph();
    wheel.setPeople(people, { quick: true });
    scheduleBlur();
  }

  function updatePerson(id, changes) {
    var i = indexOfId(id);
    if (i < 0) return;
    var p = people[i];
    dropUndo();
    if (changes.message != null) p.message = changes.message;
    if (changes.name != null && changes.name && changes.name !== p.name) {
      p.name = changes.name;
      facePending = true;
      clearTimeout(faceTimer);
      faceTimer = setTimeout(function () {
        flushFace();
        render();
      }, 160);
      labelWheel();
    }
    afterChange();
  }

  // ---------- the Edit tab ----------
  var tabLineup = $('tab-lineup');
  var tabEdit = $('tab-edit');
  var panelLineup = $('panel-lineup');
  var panelEdit = $('panel-edit');
  var editor = $('editor');
  var cast = $('cast');
  var addForm = $('add-form');
  var addName = $('add-name');
  var addBtn = $('add-btn');
  var addHint = $('add-hint');
  var lockNote = $('lock-note');
  var restoreBtn = $('restore-btn');
  var restoreUndo = $('restore-undo');
  var staleNote = $('stale-note');
  var lineupNote = $('lineup-note');
  var openId = null;
  var undo = null; // { people, base, label, at: index in the list, or -1 for the foot }
  var rowSeq = 0;
  var locked = false;

  function selectTab(which, focus) {
    var edit = which === 'edit';
    tabLineup.setAttribute('aria-selected', String(!edit));
    tabEdit.setAttribute('aria-selected', String(edit));
    tabLineup.tabIndex = edit ? -1 : 0;
    tabEdit.tabIndex = edit ? 0 : -1;
    panelLineup.hidden = edit;
    panelEdit.hidden = !edit;
    if (edit) renderCast();
    else renderRoster();
    if (focus) (edit ? tabEdit : tabLineup).focus();
  }
  tabLineup.addEventListener('click', function () { selectTab('lineup'); });
  tabEdit.addEventListener('click', function () { selectTab('edit'); });
  [tabLineup, tabEdit].forEach(function (tab) {
    tab.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        var toEdit = e.key === 'End' || (e.key !== 'Home' && tab === tabLineup);
        selectTab(toEdit ? 'edit' : 'lineup', true);
      }
    });
  });

  function chevron() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'chev');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M6 9.5l6 6 6-6');
    svg.appendChild(path);
    return svg;
  }

  function undoRow() {
    var li = document.createElement('li');
    li.className = 'cast-undo';
    var p = document.createElement('p');
    p.textContent = undo.label;
    var b = document.createElement('button');
    b.className = 'btn btn-quiet';
    b.type = 'button';
    b.textContent = 'Undo';
    b.addEventListener('click', undoLast);
    li.appendChild(p);
    li.appendChild(b);
    return li;
  }

  function buildRow(p) {
    var seq = ++rowSeq;
    var li = document.createElement('li');
    li.className = 'cast-row';
    li.dataset.id = p.id;

    var head = document.createElement('button');
    head.type = 'button';
    head.className = 'cast-head';
    head.id = 'cast-head-' + seq;
    head.setAttribute('aria-controls', 'cast-body-' + seq);
    var sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.setProperty('--c', p.colour);
    var who = document.createElement('span');
    who.className = 'who';
    who.textContent = p.name;
    head.appendChild(sw);
    head.appendChild(who);
    head.appendChild(chevron());

    var body = document.createElement('div');
    body.className = 'cast-body';
    body.id = 'cast-body-' + seq;
    body.setAttribute('role', 'group');
    body.setAttribute('aria-labelledby', head.id);

    var nameField = document.createElement('label');
    nameField.className = 'field';
    var nameLabel = document.createElement('span');
    nameLabel.className = 'field-label';
    nameLabel.textContent = 'Name';
    var nameInput = document.createElement('input');
    nameInput.className = 'field-input field-name';
    nameInput.type = 'text';
    nameInput.maxLength = 40;
    nameInput.autocomplete = 'off';
    nameInput.spellcheck = false;
    nameInput.setAttribute('autocapitalize', 'words');
    nameInput.setAttribute('enterkeyhint', 'next');
    nameInput.value = p.name;
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);

    var msgField = document.createElement('label');
    msgField.className = 'field';
    var msgLabel = document.createElement('span');
    msgLabel.className = 'field-label';
    msgLabel.textContent = 'Message';
    var msgInput = document.createElement('textarea');
    msgInput.className = 'field-input field-message';
    msgInput.rows = 4;
    msgInput.maxLength = 240;
    msgInput.value = p.message;
    msgInput.placeholder = messageFor({ name: p.name, message: '' });
    msgField.appendChild(msgLabel);
    msgField.appendChild(msgInput);

    var actions = document.createElement('div');
    actions.className = 'cast-actions';
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-quiet btn-remove';
    remove.textContent = 'Remove ' + p.name;
    var minNote = document.createElement('p');
    minNote.className = 'field-hint min-note';
    minNote.textContent = 'The wheel needs at least two names.';
    actions.appendChild(remove);
    actions.appendChild(minNote);

    body.appendChild(nameField);
    body.appendChild(msgField);
    body.appendChild(actions);
    li.appendChild(head);
    li.appendChild(body);

    head.addEventListener('click', function () {
      openId = openId === p.id ? null : p.id;
      syncOpen();
      if (openId === p.id && li.scrollIntoView) li.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    });
    nameInput.addEventListener('input', function () {
      var v = cleanName(nameInput.value);
      if (!v) return;
      who.textContent = v;
      remove.textContent = 'Remove ' + v;
      msgInput.placeholder = messageFor({ name: v, message: '' });
      updatePerson(p.id, { name: v });
    });
    nameInput.addEventListener('blur', function () {
      // An emptied name goes back to what it was.
      var q = people[indexOfId(p.id)];
      if (q && !cleanName(nameInput.value)) nameInput.value = q.name;
    });
    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        msgInput.focus();
      }
    });
    msgInput.addEventListener('input', function () {
      updatePerson(p.id, { message: msgInput.value.trim() });
    });
    remove.addEventListener('click', function () { removePerson(p.id); });
    return li;
  }

  function syncOpen() {
    Array.prototype.forEach.call(cast.querySelectorAll('.cast-row'), function (li) {
      var open = li.dataset.id === openId;
      li.classList.toggle('is-open', open);
      li.querySelector('.cast-head').setAttribute('aria-expanded', String(open));
      li.querySelector('.cast-body').hidden = !open;
    });
  }

  function renderCast() {
    cast.textContent = '';
    if (openId && indexOfId(openId) < 0) openId = null;
    people.forEach(function (p, i) {
      if (undo && undo.at === i) cast.appendChild(undoRow());
      cast.appendChild(buildRow(p));
    });
    if (undo && undo.at >= people.length) cast.appendChild(undoRow());
    syncOpen();
    renderEditorMeta();
  }

  // The parts of the Edit tab that depend on the list as a whole.
  function renderEditorMeta() {
    var full = N >= MAX_PEOPLE;
    addName.disabled = full;
    addBtn.disabled = full;
    addHint.hidden = !full;
    addHint.textContent = full ? 'That’s a full wheel. ' + MAX_PEOPLE + ' names is the most it can show clearly.' : '';
    var atMin = N <= MIN_PEOPLE;
    Array.prototype.forEach.call(cast.querySelectorAll('.btn-remove'), function (b) { b.disabled = atMin; });
    cast.classList.toggle('at-min', atMin);
    restoreBtn.hidden = !edited;
    restoreUndo.textContent = '';
    restoreUndo.hidden = true;
    if (undo && undo.at < 0) {
      restoreUndo.hidden = false;
      restoreUndo.appendChild(undoRow());
    }
    var stale = edited && listBase !== baseline;
    staleNote.hidden = !stale;
    lineupNote.textContent = '';
    function code() {
      var c = document.createElement('code');
      c.textContent = 'people.js';
      return c;
    }
    if (stale) {
      lineupNote.appendChild(document.createTextNode('Edited in this browser, and '));
      lineupNote.appendChild(code());
      lineupNote.appendChild(document.createTextNode(' has changed since. Restore it under Edit to see the latest list.'));
    } else if (edited) {
      lineupNote.appendChild(document.createTextNode('Edited in this browser. Everyone else still sees the list in '));
      lineupNote.appendChild(code());
      lineupNote.appendChild(document.createTextNode('.'));
    } else {
      lineupNote.appendChild(document.createTextNode('Sample names and messages. Swap in your own under Edit, or in '));
      lineupNote.appendChild(code());
      lineupNote.appendChild(document.createTextNode('.'));
    }
  }

  // Typing after a removal makes that removal stick: undo only ever goes
  // back one step, and never over newer edits.
  function dropUndo() {
    if (!undo) return;
    undo = null;
    var row = cast.querySelector('.cast-undo');
    if (row) row.parentNode.removeChild(row);
    restoreUndo.textContent = '';
    restoreUndo.hidden = true;
  }

  function addPerson(name) {
    name = cleanName(name).slice(0, 40);
    if (!name || N >= MAX_PEOPLE || locked) return false;
    undo = null;
    var next = people.map(clonePerson);
    next.push({ id: newId(), name: name, message: '', from: '', fixed: '', colour: '' });
    setLineup(next);
    renderCast();
    announcer.textContent = name + ' added to the wheel.';
    return true;
  }

  function removePerson(id) {
    var i = indexOfId(id);
    if (i < 0 || N <= MIN_PEOPLE || locked) return;
    var name = people[i].name;
    var snapshot = people.map(clonePerson);
    var next = snapshot.filter(function (p) { return p.id !== id; }).map(clonePerson);
    var base = listBase;
    setLineup(next);
    undo = { people: snapshot, base: base, label: name + ' removed.', at: i };
    if (openId === id) openId = null;
    renderCast();
    announcer.textContent = name + ' removed from the wheel.';
    var b = cast.querySelector('.cast-undo button');
    if (b) b.focus({ preventScroll: true });
  }

  function restoreDefaults() {
    if (!edited || locked) return;
    var snapshot = people.map(clonePerson);
    var base = listBase;
    setLineup(defaults.map(clonePerson));
    undo = { people: snapshot, base: base, label: 'Back to the list in people.js.', at: -1 };
    openId = null;
    renderCast();
    announcer.textContent = 'The wheel is back to the list in people.js.';
    var b = restoreUndo.querySelector('button');
    if (b) b.focus({ preventScroll: true });
  }

  function undoLast() {
    if (!undo || locked) return;
    var u = undo;
    undo = null;
    setLineup(u.people.map(clonePerson));
    listBase = edited ? u.base : baseline;
    renderCast();
    renderEditorMeta();
    scheduleStore();
    announcer.textContent = 'Undone.';
    var row = u.at >= 0 ? cast.querySelectorAll('.cast-row')[u.at] : null;
    var target = row ? row.querySelector('.cast-head') : addName;
    if (target) target.focus({ preventScroll: true });
  }

  addForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (addPerson(addName.value)) {
      addName.value = '';
      // Ready for the next name.
      if (!addName.disabled) addName.focus({ preventScroll: true });
      var rows = cast.querySelectorAll('.cast-row');
      var last = rows[rows.length - 1];
      if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' });
    }
  });
  restoreBtn.addEventListener('click', restoreDefaults);

  // Editing waits while the wheel is spinning or someone's being applauded.
  function syncLock() {
    var lock = state.phase === 'spinning' || state.phase === 'celebrating';
    if (lock === locked) return;
    locked = lock;
    editor.disabled = lock;
    restoreBtn.disabled = lock;
    lockNote.hidden = !lock;
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
    finishMorph();
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
      if (!panelEdit.hidden) renderCast();
      $('lineup-close').focus({ preventScroll: true });
    } else {
      if (undo) {
        undo = null;
        if (!panelEdit.hidden) renderCast();
      }
      storeList();
      if (drawer.contains(document.activeElement)) lineupBtn.focus({ preventScroll: true });
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

  // Edits are saved a moment after typing stops; make sure nothing is lost
  // if the page closes first.
  window.addEventListener('pagehide', function () {
    clearTimeout(storeTimer);
    storeList();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      clearTimeout(storeTimer);
      storeList();
    }
  });

  // ---------- start ----------
  buildAudience();
  setMuted(state.muted);
  updateHint();
  renderRoster();
  renderEditorMeta();

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
      finishMorph();
      wheel.build();
      render();
    }).catch(function () {});
  }

  // Handy for testing from the console: ROA.debug.spin(), ROA.debug.state.
  ROA.debug = {
    spin: spin,
    state: state,
    view: view,
    wheel: wheel,
    add: addPerson,
    remove: removePerson,
    restore: restoreDefaults,
    undo: undoLast,
    rename: function (id, name) { updatePerson(id, { name: name }); },
    get people() { return people; },
    get edited() { return edited; }
  };
})();
