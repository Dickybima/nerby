/* Nerby — scroll-driven story + particle scene (no dependencies) */
(function () {
  'use strict';

  var CHAPTERS = 6;
  var chs = [].slice.call(document.querySelectorAll('.ch'));
  var railBtns = [].slice.call(document.querySelectorAll('.rail button'));
  var story = document.getElementById('story');
  var rail = document.getElementById('rail');
  var cue = document.getElementById('cue');
  var bar = document.getElementById('bar');
  var rnum = document.getElementById('rnum');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.getElementById('yr').textContent = new Date().getFullYear();

  /* ---------- scroll → chapter position t in [0, 5] ---------- */
  var t = 0;
  function seg() { return (story.offsetHeight - window.innerHeight) / (CHAPTERS - 1); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, v) { v = clamp((v - a) / (b - a), 0, 1); return v * v * (3 - 2 * v); }

  function onScroll() {
    t = clamp(window.scrollY / seg(), 0, CHAPTERS - 1);
    var cur = Math.round(t);
    chs.forEach(function (el, i) {
      var o = clamp(1 - Math.abs(t - i) * 2.6, 0, 1);
      el.style.opacity = o;
      el.classList.toggle('on', o > 0);
      el.classList.toggle('cur', i === cur && o > 0.5);
    });
    railBtns.forEach(function (b, i) { b.classList.toggle('on', i === cur); });
    rnum.textContent = '0' + cur;
    bar.style.transform = 'scaleY(' + t / (CHAPTERS - 1) + ')';
    cue.classList.toggle('off', t > 0.15);
    // hide the rail once the footer starts covering the story
    var past = window.scrollY > story.offsetHeight - window.innerHeight * 0.9;
    rail.classList.toggle('off', past);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);

  document.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go) {
      e.preventDefault();
      window.scrollTo({ top: Math.round(+go.getAttribute('data-go') * seg()), behavior: reduce ? 'auto' : 'smooth' });
      return;
    }
    var ep = e.target.closest('.ep');
    if (ep && e.target.closest('.ep-b')) {
      var label = ep.querySelector('i');
      var done = function () {
        label.textContent = 'Copied';
        setTimeout(function () { label.textContent = 'Copy'; }, 1600);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(ep.getAttribute('data-copy')).then(done, function () {});
    }
  });

  /* ---------- particle scene ---------- */
  var cv = document.getElementById('scene');
  var ctx = cv.getContext('2d');
  var W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // deterministic random so the layout is identical on every load
  var sd = 7;
  function rnd() { sd = (sd * 16807) % 2147483647; return sd / 2147483647; }

  var N = W < 700 ? 1100 : 1900;
  var R = new Float32Array(N * 3);
  for (var i = 0; i < N * 3; i++) R[i] = rnd();
  var TAU = Math.PI * 2;

  function sphere(o, a, b, r, cx, cy, cz) {
    var th = a * TAU, ph = Math.acos(2 * b - 1);
    o[0] = cx + r * Math.sin(ph) * Math.cos(th);
    o[1] = cy + r * Math.cos(ph);
    o[2] = cz + r * Math.sin(ph) * Math.sin(th);
  }
  var EDGES = [[-1,-1,-1,0],[-1,1,-1,0],[-1,-1,1,0],[-1,1,1,0],[-1,-1,-1,1],[1,-1,-1,1],[-1,-1,1,1],[1,-1,1,1],[-1,-1,-1,2],[1,-1,-1,2],[-1,1,-1,2],[1,1,-1,2]];
  function cube(o, k, u, s, cx, cy, cz) {
    var e = EDGES[k % 12];
    o[0] = e[0] * s; o[1] = e[1] * s; o[2] = e[2] * s;
    o[e[3]] = (u * 2 - 1) * s;
    o[0] += cx; o[1] += cy; o[2] += cz;
  }
  var OV = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  var OE = [[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,4],[2,5],[3,4],[3,5]];
  function octa(o, k, u, s, cx, cy, cz) {
    var e = OE[k % 12], a = OV[e[0]], b = OV[e[1]];
    o[0] = cx + (a[0] + (b[0] - a[0]) * u) * s;
    o[1] = cy + (a[1] + (b[1] - a[1]) * u) * s;
    o[2] = cz + (a[2] + (b[2] - a[2]) * u) * s;
  }

  // each shape maps particle i (fraction f, randoms a/b/c, time) → position
  var SHAPES = [
    // 00 — gateway: core, beam and four objects in a row
    function (o, i, f, a, b, c, tm) {
      if (f < 0.28) return sphere(o, a, b, 0.5 * (0.6 + 0.4 * c), 0, 0, 0);
      if (f < 0.46) { o[0] = (a * 2 - 1) * 4.4; o[1] = (b - 0.5) * 0.05; o[2] = (c - 0.5) * 0.05; return; }
      var g = i % 4, x = [-3.3, -1.8, 1.8, 3.3][g], y = Math.sin(tm * 0.6 + g * 1.7) * 0.12;
      if (g === 0) { var th = a * TAU; o[0] = x + Math.cos(th) * 0.5; o[1] = y + Math.sin(th) * 0.5; o[2] = (b - 0.5) * 0.16; }
      else if (g === 1) sphere(o, a, Math.round(b * 7) / 7, 0.48, x, y, 0);
      else if (g === 2) cube(o, (c * 12) | 0, a, 0.42, x, y, 0);
      else octa(o, (c * 12) | 0, a, 0.58, x, y, 0);
    },
    // 01 — read: spiral streams flowing into the core
    function (o, i, f, a, b, c, tm) {
      if (f < 0.2) return sphere(o, a, b, 0.42, 0, 0, 0);
      var arm = i % 7, u = (a + 1 - (tm * 0.06) % 1) % 1, r = 0.4 + u * 2.8;
      var th = arm * TAU / 7 + u * 2.6;
      o[0] = Math.cos(th) * r; o[1] = (b - 0.5) * 0.12 + Math.sin(u * 9 + arm) * 0.1; o[2] = Math.sin(th) * r;
    },
    // 02 — clients: six nodes on a ring, each wired to the core
    function (o, i, f, a, b, c, tm) {
      if (f < 0.16) return sphere(o, a, b, 0.4, 0, 0, 0);
      var k = i % 6, th = k * TAU / 6 + tm * 0.08, x = Math.cos(th) * 2.7, z = Math.sin(th) * 2.7;
      if (f < 0.4) { o[0] = x * a; o[1] = (b - 0.5) * 0.03; o[2] = z * a; return; }
      sphere(o, a, b, 0.34, x, 0, z);
    },
    // 03 — control: a cage around the core with two guard rings
    function (o, i, f, a, b, c, tm) {
      if (f < 0.22) return sphere(o, a, b, 0.45, 0, 0, 0);
      if (f < 0.68) return cube(o, (c * 12) | 0, a, 1.35, 0, 0, 0);
      var th = a * TAU + tm * 0.3, r = 2.2, tilt = i % 2 ? 0.5 : -0.5;
      o[0] = Math.cos(th) * r; o[1] = Math.sin(th) * r * Math.sin(tilt); o[2] = Math.sin(th) * r * Math.cos(tilt);
    },
    // 04 — build: stacked frames rising into a tower
    function (o, i, f, a, b, c, tm) {
      if (f < 0.14) { o[0] = (a - 0.5) * 2.6; o[1] = 1.5 - ((b + tm * 0.07) % 1) * 3.4; o[2] = (c - 0.5) * 2.6; return; }
      var L = i % 7, s = 1.05 - L * 0.07, y = 1.3 - L * 0.44, side = (c * 4) | 0, u = (a * 2 - 1) * s;
      o[1] = y + (b - 0.5) * 0.04;
      if (side === 0) { o[0] = u; o[2] = -s; } else if (side === 1) { o[0] = u; o[2] = s; }
      else if (side === 2) { o[0] = -s; o[2] = u; } else { o[0] = s; o[2] = u; }
    },
    // 05 — live: a globe of networks with an orbit
    function (o, i, f, a, b, c, tm) {
      if (f < 0.72) {
        if (i % 2) sphere(o, a, Math.round(b * 9) / 9, 1.7, 0, 0, 0);
        else sphere(o, Math.round(a * 14) / 14, b, 1.7, 0, 0, 0);
        return;
      }
      var th = a * TAU + tm * 0.2, r = 2.5 + (b - 0.5) * 0.12;
      o[0] = Math.cos(th) * r; o[1] = Math.sin(th) * 0.5; o[2] = Math.sin(th) * r;
    }
  ];

  var CLIENTS = ['Claude', 'ChatGPT', 'Cursor', 'VS Code', 'Zed', 'Your agent'];
  var tagBox = document.getElementById('tags');
  var tags = CLIENTS.map(function (n) {
    var d = document.createElement('div'); d.className = 'tg'; d.textContent = n; tagBox.appendChild(d); return d;
  });

  var mx = 0, my = 0, cmx = 0, cmy = 0;
  window.addEventListener('pointermove', function (e) {
    mx = e.clientX / W - 0.5; my = e.clientY / H - 0.5;
  }, { passive: true });

  var pa = [0, 0, 0], pb = [0, 0, 0], pr = [0, 0, 0];
  var cy = 1, sy = 0, cx = 1, sx = 0, ox = 0, oy = 0, unit = 1;
  function project(x, y, z) {
    var x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    var y1 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
    var k = 7 / (7 + z2);
    pr[0] = ox + x1 * unit * k; pr[1] = oy + y1 * unit * k; pr[2] = k;
  }

  function frame(now) {
    var tm = reduce ? 0 : now / 1000;
    cmx += (mx - cmx) * 0.05; cmy += (my - cmy) * 0.05;
    var mobile = W < 900;
    ox = W * (mobile ? 0.5 : 0.64); oy = H * (mobile ? 0.34 : 0.46);
    unit = Math.min(W * (mobile ? 0.2 : 0.085), H * 0.17);
    var yaw = t * 0.9 + tm * 0.07 + cmx * 0.35, pitch = 0.24 + cmy * 0.2;
    cy = Math.cos(yaw); sy = Math.sin(yaw); cx = Math.cos(pitch); sx = Math.sin(pitch);

    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    // floor grid
    ctx.fillStyle = '#a1f837';
    for (var gx = -7; gx <= 7; gx += 0.5) {
      for (var gz = -7; gz <= 7; gz += 0.5) {
        var d = Math.sqrt(gx * gx + gz * gz);
        if (d > 7) continue;
        project(gx, 1.75, gz);
        var wave = 0.5 + 0.5 * Math.sin(d * 1.6 - tm * 1.3);
        ctx.globalAlpha = (0.05 + 0.2 * wave * wave) * (1 - d / 7);
        var s = 1.6 * pr[2];
        ctx.fillRect(pr[0] - s / 2, pr[1] - s / 2, s, s);
      }
    }

    // core glow
    project(0, 0, 0);
    var gr = unit * (1.7 + 0.12 * Math.sin(tm * 1.4));
    var g = ctx.createRadialGradient(pr[0], pr[1], 0, pr[0], pr[1], gr);
    g.addColorStop(0, 'rgba(200,255,107,.5)');
    g.addColorStop(0.18, 'rgba(161,248,55,.16)');
    g.addColorStop(1, 'rgba(161,248,55,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = g;
    ctx.fillRect(pr[0] - gr, pr[1] - gr, gr * 2, gr * 2);

    // particles, morphing between the two nearest chapter shapes
    var i0 = Math.min(Math.floor(t), CHAPTERS - 2), e = smooth(0.2, 0.8, t - i0);
    var A = SHAPES[i0], B = SHAPES[i0 + 1];
    for (var i = 0; i < N; i++) {
      var a = R[i * 3], b = R[i * 3 + 1], c = R[i * 3 + 2], f = i / N;
      A(pa, i, f, a, b, c, tm);
      var x = pa[0], y = pa[1], z = pa[2];
      if (e > 0) {
        B(pb, i, f, a, b, c, tm);
        // particles swing outward a little mid-transition
        var sw = Math.sin(e * Math.PI) * (0.25 + c * 0.5);
        x += (pb[0] - x) * e + (a - 0.5) * sw; y += (pb[1] - y) * e + (b - 0.5) * sw; z += (pb[2] - z) * e;
      }
      project(x, y, z);
      var k = pr[2];
      ctx.fillStyle = i % 5 === 0 ? '#e4ffd6' : '#a1f837';
      ctx.globalAlpha = clamp(0.25 + (k - 0.6) * 1.1, 0.12, 0.95);
      var sz = (i % 9 === 0 ? 2.6 : 1.5) * k;
      ctx.fillRect(pr[0] - sz / 2, pr[1] - sz / 2, sz, sz);
    }

    // client labels follow the six nodes in chapter 02
    var tw = clamp(1 - Math.abs(t - 2) * 2.6, 0, 1);
    for (var j = 0; j < tags.length; j++) {
      if (tw <= 0) { tags[j].style.opacity = 0; continue; }
      var th = j * TAU / 6 + tm * 0.08;
      project(Math.cos(th) * 2.7, -0.45, Math.sin(th) * 2.7);
      tags[j].style.opacity = tw * clamp((pr[2] - 0.6) * 2, 0.35, 1);
      tags[j].style.transform = 'translate(' + (pr[0] + 10) + 'px,' + (pr[1] - 8) + 'px)';
    }

    requestAnimationFrame(frame);
  }

  onScroll();
  cv.classList.add('on');
  requestAnimationFrame(frame);
})();
