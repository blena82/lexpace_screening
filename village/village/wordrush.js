// Word Rush: the Library. The existing Real-or-Not? (lexical decision) items, sorted onto two shelves.
//
// Play: pick up a closed book from the floor, carry it to the Return Desk, open it, then send it to
// the green REAL WORDS or purple MADE-UP WORDS shelf, where it stays.
//
// Timing: walking and carrying are not timed, because the book is closed until it is opened at the
// desk. The response clock starts when the word appears (the moment the classic page shows the word)
// and stops when the player commits a shelf (Enter, or clicking the chosen shelf again): the same
// as the classic "Next" click. The book flies to the shelf only after the answer is recorded.
// No feedback about correctness is shown, as on the classic page.
(function () {
  'use strict';
  const V = window.Village, { rect, text, plaque, drawPerson } = V.gfx, VW = V.VW, VH = V.VH;

  // Arabic: the real-word shelf is on the right, as the classic page lists that option first in RTL.
  const T = V.AR ? {
    real: 'كلمات حقيقية', madeup: 'كلمات مبتكرة', books: (n) => `الكتب: ${n}`, desk: 'مكتب الإعارة', exit: 'خروج', restored: '✨ عادت المكتبة مرتّبة ✨',
    send: (l) => `<kbd>Enter</kbd> أرسله إلى رف <b>${l}</b> · <kbd>←</kbd>/<kbd>→</kbd> لتغيير الرف`,
    choose: '<kbd>→</kbd> رف الكلمات الحقيقية · <kbd>←</kbd> رف الكلمات المبتكرة · أو انقر على رف',
    allSorted: 'رُتّبت كل الكتب · اخرج من الباب', open: '<kbd>E</kbd> افتح الكتاب عند مكتب الإعارة',
    carry: 'احمل الكتاب المغلق إلى مكتب الإعارة', pick: '<kbd>E</kbd> التقط الكتاب', walk: 'امشِ إلى كتاب مضيء والتقطه',
    hands: ['يداك فارغتان', 'تحمل كتابًا مغلقًا', 'تقرأ كتابًا'],
    doneObj: (d, t) => `📚 <b>عادت المكتبة مرتّبة!</b> · ${d} / ${t} كتب · اخرج من الباب`,
    readObj: '📚 <b>سباق الكلمات</b> · على أي رف يوضع هذا الكتاب؟', obj: (d, t, h) => `📚 <b>سباق الكلمات</b> · رُتّب ${d} / ${t} · ${h}`,
    meta: (n, t, l) => `كتاب ${n} من ${t} · ${l}`,
  } : {
    real: 'REAL WORDS', madeup: 'MADE-UP WORDS', books: (n) => `${n} BOOK${n === 1 ? '' : 'S'}`, desk: 'RETURN DESK', exit: 'EXIT', restored: '✨ THE LIBRARY IS RESTORED ✨',
    send: (l) => `<kbd>Enter</kbd> Send it to <b>${l}</b> · <kbd>←</kbd>/<kbd>→</kbd> change shelf`,
    choose: '<kbd>←</kbd> REAL WORDS shelf · <kbd>→</kbd> MADE-UP WORDS shelf · or click a shelf',
    allSorted: 'All books sorted · walk out through the door', open: '<kbd>E</kbd> Open the book at the Return Desk',
    carry: 'Carry the closed book to the Return Desk', pick: '<kbd>E</kbd> Pick up the book', walk: 'Walk to a glowing book and pick it up',
    hands: ['hands free', 'carrying a closed book', 'reading a book'],
    doneObj: (d, t) => `📚 <b>Library restored!</b> · ${d} / ${t} books sorted · leave through the door`,
    readObj: '📚 <b>Word Rush</b> · which shelf does this book belong on?', obj: (d, t, h) => `📚 <b>Word Rush</b> · ${d} / ${t} books sorted · ${h}`,
    meta: (n, t, l) => `Book ${n} of ${t} · ${l}`,
  };
  const LEFT_X = 24, RIGHT_X = 236;
  const SHELF = {
    real: { x: V.AR ? RIGHT_X : LEFT_X, y: 50, w: 124, h: 34, label: T.real, dark: '#436e55', mid: '#659b74', light: '#d7e9b6', ink: '#315741' },
    madeup: { x: V.AR ? LEFT_X : RIGHT_X, y: 50, w: 124, h: 34, label: T.madeup, dark: '#67517c', mid: '#9779ad', light: '#e4d6f2', ink: '#5b4670' },
  };
  const LEFT = V.AR ? 'madeup' : 'real', RIGHT = V.AR ? 'real' : 'madeup';
  const DESK = { x: 144, y: 104, w: 96, h: 40 };
  // floor spots stay clear of the minimap card (bottom right) and the door (bottom centre)
  const SPOTS = [[58, 122], [326, 118], [86, 176], [262, 182], [36, 200], [352, 146]];
  const COVERS = ['#7caa87', '#a476bd', '#5c85b7', '#c49c56', '#b67b90', '#658e8b'];
  const inR = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

  // persists across visits to the library
  const st = { mode: 'free', carrying: false, aim: null, placed: { real: [], madeup: [] }, floor: null, fly: null, want: false, auto: null };
  let hooks = null, p = null, opened = 0, nPlaced = 0;
  const $ = (id) => document.getElementById(id);

  const progress = () => hooks.progress();
  const allDone = () => { const g = progress(); return g.trial >= g.total; };
  const atDesk = () => p.x > DESK.x - 10 && p.x < DESK.x + DESK.w + 10 && p.y > DESK.y + DESK.h - 2 && p.y < DESK.y + DESK.h + 26;
  const nearBook = () => st.floor.find((s) => Math.hypot(SPOTS[s][0] - p.x, SPOTS[s][1] - p.y) < 18);

  function bookEl(show) { $('wr-book').hidden = !show; }
  function setStatus(html) { const s = $('wr-status'); s.innerHTML = html || ''; s.hidden = !html; }

  function pickUp(s) {
    st.floor = st.floor.filter((x) => x !== s); st.carrying = true;
    V.log('wordrush_pickup', { spot: s });
  }
  function openAtDesk() {
    if (st.mode !== 'free' || !st.carrying || allDone()) return;
    st.mode = 'loading'; st.want = true; p.moving = false; p.path = null; p.dir = 1;
    V.log('wordrush_open_book', { trial: progress().trial });
    hooks.render();
  }

  // Called by the page once the item is available; the page starts the response timer right after.
  function openBook(item, level, n, total) {
    st.mode = 'reading'; st.aim = null; opened = performance.now();
    setStatus('');
    $('wr-word').textContent = item.stimulus;
    $('wr-meta').textContent = T.meta(n, total, level);
    bookEl(true);
  }

  function aim(shelf) {
    if (st.mode !== 'reading') return;
    if (st.aim !== shelf) V.log('wordrush_aim', { shelf, since_open_ms: Math.round(performance.now() - opened) });
    st.aim = shelf;
  }

  async function commit() {
    if (st.mode !== 'reading' || !st.aim) return;
    const shelf = st.aim;
    st.mode = 'sending'; st.want = false;
    const ok = await hooks.submit(shelf); // the response time is taken at the start of this call
    if (!ok) { st.want = true; st.mode = 'error'; return; } // the page shows the error with a retry
    bookEl(false); st.carrying = false;
    st.fly = { shelf, t0: performance.now(), color: COVERS[nPlaced++ % COVERS.length] };
    st.mode = 'flying';
  }

  const slotPos = (shelf, i) => ({ x: SHELF[shelf].x + 6 + i * 20, y: SHELF[shelf].y - 18 });

  function solid(x, y) {
    if (x < 8 || x > VW - 8 || y < 96) return true;
    if (y > 214 && (x < 176 || x > 208)) return true;
    if (y > 226) return true;
    return inR(DESK, x, y + 4);
  }

  // click-to-walk: straight line, or around the desk (the only obstacle in the room) when it is in the way
  function route(tx, ty) {
    const pad = 8, d = { x: DESK.x - pad, y: DESK.y - pad, w: DESK.w + 2 * pad, h: DESK.h + 2 * pad };
    let hit = false;
    for (let k = 0; k <= 20 && !hit; k++) hit = inR(d, p.x + ((tx - p.x) * k) / 20, p.y + ((ty - p.y) * k) / 20);
    if (!hit) return [{ x: tx, y: ty }];
    const below = DESK.y + DESK.h + 12, side = (x) => (x < VW / 2 ? DESK.x - 12 : DESK.x + DESK.w + 12);
    const out = [];
    if (p.y < below - 4) out.push({ x: side(p.x), y: p.y }, { x: side(p.x), y: below });
    out.push({ x: ty < below ? side(tx) : tx, y: below });
    if (ty < below) out.push({ x: side(tx), y: ty });
    out.push({ x: tx, y: ty });
    return out;
  }

  function prompt() {
    if (st.mode === 'reading') {
      V.setPrompt(st.aim ? T.send(SHELF[st.aim].label) : T.choose);
    } else if (st.mode !== 'free') V.setPrompt('');
    else if (allDone()) V.setPrompt(T.allSorted);
    else if (st.carrying && atDesk()) V.setPrompt(T.open);
    else if (st.carrying) V.setPrompt(T.carry);
    else if (nearBook() !== undefined) V.setPrompt(T.pick);
    else V.setPrompt(T.walk);
  }

  function drawBook(c, x, y, color, glow, time) {
    if (glow) { const a = 0.35 + Math.sin(time * 5) * 0.2; c.fillStyle = `rgba(255,240,150,${a})`; c.fillRect(x - 4, y - 4, 20, 18); }
    rect(c, x - 1, y + 2, 14, 10, '#6b4738'); rect(c, x, y, 12, 10, color); rect(c, x + 2, y + 2, 8, 5, '#f3e6b5');
  }

  function scene(house) {
    p = { x: VW / 2, y: 208, dir: 1, moving: false, path: null };
    if (!st.floor) { const g = progress(); st.floor = SPOTS.map((_, i) => i).slice(0, Math.max(0, g.total - g.trial)); }
    return {
      house,
      enter() { setStatus(''); bookEl(false); if (st.mode !== 'free' && st.mode !== 'flying') st.mode = 'free'; st.want = false; },
      leave() { bookEl(false); setStatus(''); V.setPrompt(''); },
      objective() {
        const g = progress(), done = Math.min(g.trial, g.total);
        const hand = T.hands[st.carrying ? (st.mode === 'reading' ? 2 : 1) : 0];
        if (allDone()) return T.doneObj(done, g.total);
        if (st.mode === 'reading') return T.readObj;
        return T.obj(done, g.total, hand);
      },
      update(dt) {
        if (st.mode === 'free') {
          V.stepPlayer(p, dt, solid);
          if (st.auto !== null && !p.path) {
            const a = st.auto; st.auto = null;
            if (a === 'desk' && atDesk()) openAtDesk();
            else if (typeof a === 'number' && !st.carrying && nearBook() === a) pickUp(a);
          }
          if (p.y > 216 && p.x > 176 && p.x < 208) {
            p.y = 206;
            if (allDone()) hooks.finished(); else V.toVillage();
            return;
          }
        } else p.moving = false;
        if (st.mode === 'flying' && performance.now() - st.fly.t0 > 560) {
          st.placed[st.fly.shelf].push(st.fly.color); st.fly = null; st.mode = 'free';
        }
        prompt();
      },
      draw(c, time) {
        // floor, back wall and wall bookcases (scenery)
        rect(c, 0, 0, VW, VH, '#b89470');
        for (let y = 0; y < VH; y += 12) for (let x = 0; x < VW; x += 12) { rect(c, x, y, 11, 11, ((x + y) / 12) % 2 ? '#c4a17b' : '#bb9670'); rect(c, x + 1, y + 10, 9, 1, '#ae8867'); }
        rect(c, 0, 0, VW, 38, '#6b5346');
        for (let x = 0; x < VW; x += 12) { rect(c, x, 2, 11, 32, x % 24 ? '#82634f' : '#795b49'); rect(c, x + 1, 5, 9, 5, '#b77c52'); }
        for (const bx of [14, 47, 80, 113, 247, 280, 313, 346]) {
          rect(c, bx, 5, 27, 26, '#4b392f');
          for (let b = 0; b < 4; b++) rect(c, bx + 2 + b * 6, 7, 4, 19, ['#6f9a9c', '#a86567', '#d5af67', '#78936d'][(bx + b) % 4]);
          rect(c, bx, 28, 27, 3, '#b78b58');
        }
        // the two sorting shelves; placed books stay on the shelf the player chose
        for (const key of ['real', 'madeup']) {
          const s = SHELF[key], aimed = st.mode === 'reading' && st.aim === key;
          rect(c, s.x, s.y, s.w, s.h, s.dark); rect(c, s.x + 3, s.y + 3, s.w - 6, s.h - 8, s.mid); rect(c, s.x + 6, s.y + 6, s.w - 12, s.h - 14, s.light);
          text(c, s.label, s.x + s.w / 2, s.y + 13.5, { size: 8.5, color: s.ink });
          st.placed[key].forEach((col, i) => {
            const q = slotPos(key, i);
            rect(c, q.x, q.y, 15, 16, s.dark); rect(c, q.x + 1, q.y + 1, 13, 13, col); rect(c, q.x + 3, q.y + 4, 9, 2, '#fff4db'); rect(c, q.x + 3, q.y + 8, 7, 1, '#fff4db');
          });
          const n = st.placed[key].length;
          text(c, T.books(n), s.x + s.w / 2, s.y + s.h + 7, { size: 6, color: s.ink });
          if (aimed) {
            const a = 0.6 + Math.sin(time * 8) * 0.35;
            c.strokeStyle = `rgba(246,209,122,${a})`; c.lineWidth = 3; c.strokeRect(s.x - 3, s.y - 22, s.w + 6, s.h + 25);
            c.fillStyle = '#f6d17a'; c.beginPath(); const ax = s.x + s.w / 2; c.moveTo(ax - 5, s.y + s.h + 14); c.lineTo(ax + 5, s.y + s.h + 14); c.lineTo(ax, s.y + s.h + 9); c.fill();
          }
        }
        // books still on the floor (closed: no word is visible until the book is opened)
        st.floor.forEach((s) => drawBook(c, SPOTS[s][0] - 6, SPOTS[s][1] - 10, COVERS[s % COVERS.length], !st.carrying && st.mode === 'free', time));
        const carry = st.carrying && st.mode === 'free' ? (cc, x, y) => drawBook(cc, x - 6, y - 8, '#c49c56', false, 0) : null;
        const behind = p.y < DESK.y + DESK.h;
        if (behind) drawPerson(c, p.x, p.y, p.dir, p.moving ? 1 + (Math.floor(time * 8) % 2) : 0, carry);
        // return desk
        rect(c, DESK.x, DESK.y, DESK.w, DESK.h, '#896b52'); rect(c, DESK.x + 4, DESK.y + 3, DESK.w - 8, DESK.h - 10, '#d5b583'); rect(c, DESK.x + 14, DESK.y + 9, DESK.w - 28, 16, '#f2dfb7');
        text(c, T.desk, VW / 2, DESK.y + 17.5, { size: 6.5, color: '#806347' });
        if (st.mode === 'reading' || st.mode === 'sending' || st.mode === 'error' || st.mode === 'loading') {
          const off = st.aim === LEFT ? -16 : st.aim === RIGHT ? 16 : 0, bx = VW / 2 + off - 12, by = DESK.y - 6;
          rect(c, bx, by, 24, 10, '#fff8e7'); rect(c, bx + 11, by, 2, 10, '#d9cba5'); rect(c, bx - 1, by + 9, 26, 2, '#6b4738');
        } else if (st.fly) {
          const k = Math.min(1, (performance.now() - st.fly.t0) / 520), q = slotPos(st.fly.shelf, st.placed[st.fly.shelf].length);
          const fx = VW / 2 - 7, fy = DESK.y - 8;
          rect(c, fx + (q.x - fx) * k, fy + (q.y - fy) * k - Math.sin(k * Math.PI) * 26, 15, 16, st.fly.color);
        }
        if (!behind) drawPerson(c, p.x, p.y, p.dir, p.moving ? 1 + (Math.floor(time * 8) % 2) : 0, carry);
        if (allDone() && st.mode === 'free') text(c, T.restored, VW / 2, 160, { size: 8, color: '#fff8dc', shadow: '#64503e' });
        rect(c, 176, 216, 32, 8, '#64503e'); text(c, T.exit, VW / 2, 220, { size: 5, color: '#f6e4bb' });
      },
      key(e) {
        const k = e.key;
        if (st.mode === 'reading') {
          if (k === 'ArrowLeft' || k === 'a') { aim(LEFT); return true; }
          if (k === 'ArrowRight' || k === 'd') { aim(RIGHT); return true; }
          if (k === 'Enter' || k === ' ' || k === 'e') { commit(); return true; }
          return true; // no walking while the book is open
        }
        if (st.mode !== 'free') return true;
        if (k === 'e' || k === 'Enter' || k === ' ') {
          if (st.carrying && atDesk()) { openAtDesk(); return true; }
          const b = nearBook();
          if (!st.carrying && b !== undefined) { pickUp(b); return true; }
        }
        return false;
      },
      click(x, y) {
        for (const key of ['real', 'madeup']) {
          const s = SHELF[key];
          if (st.mode === 'reading' && x >= s.x && x < s.x + s.w && y >= s.y - 22 && y < s.y + s.h + 12) { if (st.aim === key) commit(); else aim(key); return; }
        }
        if (st.mode !== 'free') return;
        const b = st.floor.find((s) => Math.abs(SPOTS[s][0] - x) < 12 && Math.abs(SPOTS[s][1] - 4 - y) < 12);
        if (b !== undefined && !st.carrying) {
          if (nearBook() === b) pickUp(b); else { p.path = route(SPOTS[b][0], Math.max(SPOTS[b][1], 104)); st.auto = b; }
          return;
        }
        if (inR(DESK, x, y) && st.carrying) {
          if (atDesk()) openAtDesk(); else { p.path = route(VW / 2, DESK.y + DESK.h + 12); st.auto = 'desk'; }
          return;
        }
        st.auto = null;
        p.path = route(x, Math.max(y, 100));
      },
    };
  }

  V.interiors.library = scene;
  window.WordRush = {
    attach(h) { hooks = h; },
    wantsBook: () => st.want && (st.mode === 'loading' || st.mode === 'error'),
    openBook,
    status(html) { setStatus(html); },
    debug: () => ({ mode: st.mode, carrying: st.carrying, floor: st.floor.slice(), auto: st.auto, player: p && { x: Math.round(p.x), y: Math.round(p.y), path: p.path } }),
  };
})();
