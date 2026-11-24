/*
 * Round of Applause: confetti. Paper squares, discs and streamers fired from
 * two cannons, then left to drift: drag, sway and a tumbling flip that shows
 * the lighter and darker sides of each piece as it turns.
 */
(function (root) {
  'use strict';

  var ROA = (root.ROA = root.ROA || {});
  var TAU = Math.PI * 2;

  function Confetti(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.running = false;
    this.last = 0;
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    var self = this;
    this.tick = function (now) { self.frame(now); };
    this.resize();
  }

  Confetti.prototype.resize = function () {
    this.dpr = Math.min(root.devicePixelRatio || 1, 2);
    this.w = root.innerWidth;
    this.h = root.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  };

  function shadeHex(hex, t) {
    var v = parseInt(hex.slice(1), 16);
    var r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    var to = t > 0 ? 255 : 0;
    var k = Math.abs(t);
    return 'rgb(' + Math.round(r + (to - r) * k) + ',' + Math.round(g + (to - g) * k) + ',' + Math.round(b + (to - b) * k) + ')';
  }

  Confetti.prototype.add = function (x, y, angle, spread, speed, count, colours, scale) {
    for (var i = 0; i < count; i++) {
      var a = angle + (Math.random() - 0.5) * spread;
      var v = speed * (0.55 + Math.random() * 0.6);
      var kind = Math.random();
      var col = colours[(Math.random() * colours.length) | 0];
      var size = (7 + Math.random() * 7) * scale;
      this.parts.push({
        x: x,
        y: y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        rot: Math.random() * TAU,
        vrot: (Math.random() - 0.5) * 10,
        flip: Math.random() * TAU,
        vflip: 4 + Math.random() * 9,
        sway: Math.random() * TAU,
        swayRate: 1.5 + Math.random() * 2.5,
        kind: kind < 0.62 ? 'paper' : kind < 0.82 ? 'disc' : 'streamer',
        w: size,
        h: size * (kind < 0.62 ? 0.62 : 1),
        light: shadeHex(col, 0.28),
        dark: shadeHex(col, -0.25),
        colour: col,
        drag: 1.6 + Math.random() * 1.4,
        life: 0
      });
    }
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      root.requestAnimationFrame(this.tick);
    }
  };

  // Two cannons at the bottom corners, aimed up and in.
  Confetti.prototype.celebrate = function (colours, gentle) {
    var w = this.w;
    var h = this.h;
    var area = Math.min(1.6, (w * h) / (1280 * 800));
    var scale = Math.max(0.75, Math.min(1.2, Math.sqrt(w * h) / 1000));
    if (gentle) {
      for (var i = 0; i < 70 * area; i++) {
        this.add(Math.random() * w, -20 - Math.random() * h * 0.3, Math.PI / 2, 0.4, 60, 1, colours, scale);
      }
      return;
    }
    var n = Math.round(150 * Math.max(0.5, area));
    var speed = Math.max(900, h * 1.55);
    this.add(-10, h + 10, -Math.PI / 2 + 0.42, 0.55, speed, n, colours, scale);
    this.add(w + 10, h + 10, -Math.PI / 2 - 0.42, 0.55, speed, n, colours, scale);
    var self = this;
    setTimeout(function () {
      self.add(w * 0.5, h + 10, -Math.PI / 2, 0.9, speed * 1.05, Math.round(n * 0.6), colours, scale);
    }, 260);
  };

  Confetti.prototype.frame = function (now) {
    var dt = Math.min(0.033, (now - this.last) / 1000);
    this.last = now;
    var x = this.ctx;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    x.clearRect(0, 0, this.w, this.h);
    var g = 1350;
    var alive = [];
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      p.life += dt;
      p.vy += g * dt;
      var drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      // Paper reaches a gentle terminal velocity and sways as it falls.
      if (p.vy > 170) p.vy += (170 - p.vy) * Math.min(1, dt * 4);
      p.sway += p.swayRate * dt;
      p.x += (p.vx + Math.sin(p.sway) * 55) * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      p.flip += p.vflip * dt;
      if (p.y < this.h + 40 && p.x > -60 && p.x < this.w + 60 && p.life < 9) alive.push(p);
      else continue;

      var f = Math.cos(p.flip);
      x.save();
      x.translate(p.x, p.y);
      x.rotate(p.rot);
      x.fillStyle = f > 0 ? p.light : p.dark;
      if (p.kind === 'paper') {
        x.scale(1, Math.max(0.08, Math.abs(f)));
        x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      } else if (p.kind === 'disc') {
        x.scale(Math.max(0.1, Math.abs(f)), 1);
        x.beginPath();
        x.arc(0, 0, p.w * 0.38, 0, TAU);
        x.fill();
      } else {
        x.strokeStyle = f > 0 ? p.light : p.dark;
        x.lineWidth = p.w * 0.28;
        x.lineCap = 'round';
        x.beginPath();
        x.moveTo(-p.w, 0);
        x.bezierCurveTo(-p.w * 0.4, -p.w * 0.6 * f, p.w * 0.4, p.w * 0.6 * f, p.w, 0);
        x.stroke();
      }
      x.restore();
    }
    this.parts = alive;
    if (alive.length) root.requestAnimationFrame(this.tick);
    else {
      this.running = false;
      x.clearRect(0, 0, this.w, this.h);
    }
  };

  ROA.Confetti = Confetti;
})(typeof self !== 'undefined' ? self : this);
