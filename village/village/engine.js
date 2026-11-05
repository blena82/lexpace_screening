// LexPace village: pixel-art world, player movement, minimap and scene switching.
// Presentation only. It never sees answer keys and never calls the screening API; the page's
// station code (copied from the classic journey page) does that, unchanged.
(function () {
  'use strict';

  const T = 16, VW = 384, VH = 224, W = 46, H = 30;
  const GRASS = 0, PATH = 1, WATER = 2, TREE = 3, BUILDING = 4, FLOWER = 6, STONE = 7;
  const SOLID = new Set([WATER, TREE, BUILDING]);
  const SPEED = 82; // px per second

  // The page's <html lang> picks the language of the village texts (the station texts come from the page).
  const AR = document.documentElement.lang === 'ar';
  const TXT = AR ? {
    names: ['المكتبة', 'مختبر الأصوات', 'ورشة الحروف', 'بيت القصص', 'بيت الألغاز', 'متجر القرية', 'موقع البناء', 'دار البلدية'],
    games: ['سباق الكلمات', 'مختبر الأصوات', 'بنّاء الصدى', 'صانع القصص', 'البحث عن الأدلة', 'سباق الأرقام', 'مدينة المنطق', 'تاريخ التعلّم'],
    domains: ['القراءة', 'القراءة', 'الكتابة', 'الكتابة', 'القراءة', 'الرياضيات', 'الرياضيات', 'الخلفية'],
    next: (h) => `المحطة التالية: <b>${h.icon} ${h.name}</b> · ${h.game}`, allDone: 'اكتملت القرية · أنهيت جميع المحطات', title: 'قرية LexPace',
    enter: (h) => `<kbd>E</kbd> ادخل ${h.name}`, doneHouse: (h) => `${h.name} · مكتملة ✓`, lockedHouse: (h) => `${h.name} · مغلقة`,
    locked: (h) => `مغلقة الآن. المحطة التالية: ${h ? h.name : 'المحطة التالية'}.`, finished: (h) => `${h.game} مكتملة.`,
  } : {
    names: ['Library', 'Sound Lab', 'Letter Workshop', 'Story House', 'Mystery House', 'Village Shop', 'Construction Site', 'Town Hall'],
    games: ['Word Rush', 'Sound Lab', 'Echo Builder', 'Story Forge', 'Clue Hunt', 'Number Dash', 'Logic City', 'Learning history'],
    domains: ['reading', 'reading', 'writing', 'writing', 'reading', 'mathematics', 'mathematics', 'background'],
    next: (h) => `Next stop: <b>${h.icon} ${h.name}</b> · ${h.game}`, allDone: 'Village restored · all stations complete', title: 'LEXPACE VILLAGE',
    enter: (h) => `<kbd>E</kbd> Enter the ${h.name}`, doneHouse: (h) => `${h.name} · complete ✓`, lockedHouse: (h) => `${h.name} · locked`,
    locked: (h) => `Locked for now. Next stop: the ${h ? h.name : 'next station'}.`, finished: (h) => `${h.game} is complete.`,
  };

  // One house per station, in the original station order (stage numbers of the journey page).
  // The order is kept: the comprehension passage level depends on the earlier reading stations.
  const HOUSES = [
    { id: 'library', stage: 2, icon: '📚', x: 3, y: 2, w: 8, h: 6, color: '#5c85b7' },
    { id: 'sound', stage: 3, icon: '🎧', x: 14, y: 3, w: 7, h: 5, color: '#a07db4' },
    { id: 'workshop', stage: 4, icon: '🔤', x: 25, y: 3, w: 7, h: 5, color: '#b77f5b' },
    { id: 'story', stage: 5, icon: '✍️', x: 36, y: 2, w: 7, h: 6, color: '#b67b90' },
    { id: 'mystery', stage: 6, icon: '🔎', x: 36, y: 18, w: 7, h: 6, color: '#658e8b' },
    { id: 'shop', stage: 7, icon: '🔢', x: 25, y: 19, w: 7, h: 5, color: '#c49c56' },
    { id: 'site', stage: 8, icon: '🧩', x: 13, y: 18, w: 8, h: 6, color: '#7d9d69', site: true },
    { id: 'hall', stage: 9, icon: '📜', x: 2, y: 18, w: 8, h: 6, color: '#5b7d78' },
  ];
  HOUSES.forEach((h, i) => { h.name = TXT.names[i]; h.game = TXT.games[i]; h.domain = TXT.domains[i]; });
  HOUSES.forEach((h) => { h.door = { x: h.x + (h.w >> 1), y: h.y + h.h - 1 }; });

  // ---------------------------------------------------------------- map

  const map = new Uint8Array(W * H);
  const tileAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? TREE : map[y * W + x]);
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) map[y * W + x] = v; };
  const fill = (x, y, w, h, v) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, v); };
  const hash = (x, y) => { let n = (x * 374761393 + y * 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };

  function buildMap() {
    fill(0, 0, W, H, GRASS);
    for (let x = 0; x < W; x++) { set(x, 0, TREE); set(x, H - 1, TREE); }
    for (let y = 0; y < H; y++) { set(0, y, TREE); set(W - 1, y, TREE); }
    fill(1, 8, W - 2, 2, PATH); fill(1, 24, W - 2, 2, PATH);
    fill(11, 8, 2, 18, PATH); fill(22, 8, 2, 18, PATH); fill(33, 8, 2, 18, PATH);
    fill(18, 12, 10, 6, STONE); fill(21, 13, 4, 3, WATER); // plaza with a pond
    fill(37, 12, 6, 4, WATER); fill(38, 11, 4, 1, WATER); fill(38, 16, 4, 1, WATER);
    [[3, 12], [5, 14], [7, 11], [4, 16], [8, 16], [2, 14], [15, 11], [16, 15], [14, 17], [29, 11], [31, 14], [28, 17], [30, 16],
     [36, 11], [44, 13], [36, 16], [43, 17], [12, 2], [12, 5], [23, 2], [23, 5], [33, 3], [34, 6], [44, 3], [44, 6],
     [3, 27], [9, 27], [17, 27], [28, 27], [39, 27], [43, 27], [1, 27], [20, 27], [35, 27]].forEach(([x, y]) => set(x, y, TREE));
    [[4, 10], [5, 10], [8, 10], [17, 10], [18, 10], [26, 10], [27, 10], [30, 10], [38, 10], [40, 10], [4, 26], [5, 26],
     [14, 26], [15, 26], [27, 26], [40, 26], [41, 26], [6, 13], [26, 11], [19, 11], [10, 15], [35, 14]].forEach(([x, y]) => { if (tileAt(x, y) === GRASS) set(x, y, FLOWER); });
    HOUSES.forEach((h) => fill(h.x, h.y, h.w, h.h, BUILDING));
  }

  // ---------------------------------------------------------------- drawing helpers

  const rect = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  const font = (o) => `${o.bold === false ? '' : 'bold '}${o.size || 6}px ${AR ? 'Tahoma, Arial, "Noto Sans Arabic", sans-serif' : 'ui-monospace, Menlo, Consolas, monospace'}`;
  const measure = (c, s, size) => { c.font = font({ size }); return c.measureText(s).width; };
  function text(c, s, x, y, o = {}) {
    c.font = font(o); c.direction = AR ? 'rtl' : 'ltr';
    c.textAlign = o.align || 'center'; c.textBaseline = 'middle';
    if (o.shadow) { c.fillStyle = o.shadow; c.fillText(s, x + 0.5, y + 0.6); }
    c.fillStyle = o.color || '#fff7d8'; c.fillText(s, x, y);
  }
  function plaque(c, x, y, w, h, s, size) {
    rect(c, x, y, w, h, '#604e48'); rect(c, x, y + h - 1, w, 1, '#4a3c37');
    text(c, s, x + w / 2, y + h / 2 + 0.5, { size: size || 5.5 });
  }

  function drawTile(c, tx, ty) {
    const x = tx * T, y = ty * T, v = tileAt(tx, ty), r = hash(tx, ty);
    if (v === PATH) {
      rect(c, x, y, T, T, '#d8be90');
      rect(c, x + 2 + ((r * 9) | 0), y + 4, 4, 2, '#c4aa7e'); rect(c, x + 10, y + 11 - ((r * 5) | 0), 3, 2, '#ebd5ac');
    } else if (v === STONE) {
      rect(c, x, y, T, T, (tx + ty) % 2 ? '#e6d3a8' : '#dfcb9d');
      rect(c, x, y + T - 1, T, 1, '#cdb88a'); rect(c, x + T - 1, y, 1, T, '#cdb88a');
    } else if (v === WATER) {
      rect(c, x, y, T, T, '#cae8e9');
      const shore = (dx, dy) => tileAt(tx + dx, ty + dy) !== WATER;
      if (shore(0, -1)) rect(c, x, y, T, 3, '#a1c9d6');
      if (shore(0, 1)) rect(c, x, y + T - 3, T, 3, '#a1c9d6');
      if (shore(-1, 0)) rect(c, x, y, 3, T, '#a1c9d6');
      if (shore(1, 0)) rect(c, x + T - 3, y, 3, T, '#a1c9d6');
      rect(c, x + 3 + ((r * 7) | 0), y + 6, 4, 1, '#ffffff');
    } else {
      rect(c, x, y, T, T, (tx * 11 + ty * 7) % 13 === 0 ? '#91c989' : '#80b97d');
      rect(c, x + 2, y + 3, 2, 2, '#6eaa6d'); rect(c, x + 10 + ((r * 4) | 0), y + 10, 2, 1, '#6eaa6d');
      if (v === FLOWER) { rect(c, x + 8, y + 6, 3, 3, '#f5cbd7'); rect(c, x + 9, y + 5, 2, 2, '#ffe8a4'); rect(c, x + 3, y + 11, 3, 3, '#f5cbd7'); }
    }
  }
  function drawTree(c, tx, ty) {
    const x = tx * T, y = ty * T;
    rect(c, x + 6, y + 6, 4, 9, '#6e5844');
    rect(c, x, y - 3, 16, 14, '#478b64'); rect(c, x + 2, y - 6, 12, 11, '#62a574');
  }
  function drawHouse(c, h) {
    if (h.site) return drawSite(c, h);
    const X = h.x * T, Y = h.y * T, w = h.w * T, hh = h.h * T;
    rect(c, X - 3, Y + 8, w + 6, hh - 6, '#648c70');
    rect(c, X, Y + 8, w, hh - 8, '#f7dcb1'); rect(c, X + 4, Y + 13, w - 8, hh - 22, '#fbe8c7');
    rect(c, X - 4, Y + 1, w + 8, 13, '#425867'); rect(c, X - 2, Y - 2, w + 4, 12, h.color);
    for (let i = 0; i < w; i += 18) rect(c, X + i + 2, Y + 2, 9, 2, 'rgba(255,255,255,.27)');
    const ww = 16, wy = Y + hh - 34;
    [X + 7, X + w - 7 - ww].forEach((wx) => { rect(c, wx, wy, ww, ww, '#83b9c6'); rect(c, wx + 3, wy + 3, ww - 6, ww - 6, '#cbe6e8'); });
    const pw = Math.min(w - 10, measure(c, h.name.toUpperCase(), 5.5) + 10);
    plaque(c, X + (w - pw) / 2, Y + 12, pw, 10, h.name.toUpperCase());
    const dx = h.door.x * T - 1;
    rect(c, dx, Y + hh - 26, 18, 26, '#775b4e'); rect(c, dx + 3, Y + hh - 22, 12, 22, '#483d43');
  }
  function drawSite(c, h) {
    const x = h.x * T, y = h.y * T, w = h.w * T, hh = h.h * T;
    rect(c, x, y, w, hh, '#d8be90');
    c.fillStyle = '#c4aa7e';
    for (let k = 0; k < 30; k++) c.fillRect(x + ((hash(k, 3) * w) | 0), y + ((hash(3, k) * hh) | 0), 3, 2);
    const bx = x + 12, by = y + 10;
    for (let i = 0; i < 4; i++) rect(c, bx + i * 22, by, 3, 52, '#c49c56');
    for (let j = 0; j < 3; j++) rect(c, bx, by + j * 20, 69, 3, '#7d9d69');
    rect(c, x + w - 18, y + 4, 4, 60, '#f6d17a'); rect(c, x + w - 54, y + 4, 44, 3, '#f6d17a'); rect(c, x + w - 50, y + 7, 1, 16, '#26394a'); rect(c, x + w - 53, y + 22, 7, 5, '#5b7d78');
    for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) rect(c, x + 14 + j * 7 - i * 3, y + hh - 24 + i * 5, 6, 4, '#b77f5b');
    const gx = h.door.x * T;
    c.fillStyle = '#6e5844';
    for (let i = x; i < x + w; i += 6) { if (i >= gx - 2 && i < gx + 16) continue; c.fillRect(i, y + hh - 8, 2, 8); }
    for (const fy of [y + hh - 7, y + hh - 3]) { c.fillRect(x, fy, gx - x - 2, 1); c.fillRect(gx + 16, fy, x + w - gx - 16, 1); }
    for (let i = y; i < y + hh; i += 6) { c.fillRect(x, i, 2, 5); c.fillRect(x + w - 2, i, 2, 5); }
    const pw = measure(c, h.name.toUpperCase(), 5.5) + 12;
    plaque(c, x + (w - pw) / 2, y + hh - 36, pw, 10, h.name.toUpperCase());
  }

  // feet at (x, y); dir: 0 down, 1 up, 2 left, 3 right. Colours follow the village reference avatar.
  function drawPerson(c, x, y, dir, step, carry) {
    x = Math.round(x) - 5; y = Math.round(y) - 17;
    rect(c, x + 1, y + 15, 9, 3, 'rgba(0,0,0,.18)');
    const a = step === 1 ? 1 : 0, b = step === 2 ? 1 : 0;
    rect(c, x + 2, y + 11, 3, 5 - a, '#31465b'); rect(c, x + 6, y + 11, 3, 5 - b, '#31465b');
    rect(c, x + 1, y + 6, 9, 6, '#567aab');
    if (carry) { rect(c, x - 1, y + 3, 2, 5, '#efbb94'); rect(c, x + 10, y + 3, 2, 5, '#efbb94'); }
    else { rect(c, x - 1, y + 7 + b, 2, 5, '#efbb94'); rect(c, x + 10, y + 7 + a, 2, 5, '#efbb94'); }
    rect(c, x + 2, y, 7, 7, '#efbb94');
    rect(c, x + 1, y - 1, 9, 3, '#55483f');
    if (dir === 1) rect(c, x + 2, y + 1, 7, 5, '#55483f');
    else if (dir === 2) { rect(c, x + 7, y + 1, 3, 4, '#55483f'); rect(c, x + 3, y + 3, 1, 2, '#253b47'); }
    else if (dir === 3) { rect(c, x + 1, y + 1, 3, 4, '#55483f'); rect(c, x + 7, y + 3, 1, 2, '#253b47'); }
    else { rect(c, x + 4, y + 3, 1, 2, '#253b47'); rect(c, x + 7, y + 3, 1, 2, '#253b47'); }
    if (carry) carry(c, x + 5, y - 3);
  }

  // ---------------------------------------------------------------- engine state

  let canvas, ctx, S = 3, mini, mctx, staticLayer = null, opts = {}, scene = null, lastT = 0, fading = false;
  const keys = new Set();
  const player = { x: 22.9 * T, y: 18.6 * T, dir: 0, moving: false, path: null, autoEnter: null };
  const gameplay = []; // separate gameplay event log (never sent to the scoring API)
  const $ = (id) => document.getElementById(id);

  function log(type, data) { gameplay.push({ t_ms: Math.round(performance.now()), type, ...data }); }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const want = Math.max(2, Math.min(5, Math.round((r.width * (window.devicePixelRatio || 1)) / VW)));
    if (want === S && canvas.width === VW * S) return;
    S = want; canvas.width = VW * S; canvas.height = VH * S; staticLayer = null;
  }

  function buildStatic() {
    const cv = document.createElement('canvas');
    cv.width = W * T * S; cv.height = H * T * S;
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false; c.setTransform(S, 0, 0, S, 0, 0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) drawTile(c, x, y);
    HOUSES.forEach((h) => drawHouse(c, h));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (tileAt(x, y) === TREE) drawTree(c, x, y);
    staticLayer = cv;
  }

  const stage = () => opts.getStage();
  const houseState = (h) => (stage() > h.stage ? 'done' : stage() === h.stage ? 'current' : 'locked');
  const currentHouse = () => HOUSES.find((h) => h.stage === stage());

  // ---------------------------------------------------------------- HUD

  let lastHud = '';
  function setObjective() {
    const h = currentHouse();
    let msg;
    if (scene && scene.objective) msg = scene.objective();
    else if (h) msg = TXT.next(h);
    else if (stage() >= 10) msg = TXT.allDone;
    else msg = TXT.title;
    $('hud-objective').innerHTML = msg;
    const key = stage() + '|' + (scene && scene.house ? scene.house.id : '');
    if (key !== lastHud) { lastHud = key; if (opts.onChange) opts.onChange(); }
  }
  function setPrompt(html) { const p = $('hud-prompt'); if (p.innerHTML !== (html || '')) p.innerHTML = html || ''; p.hidden = !html; }
  let toastTimer = 0;
  function toast(msg) { const t = $('hud-toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600); }

  function drawMinimap(time) {
    const k = 4;
    if (mini.width !== W * k) { mini.width = W * k; mini.height = H * k; }
    const colors = { [GRASS]: '#8cc18a', [FLOWER]: '#8cc18a', [PATH]: '#e9d6a4', [WATER]: '#a1c9d6', [TREE]: '#62a574', [STONE]: '#e9d6a4', [BUILDING]: '#8cc18a' };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { mctx.fillStyle = colors[tileAt(x, y)]; mctx.fillRect(x * k, y * k, k, k); }
    mctx.font = 'bold 11px sans-serif'; mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
    HOUSES.forEach((h, i) => {
      const st = houseState(h);
      mctx.fillStyle = st === 'done' ? '#4b8e5e' : st === 'current' ? h.color : '#b7c2b5';
      mctx.fillRect(h.x * k, h.y * k, h.w * k, h.h * k);
      if (st === 'current' && Math.floor(time * 3) % 2) { mctx.strokeStyle = '#fffbdd'; mctx.lineWidth = 2; mctx.strokeRect(h.x * k - 1, h.y * k - 1, h.w * k + 2, h.h * k + 2); }
      mctx.fillStyle = '#fff'; mctx.fillText(st === 'done' ? '✓' : i < 7 ? String(i + 1) : '★', (h.x + h.w / 2) * k, (h.y + h.h / 2) * k);
    });
    const inside = scene && scene.house;
    const p = inside ? { x: (inside.door.x + 0.5) * T, y: (inside.door.y + 1) * T } : player;
    mctx.fillStyle = '#fffbdd'; mctx.beginPath(); mctx.arc((p.x / T) * k, (p.y / T) * k, 5, 0, Math.PI * 2); mctx.fill();
    mctx.strokeStyle = '#294a57'; mctx.lineWidth = 2; mctx.stroke();
  }

  // ---------------------------------------------------------------- movement

  function moveBody(p, dx, dy, solid) {
    const blocked = (x, y) => solid(x - 4, y - 3) || solid(x + 4, y - 3) || solid(x - 4, y) || solid(x + 4, y);
    let moved = false;
    if (dx && !blocked(p.x + dx, p.y)) { p.x += dx; moved = true; }
    if (dy && !blocked(p.x, p.y + dy)) { p.y += dy; moved = true; }
    return moved;
  }
  function keyDir() {
    let dx = 0, dy = 0;
    if (keys.has('ArrowLeft') || keys.has('a')) dx -= 1;
    if (keys.has('ArrowRight') || keys.has('d')) dx += 1;
    if (keys.has('ArrowUp') || keys.has('w')) dy -= 1;
    if (keys.has('ArrowDown') || keys.has('s')) dy += 1;
    return [dx, dy];
  }
  // shared by every scene: keyboard / d-pad movement, or follow a click path
  function stepPlayer(p, dt, solid) {
    let [dx, dy] = keyDir();
    if (dx || dy) p.path = null;
    else if (p.path && p.path.length) {
      const wp = p.path[0], ex = wp.x - p.x, ey = wp.y - p.y, d = Math.hypot(ex, ey);
      if (d < 2) { p.path.shift(); if (!p.path.length) p.path = null; }
      else { dx = ex / d; dy = ey / d; }
    }
    if (!dx && !dy) { p.moving = false; return; }
    const n = Math.hypot(dx, dy), v = SPEED * dt;
    p.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : dy < 0 ? 1 : 0;
    p.moving = moveBody(p, (dx / n) * v, (dy / n) * v, solid);
    if (!p.moving && p.path) p.path = null;
  }
  const villageSolid = (x, y) => SOLID.has(tileAt(Math.floor(x / T), Math.floor(y / T)));

  function findPath(fromX, fromY, toTx, toTy) {
    const sx = Math.floor(fromX / T), sy = Math.floor(fromY / T);
    if (SOLID.has(tileAt(toTx, toTy))) return null;
    const prev = new Int32Array(W * H).fill(-1), q = [sy * W + sx];
    prev[sy * W + sx] = sy * W + sx;
    while (q.length) {
      const cur = q.shift(), cx = cur % W, cy = (cur / W) | 0;
      if (cx === toTx && cy === toTy) break;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ox, ny = cy + oy, ni = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || prev[ni] !== -1 || SOLID.has(tileAt(nx, ny))) continue;
        prev[ni] = cur; q.push(ni);
      }
    }
    let i = toTy * W + toTx;
    if (prev[i] === -1) return null;
    const out = [];
    while (prev[i] !== i) { out.push({ x: (i % W) * T + T / 2, y: ((i / W) | 0) * T + T / 2 + 3 }); i = prev[i]; }
    return out.reverse();
  }

  // ---------------------------------------------------------------- village scene

  const doorFront = (h) => ({ x: (h.door.x + 0.5) * T, y: (h.door.y + 1) * T + 6 });
  function nearHouse() {
    return HOUSES.find((h) => { const f = doorFront(h); return Math.abs(player.x - f.x) < 12 && Math.abs(player.y - f.y) < 10; });
  }
  function tryEnter(h) {
    if (stage() < 2) return;
    const st = houseState(h);
    if (st === 'locked') { toast(TXT.locked(currentHouse())); log('locked_door', { house: h.id }); return; }
    if (st === 'done') { toast(TXT.finished(h)); return; }
    enterHouse(h);
  }

  const village = {
    camX: 0, camY: 0,
    enter() { setPrompt(''); },
    update(dt) {
      if (opts.panelOpen()) { player.moving = false; return; }
      stepPlayer(player, dt, villageSolid);
      const h = nearHouse();
      if (h && player.autoEnter === h && !player.path) { player.autoEnter = null; tryEnter(h); return; }
      setPrompt(h ? (houseState(h) === 'current' ? TXT.enter(h) : houseState(h) === 'done' ? TXT.doneHouse(h) : TXT.lockedHouse(h)) : '');
    },
    draw(c, time) {
      this.camX = Math.max(0, Math.min(W * T - VW, Math.round(player.x - VW / 2)));
      this.camY = Math.max(0, Math.min(H * T - VH, Math.round(player.y - VH / 2)));
      if (!staticLayer) buildStatic();
      c.drawImage(staticLayer, this.camX * S, this.camY * S, VW * S, VH * S, 0, 0, VW, VH);
      c.save(); c.translate(-this.camX, -this.camY);
      HOUSES.forEach((h) => {
        const st = houseState(h), dx = h.door.x * T + 8, dy = h.door.y * T;
        if (st === 'locked') {
          rect(c, h.x * T - 4, h.y * T - 2, h.w * T + 8, h.h * T + 2, 'rgba(60,80,90,.18)');
          rect(c, dx - 3, dy + 6, 6, 5, '#f6d17a'); c.strokeStyle = '#f6d17a'; c.lineWidth = 1; c.strokeRect(dx - 1.5, dy + 3.5, 3, 3);
        } else if (st === 'current') {
          const b = Math.round(Math.sin(time * 5) * 2);
          c.fillStyle = 'rgba(255,240,170,.35)'; c.fillRect(dx - 9, dy - 9, 18, 25);
          c.fillStyle = '#f6d17a'; c.beginPath(); c.moveTo(dx - 6, dy - 22 + b); c.lineTo(dx + 6, dy - 22 + b); c.lineTo(dx, dy - 14 + b); c.fill();
          c.strokeStyle = '#775b4e'; c.lineWidth = 1; c.stroke();
        } else {
          const fx = h.x * T + h.w * T - 14, fy = h.y * T - 8;
          rect(c, fx, fy, 12, 12, '#fff2b8'); text(c, '✓', fx + 6, fy + 6.5, { size: 8, color: '#4b8e5e' });
        }
      });
      drawPerson(c, player.x, player.y, player.dir, player.moving ? 1 + (Math.floor(time * 8) % 2) : 0);
      if (player.path && player.path.length) { const t = player.path[player.path.length - 1]; c.strokeStyle = 'rgba(255,255,255,.8)'; c.strokeRect(t.x - 5.5, t.y - 7.5, 11, 9); }
      c.restore();
    },
    key(e) {
      if (['e', 'Enter', ' '].includes(e.key)) { const h = nearHouse(); if (h) { tryEnter(h); return true; } }
      return false;
    },
    click(x, y) {
      const wx = x + this.camX, wy = y + this.camY;
      const h = HOUSES.find((h) => wx >= h.x * T && wx < (h.x + h.w) * T && wy >= h.y * T - 6 && wy < (h.y + h.h) * T);
      if (h) {
        if (nearHouse() === h) { tryEnter(h); return; }
        player.path = findPath(player.x, player.y - 3, h.door.x, h.door.y + 1); player.autoEnter = h;
        if (player.path) player.path.push(doorFront(h));
        return;
      }
      player.autoEnter = null;
      player.path = findPath(player.x, player.y - 3, Math.floor(wx / T), Math.floor(wy / T));
    },
  };

  // ---------------------------------------------------------------- generic interior
  // For stations that do not have their own game scene yet: a themed room, and the station's
  // original activity screen opens on arrival (the classic UI, unchanged).

  function GenericInterior(h) {
    return {
      house: h,
      objective: () => `<b>${h.icon} ${h.game}</b> · ${h.name}`,
      enter() { setPrompt(''); opts.openPanel(h); },
      update() {},
      draw(c) {
        rect(c, 0, 0, VW, VH, '#b89470');
        for (let y = 0; y < VH; y += 16) for (let x = 0; x < VW; x += 16) { rect(c, x, y, 15, 15, (x + y) % 32 ? '#c4a17b' : '#bb9670'); rect(c, x + 1, y + 14, 13, 1, '#ae8867'); }
        rect(c, 0, 0, VW, 40, '#6b5346'); rect(c, 0, 36, VW, 4, h.color);
        rect(c, 150, 100, 84, 36, '#896b52'); rect(c, 154, 103, 76, 28, '#d5b583');
        const pw = measure(c, h.game.toUpperCase(), 7) + 20;
        plaque(c, (VW - pw) / 2, 12, pw, 14, h.game.toUpperCase(), 7);
        drawPerson(c, VW / 2, 176, 1, 0);
      },
      key() { return false; },
      click() {},
    };
  }

  // ---------------------------------------------------------------- scenes and transitions

  const interiors = {};
  function fadeTo(next, after) {
    if (fading) return;
    fading = true;
    const f = $('fade'); f.classList.add('on');
    setTimeout(() => {
      if (scene && scene.leave) scene.leave();
      scene = next; fading = false; f.classList.remove('on');
      scene.enter(); setObjective();
      if (after) after();
    }, 260);
  }
  function enterHouse(h) {
    log('enter_house', { house: h.id, stage: h.stage });
    player.path = null; player.autoEnter = null; keys.clear();
    const f = doorFront(h); player.x = f.x; player.y = f.y + 4; player.dir = 0; // come back out at this door
    fadeTo(interiors[h.id] ? interiors[h.id](h) : GenericInterior(h));
  }
  function toVillage(msg) {
    const h = scene && scene.house;
    if (h) log('exit_house', { house: h.id });
    keys.clear();
    fadeTo(village, () => { if (msg) toast(msg); });
  }
  // Quest journal: go straight to a house without walking there.
  function travelTo(id) {
    const h = HOUSES.find((x) => x.id === id);
    if (!h || fading || opts.panelOpen() || (scene && scene.house)) return;
    const f = doorFront(h); player.x = f.x; player.y = f.y + 4; player.path = null;
    log('journal_travel', { house: h.id });
    tryEnter(h);
  }

  // The page calls this from go(n). A station that finished sends the player back outside.
  function onStage(n) {
    log('stage', { stage: n });
    if (scene && scene.house && scene.house.stage < n) {
      const h = scene.house;
      opts.closePanel();
      fadeTo(village, () => { if (n < 10 && opts.completed) opts.completed(h, currentHouse()); });
      log('exit_house', { house: h.id });
    } else setObjective();
  }
  // Station screens may draw only while the player is at that station (and, for the houses with a
  // mission card, after "Start mission"), so item requests and timers never start early.
  let missionStage = 0;
  function startMission(n) { missionStage = n; log('start_mission', { stage: n }); }
  function allowsRender(n) {
    if (n <= 1 || n >= 10) return true;
    const here = !!(scene && scene.house && scene.house.stage === n && !fading);
    return here && (n === 2 || missionStage === n);
  }

  function frame(t) {
    const time = t / 1000, dt = Math.min(0.05, (t - lastT) / 1000 || 0); lastT = t;
    resize();
    if (scene && !fading) scene.update(dt, time);
    ctx.setTransform(S, 0, 0, S, 0, 0); ctx.imageSmoothingEnabled = false;
    if (scene) scene.draw(ctx, time);
    drawMinimap(time);
    if (Math.floor(time * 4) !== Math.floor((time - dt) * 4)) setObjective();
    requestAnimationFrame(frame);
  }

  function typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  const norm = (k) => (k.length === 1 ? k.toLowerCase() : k);
  // keyboard and on-screen d-pad share one path
  function press(k) {
    if (opts.panelOpen() || fading) return false;
    if (scene && scene.key({ key: k })) return true;
    keys.add(k);
    return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k);
  }

  function init(o) {
    opts = o;
    canvas = $('world'); ctx = canvas.getContext('2d'); mini = $('minimap'); mctx = mini.getContext('2d');
    buildMap();
    scene = village; village.enter();
    window.addEventListener('keydown', (e) => { if (!typing(e) && press(norm(e.key))) e.preventDefault(); });
    window.addEventListener('keyup', (e) => keys.delete(norm(e.key)));
    window.addEventListener('blur', () => keys.clear());
    canvas.addEventListener('pointerdown', (e) => {
      if (opts.panelOpen() || fading || !scene) return;
      const r = canvas.getBoundingClientRect();
      scene.click(((e.clientX - r.left) / r.width) * VW, ((e.clientY - r.top) / r.height) * VH);
    });
    requestAnimationFrame(frame);
  }

  window.Village = {
    T, VW, VH, AR, init, onStage, allowsRender, startMission, enterHouse, toVillage, travelTo, houseState, press, toast, setPrompt, setObjective, log, gameplay,
    keys, stepPlayer, moveBody, interiors, HOUSES, gfx: { rect, text, plaque, drawPerson },
    get scene() { return scene; },
  };
})();
