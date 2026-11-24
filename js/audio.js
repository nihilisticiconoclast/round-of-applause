/*
 * Round of Applause: sound, all synthesised in the browser (no audio files).
 * Peg clicks, the whirr of the bearing, a bell flourish when the wheel lands
 * and a studio audience that actually claps: forty-odd clappers, each with
 * their own pace, hands and seat, mixed through a small room reverb.
 */
(function (root) {
  'use strict';

  var ROA = (root.ROA = root.ROA || {});

  var ctx = null;
  var master = null;
  var verbIn = null;
  var clicks = [];
  var applauseBuf = null;
  var noiseBuf = null;
  var whirr = null;
  var muted = false;
  var lastClick = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }

  // RBJ biquad, applied offline to a Float32Array in place.
  function biquad(data, sr, type, freq, q) {
    var w0 = (2 * Math.PI * freq) / sr;
    var cos = Math.cos(w0);
    var alpha = Math.sin(w0) / (2 * q);
    var b0, b1, b2, a0, a1, a2;
    if (type === 'bandpass') {
      b0 = alpha; b1 = 0; b2 = -alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    } else {
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    }
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (var i = 0; i < data.length; i++) {
      var x0 = data[i];
      var y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
      data[i] = y0;
    }
    return data;
  }

  function makeClick(sr, pitch) {
    var len = Math.floor(sr * 0.045);
    var buf = ctx.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    var noise = new Float32Array(len);
    for (var i = 0; i < len; i++) noise[i] = Math.random() * 2 - 1;
    biquad(noise, sr, 'bandpass', 3800 * pitch, 1.1);
    for (i = 0; i < len; i++) {
      var t = i / sr;
      var snap = noise[i] * Math.exp(-t / 0.0022) * 2.2;
      var body = Math.sin(2 * Math.PI * 1650 * pitch * t) * Math.exp(-t / 0.007) * 0.55;
      var knock = Math.sin(2 * Math.PI * 240 * pitch * t) * Math.exp(-t / 0.012) * 0.35;
      d[i] = (snap + body + knock) * Math.min(1, t / 0.0004);
    }
    return buf;
  }

  // A crowd: each clapper keeps their own tempo and timbre, joining and
  // dropping out at slightly different moments so it swells and thins.
  function makeApplause(sr, seconds) {
    var len = Math.floor(sr * seconds);
    var buf = ctx.createBuffer(2, len, sr);
    var L = buf.getChannelData(0);
    var R = buf.getChannelData(1);
    var templates = [];
    var tl = Math.floor(sr * 0.03);
    for (var k = 0; k < 8; k++) {
      var tpl = new Float32Array(tl);
      for (var i = 0; i < tl; i++) tpl[i] = Math.random() * 2 - 1;
      biquad(tpl, sr, 'bandpass', rand(900, 2600), rand(0.7, 1.6));
      biquad(tpl, sr, 'highpass', 300, 0.7);
      var decay = rand(0.0035, 0.0075);
      for (i = 0; i < tl; i++) tpl[i] *= Math.exp(-i / sr / decay) * Math.min(1, i / (sr * 0.0006));
      templates.push(tpl);
    }
    var people = 46;
    for (var p = 0; p < people; p++) {
      var rate = rand(3.4, 5.6);
      var start = rand(0, 0.55) + (p < 6 ? 0 : rand(0, 0.35));
      var end = seconds - rand(0.4, 2.2);
      var gain = rand(0.25, 1) * (p < 10 ? 1.1 : 0.8);
      var pan = rand(-0.9, 0.9);
      var gl = Math.cos(((pan + 1) * Math.PI) / 4);
      var gr = Math.sin(((pan + 1) * Math.PI) / 4);
      var tplA = templates[p % templates.length];
      var tplB = templates[(p + 3) % templates.length];
      for (var t = start; t < end; t += (1 / rate) * rand(0.88, 1.12)) {
        // Fade each clapper in and out.
        var env = Math.min(1, (t - start) / 0.3) * Math.min(1, (end - t) / 0.7);
        var amp = gain * env * rand(0.7, 1);
        var tpl2 = Math.random() < 0.7 ? tplA : tplB;
        var at = Math.floor(t * sr);
        for (i = 0; i < tl && at + i < len; i++) {
          var v = tpl2[i] * amp;
          L[at + i] += v * gl;
          R[at + i] += v * gr;
        }
      }
    }
    // Normalise.
    var peak = 0;
    for (i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    var norm = peak > 0 ? 0.9 / peak : 1;
    for (i = 0; i < len; i++) { L[i] *= norm; R[i] *= norm; }
    return buf;
  }

  function makeReverb(sr) {
    var len = Math.floor(sr * 1.4);
    var buf = ctx.createBuffer(2, len, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        var t = i / sr;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t / 0.32) * (t < 0.008 ? t / 0.008 : 1);
      }
    }
    return buf;
  }

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
    } catch (e) {
      return false;
    }
    var sr = ctx.sampleRate;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);

    var verb = ctx.createConvolver();
    verb.buffer = makeReverb(sr);
    verbIn = ctx.createGain();
    verbIn.gain.value = 0.22;
    verbIn.connect(verb);
    verb.connect(master);

    clicks = [makeClick(sr, 1), makeClick(sr, 0.93), makeClick(sr, 1.08)];
    noiseBuf = ctx.createBuffer(1, sr * 2, sr);
    var nd = noiseBuf.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // Build the crowd after the first frame so the click that started us is instant.
    setTimeout(function () { applauseBuf = makeApplause(sr, 5.2); }, 30);
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function out(node, wet) {
    node.connect(master);
    if (wet) {
      var send = ctx.createGain();
      send.gain.value = wet;
      node.connect(send);
      send.connect(verbIn);
    }
  }

  // Peg click. `when` is seconds from now; intensity 0..1.
  function click(when, intensity) {
    if (!ctx || muted) return;
    var at = ctx.currentTime + Math.max(0, when || 0);
    // Above ~40 clicks a second it's a buzz; thin it out.
    if (at - lastClick < 0.022) return;
    lastClick = at;
    var src = ctx.createBufferSource();
    src.buffer = clicks[(Math.random() * clicks.length) | 0];
    src.playbackRate.value = rand(0.94, 1.06);
    var g = ctx.createGain();
    g.gain.value = 0.16 + 0.5 * Math.min(1, intensity);
    src.connect(g);
    out(g, 0.08);
    src.start(at);
  }

  function whoosh() {
    if (!ctx || muted) return;
    var t = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(260, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.32);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    src.connect(f);
    f.connect(g);
    out(g, 0.15);
    src.start(t);
    src.stop(t + 0.6);
    // The button's thunk.
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    var og = ctx.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(og);
    out(og, 0);
    o.start(t);
    o.stop(t + 0.2);
  }

  // Bearing and air noise, following the wheel's speed (rad/s).
  function spinNoise(omega) {
    if (!ctx) return;
    if (!whirr) {
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 300;
      var g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f);
      f.connect(g);
      out(g, 0);
      src.start();
      whirr = { src: src, f: f, g: g };
    }
    var w = Math.abs(omega) || 0;
    if (!isFinite(w)) w = 0;
    var t = ctx.currentTime;
    whirr.g.gain.setTargetAtTime(muted ? 0 : Math.min(0.11, w * 0.0065), t, 0.05);
    whirr.f.frequency.setTargetAtTime(180 + w * 55, t, 0.05);
  }

  function bell(freq, at, dur, gain) {
    var o1 = ctx.createOscillator();
    var o2 = ctx.createOscillator();
    var o3 = ctx.createOscillator();
    o1.frequency.value = freq;
    o2.frequency.value = freq * 2.756;
    o3.frequency.value = freq * 5.404;
    o1.type = o2.type = o3.type = 'sine';
    var g = ctx.createGain();
    var g2 = ctx.createGain();
    var g3 = ctx.createGain();
    g2.gain.value = 0.3;
    g3.gain.value = 0.12;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o1.connect(g);
    o2.connect(g2);
    g2.connect(g);
    o3.connect(g3);
    g3.connect(g);
    out(g, 0.35);
    [o1, o2, o3].forEach(function (o) { o.start(at); o.stop(at + dur + 0.05); });
  }

  // A bright four-note flourish, then the crowd.
  function fanfare() {
    if (!ctx || muted) return;
    var t = ctx.currentTime + 0.02;
    var notes = [783.99, 987.77, 1174.66, 1567.98];
    notes.forEach(function (f, i) { bell(f, t + i * 0.085, 1.4 - i * 0.1, 0.2); });
    bell(2349.32, t + 0.36, 1.8, 0.11);
    bell(1567.98, t + 0.36, 1.8, 0.1);
  }

  function applause() {
    if (!ctx || muted) return;
    if (!applauseBuf) applauseBuf = makeApplause(ctx.sampleRate, 5.2);
    var t = ctx.currentTime + 0.05;
    var src = ctx.createBufferSource();
    src.buffer = applauseBuf;
    src.playbackRate.value = rand(0.97, 1.03);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.75, t + 0.35);
    g.gain.setValueAtTime(0.75, t + 3.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5.1);
    src.connect(g);
    out(g, 0.3);
    src.start(t);
  }

  function setMuted(m) {
    muted = !!m;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.03);
  }

  ROA.Audio = {
    init: init,
    click: click,
    whoosh: whoosh,
    spinNoise: spinNoise,
    fanfare: fanfare,
    applause: applause,
    setMuted: setMuted,
    isMuted: function () { return muted; },
    ready: function () { return !!ctx; }
  };
})(typeof self !== 'undefined' ? self : this);
