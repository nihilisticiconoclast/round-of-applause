/*
 * Round of Applause: the wheel renderer.
 *
 * Everything that doesn't move (frame, bulb sockets, lighting, hub, flapper)
 * is painted once into offscreen canvases. Each frame only composites them,
 * rotating the face and crossfading into pre-blurred copies of it as the
 * wheel speeds up, so a fast wheel smears like it would on camera instead of
 * strobing. Highlights stay put while the face turns underneath them.
 */
(function (root) {
  'use strict';

  var ROA = (root.ROA = root.ROA || {});
  var TAU = Math.PI * 2;
  var BULBS = 32;

  // ---------- colour helpers ----------
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function rgba(rgb, a) {
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  }
  function mix(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }
  function luminance(rgb) {
    var c = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  var WHITE = [255, 250, 240];
  var INK = [16, 20, 82];
  // Light text unless dark ink reads clearly better.
  function inkFor(hex) {
    var rgb = hexToRgb(hex);
    return contrast(rgb, INK) > contrast(rgb, WHITE) * 1.25 ? INK : WHITE;
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // A brushed-brass ring: a conic sweep of light and dark around the circle.
  function brass(ctx, cx, cy, rgbLight) {
    var g;
    if (ctx.createConicGradient) {
      g = ctx.createConicGradient(-Math.PI / 3, cx, cy);
      g.addColorStop(0, '#fff0c2');
      g.addColorStop(0.12, '#e9b44c');
      g.addColorStop(0.27, '#8a5a17');
      g.addColorStop(0.42, '#f2c66a');
      g.addColorStop(0.55, '#fff3cf');
      g.addColorStop(0.7, '#b07a25');
      g.addColorStop(0.85, '#e9b44c');
      g.addColorStop(1, '#fff0c2');
    } else {
      g = ctx.createLinearGradient(cx - 100, cy - 100, cx + 100, cy + 100);
      g.addColorStop(0, '#fff0c2');
      g.addColorStop(0.5, '#e9b44c');
      g.addColorStop(1, '#8a5a17');
    }
    return g;
  }

  function ring(ctx, cx, cy, r0, r1) {
    ctx.beginPath();
    ctx.arc(cx, cy, r1, 0, TAU);
    ctx.arc(cx, cy, r0, 0, TAU, true);
    ctx.closePath();
  }

  function star(ctx, cx, cy, rOut, rIn, points) {
    ctx.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var r = i % 2 === 0 ? rOut : rIn;
      var a = -Math.PI / 2 + (i * Math.PI) / points;
      var x = cx + Math.cos(a) * r;
      var y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // ---------- the renderer ----------
  function Wheel(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.people = [];
    this.n = 0;
    this.cssSize = 0;
    this.dpr = 1;
    this.g = null;
    this.L = {};
    this.glowCache = {};
  }

  Wheel.prototype.setPeople = function (people) {
    this.people = people;
    this.n = people.length;
    if (this.cssSize) this.build();
  };

  Wheel.prototype.resize = function (cssSize, dpr) {
    // Cap the backing store so phones with dpr 3 don't paint 9x the pixels.
    var maxDevice = 1500;
    this.dpr = Math.min(dpr || 1, maxDevice / Math.max(cssSize, 1));
    this.cssSize = cssSize;
    var px = Math.round(cssSize * this.dpr);
    this.canvas.width = px;
    this.canvas.height = px;
    this.canvas.style.width = cssSize + 'px';
    this.canvas.style.height = cssSize + 'px';
    this.build();
  };

  Wheel.prototype.geometry = function () {
    var S = this.canvas.width;
    var g = {};
    g.S = S;
    g.cx = S / 2;
    g.cy = S * 0.508;
    g.Rout = S * 0.466;
    g.Rface = g.Rout * 0.855;
    g.Rbulb = g.Rface + (g.Rout - g.Rface) * 0.5;
    g.bulbR = (g.Rout - g.Rface) * 0.235;
    g.Rpeg = g.Rface * 0.952;
    g.pegR = Math.max(2, g.Rface * 0.021);
    g.Rhub = g.Rface * 0.165;
    // Flapper: pivots just above the frame, tip reaches past the pegs.
    g.pivotY = g.cy - g.Rout * 1.012;
    g.tipR = g.Rface * 0.905;
    g.flapLen = g.cy - g.tipR - g.pivotY;
    g.flapGain = g.Rpeg / g.flapLen; // tip travel along the rim -> flapper rotation
    return g;
  };

  Wheel.prototype.build = function () {
    if (!this.n || !this.canvas.width) return;
    this.g = this.geometry();
    this.L.frame = this.buildFrame();
    this.L.face = this.buildFace();
    this.L.blur1 = this.blurred(this.L.face, (5 * Math.PI) / 180);
    this.L.blur2 = this.blurred(this.L.face, (13 * Math.PI) / 180);
    this.L.blur3 = this.blurred(this.L.face, (30 * Math.PI) / 180);
    this.L.shade = this.buildShade();
    this.L.hub = this.buildHub();
    this.buildPointer();
    this.buildBulbs();
    this.glowCache = {};
  };

  // ---------- static layers ----------
  Wheel.prototype.buildFrame = function () {
    var g = this.g;
    var c = makeCanvas(g.S, g.S);
    var x = c.getContext('2d');

    // Contact shadow on the backdrop.
    x.save();
    x.shadowColor = 'rgba(3, 8, 48, 0.5)';
    x.shadowBlur = g.Rout * 0.035;
    x.shadowOffsetY = g.Rout * 0.015;
    x.fillStyle = '#060c3a';
    x.beginPath();
    x.arc(g.cx, g.cy, g.Rout * 0.99, 0, TAU);
    x.fill();
    x.restore();

    // Outer brass bezel.
    x.fillStyle = brass(x, g.cx, g.cy);
    ring(x, g.cx, g.cy, g.Rout * 0.962, g.Rout);
    x.fill();
    x.strokeStyle = 'rgba(70, 40, 5, 0.6)';
    x.lineWidth = Math.max(1, g.Rout * 0.004);
    x.beginPath();
    x.arc(g.cx, g.cy, g.Rout * 0.962, 0, TAU);
    x.stroke();

    // Lacquered rim, shaded like a rounded band lit from above.
    var rIn = g.Rface;
    var rOut = g.Rout * 0.962;
    var lac = x.createRadialGradient(g.cx, g.cy, rIn, g.cx, g.cy, rOut);
    lac.addColorStop(0, '#050a33');
    lac.addColorStop(0.35, '#16237a');
    lac.addColorStop(0.55, '#1b2b8c');
    lac.addColorStop(1, '#060b38');
    x.fillStyle = lac;
    ring(x, g.cx, g.cy, rIn, rOut);
    x.fill();
    var top = x.createLinearGradient(0, g.cy - g.Rout, 0, g.cy + g.Rout);
    top.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
    top.addColorStop(0.45, 'rgba(255, 255, 255, 0.02)');
    top.addColorStop(1, 'rgba(0, 0, 20, 0.35)');
    x.fillStyle = top;
    ring(x, g.cx, g.cy, rIn, rOut);
    x.fill();

    // Bulb sockets.
    for (var i = 0; i < BULBS; i++) {
      var a = -Math.PI / 2 + ((i + 0.5) * TAU) / BULBS;
      var bx = g.cx + Math.cos(a) * g.Rbulb;
      var by = g.cy + Math.sin(a) * g.Rbulb;
      var s = g.bulbR * 1.38;
      var sock = x.createRadialGradient(bx - s * 0.3, by - s * 0.4, s * 0.1, bx, by, s);
      sock.addColorStop(0, '#fff0c2');
      sock.addColorStop(0.5, '#c88f32');
      sock.addColorStop(1, '#5c3a0c');
      x.fillStyle = sock;
      x.beginPath();
      x.arc(bx, by, s, 0, TAU);
      x.fill();
      x.fillStyle = '#1a0f02';
      x.beginPath();
      x.arc(bx, by, g.bulbR * 1.08, 0, TAU);
      x.fill();
    }
    return c;
  };

  Wheel.prototype.buildFace = function () {
    var g = this.g;
    var R = g.Rface;
    var D = Math.ceil(R * 2) + 2;
    var c = makeCanvas(D, D);
    var x = c.getContext('2d');
    var n = this.n;
    var d = TAU / n;
    x.translate(D / 2, D / 2);

    // Wedges.
    for (var j = 0; j < n; j++) {
      var a0 = -Math.PI / 2 + (j - 0.5) * d;
      var a1 = a0 + d;
      var col = this.people[j].colour;
      var rgb = hexToRgb(col);
      x.beginPath();
      x.moveTo(0, 0);
      x.arc(0, 0, R + 1, a0, a1);
      x.closePath();
      x.fillStyle = col;
      x.fill();

      // A faint bevel: lit leading edge, shadowed trailing edge.
      x.save();
      x.clip();
      var mid = (a0 + a1) / 2;
      var lg = x.createLinearGradient(
        Math.cos(a0) * R * 0.5, Math.sin(a0) * R * 0.5,
        Math.cos(a1) * R * 0.5, Math.sin(a1) * R * 0.5
      );
      lg.addColorStop(0, 'rgba(255,255,255,0.10)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0)');
      lg.addColorStop(1, 'rgba(0,0,40,0.10)');
      x.fillStyle = lg;
      x.fillRect(-R, -R, R * 2, R * 2);

      // Printed halftone toward the rim, in a lighter tint of the wedge.
      var tint = rgba(mix(rgb, [255, 255, 255], 0.55), 0.35);
      x.fillStyle = tint;
      var step = R * 0.034;
      for (var r = R * 0.6; r < R * 0.985; r += step) {
        var k = (r - R * 0.6) / (R * 0.385);
        var dotR = step * 0.36 * Math.pow(k, 1.4);
        if (dotR < 0.35) continue;
        var arcLen = d * r;
        var count = Math.max(1, Math.floor(arcLen / step));
        var off = ((Math.round(r / step) % 2) * 0.5) / count;
        for (var q = 0; q < count; q++) {
          var aa = a0 + d * ((q + 0.5) / count + off);
          x.beginPath();
          x.arc(Math.cos(aa) * r, Math.sin(aa) * r, dotR, 0, TAU);
          x.fill();
        }
      }
      x.restore();
      void mid;
    }

    // Depth: darker toward the hub, a little brighter toward the rim.
    var depth = x.createRadialGradient(0, 0, R * 0.12, 0, 0, R);
    depth.addColorStop(0, 'rgba(6, 8, 50, 0.38)');
    depth.addColorStop(0.42, 'rgba(6, 8, 50, 0.06)');
    depth.addColorStop(0.75, 'rgba(255, 255, 255, 0)');
    depth.addColorStop(1, 'rgba(255, 255, 255, 0.08)');
    x.fillStyle = depth;
    x.beginPath();
    x.arc(0, 0, R + 1, 0, TAU);
    x.fill();

    // Brass dividers.
    for (j = 0; j < n; j++) {
      var a = -Math.PI / 2 + (j - 0.5) * d;
      var ca = Math.cos(a);
      var sa = Math.sin(a);
      x.lineCap = 'round';
      x.strokeStyle = 'rgba(30, 14, 0, 0.35)';
      x.lineWidth = Math.max(2, R * 0.012);
      x.beginPath();
      x.moveTo(ca * R * 0.16, sa * R * 0.16);
      x.lineTo(ca * R, sa * R);
      x.stroke();
      x.strokeStyle = '#f3c76c';
      x.lineWidth = Math.max(1.2, R * 0.0065);
      x.beginPath();
      x.moveTo(ca * R * 0.16, sa * R * 0.16);
      x.lineTo(ca * R, sa * R);
      x.stroke();
    }

    // Names, reading outward from the hub like a real wheel.
    this.drawNames(x, R, d);

    // Pegs on every boundary.
    for (j = 0; j < n; j++) {
      var pa = -Math.PI / 2 + (j - 0.5) * d;
      var px = Math.cos(pa) * g.Rpeg;
      var py = Math.sin(pa) * g.Rpeg;
      var pr = g.pegR;
      x.fillStyle = 'rgba(10, 6, 30, 0.45)';
      x.beginPath();
      x.arc(px + pr * 0.25, py + pr * 0.35, pr * 1.15, 0, TAU);
      x.fill();
      var pg = x.createRadialGradient(px - pr * 0.35, py - pr * 0.4, pr * 0.1, px, py, pr);
      pg.addColorStop(0, '#fff6d8');
      pg.addColorStop(0.45, '#e9b44c');
      pg.addColorStop(1, '#7a4c10');
      x.fillStyle = pg;
      x.beginPath();
      x.arc(px, py, pr, 0, TAU);
      x.fill();
    }
    return c;
  };

  Wheel.prototype.fontFor = function (size) {
    return '800 ' + size + 'px "Big Shoulders", "Arial Narrow", "Roboto Condensed", sans-serif';
  };

  Wheel.prototype.drawNames = function (x, R, d) {
    var n = this.n;
    var outer = R * 0.865;
    var inner = R * 0.27;
    var sizes = [];
    var j;
    // Fit each name, then pull them toward a common size so the wheel reads
    // as one set; only names that genuinely need it end up smaller.
    for (j = 0; j < n; j++) {
      var label = this.people[j].name.toUpperCase();
      var size = Math.min(R * (n <= 6 ? 0.19 : 0.15), 2 * outer * Math.sin(Math.min(d / 2, Math.PI / 2)) * 0.62);
      for (var it = 0; it < 24; it++) {
        x.font = this.fontFor(size);
        var w = x.measureText(label).width;
        var start = outer - w;
        var chord = 2 * Math.max(start, R * 0.05) * Math.sin(Math.min(d / 2, Math.PI / 2));
        var fitsLength = start >= inner;
        var fitsHeight = size * 0.78 <= chord * 0.8;
        if (fitsLength && fitsHeight) break;
        size *= 0.94;
      }
      sizes.push(size);
    }
    var common = sizes.slice().sort(function (a, b) { return a - b; })[Math.floor(n / 2)];
    for (j = 0; j < n; j++) {
      var s = Math.min(sizes[j], common * 1.0);
      var person = this.people[j];
      var ink = inkFor(person.colour);
      x.save();
      x.rotate(-Math.PI / 2 + j * d);
      x.font = this.fontFor(s);
      x.textAlign = 'right';
      x.textBaseline = 'middle';
      if ('letterSpacing' in x) x.letterSpacing = (s * 0.03).toFixed(1) + 'px';
      x.shadowColor = ink === INK ? 'rgba(255,255,255,0.35)' : 'rgba(10, 6, 50, 0.45)';
      x.shadowBlur = s * 0.08;
      x.fillStyle = rgba(ink, 1);
      x.fillText(person.name.toUpperCase(), outer, s * 0.04);
      x.restore();
    }
  };

  // Rotational motion blur by repeated rotate-and-average (32 taps).
  Wheel.prototype.blurred = function (src, span) {
    var D = src.width;
    var a = makeCanvas(D, D);
    a.getContext('2d').drawImage(src, 0, 0);
    var b = makeCanvas(D, D);
    var step = span / 2;
    for (var k = 0; k < 5; k++) {
      step /= 2;
      var bx = b.getContext('2d');
      bx.setTransform(1, 0, 0, 1, 0, 0);
      bx.globalAlpha = 1;
      bx.clearRect(0, 0, D, D);
      bx.translate(D / 2, D / 2);
      bx.rotate(-step);
      bx.drawImage(a, -D / 2, -D / 2);
      bx.rotate(2 * step);
      bx.globalAlpha = 0.5;
      bx.drawImage(a, -D / 2, -D / 2);
      var t = a;
      a = b;
      b = t;
    }
    return a;
  };

  Wheel.prototype.buildShade = function () {
    var g = this.g;
    var c = makeCanvas(g.S, g.S);
    var x = c.getContext('2d');
    var R = g.Rface;

    x.save();
    x.beginPath();
    x.arc(g.cx, g.cy, R, 0, TAU);
    x.clip();
    // Ambient occlusion where the face meets the rim.
    var ao = x.createRadialGradient(g.cx, g.cy, R * 0.86, g.cx, g.cy, R);
    ao.addColorStop(0, 'rgba(4, 8, 48, 0)');
    ao.addColorStop(1, 'rgba(4, 8, 48, 0.42)');
    x.fillStyle = ao;
    x.fillRect(0, 0, g.S, g.S);
    // Studio key light from the upper left, fixed while the face turns.
    var key = x.createRadialGradient(g.cx - R * 0.38, g.cy - R * 0.55, 0, g.cx - R * 0.38, g.cy - R * 0.55, R * 1.25);
    key.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
    key.addColorStop(0.45, 'rgba(255, 255, 255, 0.05)');
    key.addColorStop(1, 'rgba(255, 255, 255, 0)');
    x.fillStyle = key;
    x.fillRect(0, 0, g.S, g.S);
    var under = x.createLinearGradient(0, g.cy - R, 0, g.cy + R);
    under.addColorStop(0.55, 'rgba(4, 8, 48, 0)');
    under.addColorStop(1, 'rgba(4, 8, 48, 0.18)');
    x.fillStyle = under;
    x.fillRect(0, 0, g.S, g.S);
    x.restore();

    // Inner brass bezel, overlapping the face edge.
    x.fillStyle = brass(x, g.cx, g.cy);
    ring(x, g.cx, g.cy, R * 0.986, R * 1.024);
    x.fill();
    x.strokeStyle = 'rgba(70, 40, 5, 0.55)';
    x.lineWidth = Math.max(1, R * 0.004);
    x.beginPath();
    x.arc(g.cx, g.cy, R * 0.986, 0, TAU);
    x.stroke();
    return c;
  };

  Wheel.prototype.buildHub = function () {
    var g = this.g;
    var r = g.Rhub;
    var pad = r * 0.6;
    var D = Math.ceil((r + pad) * 2);
    var c = makeCanvas(D, D);
    var x = c.getContext('2d');
    var cx = D / 2;
    var cy = D / 2;

    x.save();
    x.shadowColor = 'rgba(4, 6, 40, 0.55)';
    x.shadowBlur = r * 0.35;
    x.shadowOffsetY = r * 0.14;
    x.fillStyle = '#5c3a0c';
    x.beginPath();
    x.arc(cx, cy, r, 0, TAU);
    x.fill();
    x.restore();

    x.fillStyle = brass(x, cx, cy);
    x.beginPath();
    x.arc(cx, cy, r, 0, TAU);
    x.fill();

    // Red enamel cap.
    var er = r * 0.76;
    var enamel = x.createRadialGradient(cx - er * 0.3, cy - er * 0.35, er * 0.1, cx, cy, er);
    enamel.addColorStop(0, '#ff6d80');
    enamel.addColorStop(0.45, '#e01a3c');
    enamel.addColorStop(1, '#7d0a1e');
    x.fillStyle = enamel;
    x.beginPath();
    x.arc(cx, cy, er, 0, TAU);
    x.fill();
    x.strokeStyle = 'rgba(60, 20, 0, 0.6)';
    x.lineWidth = Math.max(1, r * 0.04);
    x.stroke();

    // Brass star.
    x.save();
    x.shadowColor = 'rgba(60, 0, 10, 0.6)';
    x.shadowBlur = r * 0.08;
    x.shadowOffsetY = r * 0.04;
    var sg = x.createLinearGradient(cx - er * 0.5, cy - er * 0.5, cx + er * 0.5, cy + er * 0.5);
    sg.addColorStop(0, '#fff3cf');
    sg.addColorStop(0.5, '#e9b44c');
    sg.addColorStop(1, '#9a6519');
    x.fillStyle = sg;
    star(x, cx, cy + er * 0.03, er * 0.58, er * 0.25, 5);
    x.lineJoin = 'round';
    x.fill();
    x.restore();

    // Gloss.
    var gl = x.createRadialGradient(cx - r * 0.35, cy - r * 0.45, 0, cx - r * 0.35, cy - r * 0.45, r * 0.9);
    gl.addColorStop(0, 'rgba(255,255,255,0.55)');
    gl.addColorStop(0.35, 'rgba(255,255,255,0.10)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gl;
    x.beginPath();
    x.arc(cx, cy, r, 0, TAU);
    x.fill();
    return c;
  };

  Wheel.prototype.buildPointer = function () {
    var g = this.g;
    var L = g.flapLen;
    var w = g.Rout * 0.07;
    var m = g.Rout * 0.058;
    var W = Math.ceil(w * 2 + m * 2);
    var H = Math.ceil(L + m * 2.2);
    var ox = W / 2;
    var oy = m * 1.1;

    function blade(x) {
      x.beginPath();
      x.moveTo(ox - w * 0.62, oy);
      x.bezierCurveTo(ox - w * 0.95, oy + L * 0.35, ox - w * 0.55, oy + L * 0.7, ox - w * 0.08, oy + L * 0.985);
      x.quadraticCurveTo(ox, oy + L * 1.02, ox + w * 0.08, oy + L * 0.985);
      x.bezierCurveTo(ox + w * 0.55, oy + L * 0.7, ox + w * 0.95, oy + L * 0.35, ox + w * 0.62, oy);
      x.closePath();
    }

    // Shadow sprite.
    var s = makeCanvas(W + m * 2, H + m * 2);
    var sx = s.getContext('2d');
    sx.translate(m, m);
    sx.shadowColor = 'rgba(3, 6, 40, 0.65)';
    sx.shadowBlur = g.Rout * 0.025;
    sx.fillStyle = 'rgba(3, 6, 40, 0.65)';
    blade(sx);
    sx.fill();
    sx.beginPath();
    sx.arc(ox, oy, m, 0, TAU);
    sx.fill();

    var c = makeCanvas(W, H);
    var x = c.getContext('2d');
    // Brass blade.
    var bg = x.createLinearGradient(ox - w, 0, ox + w, 0);
    bg.addColorStop(0, '#7a4c10');
    bg.addColorStop(0.3, '#f6d184');
    bg.addColorStop(0.55, '#fff3cf');
    bg.addColorStop(0.8, '#c88f32');
    bg.addColorStop(1, '#6b4511');
    x.fillStyle = bg;
    blade(x);
    x.fill();
    x.strokeStyle = 'rgba(60, 30, 0, 0.7)';
    x.lineWidth = Math.max(1, g.Rout * 0.005);
    x.stroke();
    // Red enamel inlay.
    x.save();
    x.translate(ox, oy + L * 0.42);
    x.scale(0.5, 0.5);
    x.translate(-ox, -(oy + L * 0.42));
    var eg = x.createLinearGradient(ox - w, 0, ox + w, 0);
    eg.addColorStop(0, '#8e0b21');
    eg.addColorStop(0.45, '#ff4d66');
    eg.addColorStop(1, '#8e0b21');
    x.fillStyle = eg;
    blade(x);
    x.fill();
    x.restore();
    // Pivot boss and screw.
    var pb = x.createRadialGradient(ox - m * 0.35, oy - m * 0.4, m * 0.1, ox, oy, m);
    pb.addColorStop(0, '#fff6d8');
    pb.addColorStop(0.5, '#e0a840');
    pb.addColorStop(1, '#6b4511');
    x.fillStyle = pb;
    x.beginPath();
    x.arc(ox, oy, m, 0, TAU);
    x.fill();
    x.strokeStyle = 'rgba(60, 30, 0, 0.7)';
    x.stroke();
    x.strokeStyle = 'rgba(70, 40, 5, 0.85)';
    x.lineWidth = Math.max(1, m * 0.16);
    x.beginPath();
    x.moveTo(ox - m * 0.45, oy + m * 0.2);
    x.lineTo(ox + m * 0.45, oy - m * 0.2);
    x.stroke();

    this.L.pointer = c;
    this.L.pointerShadow = s;
    this.L.pointerOrigin = { x: ox, y: oy, pad: m };
  };

  Wheel.prototype.buildBulbs = function () {
    var r = Math.max(2, this.g.bulbR);
    var D = Math.ceil(r * 2.4);
    function bulb(stops) {
      var c = makeCanvas(D, D);
      var x = c.getContext('2d');
      var gr = x.createRadialGradient(D / 2 - r * 0.3, D / 2 - r * 0.35, r * 0.05, D / 2, D / 2, r);
      stops.forEach(function (s) { gr.addColorStop(s[0], s[1]); });
      x.fillStyle = gr;
      x.beginPath();
      x.arc(D / 2, D / 2, r, 0, TAU);
      x.fill();
      x.fillStyle = 'rgba(255,255,255,0.75)';
      x.beginPath();
      x.arc(D / 2 - r * 0.32, D / 2 - r * 0.36, r * 0.22, 0, TAU);
      x.fill();
      return c;
    }
    this.L.bulbOff = bulb([[0, '#c9a06a'], [0.55, '#6e4a1e'], [1, '#2e1c08']]);
    this.L.bulbOn = bulb([[0, '#ffffff'], [0.45, '#fff2c8'], [1, '#ffbf4d']]);
  };

  Wheel.prototype.glow = function (hex) {
    var key = hex || 'warm';
    if (this.glowCache[key]) return this.glowCache[key];
    var r = Math.max(2, this.g.bulbR) * 3.8;
    var D = Math.ceil(r * 2);
    var c = makeCanvas(D, D);
    var x = c.getContext('2d');
    var rgb = hex ? mix(hexToRgb(hex), [255, 240, 200], 0.35) : [255, 205, 110];
    var gr = x.createRadialGradient(D / 2, D / 2, 0, D / 2, D / 2, r);
    gr.addColorStop(0, rgba(rgb, 0.85));
    gr.addColorStop(0.25, rgba(rgb, 0.35));
    gr.addColorStop(1, rgba(rgb, 0));
    x.fillStyle = gr;
    x.fillRect(0, 0, D, D);
    this.glowCache[key] = c;
    return c;
  };

  // ---------- per frame ----------
  /*
   * s: { theta, omega, phi, time, chase, bulbs: 'idle'|'chase'|'win', winT,
   *      highlight: index|-1, highlightT, tint, veiled: [indices], veil }
   */
  Wheel.prototype.draw = function (s) {
    var g = this.g;
    if (!g) return;
    var x = this.ctx;
    var L = this.L;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, g.S, g.S);
    x.drawImage(L.frame, 0, 0);

    // Face, blurred by how far it turns in one frame (about 1/60 s exposure).
    var perFrame = (Math.abs(s.omega || 0) / 60) * (180 / Math.PI);
    var R = g.Rface;
    var D = L.face.width;
    x.save();
    x.translate(g.cx, g.cy);
    x.rotate(s.theta);
    var layers = [
      [0, L.face],
      [3.5, L.blur1],
      [9, L.blur2],
      [22, L.blur3]
    ];
    var lo = layers[0];
    var hi = null;
    for (var i = 1; i < layers.length; i++) {
      if (perFrame >= layers[i][0]) lo = layers[i];
      else { hi = layers[i]; break; }
    }
    x.drawImage(lo[1], -D / 2, -D / 2);
    if (hi) {
      var t = (perFrame - lo[0]) / (hi[0] - lo[0]);
      if (t > 0.02) {
        x.globalAlpha = Math.min(1, t);
        x.drawImage(hi[1], -D / 2, -D / 2);
        x.globalAlpha = 1;
      }
    }

    var d = TAU / this.n;
    // Wedges sitting out the next spin are veiled.
    if (s.veiled && s.veiled.length && s.veil > 0) {
      x.fillStyle = 'rgba(8, 12, 60, ' + 0.5 * s.veil + ')';
      for (i = 0; i < s.veiled.length; i++) {
        var va = -Math.PI / 2 + (s.veiled[i] - 0.5) * d;
        x.beginPath();
        x.moveTo(0, 0);
        x.arc(0, 0, R, va, va + d);
        x.closePath();
        x.fill();
      }
    }
    // Winner: everything else dims, their wedge glows.
    if (s.highlight >= 0 && s.highlightT > 0) {
      var k = Math.min(1, s.highlightT);
      var ha = -Math.PI / 2 + (s.highlight - 0.5) * d;
      x.beginPath();
      x.arc(0, 0, R, 0, TAU);
      x.moveTo(0, 0);
      x.arc(0, 0, R, ha + d, ha, true);
      x.closePath();
      x.fillStyle = 'rgba(6, 10, 50, ' + 0.5 * k + ')';
      x.fill('evenodd');
      var pulse = 0.5 + 0.5 * Math.sin((s.time || 0) * 5);
      x.beginPath();
      x.moveTo(0, 0);
      x.arc(0, 0, R * 0.985, ha, ha + d);
      x.closePath();
      x.globalCompositeOperation = 'lighter';
      x.fillStyle = 'rgba(255, 245, 220, ' + (0.08 + 0.1 * pulse) * k + ')';
      x.fill();
      x.globalCompositeOperation = 'source-over';
      x.lineJoin = 'round';
      x.lineWidth = Math.max(2, R * 0.016);
      x.strokeStyle = 'rgba(255, 236, 180, ' + 0.9 * k + ')';
      x.shadowColor = 'rgba(255, 220, 140, ' + 0.9 * k + ')';
      x.shadowBlur = R * 0.05;
      x.stroke();
      x.shadowBlur = 0;
    }
    x.restore();

    x.drawImage(L.shade, 0, 0);
    this.drawBulbs(s);
    var hub = L.hub;
    x.drawImage(hub, g.cx - hub.width / 2, g.cy - hub.height / 2);

    // Flapper: rotates about its pivot as pegs push its tip along the rim.
    var o = L.pointerOrigin;
    var angle = -(s.phi || 0) * g.flapGain;
    x.save();
    x.translate(g.cx + g.Rout * 0.012, g.pivotY + g.Rout * 0.022);
    x.rotate(angle);
    x.drawImage(L.pointerShadow, -o.x - o.pad, -o.y - o.pad);
    x.restore();
    x.save();
    x.translate(g.cx, g.pivotY);
    x.rotate(angle);
    x.drawImage(L.pointer, -o.x, -o.y);
    x.restore();
  };

  Wheel.prototype.bulbLevel = function (i, s) {
    var a = (i + 0.5) / BULBS;
    var time = s.time || 0;
    var idle = 0.78 + 0.08 * Math.sin(i * 2.1 + time * 0.9);
    if (s.bulbs === 'win') {
      var t = s.winT || 0;
      if (t < 1.4) return Math.floor(t * 12) % 2 ? 1 : 0.12;
      return (i + Math.floor(t * 5)) % 2 ? 1 : 0.3;
    }
    if (s.bulbs === 'chase') {
      var m = Math.min(1, Math.abs(s.omega || 0) / 4);
      var c = Math.cos(TAU * 4 * a - (s.chase || 0));
      var chase = 0.36 + 0.64 * Math.pow(Math.max(0, c), 4);
      return idle * (1 - m) + chase * m;
    }
    return idle;
  };

  Wheel.prototype.drawBulbs = function (s) {
    var g = this.g;
    var x = this.ctx;
    var off = this.L.bulbOff;
    var on = this.L.bulbOn;
    var glow = this.glow(s.bulbs === 'win' ? s.tint : null);
    var D = off.width;
    var G = glow.width;
    var levels = [];
    var i;
    for (i = 0; i < BULBS; i++) levels.push(this.bulbLevel(i, s));
    for (i = 0; i < BULBS; i++) {
      var a = -Math.PI / 2 + ((i + 0.5) * TAU) / BULBS;
      var bx = g.cx + Math.cos(a) * g.Rbulb;
      var by = g.cy + Math.sin(a) * g.Rbulb;
      x.drawImage(off, bx - D / 2, by - D / 2);
      x.globalAlpha = levels[i];
      x.drawImage(on, bx - D / 2, by - D / 2);
      x.globalAlpha = 1;
    }
    x.globalCompositeOperation = 'lighter';
    for (i = 0; i < BULBS; i++) {
      var b = -Math.PI / 2 + ((i + 0.5) * TAU) / BULBS;
      x.globalAlpha = levels[i] * levels[i] * 0.9;
      x.drawImage(glow, g.cx + Math.cos(b) * g.Rbulb - G / 2, g.cy + Math.sin(b) * g.Rbulb - G / 2);
    }
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
  };

  // Where on the page the wheel centre and radius are (CSS px).
  Wheel.prototype.metrics = function () {
    var g = this.g;
    if (!g) return null;
    var k = 1 / this.dpr;
    return { cx: g.cx * k, cy: g.cy * k, rFace: g.Rface * k, rOut: g.Rout * k };
  };

  Wheel.inkFor = function (hex) {
    var ink = inkFor(hex);
    return ink === INK ? '#101452' : '#fffaf0';
  };
  Wheel.shade = function (hex, t) {
    var rgb = mix(hexToRgb(hex), [8, 10, 60], t);
    return 'rgb(' + rgb.join(',') + ')';
  };

  ROA.Wheel = Wheel;
})(typeof self !== 'undefined' ? self : this);
