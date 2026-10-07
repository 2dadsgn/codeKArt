(function () {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  const FONT = (getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-family') || '').trim() || 'Consolas, monospace';
  const saved = (vscodeApi && vscodeApi.getState()) || {};

  // ---------- Costanti ----------
  const SEG = 200, RUMBLE = 3, ROAD_W = 2000, LANES = 3, FOV = 100, CAM_H = 1000, DRAW = 300, FOG_DENSITY = 5;
  const CAM_DEPTH = 1 / Math.tan((FOV / 2) * Math.PI / 180);
  const PLAYER_Z = CAM_H * CAM_DEPTH;
  const STEP = 1 / 60;
  const MAX_SPEED = SEG / STEP;
  const ACCEL = MAX_SPEED / 5, BRAKE = -MAX_SPEED, DECEL = -MAX_SPEED / 5;
  const OFFROAD_DECEL = -MAX_SPEED / 2, OFFROAD_LIMIT = MAX_SPEED / 4, CENTRIFUGAL = 0.3;
  const KART_WORLD = 420, KART_W = KART_WORLD / ROAD_W;
  const LAPS = 3, GRID_SIZE = 5, NET_RATE = 0.05;
  const RAMP_H = 430, GRAVITY = 4200, INVERT_TIME = 5;

  // ---------- Utilità ----------
  const U = {
    inc: (s, i, m) => { let r = (s + i) % m; if (r < 0) r += m; return r; },
    interp: (a, b, p) => a + (b - a) * p,
    easeIn: (a, b, p) => a + (b - a) * p * p,
    easeInOut: (a, b, p) => a + (b - a) * ((-Math.cos(p * Math.PI) / 2) + 0.5),
    pct: (n, t) => (n % t) / t,
    limit: (v, lo, hi) => Math.max(lo, Math.min(v, hi)),
    overlap: (x1, w1, x2, w2) => Math.abs(x1 - x2) < (w1 + w2) / 2,
    fog: (d, density) => 1 / Math.pow(Math.E, d * d * density),
    fmt: (t) => {
      const m = Math.floor(t / 60), s = t - m * 60;
      return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
    },
    rng: (seed) => () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  };

  // ---------- Suoni (sintetizzati con Web Audio, nessun file) ----------
  let muted = !!saved.muted;
  const Sound = (() => {
    let ac = null, master, eng1, eng2, engFilter, engGain, screechGain, noiseBuf;

    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted || document.hidden ? 0 : 0.5;
      master.connect(ac.destination);

      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      eng1 = ac.createOscillator(); eng1.type = 'sawtooth';
      eng2 = ac.createOscillator(); eng2.type = 'square';
      engFilter = ac.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 500;
      engGain = ac.createGain(); engGain.gain.value = 0;
      eng1.connect(engFilter); eng2.connect(engFilter); engFilter.connect(engGain); engGain.connect(master);
      eng1.start(); eng2.start();

      const scr = ac.createBufferSource(); scr.buffer = noiseBuf; scr.loop = true;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 5;
      screechGain = ac.createGain(); screechGain.gain.value = 0;
      scr.connect(bp); bp.connect(screechGain); screechGain.connect(master);
      scr.start();
    }

    function updateVolume() {
      if (ac) master.gain.setTargetAtTime(muted || document.hidden ? 0 : 0.5, ac.currentTime, 0.03);
    }

    function engine(pct, boost, on) {
      if (!ac) return;
      const t = ac.currentTime, p = Math.min(pct, 1.4);
      const f = 48 + 140 * p + (boost ? 30 : 0);
      eng1.frequency.setTargetAtTime(f, t, 0.06);
      eng2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
      engFilter.frequency.setTargetAtTime(350 + 1500 * p, t, 0.06);
      engGain.gain.setTargetAtTime(on ? 0.035 + 0.045 * Math.min(p, 1) : 0, t, 0.1);
    }

    function screech(on) {
      if (ac) screechGain.gain.setTargetAtTime(on ? 0.05 : 0, ac.currentTime, 0.04);
    }

    function tone(freq, dur, o) {
      if (!ac) return;
      o = o || {};
      const t = ac.currentTime + (o.delay || 0);
      const osc = ac.createOscillator();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.vol || 0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(t + dur + 0.05);
    }

    function noise(dur, o) {
      if (!ac) return;
      o = o || {};
      const t = ac.currentTime + (o.delay || 0);
      const src = ac.createBufferSource(); src.buffer = noiseBuf;
      const f = ac.createBiquadFilter();
      f.type = o.filter || 'lowpass';
      f.frequency.setValueAtTime(o.freq || 800, t);
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      f.Q.value = o.q || 1;
      const g = ac.createGain();
      g.gain.setValueAtTime(o.vol || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur + 0.05);
    }

    return {
      init, updateVolume, engine, screech,
      tick() { tone(660, 0.05, { type: 'triangle', vol: 0.08 }); },
      count() { tone(440, 0.18, { vol: 0.1 }); },
      go() { tone(880, 0.45, { vol: 0.12 }); },
      gem() { tone(988, 0.08, { type: 'triangle', vol: 0.14 }); tone(1480, 0.15, { type: 'triangle', vol: 0.14, delay: 0.07 }); },
      turbo() { noise(0.7, { filter: 'bandpass', freq: 400, to: 3500, q: 2, vol: 0.3 }); tone(220, 0.5, { type: 'sawtooth', to: 660, vol: 0.05 }); },
      jump() { tone(260, 0.25, { type: 'sine', to: 640, vol: 0.14 }); },
      land() { noise(0.18, { freq: 300, vol: 0.35 }); tone(90, 0.12, { type: 'sine', vol: 0.2 }); },
      trick() { [660, 880, 1320].forEach((f, i) => tone(f, 0.1, { type: 'triangle', vol: 0.12, delay: i * 0.06 })); },
      bump() { noise(0.12, { freq: 900, vol: 0.28 }); tone(110, 0.1, { vol: 0.1 }); },
      poop() {
        tone(320, 0.35, { type: 'sine', to: 55, vol: 0.28 });
        noise(0.3, { freq: 500, to: 120, vol: 0.3 });
        tone(140, 0.2, { type: 'square', to: 70, vol: 0.07, delay: 0.12 });
      },
      slip() { noise(0.6, { filter: 'bandpass', freq: 3000, to: 1200, q: 6, vol: 0.22 }); },
      lap(final) { (final ? [523, 659, 784, 1047] : [523, 784]).forEach((f, i) => tone(f, 0.14, { type: 'triangle', vol: 0.12, delay: i * 0.09 })); },
      finish(win) { (win ? [523, 659, 784, 1047, 784, 1047] : [392, 523, 659, 523]).forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.13, delay: i * 0.13 })); }
    };
  })();

  // ---------- Piste ----------
  const L = { S: 25, M: 50, LG: 100 }, C = { E: 2, M: 4, H: 6 }, HL = { L: 20, M: 40, H: 60 };

  const TRACKS = [
    {
      id: 'valle', name: 'Valle dei Commit', desc: 'Colline verdi, curve morbide e tre rampe',
      grip: 60, endCurve: -C.E,
      pal: {
        skyTop: '#5cc6dd', skyBottom: '#eef9f3', fog: '#eef9f3', hillFar: '#a7d8bd', hillNear: '#5aa978',
        grass: ['#68b96f', '#5eae66'], road: ['#5a5b66', '#54555f'], rumble: ['#ffffff', '#2f3e8f'],
        lane: '#ffe066', ink: '#1d2340', slick: '#1c1c24', slickShine: 'rgba(160, 120, 255, 0.45)'
      },
      scenery: ['tree', 'tree', 'bush', 'tree'],
      tokens: ['{ }', '=>', '</>', '&&', '++', '::', '!=', '[ ]', '#!', 'fn()', '/* */', 'TODO', '0xFF', 'null', 'git push', '?:'],
      signColors: ['#2f3e8f', '#e8336d', '#ff7a3d', '#2fbf71', '#8a7dff'],
      ramps: [0.2, 0.5, 0.78], slicks: [0.34, 0.64], extraPoops: false,
      layout(R) {
        R(L.S, L.M, L.S, 0, 0);
        R(L.M, L.M, L.M, 0, HL.L);
        R(L.M, L.M, L.M, C.M, -HL.L);
        R(L.S, L.S, L.S, 0, 0);
        R(L.M, L.M, L.M, -C.H, HL.M);
        R(L.LG, L.M, L.M, C.E, HL.H);
        R(L.M, L.S, L.M, -C.M, -HL.M);
        R(L.M, L.M, L.M, -C.E, 0);
        R(L.M, L.M, L.M, C.M, HL.M);
        R(L.M, L.M, L.M, C.E, -HL.L);
        R(L.M, L.M, L.M, -C.E, HL.M);
        R(L.M, L.M, L.M, -C.M, -HL.M);
        R(L.LG, L.M, L.LG, C.H, -HL.L);
        R(L.M, L.M, L.M, -C.M, 0);
      }
    },
    {
      id: 'deserto', name: 'Deserto del Deploy', desc: 'Dune altissime e salti lunghi: cinque rampe',
      grip: 60, endCurve: 0,
      pal: {
        skyTop: '#f08a4b', skyBottom: '#ffe1a8', fog: '#ffe1a8', hillFar: '#e7a46a', hillNear: '#c9784a',
        grass: ['#e6c27a', '#dfb96f'], road: ['#6e625a', '#685c54'], rumble: ['#f3e3c3', '#b5462f'],
        lane: '#fff3d6', ink: '#4a2416', slick: '#1f1712', slickShine: 'rgba(255, 190, 120, 0.4)'
      },
      scenery: ['cactus', 'rock', 'cactus', 'cactus'],
      tokens: ['deploy', '200 OK', 'CI ✓', 'v2.0', 'ship it', 'prod', 'rollback', 'hotfix', 'main', 'tag'],
      signColors: ['#b5462f', '#2f3e8f', '#3a7d44', '#7a3fa8'],
      ramps: [0.12, 0.3, 0.5, 0.68, 0.86], slicks: [0.41], extraPoops: false,
      layout(R) {
        R(L.S, L.M, L.S, 0, 0);
        R(L.LG, L.LG, L.LG, 0, HL.H);
        R(L.M, L.M, L.M, C.E, -HL.H);
        R(L.LG, L.M, L.LG, 0, HL.M);
        R(L.M, L.M, L.M, -C.M, -HL.M);
        R(L.LG, L.LG, L.LG, C.E, HL.L);
        R(L.M, L.S, L.M, C.H, 0);
        R(L.LG, L.LG, L.LG, 0, -HL.M);
        R(L.M, L.M, L.M, -C.E, HL.H);
        R(L.LG, L.M, L.M, 0, -HL.H);
        R(L.M, L.M, L.M, -C.M, HL.L);
      }
    },
    {
      id: 'ghiaccio', name: 'Ghiacciaio Legacy', desc: 'Asfalto ghiacciato: si scivola ovunque, tornanti stretti',
      grip: 4, endCurve: C.E,
      pal: {
        skyTop: '#8fc3ec', skyBottom: '#f2f8fd', fog: '#f2f8fd', hillFar: '#d6e6f3', hillNear: '#b3cde3',
        grass: ['#eef4f8', '#e2ebf2'], road: ['#7d8ca3', '#77869c'], rumble: ['#ffffff', '#3d6fb6'],
        lane: '#d9f1ff', ink: '#1d2c40', slick: '#cfefff', slickShine: 'rgba(255, 255, 255, 0.85)'
      },
      scenery: ['pine', 'pine', 'rock', 'pine'],
      tokens: ['legacy', 'COBOL', 'v1.0.3', 'goto', 'XML', 'deprecated', 'jQuery', 'SVN', 'FIXME'],
      signColors: ['#3d6fb6', '#1d2c40', '#7a8fb0', '#b0413e'],
      ramps: [0.27, 0.74], slicks: [0.16, 0.44, 0.58, 0.86], extraPoops: false,
      layout(R) {
        R(L.S, L.M, L.S, 0, 0);
        R(L.M, L.M, L.M, C.H, HL.L);
        R(L.S, L.S, L.S, 0, 0);
        R(L.M, L.M, L.M, -C.H, -HL.L);
        R(L.M, L.S, L.M, C.M, HL.M);
        R(L.M, L.M, L.M, -C.M, 0);
        R(L.LG, L.M, L.LG, C.E, -HL.M);
        R(L.M, L.M, L.M, -C.H, HL.L);
        R(L.M, L.M, L.M, C.H, 0);
        R(L.M, L.LG, L.M, 0, -HL.L);
      }
    },
    {
      id: 'notte', name: 'Notte del Debug', desc: 'Curve strette al buio e molte più sorprese sull\'asfalto',
      grip: 60, endCurve: -C.E, night: true,
      pal: {
        skyTop: '#0b1030', skyBottom: '#2b2f63', fog: '#22264f', hillFar: '#1c2148', hillNear: '#141836',
        grass: ['#1d3a2c', '#1a3427'], road: ['#3b3c47', '#373843'], rumble: ['#ffcf33', '#2a2b35'],
        lane: '#ffe066', ink: '#ffffff', slick: '#07070b', slickShine: 'rgba(120, 200, 255, 0.5)'
      },
      scenery: ['lamp', 'bush', 'tree', 'bush'],
      tokens: ['console.log', 'debugger', 'NaN', 'undefined', '404', 'segfault', 'printf', '¯\\_(ツ)_/¯', 'stack trace'],
      signColors: ['#ffcf33', '#ff4fa3', '#4fd1ff', '#8aff80'],
      ramps: [0.36, 0.71], slicks: [0.22, 0.55, 0.9], extraPoops: true,
      layout(R) {
        R(L.S, L.M, L.S, 0, 0);
        R(L.M, L.S, L.M, -C.M, 0);
        R(L.M, L.S, L.M, C.H, HL.L);
        R(L.S, L.S, L.S, -C.E, 0);
        R(L.M, L.M, L.M, -C.H, -HL.L);
        R(L.M, L.S, L.M, C.M, HL.M);
        R(L.M, L.S, L.M, -C.M, -HL.M);
        R(L.S, L.M, L.S, 0, 0);
        R(L.M, L.M, L.M, C.H, 0);
        R(L.M, L.M, L.M, -C.E, HL.L);
        R(L.M, L.S, L.M, C.M, 0);
        R(L.LG, L.M, L.LG, -C.M, -HL.L);
      }
    }
  ];
  const TRACK_BY_ID = Object.fromEntries(TRACKS.map(t => [t.id, t]));

  // Gruppi di oggetti sull'asfalto: gemme turbo e, ogni tanto, cacche
  const PATTERNS = [
    [['gem', -0.6, 0], ['gem', 0, 0], ['gem', 0.6, 0]],
    [['gem', -0.33, 0], ['gem', 0.33, 0], ['poop', 0, 22]],
    [['gem', -0.6, 0], ['poop', 0, 0], ['gem', 0.6, 0]],
    [['poop', -0.4, 0], ['gem', 0.4, 0], ['poop', 0.45, 30], ['gem', -0.45, 30]]
  ];

  let track = TRACK_BY_ID[saved.trackId] || TRACKS[0];
  let segments = [], trackLength = 0, items = [], lineZ = 0, minimap = null, stars = [];

  function lastY() { return segments.length ? segments[segments.length - 1].p2.world.y : 0; }
  function addSegment(curve, y) {
    const n = segments.length;
    segments.push({
      index: n, curve, sprites: [], cars: [], items: [],
      p1: { world: { y: lastY(), z: n * SEG }, camera: {}, screen: {} },
      p2: { world: { y, z: (n + 1) * SEG }, camera: {}, screen: {} },
      alt: Math.floor(n / RUMBLE) % 2
    });
  }
  function addRoad(enter, hold, leave, curve, y) {
    const sY = lastY(), eY = sY + (y || 0) * SEG, tot = enter + hold + leave;
    for (let n = 0; n < enter; n++) addSegment(U.easeIn(0, curve, n / enter), U.easeInOut(sY, eY, n / tot));
    for (let n = 0; n < hold; n++) addSegment(curve, U.easeInOut(sY, eY, (enter + n) / tot));
    for (let n = 0; n < leave; n++) addSegment(U.easeInOut(curve, 0, n / leave), U.easeInOut(sY, eY, (enter + hold + n) / tot));
  }
  function findSegment(z) { return segments[Math.floor(z / SEG) % segments.length]; }
  function zOf(dist) { return U.inc(lineZ, dist, trackLength); }

  function forCrossed(oldZ, newZ, fn) {
    const n = segments.length;
    let a = Math.floor(oldZ / SEG), b = Math.floor(newZ / SEG);
    if (b < a) b += n;
    for (let i = a; i <= b && i - a < 5; i++) fn(segments[i % n]);
  }

  function buildTrack() {
    const T = track;
    segments = [];
    T.layout(addRoad);
    addRoad(120, 120, 120, T.endCurve, -lastY() / SEG);
    trackLength = segments.length * SEG;
    const N = segments.length;

    lineZ = PLAYER_Z + 30 * SEG;
    const ls = findSegment(lineZ).index;
    segments[ls].start = true;
    segments[ls + 1].start = true;

    // Scenografia
    let t = 0;
    for (let i = 20; i < N; i += 6) {
      const k = (i - 20) / 6, side = k % 2 ? 1 : -1;
      if (i % 30 === 2) {
        segments[i].sprites.push({ type: 'sign', offset: side * 1.75, text: T.tokens[t % T.tokens.length], color: T.signColors[t % T.signColors.length] });
        t++;
        continue;
      }
      const type = T.scenery[k % T.scenery.length];
      const near = type === 'lamp' ? 1.3 : 1.5 + ((i * 7) % 10) / 6;
      segments[i].sprites.push({ type, offset: side * near });
      if (i % 4 === 0) {
        const other = T.scenery[(k + 1) % T.scenery.length];
        segments[i].sprites.push({ type: other === 'lamp' ? 'bush' : other, offset: -side * (2.4 + ((i * 3) % 10) / 8) });
      }
    }

    // Rampe e chiazze scivolose
    const at = (f) => U.limit(Math.floor(f * N), 80, N - 40);
    T.ramps.forEach((f, k) => {
      const i = at(f);
      const r = { offset: [0, -0.45, 0.45][k % 3], width: k % 3 === 0 ? 0.9 : 0.75 };
      segments[i].ramp = r; segments[i + 1].ramp = r; segments[i].rampDraw = true;
    });
    T.slicks.forEach((f, k) => {
      const i = at(f);
      if (segments[i].ramp || segments[i + 1].ramp) return;
      const s = { offset: [0.45, -0.45, 0][k % 3], width: 0.55 };
      segments[i].slick = s; segments[i + 1].slick = s; segments[i].slickDraw = true;
    });

    // Gemme e cacche
    items = [];
    const blocked = (i) => {
      for (let j = i - 5; j <= i + 5; j++) { const s = segments[(j + N) % N]; if (s.ramp || s.slick) return true; }
      return false;
    };
    const addItem = (i, type, offset) => {
      if (i >= N - 2 || blocked(i)) return;
      const it = { type, offset, taken: 0, idx: items.length };
      segments[i].items.push(it);
      items.push(it);
    };
    let row = 0;
    for (let i = 120; i < N - 60; i += 110, row++) {
      for (const [type, off, dz] of PATTERNS[row % PATTERNS.length]) addItem(i + dz, type, off);
      if (T.extraPoops) addItem(i + 60, 'poop', row % 2 ? 0.3 : -0.3);
    }

    buildMinimap();

    stars = [];
    if (T.night) {
      const r = U.rng(7);
      for (let i = 0; i < 90; i++) stars.push([r(), r() * 0.5, r() < 0.15 ? 2 : 1]);
    }
  }

  // Forma della pista per la minimappa, ricavata dalle curve
  function buildMinimap() {
    const n = segments.length, pts = [];
    let cum = 0, x = 0, y = 0;
    for (let i = 0; i < n; i++) {
      pts.push([x, y]);
      cum += segments[i].curve;
      const a = cum * 0.0017 + (Math.PI * 2 * i) / n;
      x += Math.cos(a); y += Math.sin(a);
    }
    const ex = x, ey = y;
    for (let i = 0; i < n; i++) { pts[i][0] -= ex * i / n; pts[i][1] -= ey * i / n; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [px, py] of pts) { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
    const size = Math.max(maxX - minX, maxY - minY) || 1;
    minimap = pts.map(([px, py]) => [(px - (minX + maxX) / 2) / size, (py - (minY + maxY) / 2) / size]);
  }

  // ---------- Stato ----------
  const keys = { left: false, right: false, up: false, down: false, drift: false };
  let mode = 'solo';            // solo | host | client
  let myId = 0, myName = 'Tu', myColor = '#ff4757', inviteCode = '';
  let roster = [];
  let state = 'title';          // title | lobby | countdown | race | paused | finished | disconnected
  let position = 0, skyOffset = 0, raceTime = 0, countdown = 0, lastCount = 0, finishedAt = 0, flash = 0, netTimer = 0;
  let toast = { text: '', time: 0 }, popup = { text: '', time: 0, color: '#ffcf33' };
  let player, cars = [];
  let bestTimes = saved.bestTimes || {};

  const RIVALS = [
    { name: 'Byte', color: '#ff7a3d', speed: 0.955 },
    { name: 'Lambda', color: '#2fbf71', speed: 0.94 },
    { name: 'Null', color: '#8a7dff', speed: 0.925 },
    { name: 'Tabs', color: '#ffcf33', speed: 0.91 }
  ];

  const online = () => mode !== 'solo';
  function persist() { if (vscodeApi) vscodeApi.setState({ bestTimes, muted, trackId: track.id }); }
  function send(msg) { if (vscodeApi && online()) vscodeApi.postMessage({ type: 'send', msg }); }
  function showToast(text) { toast = { text, time: 2.5 }; }
  function showPopup(text, color) { popup = { text, time: 1.1, color: color || '#ffcf33' }; }

  function newPlayer() {
    return {
      id: myId, name: myName, color: myColor, x: 0, vx: 0, speed: 0, dist: 0,
      turbo: 1, boost: 0, drift: { on: false, time: 0, dir: 0 }, lapStart: 0, lap: 1, lastLap: null,
      finished: false, finishTime: 0, bump: 0,
      air: false, jy: 0, vy: 0, trick: false, trickT: 0,
      slip: 0, spin: 0, invert: 0
    };
  }

  function clearWorld() {
    for (const s of segments) s.cars = [];
    for (const it of items) it.taken = 0;
    cars = [];
    position = 0; skyOffset = 0; raceTime = 0; finishedAt = 0; flash = 0; netTimer = 0; lastCount = 0;
    player = newPlayer();
  }

  function selectTrack(id, announce) {
    const t = TRACK_BY_ID[id];
    if (!t) return;
    track = t;
    buildTrack();
    clearWorld();
    persist();
    if (announce && mode === 'host') send({ t: 'track', id: t.id });
  }

  function cycleTrack(dir) {
    const i = TRACKS.indexOf(track);
    selectTrack(TRACKS[(i + dir + TRACKS.length) % TRACKS.length].id, true);
    Sound.tick();
  }

  function buildGrid(humans) {
    const bots = RIVALS.slice(0, Math.max(0, GRID_SIZE - humans.length))
      .map((r, i) => ({ id: 'b' + i, name: r.name, color: r.color, bot: 1, speed: r.speed }));
    return bots.concat(humans.map(h => ({ id: h.id, name: h.name, color: h.color })));
  }

  function startRace(grid) {
    clearWorld();
    grid.forEach((g, i) => {
      const z = lineZ - (2 + i * 3) * SEG;
      const lane = i % 2 ? 0.5 : -0.5;
      if (g.id === myId) {
        position = U.inc(0, z - PLAYER_Z, trackLength);
        player.dist = z - lineZ;
        player.x = lane;
        return;
      }
      const car = {
        id: g.id, name: g.name, color: g.color, bot: !!g.bot,
        kind: g.bot && mode !== 'client' ? 'ai' : 'net',
        baseSpeed: MAX_SPEED * (g.speed || 0.93),
        z, dist: z - lineZ, offset: lane, lane, speed: 0, boost: 0,
        tDist: z - lineZ, tOffset: lane, tSpeed: 0, tBoost: 0, tJy: 0,
        air: false, jy: 0, vy: 0, wobble: 0,
        finished: false, finishTime: 0
      };
      car.seg = findSegment(z);
      car.seg.cars.push(car);
      cars.push(car);
    });
    state = 'countdown';
    countdown = 3;
    lastCount = 4;
  }

  function startFromHere() {
    if (mode === 'client') return;
    const humans = mode === 'solo' ? [{ id: myId, name: myName, color: myColor }] : roster;
    const grid = buildGrid(humans);
    if (mode === 'host') send({ t: 'start', grid, track: track.id });
    startRace(grid);
  }

  function backToMenu() {
    clearWorld();
    if (mode === 'solo') state = 'title';
    else {
      state = 'lobby';
      if (mode === 'host') { send({ t: 'tolobby' }); send({ t: 'track', id: track.id }); }
    }
  }

  function removeCar(car) {
    const i = car.seg.cars.indexOf(car);
    if (i >= 0) car.seg.cars.splice(i, 1);
  }

  // ---------- Rete ----------
  function onNet(msg) {
    switch (msg.t) {
      case 'lobby': {
        roster = msg.players || [];
        const ids = new Set(roster.map(p => p.id));
        cars = cars.filter(c => {
          if (c.bot || ids.has(c.id)) return true;
          removeCar(c);
          showToast(`${c.name} ha lasciato la gara`);
          return false;
        });
        if (mode === 'host') send({ t: 'track', id: track.id });
        break;
      }
      case 'track':
        if (mode === 'client' && (state === 'lobby' || state === 'finished') && msg.id !== track.id) selectTrack(msg.id, false);
        break;
      case 'tolobby':
        if (mode === 'client') { clearWorld(); state = 'lobby'; }
        break;
      case 'start':
        if (msg.track && msg.track !== track.id) selectTrack(msg.track, false);
        if (Array.isArray(msg.grid)) startRace(msg.grid);
        break;
      case 'state': {
        const car = cars.find(c => c.id === msg.from && c.kind === 'net');
        if (car) applyRemote(car, msg.d, msg.x, msg.s, msg.b, msg.j);
        if (mode === 'client' && Array.isArray(msg.bots)) {
          for (const [id, d, x, s, ft, j] of msg.bots) {
            const bot = cars.find(c => c.id === id);
            if (!bot) continue;
            applyRemote(bot, d, x, s, 0, j);
            if (ft && !bot.finished) { bot.finished = true; bot.finishTime = ft; }
          }
        }
        break;
      }
      case 'item':
        if (items[msg.i]) items[msg.i].taken = 8;
        break;
      case 'finish': {
        const car = cars.find(c => c.id === msg.from);
        if (car && !car.finished) { car.finished = true; car.finishTime = msg.time; }
        break;
      }
    }
  }

  function applyRemote(car, d, x, s, b, j) {
    if (typeof d !== 'number') return;
    car.tDist = d; car.tOffset = +x || 0; car.tSpeed = +s || 0; car.tBoost = b ? 1 : 0; car.tJy = +j || 0;
  }

  function sendState() {
    const msg = {
      t: 'state', d: Math.round(player.dist), x: +player.x.toFixed(3), s: Math.round(player.speed),
      b: player.boost > 0 ? 1 : 0, j: Math.round(player.jy)
    };
    if (mode === 'host') {
      msg.bots = cars.filter(c => c.kind === 'ai').map(c => [
        c.id, Math.round(c.dist), +c.offset.toFixed(3), Math.round(c.speed), c.finished ? +c.finishTime.toFixed(2) : 0, Math.round(c.jy)
      ]);
    }
    send(msg);
  }

  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'init') {
      mode = m.mode || 'solo';
      myId = mode === 'solo' ? 0 : m.myId;
      myName = mode === 'solo' ? 'Tu' : (m.name || 'Pilota');
      myColor = mode === 'solo' ? '#ff4757' : (m.color || '#ff4757');
      inviteCode = m.code || '';
      roster = m.players || [];
      clearWorld();
      state = mode === 'solo' ? 'title' : 'lobby';
      if (mode === 'host') send({ t: 'track', id: track.id });
    } else if (m.type === 'net' && m.msg) {
      onNet(m.msg);
    } else if (m.type === 'disconnected') {
      state = 'disconnected';
    } else if (m.type === 'toast') {
      showToast(m.text);
    }
  });

  // ---------- Aggiornamento ----------
  function update(dt) {
    if (flash > 0) flash -= dt;
    if (toast.time > 0) toast.time -= dt;
    if (popup.time > 0) popup.time -= dt;

    // Nei menu la pista scorre lentamente sullo sfondo
    if (state === 'title' || state === 'lobby') {
      position = U.inc(position, dt * MAX_SPEED * 0.22, trackLength);
      skyOffset = U.inc(skyOffset, 0.001 * findSegment(position + PLAYER_Z).curve * dt * MAX_SPEED * 0.22 / SEG, 1);
      Sound.engine(0, false, false);
      Sound.screech(false);
      return;
    }

    if (state === 'countdown') {
      countdown -= dt;
      const c = Math.ceil(countdown);
      if (c !== lastCount) { lastCount = c; if (c > 0) Sound.count(); }
      updateCars(0);
      if (countdown <= 0) { state = 'race'; Sound.go(); }
      Sound.engine(0.05, false, true);
      return;
    }
    if (state !== 'race' && state !== 'finished') {
      Sound.engine(0, false, false);
      Sound.screech(false);
      return;
    }

    raceTime += dt;
    for (const it of items) if (it.taken > 0) it.taken = Math.max(0, it.taken - dt);

    updateCars(dt);
    updatePlayer(dt);

    Sound.engine(player.speed / MAX_SPEED, player.boost > 0, true);
    Sound.screech(!player.air && (player.drift.on || player.slip > 0));

    if (online()) {
      netTimer -= dt;
      if (netTimer <= 0) { netTimer = NET_RATE; sendState(); }
    }
  }

  function boostPlayer(sec) { player.boost = Math.max(player.boost, sec); flash = 0.25; Sound.turbo(); }

  function updatePlayer(dt) {
    const p = player;
    const auto = p.finished;
    const left = !auto && keys.left, right = !auto && keys.right;
    const up = auto || keys.up, down = !auto && keys.down;
    const speedPct = p.speed / MAX_SPEED;
    const sp = Math.min(speedPct, 1);
    const steer = (left ? -1 : 0) + (right ? 1 : 0);
    const segNow = findSegment(U.inc(position, PLAYER_Z, trackLength));

    // Derapata: tieni Shift sterzando, rilascia per la spinta
    const d = p.drift;
    if (!auto && !p.air && p.slip <= 0 && keys.drift && steer !== 0 && speedPct > 0.45) {
      if (!d.on) { d.on = true; d.dir = steer; d.time = 0; }
      d.time += dt;
    } else if (d.on) {
      if (d.time > 0.7 && !p.air) boostPlayer(0.4 + Math.min(d.time, 2.2) * 0.35);
      d.on = false; d.time = 0;
    }

    // Sterzo con aderenza: sul ghiaccio e sulle chiazze il kart risponde in ritardo
    let target = steer * 2 * sp * (d.on ? 1.5 : 1) + (d.on ? d.dir * 2 * sp * 0.25 : 0);
    if (p.air) target = p.vx + steer * 0.4 * sp;
    const grip = p.air ? 2 : p.slip > 0 ? 1.1 : track.grip;
    p.vx += (target - p.vx) * Math.min(1, grip * dt);
    if (p.slip > 0) { p.slip -= dt; p.spin += dt * 16; } else p.spin = 0;
    p.x += p.vx * dt;
    if (auto) p.x += (0 - p.x) * dt * 2;
    if (!p.air) p.x -= dt * 2 * sp * sp * segNow.curve * CENTRIFUGAL * (d.on ? 0.55 : 1);

    // Velocità
    const top = MAX_SPEED * (p.boost > 0 ? 1.4 : 1);
    if (p.boost > 0) {
      p.boost -= dt;
      p.speed += ACCEL * 3 * dt;
    } else if (!p.air) {
      if (up) p.speed += ACCEL * dt;
      else if (down) p.speed += BRAKE * dt;
      else p.speed += DECEL * dt;
    }
    if (d.on) p.speed += DECEL * 0.25 * dt;
    if (!p.air && (p.x < -1 || p.x > 1) && p.speed > OFFROAD_LIMIT && p.boost <= 0) p.speed += OFFROAD_DECEL * dt;
    if (p.speed > top) p.speed = Math.max(top, p.speed - MAX_SPEED * 0.6 * dt);
    p.speed = Math.max(0, p.speed);
    p.x = U.limit(p.x, -2.6, 2.6);
    if (p.invert > 0) p.invert -= dt;

    // Volo
    if (p.air) {
      p.vy -= GRAVITY * dt;
      p.jy += p.vy * dt;
      if (p.trick) p.trickT += dt;
      if (p.jy <= 0) {
        p.jy = 0; p.air = false; p.vy = 0;
        if (p.trick) { boostPlayer(0.9); Sound.trick(); showPopup('Trick!'); }
        else Sound.land();
        p.trick = false;
      }
    }

    // Movimento e ciò che si incontra sull'asfalto
    const oldZ = U.inc(position, PLAYER_Z, trackLength);
    position = U.inc(position, dt * p.speed, trackLength);
    p.dist += dt * p.speed;
    const newZ = U.inc(position, PLAYER_Z, trackLength);

    forCrossed(oldZ, newZ, (seg) => {
      if (p.air) return;
      if (seg.ramp && p.speed > OFFROAD_LIMIT && U.overlap(p.x, KART_W, seg.ramp.offset, seg.ramp.width)) {
        p.air = true; p.vy = 900 + 1500 * Math.min(speedPct, 1.3); p.trick = false; p.trickT = 0;
        d.on = false; d.time = 0;
        Sound.jump();
        return;
      }
      if (seg.slick && p.slip <= 0 && U.overlap(p.x, KART_W, seg.slick.offset, seg.slick.width)) {
        p.slip = 1.3;
        p.vx += (p.x >= seg.slick.offset ? 1 : -1) * 0.9;
        p.speed *= 0.9;
        d.on = false; d.time = 0;
        Sound.slip();
        showPopup(track.id === 'ghiaccio' ? 'Ghiaccio!' : 'Olio!', '#8fd0ff');
      }
      for (const it of seg.items) {
        if (it.taken || !U.overlap(p.x, KART_W, it.offset, it.type === 'poop' ? 0.16 : 0.18)) continue;
        it.taken = 8;
        send({ t: 'item', i: it.idx });
        if (it.type === 'gem') {
          p.turbo = Math.min(3, p.turbo + 1);
          flash = 0.15;
          Sound.gem();
        } else {
          p.invert = INVERT_TIME;
          p.speed *= 0.55;
          Sound.poop();
          showPopup('Che schifo!', '#e2a35c');
        }
      }
    });

    // Urti con gli altri kart
    const playerSeg = findSegment(newZ);
    if (!p.air) {
      for (const car of playerSeg.cars) {
        if (car.jy < 60 && p.speed > car.speed && U.overlap(p.x, KART_W, car.offset, KART_W)) {
          p.speed = car.speed * 0.8;
          p.vx = 0;
          p.x += (p.x >= car.offset ? 1 : -1) * 0.12;
          if (p.bump <= 0) Sound.bump();
          p.bump = 0.25;
          break;
        }
      }
    }
    if (p.bump > 0) p.bump -= dt;

    skyOffset = U.inc(skyOffset, 0.001 * playerSeg.curve * (dt * p.speed) / SEG, 1);

    // Giri e arrivo
    const lap = Math.min(LAPS, Math.floor(Math.max(0, p.dist) / trackLength) + 1);
    if (lap !== p.lap) {
      p.lastLap = raceTime - p.lapStart;
      p.lapStart = raceTime;
      p.lap = lap;
      Sound.lap(lap === LAPS);
    }
    if (!p.finished && p.dist >= LAPS * trackLength) {
      p.finished = true;
      p.finishTime = raceTime;
      finishedAt = raceTime;
      state = 'finished';
      send({ t: 'finish', time: +raceTime.toFixed(2) });
      const won = standings().indexOf(p) === 0;
      Sound.finish(won);
      if (mode === 'solo' && won && (!bestTimes[track.id] || raceTime < bestTimes[track.id])) {
        bestTimes[track.id] = raceTime;
        persist();
      }
    }
  }

  function updateCars(dt) {
    const playerSeg = findSegment(U.inc(position, PLAYER_Z, trackLength));
    for (const car of cars) {
      const oldZ = car.z;
      if (car.kind === 'ai') updateAi(car, dt, playerSeg);
      else updateNet(car, dt);
      car.z = zOf(car.dist);
      if (car.kind === 'ai' && dt > 0) aiCrossings(car, oldZ, car.z);
      const seg = findSegment(car.z);
      if (seg !== car.seg) {
        removeCar(car);
        seg.cars.push(car);
        car.seg = seg;
        if (car.kind === 'ai' && Math.random() < 0.006) car.lane = [-0.6, 0, 0.6][Math.floor(Math.random() * 3)];
      }
    }
  }

  function updateAi(car, dt, playerSeg) {
    if (dt === 0) return;
    const gap = car.dist - player.dist;
    let target = car.baseSpeed;
    if (!car.finished) {
      if (gap > 8000) target *= 0.93;
      else if (gap < -8000) target = Math.min(MAX_SPEED * 0.985, target * 1.05);
    } else target *= 0.55;
    if (car.boost > 0) { car.boost -= dt; target *= 1.3; }
    if (!car.air) car.speed += (target - car.speed) * Math.min(1, dt * 1.2);

    if (!car.air) {
      car.offset += steerCar(car, car.seg, playerSeg);
      car.offset += (car.lane - car.offset) * dt * 0.4;
    }
    if (car.wobble > 0) { car.wobble -= dt; car.offset += Math.sin(car.wobble * 20) * dt * 0.8; }
    car.offset = U.limit(car.offset, -0.95, 0.95);
    car.dist += dt * car.speed;

    if (car.air) {
      car.vy -= GRAVITY * dt;
      car.jy += car.vy * dt;
      if (car.jy <= 0) { car.jy = 0; car.vy = 0; car.air = false; }
    }
    if (!car.finished && car.dist >= LAPS * trackLength) {
      car.finished = true;
      car.finishTime = raceTime;
    }
  }

  function aiCrossings(car, oldZ, newZ) {
    forCrossed(oldZ, newZ, (seg) => {
      if (car.air) return;
      if (seg.ramp && U.overlap(car.offset, KART_W, seg.ramp.offset, seg.ramp.width)) {
        car.air = true; car.vy = 900 + 1500 * Math.min(car.speed / MAX_SPEED, 1.3);
        return;
      }
      if (seg.slick && car.wobble <= 0 && U.overlap(car.offset, KART_W, seg.slick.offset, seg.slick.width)) {
        car.wobble = 1; car.speed *= 0.85;
      }
      for (const it of seg.items) {
        if (it.taken || !U.overlap(car.offset, KART_W, it.offset, 0.18)) continue;
        it.taken = 8;
        send({ t: 'item', i: it.idx });
        if (it.type === 'gem') car.boost = 1.1;
        else car.speed *= 0.6;
      }
    });
  }

  function updateNet(car, dt) {
    car.tDist += car.tSpeed * dt;
    car.dist += car.tSpeed * dt;
    const err = car.tDist - car.dist;
    if (Math.abs(err) > SEG * 30) car.dist = car.tDist;
    else car.dist += err * Math.min(1, dt * 6);
    car.offset += (car.tOffset - car.offset) * Math.min(1, dt * 10);
    car.jy += (car.tJy - car.jy) * Math.min(1, dt * 15);
    car.speed = car.tSpeed;
    car.boost = car.tBoost;
  }

  // Le CPU schivano gli altri kart e le cacche
  function steerCar(car, seg, playerSeg) {
    for (let i = 1; i < 20; i++) {
      const s = segments[(seg.index + i) % segments.length];
      if (s === playerSeg && car.speed > player.speed && U.overlap(player.x, KART_W, car.offset, KART_W * 1.3)) {
        const dir = player.x > 0.5 ? -1 : player.x < -0.5 ? 1 : (car.offset > player.x ? 1 : -1);
        return dir * (1 / i) * (car.speed - player.speed) / MAX_SPEED;
      }
      for (const o of s.cars) {
        if (o !== car && car.speed > o.speed && U.overlap(car.offset, KART_W, o.offset, KART_W * 1.3)) {
          const dir = o.offset > 0.5 ? -1 : o.offset < -0.5 ? 1 : (car.offset > o.offset ? 1 : -1);
          return dir * (1 / i) * (car.speed - o.speed) / MAX_SPEED;
        }
      }
      if (i < 12) {
        for (const it of s.items) {
          if (it.type !== 'poop' || it.taken || !U.overlap(car.offset, KART_W, it.offset, 0.3)) continue;
          const dir = it.offset > 0.5 ? -1 : it.offset < -0.5 ? 1 : (car.offset >= it.offset ? 1 : -1);
          return dir * 0.035 / Math.sqrt(i);
        }
      }
    }
    return 0;
  }

  function standings() {
    return [player, ...cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.dist - a.dist;
    });
  }

  // ---------- Disegno della pista ----------
  function project(p, camX, camY, camZ, W, H) {
    p.camera.x = (p.world.x || 0) - camX;
    p.camera.y = (p.world.y || 0) - camY;
    p.camera.z = (p.world.z || 0) - camZ;
    p.screen.scale = CAM_DEPTH / p.camera.z;
    p.screen.x = Math.round(W / 2 + p.screen.scale * p.camera.x * W / 2);
    p.screen.y = Math.round(H / 2 - p.screen.scale * p.camera.y * H / 2);
    p.screen.w = Math.round(p.screen.scale * ROAD_W * W / 2);
  }

  function poly(pts, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath(); ctx.fill();
  }

  function renderSegment(W, seg) {
    const P = track.pal;
    const { x: x1, y: y1, w: w1 } = seg.p1.screen;
    const { x: x2, y: y2, w: w2 } = seg.p2.screen;
    const r1 = w1 / Math.max(6, 2 * LANES), r2 = w2 / Math.max(6, 2 * LANES);
    const l1 = w1 / Math.max(32, 8 * LANES), l2 = w2 / Math.max(32, 8 * LANES);

    ctx.fillStyle = P.grass[seg.alt];
    ctx.fillRect(0, y2, W, y1 - y2);
    poly([x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2], P.rumble[seg.alt]);
    poly([x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2], P.rumble[seg.alt]);
    poly([x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2], P.road[seg.alt]);

    if (seg.start) {
      const cols = 12;
      for (let i = 0; i < cols; i++) {
        if ((i + seg.index) % 2) continue;
        const a = i / cols, b = (i + 1) / cols;
        poly([x1 - w1 + 2 * w1 * a, y1, x1 - w1 + 2 * w1 * b, y1, x2 - w2 + 2 * w2 * b, y2, x2 - w2 + 2 * w2 * a, y2], '#f4f4f4');
      }
    } else if (seg.alt === 0) {
      const lw1 = w1 * 2 / LANES, lw2 = w2 * 2 / LANES;
      let lx1 = x1 - w1 + lw1, lx2 = x2 - w2 + lw2;
      for (let lane = 1; lane < LANES; lane++, lx1 += lw1, lx2 += lw2) {
        poly([lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2], P.lane);
      }
    }
    if (seg.fog < 1) {
      ctx.globalAlpha = 1 - seg.fog;
      ctx.fillStyle = P.fog;
      ctx.fillRect(0, y2, W, y1 - y2);
      ctx.globalAlpha = 1;
    }
  }

  function drawHills(W, H, offset, baseY, amp, color, freq, phase) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W + 8; x += 8) {
      const t = (x / W + offset) * Math.PI * 2 * freq + phase;
      ctx.lineTo(x, baseY - amp * (0.55 + 0.25 * Math.sin(t) + 0.2 * Math.sin(t * 2.7 + 1.3)));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawBackground(W, H, playerY) {
    const P = track.pal;
    const g = ctx.createLinearGradient(0, 0, 0, H / 2);
    g.addColorStop(0, P.skyTop);
    g.addColorStop(1, P.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (stars.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (const [sx, sy, sz] of stars) ctx.fillRect(((sx + skyOffset * 0.2) % 1) * W, sy * H, sz, sz);
      ctx.fillStyle = '#f4f1d0';
      ctx.beginPath(); ctx.arc(W * 0.8, H * 0.12, Math.max(10, H * 0.04), 0, Math.PI * 2); ctx.fill();
    }
    const yOff = -playerY * H * 0.000006;
    drawHills(W, H, skyOffset * 0.5, H * 0.52 + yOff, H * 0.16, P.hillFar, 2, 0);
    drawHills(W, H, skyOffset, H * 0.54 + yOff * 1.5, H * 0.1, P.hillNear, 3, 2);
  }

  // ---------- Scenografia ----------
  function drawTree(x, y, w) {
    ctx.fillStyle = '#6b4a2e';
    ctx.fillRect(x - w * 0.06, y - w * 0.7, w * 0.12, w * 0.7);
    ctx.fillStyle = track.night ? '#1f5137' : '#2e7d4f';
    ctx.beginPath(); ctx.arc(x, y - w * 0.85, w * 0.36, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = track.night ? '#2a6646' : '#3f9a62';
    ctx.beginPath(); ctx.arc(x - w * 0.12, y - w * 1.0, w * 0.24, 0, Math.PI * 2); ctx.fill();
  }
  function drawBush(x, y, w) {
    ctx.fillStyle = track.night ? '#1f4a33' : '#3f9a62';
    for (const [dx, r] of [[-0.25, 0.22], [0.2, 0.25], [0, 0.3]]) {
      ctx.beginPath(); ctx.arc(x + dx * w, y - r * w * 0.6, r * w, Math.PI, 0); ctx.fill();
    }
  }
  function drawCactus(x, y, w) {
    ctx.fillStyle = '#3f8f4f';
    const cw = w * 0.16;
    ctx.beginPath(); ctx.roundRect(x - cw / 2, y - w * 1.1, cw, w * 1.1, cw / 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(x - w * 0.32, y - w * 0.75, cw * 0.8, w * 0.38, cw / 2); ctx.fill();
    ctx.fillRect(x - w * 0.32, y - w * 0.45, w * 0.3, cw * 0.7);
    ctx.beginPath(); ctx.roundRect(x + w * 0.2, y - w * 0.9, cw * 0.8, w * 0.42, cw / 2); ctx.fill();
    ctx.fillRect(x, y - w * 0.56, w * 0.3, cw * 0.7);
  }
  function drawRock(x, y, w) {
    const snow = track.id === 'ghiaccio';
    ctx.fillStyle = snow ? '#8796a8' : '#a5643f';
    poly([x - w * 0.5, y, x - w * 0.35, y - w * 0.4, x - w * 0.05, y - w * 0.55, x + w * 0.3, y - w * 0.35, x + w * 0.5, y], ctx.fillStyle);
    poly([x - w * 0.05, y - w * 0.55, x + w * 0.3, y - w * 0.35, x + w * 0.1, y - w * 0.3], snow ? '#ffffff' : '#c27a4f');
  }
  function drawPine(x, y, w) {
    ctx.fillStyle = '#5b4030';
    ctx.fillRect(x - w * 0.05, y - w * 0.25, w * 0.1, w * 0.25);
    for (let i = 0; i < 3; i++) {
      const by = y - w * (0.2 + i * 0.32), hw = w * (0.42 - i * 0.1);
      poly([x - hw, by, x + hw, by, x, by - w * 0.48], '#2f5d4a');
      poly([x - hw * 0.35, by - w * 0.32, x + hw * 0.35, by - w * 0.32, x, by - w * 0.48], '#ffffff');
    }
  }
  function drawLamp(x, y, w) {
    const side = x < canvas.width / 2 ? 1 : -1;
    const top = y - w * 1.6;
    const glow = ctx.createRadialGradient(x + side * w * 0.3, top + w * 0.1, 0, x + side * w * 0.3, top + w * 0.1, w * 0.9);
    glow.addColorStop(0, 'rgba(255, 220, 120, 0.55)');
    glow.addColorStop(1, 'rgba(255, 220, 120, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x + side * w * 0.3, top + w * 0.1, w * 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5a5d6b';
    ctx.fillRect(x - w * 0.03, top, w * 0.06, y - top);
    ctx.fillRect(x, top, side * w * 0.32, w * 0.05);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(x + side * w * 0.22 - w * 0.06, top + w * 0.05, w * 0.12, w * 0.06);
  }

  function drawSign(x, y, w, text, color) {
    const h = w * 0.5, top = y - w * 0.95;
    ctx.fillStyle = '#3b3b45';
    ctx.fillRect(x - w * 0.38, top + h, w * 0.05, y - top - h);
    ctx.fillRect(x + w * 0.33, top + h, w * 0.05, y - top - h);
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, top, w, h);
    ctx.fillStyle = track.night ? '#14172e' : '#ffffff';
    ctx.fillRect(x - w / 2 + w * 0.04, top + h * 0.1, w - w * 0.08, h * 0.8);
    if (w > 18) {
      let size = Math.round(h * 0.42);
      ctx.font = `bold ${size}px ${FONT}`;
      const tw = ctx.measureText(text).width;
      if (tw > w * 0.82) { size = Math.floor(size * (w * 0.82) / tw); ctx.font = `bold ${size}px ${FONT}`; }
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, top + h / 2);
    }
  }

  const SPRITES = {
    tree: [1100, drawTree], bush: [700, drawBush], cactus: [900, drawCactus], rock: [800, drawRock],
    pine: [1300, drawPine], lamp: [900, drawLamp]
  };

  // ---------- Oggetti sull'asfalto ----------
  function drawGem(x, y, w, t) {
    const cy = y - w * 0.9 - Math.sin(t * 5) * w * 0.12;
    ctx.fillStyle = 'rgba(255, 207, 51, 0.35)';
    ctx.beginPath(); ctx.arc(x, cy, w * 0.75, 0, Math.PI * 2); ctx.fill();
    poly([x, cy - w * 0.55, x + w * 0.4, cy, x, cy + w * 0.55, x - w * 0.4, cy], '#ffcf33');
    poly([x + w * 0.08, cy - w * 0.32, x - w * 0.14, cy + w * 0.04, x + w * 0.02, cy + w * 0.04, x - w * 0.08, cy + w * 0.32, x + w * 0.16, cy - w * 0.06, x, cy - w * 0.06], '#ff7a3d');
  }

  function drawPoop(x, y, w) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(x, y, w * 0.55, w * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    const tiers = [[0, 0.5, 0.2], [-0.22, 0.38, 0.17], [-0.42, 0.25, 0.14]];
    for (const [dy, rw, rh] of tiers) {
      ctx.fillStyle = '#7a4a24';
      ctx.beginPath(); ctx.ellipse(x, y - w * 0.12 + dy * w, rw * w, rh * w, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9a6233';
      ctx.beginPath(); ctx.ellipse(x - rw * w * 0.25, y - w * 0.16 + dy * w, rw * w * 0.45, rh * w * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    }
    poly([x - w * 0.06, y - w * 0.58, x + w * 0.06, y - w * 0.58, x + w * 0.14, y - w * 0.72], '#7a4a24');
    if (w > 14) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x - w * 0.12, y - w * 0.36, w * 0.07, 0, Math.PI * 2); ctx.arc(x + w * 0.12, y - w * 0.36, w * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1d1d1d';
      ctx.beginPath(); ctx.arc(x - w * 0.11, y - w * 0.35, w * 0.035, 0, Math.PI * 2); ctx.arc(x + w * 0.13, y - w * 0.35, w * 0.035, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawSlick(seg, W) {
    const s = seg.p1.screen, e = seg.p2.screen, sl = seg.slick;
    const near = segments[(seg.index + 2) % segments.length].p1.screen;
    const cx = U.interp(s.x, e.x, 0.5) + s.scale * sl.offset * ROAD_W * W / 2;
    const rx = s.scale * sl.width / 2 * ROAD_W * W / 2;
    const cy = U.interp(s.y, near.y, 0.5);
    const ry = Math.max(2, Math.abs(s.y - near.y) / 2);
    ctx.fillStyle = track.pal.slick;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = track.pal.slickShine;
    ctx.beginPath(); ctx.ellipse(cx - rx * 0.2, cy - ry * 0.15, rx * 0.45, ry * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Rampa: bordo vicino a terra, bordo lontano rialzato, strisce gialle e nere
  function drawRamp(seg, W, H) {
    const far = segments[(seg.index + 1) % segments.length];
    if (far.p2.camera.z <= CAM_DEPTH) return;
    const r = seg.ramp, a = seg.p1.screen, b = far.p2.screen;
    const ax = a.x + a.scale * r.offset * ROAD_W * W / 2, aw = a.scale * r.width / 2 * ROAD_W * W / 2;
    const bx = b.x + b.scale * r.offset * ROAD_W * W / 2, bw = b.scale * r.width / 2 * ROAD_W * W / 2;
    const bTop = b.y - b.scale * RAMP_H * H / 2;
    poly([ax - aw, a.y, bx - bw, bTop, bx - bw, b.y], '#a8891f');
    poly([ax + aw, a.y, bx + bw, bTop, bx + bw, b.y], '#a8891f');
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      const p0 = i / bands, p1 = (i + 1) / bands;
      const y0 = U.interp(a.y, bTop, p0), y1 = U.interp(a.y, bTop, p1);
      const x0 = U.interp(ax, bx, p0), x1 = U.interp(ax, bx, p1);
      const w0 = U.interp(aw, bw, p0), w1 = U.interp(aw, bw, p1);
      poly([x0 - w0, y0, x0 + w0, y0, x1 + w1, y1, x1 - w1, y1], i % 2 ? '#1f2028' : '#ffcf33');
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Kart: (x, y) è il punto a terra; lift lo solleva, angle lo ruota
  function drawKart(x, y, w, color, tilt, lift, angle) {
    if (w < 2) return;
    const h = w * 0.6;
    const shadowScale = 1 / (1 + (lift || 0) / (w * 1.5));
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y, w * 0.55 * shadowScale, h * 0.12 * shadowScale, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(x, y - (lift || 0));
    if (angle) { ctx.translate(0, -h * 0.5); ctx.rotate(angle); ctx.translate(0, h * 0.5); }
    ctx.fillStyle = '#1f2028';
    roundRect(-w * 0.5, -h * 0.5, w * 0.24, h * 0.5, w * 0.05); ctx.fill();
    roundRect(w * 0.26, -h * 0.5, w * 0.24, h * 0.5, w * 0.05); ctx.fill();
    poly([-w * 0.3, -h * 0.12, w * 0.3, -h * 0.12, w * 0.24 + tilt * w * 0.03, -h * 0.62, -w * 0.24 + tilt * w * 0.03, -h * 0.62], color);
    ctx.fillStyle = '#1f2028';
    ctx.fillRect(-w * 0.34, -h * 0.7, w * 0.68, h * 0.1);
    ctx.fillStyle = '#9aa0ad';
    ctx.fillRect(-w * 0.14, -h * 0.2, w * 0.07, h * 0.1);
    ctx.fillRect(w * 0.07, -h * 0.2, w * 0.07, h * 0.1);
    const hx = tilt * w * 0.06, hy = -h * 0.95;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(hx, hy, w * 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(hx - w * 0.03, hy - w * 0.15, w * 0.06, w * 0.3);
    ctx.restore();
  }

  function render() {
    const W = canvas.width, H = canvas.height;
    const baseSeg = findSegment(position), basePct = U.pct(position, SEG);
    const pz = U.inc(position, PLAYER_Z, trackLength);
    const playerSeg = findSegment(pz), playerPct = U.pct(pz, SEG);
    const playerY = U.interp(playerSeg.p1.world.y, playerSeg.p2.world.y, playerPct);
    let maxy = H, x = 0, dx = -(baseSeg.curve * basePct);

    drawBackground(W, H, playerY);

    for (let n = 0; n < DRAW; n++) {
      const seg = segments[(baseSeg.index + n) % segments.length];
      const looped = seg.index < baseSeg.index;
      seg.fog = U.fog(n / DRAW, FOG_DENSITY);
      seg.clip = maxy;
      project(seg.p1, player.x * ROAD_W - x, playerY + CAM_H, position - (looped ? trackLength : 0), W, H);
      project(seg.p2, player.x * ROAD_W - x - dx, playerY + CAM_H, position - (looped ? trackLength : 0), W, H);
      x += dx; dx += seg.curve;
      if (seg.p1.camera.z <= CAM_DEPTH || seg.p2.screen.y >= maxy) continue;
      if (seg.p2.screen.y >= seg.p1.screen.y) continue;
      renderSegment(W, seg);
      maxy = seg.p2.screen.y;
    }

    const t = performance.now() / 1000;
    for (let n = DRAW - 1; n > 0; n--) {
      const seg = segments[(baseSeg.index + n) % segments.length];
      if (seg.p1.camera.z <= CAM_DEPTH) continue;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, seg.clip); ctx.clip();
      const s = seg.p1.screen;
      if (seg.slickDraw && n < DRAW - 2) drawSlick(seg, W);
      if (seg.rampDraw && n < DRAW - 2) drawRamp(seg, W, H);
      for (const sp of seg.sprites) {
        const sx = s.x + s.scale * sp.offset * ROAD_W * W / 2;
        if (sp.type === 'sign') { const w = s.scale * 1500 * W / 2; if (w >= 2) drawSign(sx, s.y, w, sp.text, sp.color); continue; }
        const def = SPRITES[sp.type];
        const w = s.scale * def[0] * W / 2;
        if (w >= 1) def[1](sx, s.y, w);
      }
      for (const it of seg.items) {
        if (it.taken) continue;
        const ix = s.x + s.scale * it.offset * ROAD_W * W / 2;
        if (it.type === 'gem') { const w = s.scale * 260 * W / 2; if (w >= 1) drawGem(ix, s.y, w, t); }
        else { const w = s.scale * 300 * W / 2; if (w >= 1) drawPoop(ix, s.y, w); }
      }
      for (const car of seg.cars) {
        const p = U.pct(car.z, SEG);
        const sc = U.interp(seg.p1.screen.scale, seg.p2.screen.scale, p);
        const cx = U.interp(seg.p1.screen.x, seg.p2.screen.x, p) + sc * car.offset * ROAD_W * W / 2;
        const cy = U.interp(seg.p1.screen.y, seg.p2.screen.y, p);
        const cw = sc * KART_WORLD * W / 2;
        const lift = sc * car.jy * H / 2;
        if (car.boost > 0) drawFlames(cx, cy - lift, cw);
        drawKart(cx, cy, cw, car.color, 0, lift, car.wobble > 0 ? Math.sin(car.wobble * 18) * 0.3 : 0);
        if (cw > 30) {
          const size = Math.round(U.limit(cw * 0.16, 10, 16));
          ctx.font = `bold ${size}px ${FONT}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          const tw = ctx.measureText(car.name).width;
          const ly = cy - lift - cw * 0.82;
          if (!car.bot) {
            ctx.fillStyle = 'rgba(29, 35, 64, 0.8)';
            roundRect(cx - tw / 2 - 6, ly - size - 4, tw + 12, size + 6, 4); ctx.fill();
            ctx.fillStyle = car.color;
          } else ctx.fillStyle = track.pal.ink;
          ctx.fillText(car.name, cx, ly);
        }
      }
      ctx.restore();
    }

    // Il mio kart
    const pScale = CAM_DEPTH / PLAYER_Z;
    const camY = U.interp(playerSeg.p1.camera.y, playerSeg.p2.camera.y, playerPct);
    let py = H / 2 - pScale * camY * H / 2;
    const offroad = !player.air && (player.x < -1 || player.x > 1) && player.speed > 0;
    if (offroad || player.bump > 0) py += (Math.random() - 0.5) * 6;
    const steerVis = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
    const pw = pScale * KART_WORLD * W / 2;
    const lift = pScale * player.jy * H / 2;
    let angle = 0;
    if (player.trick) angle = Math.min(1, player.trickT / 0.45) * Math.PI * 2;
    else if (player.slip > 0) angle = Math.sin(player.spin) * 0.35;
    if (player.boost > 0) drawFlames(W / 2, py - lift, pw);
    if (player.drift.on) drawSparks(W / 2, py, pw, player.drift.time);
    drawKart(W / 2, py, pw, player.color, state === 'race' ? steerVis : 0, lift, angle);

    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 224, 102, ${flash})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawHud(W, H);

    // Malus: colori invertiti
    const filter = player.invert > 0 && (state === 'race' || state === 'finished') ? 'invert(1)' : '';
    if (canvas.style.filter !== filter) canvas.style.filter = filter;
  }

  function drawFlames(x, y, w) {
    for (const side of [-1, 1]) {
      const fx = x + side * w * 0.1, fy = y - w * 0.12;
      const len = w * (0.18 + Math.random() * 0.12);
      poly([fx - w * 0.04, fy, fx + w * 0.04, fy, fx, fy + len], '#ff7a3d');
      poly([fx - w * 0.02, fy, fx + w * 0.02, fy, fx, fy + len * 0.6], '#ffe066');
    }
  }

  function drawSparks(x, y, w, time) {
    ctx.fillStyle = time > 1.6 ? '#5cc6ff' : time > 0.7 ? '#ff9a3d' : '#d9d9d9';
    for (let i = 0; i < 10; i++) {
      const side = i % 2 ? 1 : -1;
      ctx.fillRect(x + side * w * (0.42 + Math.random() * 0.15), y - Math.random() * w * 0.12, 3, 3);
    }
  }

  // ---------- HUD ----------
  const PAPER = '#ffffff', ACCENT = '#ffcf33', MUTED = '#aab0d0', INK = '#1d2340';

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(29, 35, 64, 0.82)';
    roundRect(x, y, w, h, 8); ctx.fill();
  }

  function text(str, x, y, size, color, align, weight) {
    ctx.font = `${weight || 'bold'} ${size}px ${FONT}`;
    ctx.fillStyle = color || PAPER;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y);
  }

  const blink = () => Math.floor(performance.now() / 500) % 2 === 1;

  function drawHud(W, H) {
    const s = Math.max(0.7, Math.min(1.3, W / 1000));
    const pad = 14 * s;

    if (state === 'title') { drawTitle(W, H, s); drawToast(W, H, s); return; }
    if (state === 'lobby') { drawLobby(W, H, s); drawToast(W, H, s); return; }
    if (state === 'disconnected') { drawDisconnected(W, H, s); return; }

    const order = standings();
    const place = order.indexOf(player) + 1;

    panel(pad, pad, 210 * s, 74 * s);
    text(`Giro ${player.lap}/${LAPS}`, pad + 14 * s, pad + 30 * s, 22 * s);
    text(U.fmt(state === 'finished' ? player.finishTime : raceTime), pad + 14 * s, pad + 58 * s, 18 * s, ACCENT);

    panel(W - pad - 120 * s, pad, 120 * s, 74 * s);
    text(`${place}°`, W - pad - 60 * s, pad + 52 * s, 44 * s, place === 1 ? ACCENT : PAPER, 'center');
    text(`/${order.length}`, W - pad - 18 * s, pad + 52 * s, 16 * s, MUTED, 'right');

    drawMinimap(W - pad - 120 * s, pad + 82 * s, 120 * s);

    panel(pad, H - pad - 56 * s, 150 * s, 56 * s);
    text(`${Math.round(player.speed / MAX_SPEED * 160)}`, pad + 14 * s, H - pad - 18 * s, 30 * s, player.boost > 0 ? ACCENT : PAPER);
    text('km/h', pad + 90 * s, H - pad - 18 * s, 14 * s, MUTED, 'left', 'normal');

    panel(W - pad - 160 * s, H - pad - 56 * s, 160 * s, 56 * s);
    text('Turbo', W - pad - 146 * s, H - pad - 22 * s, 14 * s, MUTED, 'left', 'normal');
    for (let i = 0; i < 3; i++) {
      const cx = W - pad - 78 * s + i * 26 * s, cy = H - pad - 28 * s;
      poly([cx, cy - 11 * s, cx + 8 * s, cy, cx, cy + 11 * s, cx - 8 * s, cy], i < player.turbo ? ACCENT : 'rgba(255,255,255,0.15)');
    }

    if (player.lastLap && raceTime - player.lapStart < 2.5 && state === 'race') {
      text(player.lap === LAPS ? 'Ultimo giro' : `Giro ${player.lap}`, W / 2, H * 0.22, 34 * s, PAPER, 'center');
      text(`Giro precedente ${U.fmt(player.lastLap)}`, W / 2, H * 0.22 + 30 * s, 16 * s, track.night ? PAPER : INK, 'center');
    }
    if (player.air && !player.trick && state === 'race') {
      ctx.lineWidth = 4 * s; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
      ctx.font = `normal ${15 * s}px ${FONT}`; ctx.textAlign = 'center';
      ctx.strokeText('Shift in volo per un trick', W / 2, H * 0.62);
      text('Shift in volo per un trick', W / 2, H * 0.62, 15 * s, PAPER, 'center', 'normal');
    }

    if (state === 'countdown') {
      const n = Math.ceil(countdown);
      text(n > 0 ? String(n) : 'Via!', W / 2, H * 0.4, 96 * s, ACCENT, 'center');
      ctx.lineWidth = 5 * s; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
      ctx.font = `bold ${20 * s}px ${FONT}`; ctx.textAlign = 'center';
      ctx.strokeText(track.name, W / 2, H * 0.4 + 40 * s);
      text(track.name, W / 2, H * 0.4 + 40 * s, 20 * s, PAPER, 'center');
    } else if (state === 'race' && raceTime < 0.8) {
      text('Via!', W / 2, H * 0.4, 96 * s, ACCENT, 'center');
    }

    if (popup.time > 0 && state === 'race') {
      ctx.globalAlpha = Math.min(1, popup.time * 3);
      const size = (40 + (1.1 - popup.time) * 20) * s;
      ctx.lineWidth = 6 * s; ctx.strokeStyle = track.night ? '#000000' : INK; ctx.lineJoin = 'round';
      ctx.font = `bold ${size}px ${FONT}`; ctx.textAlign = 'center';
      ctx.strokeText(popup.text, W / 2, H * 0.33);
      text(popup.text, W / 2, H * 0.33, size, popup.color, 'center');
      ctx.globalAlpha = 1;
    }

    if (state === 'paused') drawPaused(W, H, s);
    if (state === 'finished' && raceTime - finishedAt > 1.2) drawResults(W, H, s, order);
    else if (state === 'finished') text('Traguardo!', W / 2, H * 0.4, 64 * s, ACCENT, 'center');
    drawToast(W, H, s);
  }

  function drawMinimap(x, y, size) {
    if (!minimap) return;
    panel(x, y, size, size);
    const pad = size * 0.12, inner = size - pad * 2;
    const px = (i) => x + pad + (minimap[i][0] + 0.5) * inner;
    const pyy = (i) => y + pad + (minimap[i][1] + 0.5) * inner;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(2, size * 0.035);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < minimap.length; i += 4) { if (i === 0) ctx.moveTo(px(i), pyy(i)); else ctx.lineTo(px(i), pyy(i)); }
    ctx.closePath();
    ctx.stroke();
    const ls = findSegment(lineZ).index;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px(ls) - 3, pyy(ls) - 3, 6, 6);
    const dot = (z, color, r) => {
      const i = Math.floor(z / SEG) % minimap.length;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(px(i), pyy(i), r, 0, Math.PI * 2); ctx.fill();
    };
    for (const c of cars) dot(c.z, c.color, size * 0.035);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    dot(U.inc(position, PLAYER_Z, trackLength), player.color, size * 0.055);
    ctx.beginPath();
    const pi = Math.floor(U.inc(position, PLAYER_Z, trackLength) / SEG) % minimap.length;
    ctx.arc(px(pi), pyy(pi), size * 0.055, 0, Math.PI * 2); ctx.stroke();
  }

  function shade(W, H, a) {
    ctx.fillStyle = `rgba(29, 35, 64, ${a})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Selettore di pista: frecce ai lati del nome, descrizione e record sotto
  function drawTrackPicker(W, y, s, canChange) {
    const i = TRACKS.indexOf(track);
    text(`Pista ${i + 1} di ${TRACKS.length}`, W / 2, y, 14 * s, MUTED, 'center', 'normal');
    text(track.name, W / 2, y + 34 * s, 30 * s, ACCENT, 'center');
    if (canChange) {
      ctx.font = `bold ${30 * s}px ${FONT}`;
      const tw = ctx.measureText(track.name).width;
      text('‹', W / 2 - tw / 2 - 28 * s, y + 34 * s, 34 * s, PAPER, 'center');
      text('›', W / 2 + tw / 2 + 28 * s, y + 34 * s, 34 * s, PAPER, 'center');
    }
    text(track.desc, W / 2, y + 58 * s, 15 * s, PAPER, 'center', 'normal');
    const best = bestTimes[track.id];
    const hint = canChange ? '← → per cambiare pista' : 'La pista la sceglie l\'host';
    text(best && mode === 'solo' ? `${hint}   Record: ${U.fmt(best)}` : hint, W / 2, y + 80 * s, 13 * s, MUTED, 'center', 'normal');
  }

  function drawTitle(W, H, s) {
    shade(W, H, 0.7);
    text('Codekart', W / 2, H * 0.16, 72 * s, PAPER, 'center');
    text('3 giri, 5 piloti, nessun merge conflict.', W / 2, H * 0.16 + 32 * s, 17 * s, ACCENT, 'center', 'normal');
    const lines = [
      ['↑ ↓ / W S', 'accelera e frena'],
      ['← → / A D', 'sterza'],
      ['Shift', 'derapata in curva, trick in volo'],
      ['Spazio', 'usa un turbo'],
      ['P / M', 'pausa / audio ' + (muted ? 'spento' : 'acceso')]
    ];
    const x0 = W / 2 - 190 * s;
    lines.forEach((l, i) => {
      const y = H * 0.16 + 70 * s + i * 23 * s;
      text(l[0], x0, y, 14 * s, ACCENT);
      text(l[1], x0 + 130 * s, y, 14 * s, PAPER, 'left', 'normal');
    });
    text('Gemme gialle: turbo.   Cacche: colori invertiti.   Rampe: salti.', W / 2, H * 0.16 + 70 * s + lines.length * 23 * s + 8 * s, 13 * s, MUTED, 'center', 'normal');
    drawTrackPicker(W, H * 0.66, s, true);
    if (blink()) text('Premi Invio per partire', W / 2, H * 0.94, 20 * s, PAPER, 'center');
  }

  function drawLobby(W, H, s) {
    shade(W, H, 0.8);
    const host = mode === 'host';
    text(host ? 'La tua gara in LAN' : 'Sei in gara', W / 2, H * 0.1, 34 * s, PAPER, 'center');
    text(inviteCode, W / 2, H * 0.1 + 42 * s, 36 * s, ACCENT, 'center');
    text('C copia l\'invito da mandare ai colleghi', W / 2, H * 0.1 + 66 * s, 14 * s, PAPER, 'center', 'normal');

    const listY = H * 0.1 + 104 * s;
    const bots = Math.max(0, GRID_SIZE - roster.length);
    const rowH = 26 * s, colW = 280 * s;
    roster.forEach((p, i) => {
      const y = listY + i * rowH;
      const x = W / 2 - colW / 2;
      ctx.fillStyle = p.color;
      roundRect(x, y - 15 * s, 16 * s, 16 * s, 4 * s); ctx.fill();
      text(p.name, x + 28 * s, y, 16 * s, p.id === myId ? ACCENT : PAPER);
      const tag = [p.id === 0 ? 'host' : '', p.id === myId ? 'tu' : ''].filter(Boolean).join(', ');
      if (tag) text(tag, x + colW, y, 13 * s, MUTED, 'right', 'normal');
    });
    if (bots > 0) text(`+ ${bots} ${bots === 1 ? 'pilota CPU' : 'piloti CPU'}`, W / 2, listY + roster.length * rowH + 4 * s, 13 * s, MUTED, 'center', 'normal');

    drawTrackPicker(W, H * 0.68, s, host);
    if (host) {
      if (blink()) text('Premi Invio per partire', W / 2, H * 0.94, 20 * s, PAPER, 'center');
    } else {
      text('In attesa che l\'host faccia partire la gara', W / 2, H * 0.94, 18 * s, PAPER, 'center', 'normal');
    }
  }

  function drawDisconnected(W, H, s) {
    shade(W, H, 0.82);
    text('Gara interrotta', W / 2, H * 0.42, 48 * s, PAPER, 'center');
    text('L\'host ha chiuso la gara o la rete non è più raggiungibile.', W / 2, H * 0.42 + 36 * s, 16 * s, ACCENT, 'center', 'normal');
    text('Premi Invio per giocare da solo', W / 2, H * 0.42 + 70 * s, 16 * s, PAPER, 'center', 'normal');
  }

  function drawPaused(W, H, s) {
    shade(W, H, 0.6);
    text('In pausa', W / 2, H * 0.45, 56 * s, PAPER, 'center');
    text('P per riprendere, Esc per tornare al menu', W / 2, H * 0.45 + 34 * s, 16 * s, ACCENT, 'center', 'normal');
  }

  function drawResults(W, H, s, order) {
    const w = 400 * s, h = (110 + order.length * 34) * s, x = W / 2 - w / 2, y = H / 2 - h / 2;
    panel(x, y, w, h);
    const place = order.indexOf(player) + 1;
    text(place === 1 ? 'Hai vinto' : `Arrivato ${place}°`, W / 2, y + 42 * s, 30 * s, place === 1 ? ACCENT : PAPER, 'center');
    order.forEach((r, i) => {
      const ry = y + (80 + i * 34) * s;
      ctx.fillStyle = r.color;
      ctx.fillRect(x + 24 * s, ry - 14 * s, 10 * s, 18 * s);
      text(`${i + 1}°  ${r.name}`, x + 46 * s, ry, 17 * s, r === player ? ACCENT : PAPER);
      text(r.finished ? U.fmt(r.finishTime) : 'in gara', x + w - 24 * s, ry, 15 * s, MUTED, 'right', 'normal');
    });
    const hint = mode === 'client' ? 'In attesa dell\'host' : mode === 'host' ? 'Invio per tornare alla lobby' : 'Invio per tornare al menu';
    text(hint, W / 2, y + h - 18 * s, 15 * s, PAPER, 'center', 'normal');
  }

  function drawToast(W, H, s) {
    if (toast.time <= 0) return;
    ctx.globalAlpha = Math.min(1, toast.time * 2);
    ctx.font = `bold ${16 * s}px ${FONT}`;
    const tw = ctx.measureText(toast.text).width + 32 * s;
    panel(W / 2 - tw / 2, H * 0.78, tw, 40 * s);
    text(toast.text, W / 2, H * 0.78 + 26 * s, 16 * s, ACCENT, 'center');
    ctx.globalAlpha = 1;
  }

  // ---------- Input ----------
  const MAP = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ShiftLeft: 'drift', ShiftRight: 'drift'
  };

  window.addEventListener('keydown', (e) => {
    Sound.init();
    const menu = state === 'title' || (state === 'lobby' && mode === 'host');
    if (menu && !e.repeat && (e.code === 'ArrowLeft' || e.code === 'KeyA')) { cycleTrack(-1); e.preventDefault(); return; }
    if (menu && !e.repeat && (e.code === 'ArrowRight' || e.code === 'KeyD')) { cycleTrack(1); e.preventDefault(); return; }

    if (MAP[e.code]) { keys[MAP[e.code]] = true; e.preventDefault(); }
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && state === 'race' && player.air && !player.trick && player.vy > -400) {
      player.trick = true; player.trickT = 0;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (state === 'race' && player.turbo > 0 && player.boost <= 0) { player.turbo--; boostPlayer(1.6); }
    }
    if (e.code === 'Enter' && !e.repeat) {
      if (state === 'title') startFromHere();
      else if (state === 'lobby' && mode === 'host') startFromHere();
      else if (state === 'finished' && raceTime - finishedAt > 1.2 && mode !== 'client') backToMenu();
      else if (state === 'disconnected') { mode = 'solo'; myId = 0; myName = 'Tu'; myColor = '#ff4757'; clearWorld(); state = 'title'; }
    }
    if (e.code === 'KeyC' && online() && (state === 'lobby' || state === 'finished') && vscodeApi) {
      vscodeApi.postMessage({ type: 'copyInvite' });
    }
    if (e.code === 'KeyM' && !e.repeat) {
      muted = !muted;
      Sound.updateVolume();
      persist();
      showToast(muted ? 'Audio spento' : 'Audio acceso');
    }
    if (e.code === 'KeyP') {
      if (online() && state === 'race') showToast('Online la gara non si può mettere in pausa');
      else if (state === 'race') state = 'paused';
      else if (state === 'paused') state = 'race';
    }
    if (e.code === 'Escape' && state === 'paused') { clearWorld(); state = 'title'; }
  });
  window.addEventListener('keyup', (e) => { if (MAP[e.code]) keys[MAP[e.code]] = false; });
  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    if (state === 'race' && !online()) state = 'paused';
  });
  document.addEventListener('visibilitychange', () => Sound.updateVolume());
  canvas.addEventListener('mousedown', () => { canvas.focus(); Sound.init(); });

  // ---------- Loop ----------
  function resize() {
    canvas.width = Math.max(320, window.innerWidth);
    canvas.height = Math.max(240, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  buildTrack();
  clearWorld();
  resize();
  canvas.focus();

  let last = performance.now(), acc = 0;
  function frame(now) {
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (vscodeApi) vscodeApi.postMessage({ type: 'ready' });
})();
