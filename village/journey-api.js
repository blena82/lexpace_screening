// LexPace integration: connects the EN/AR journey pages to the screening backend.
// Items come from /api/screening (LLM-generated and validated, or starter items); answers are
// evaluated on the server, which also keeps the answer keys. Pages call LP.step / LP.answer / LP.finish.
const LP = {
  sid: null, plan: {}, cache: {}, pending: {}, busy: false, final: null, text: {},
  async post(path, body) {
    const res = await fetch('/api/screening' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (!res.ok) throw new Error(path + ': ' + res.status);
    return res.json();
  },
  async start(language, context) {
    const s = await this.post('/sessions', { language, context });
    Object.assign(this, { sid: s.session_id, plan: s.plan, cache: {}, pending: {}, final: null, busy: false });
    return s;
  },
  total(activity) { return this.plan[activity] || 0; },
  // Returns the item for (activity, trial), or null after showing a loading screen / moving on.
  step(activity, trialNo, nextStage) {
    if (trialNo >= this.total(activity)) { go(nextStage); return null; }
    const k = activity + ':' + trialNo;
    if (this.cache[k]) return this.cache[k];
    if (!this.pending[k]) {
      this.pending[k] = this.post('/sessions/' + this.sid + '/items', { activity })
        .then((it) => { this.cache[k] = it; delete this.pending[k]; render(); })
        .catch((e) => { delete this.pending[k]; this.fail(e); });
    }
    show(this.loading());
    return null;
  },
  async answer(item, body) {
    if (this.busy) return null;
    this.busy = true;
    try { return await this.post('/sessions/' + this.sid + '/answers', { item_id: item.item_id, ...body }); }
    catch (e) { this.fail(e); return null; }
    finally { this.busy = false; }
  },
  finish(history, extra) {
    if (this.final || this.pending.final) return this.final;
    this.pending.final = this.post('/sessions/' + this.sid + '/complete', { history, ...extra })
      .then((r) => {
        this.final = r; delete this.pending.final; render();
        // LexPace integration: tell the LexPace page the check is done, so it can show next steps.
        // The village pages show a full-page summary first; the student moves on with Continue (see LP_SUMMARY).
        if (!document.getElementById('panel')) {
          try { if (window.parent !== window) window.parent.postMessage({ type: 'lexpace:check-complete' }, location.origin); } catch (e) {}
        }
      })
      .catch((e) => { delete this.pending.final; this.fail(e); });
    show(this.loading());
    return null;
  },
  loading() { return `<div class="info" style="margin-top:40px">${this.text.loading}</div>`; },
  fail(e) {
    console.error('[lexpace]', e);
    show(`<div class="info" style="margin-top:40px">${this.text.error}</div><div class="actions"><button class="btn" onclick="render()">${this.text.retry}</button></div>`);
  },
};

// Village pages: the finished check's summary ("Results") fills the page with the screening scores.
//   X         -> LexPace opens a fresh screening (Check tab)
//   Continue  -> LexPace's Results page (what the results mean, format, SAS referral); Back returns here
// The last summary is kept in this browser, so LexPace's Results tab can reopen it (?summary=1).
const LP_SUMMARY = {
  KEY: 'lexpace:last-summary',
  text: {
    en: { close: 'Close', cont: 'See what my results mean →', next: 'Continue →', title: 'Your screening results',
      gamesTitle: 'Your game results', gamesLead: 'How many answers you got right in each game.',
      completed: 'Completed · written answer, no right or wrong', notPlayed: 'Not played',
      lead: 'Your score in each area, based on your activities. Below 50% means extra support is suggested.',
      names: { reading: 'Reading Fluency', writing: 'Writing', math: 'Number Sense' }, threshold: '50% · threshold',
      suggested: 'Support suggested:', none: 'none', model: 'This is a screening by a trained model, not a diagnosis.',
      pending: 'Your answers were saved. Your scores will appear here once the screening model is connected.' },
    ar: { close: 'إغلاق', cont: 'اعرف ماذا تعني نتائجي ←', next: 'متابعة ←', title: 'نتائج الفحص',
      gamesTitle: 'نتائج الألعاب', gamesLead: 'عدد الإجابات الصحيحة في كل لعبة.',
      completed: 'مكتمل · إجابة كتابية بلا صواب أو خطأ', notPlayed: 'لم تُلعب',
      lead: 'درجتك في كل مجال بناءً على أنشطتك. الدرجة الأقل من 50% تعني أن دعمًا إضافيًا مقترح.',
      names: { reading: 'طلاقة القراءة', writing: 'الكتابة', math: 'الحس العددي' }, threshold: '50% · الحد',
      suggested: 'الدعم المقترح:', none: 'لا يوجد', model: 'هذا فحص أولي بنموذج مدرَّب، وليس تشخيصًا.',
      pending: 'تم حفظ إجاباتك. ستظهر درجاتك هنا عند ربط نموذج الفحص.' },
  },
  lang() { return document.documentElement.lang === 'ar' ? 'ar' : 'en'; },
  tell(type) {
    try { if (window.parent !== window) window.parent.postMessage({ type }, location.origin); } catch (e) {}
  },
  save() {
    try {
      localStorage.setItem(this.KEY, JSON.stringify({ lang: this.lang(), at: new Date().toISOString(),
        results, historyAnswers, final: LP.final }));
    } catch (e) {}
    this.tell('lexpace:summary-saved');
  },
  load() {
    try { const s = JSON.parse(localStorage.getItem(this.KEY) || 'null'); return s && s.final ? s : null; } catch (e) { return null; }
  },
  // Shows the saved summary again (the village opens with every house done).
  reopen() {
    const s = this.load();
    if (!s) return false;
    results = s.results || []; historyAnswers = s.historyAnswers || {}; LP.final = s.final; passageDone = true;
    go(stages.length - 1);
    return true;
  },
  results() { this.tell('lexpace:open-results'); },
  close() {
    const panel = document.getElementById('panel');
    if (panel) panel.classList.remove('lp-summary');
    closePanel();
    this.tell('lexpace:summary-closed');
  },
  // The model gives, per area, how likely a difficulty is. The student sees a score (100% - that),
  // so a score below 50% means support is suggested.
  scoreRows() {
    const c = (LP.final || {}).classification || {};
    if (c.status !== 'ok' || !c.outputs) return null;
    return ['reading', 'writing', 'math'].filter((k) => c.outputs[k]).map((k) => ({
      key: k, score: Math.round((1 - c.outputs[k].probability) * 100), suggested: !!c.outputs[k].positive,
    }));
  },
  // Per station: share of answers correct, from the page's recorded results (game labels in station order).
  gameRows() {
    const labels = Object.values((LP_DEMO.labels || {})[this.lang()] || {});
    const houses = (typeof Village !== 'undefined' && Village.HOUSES) || [];
    return labels.map((label, i) => {
      const scored = results.filter((r) => r.game === label && r.correct !== null && r.correct !== undefined);
      const played = results.some((r) => r.game === label);
      return { name: houses[i] ? houses[i].game : label, n: scored.length, ok: scored.filter((r) => r.correct).length, played };
    });
  },
  decorate() {
    const panel = document.getElementById('panel'), app = document.getElementById('app');
    if (!panel || !app || app.querySelector('.lp-summary-close')) return;
    const t = this.text[this.lang()];
    panel.classList.add('lp-summary');
    const rows = this.scoreRows();
    const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const bars = rows ? rows.map((r) => `<div class="lp-row"><div class="lp-name">${esc(t.names[r.key])}</div>
        <div class="lp-track"><div class="lp-fill${r.suggested ? ' is-low' : ''}" style="width:${r.score}%"></div><div class="lp-thr"></div></div>
        <div class="lp-val">${r.score}%</div></div>`).join('')
      + `<div class="lp-axis"><div></div><div><span>0%</span><span>${esc(t.threshold)}</span><span>100%</span></div><div></div></div>`
      : `<p class="lp-pending">${esc(t.pending)}</p>`;
    const picked = rows ? rows.filter((r) => r.suggested) : [];
    const foot = rows ? `<div class="lp-foot"><b>${esc(t.suggested)}</b> ${picked.length ? picked.map((r) => `<span class="lp-tag">${esc(t.names[r.key])}</span>`).join(' ') : esc(t.none)}<br>${esc(t.model)}</div>` : '';
    const games = this.gameRows().map((g) => g.n
      ? `<div class="lp-row"><div class="lp-name">${esc(g.name)}</div>
          <div class="lp-track"><div class="lp-fill" style="width:${Math.round(100 * g.ok / g.n)}%"></div></div>
          <div class="lp-val">${Math.round(100 * g.ok / g.n)}%<small>${g.ok}/${g.n}</small></div></div>`
      : `<div class="lp-row"><div class="lp-name">${esc(g.name)}</div><div class="lp-track lp-none">${esc(g.played ? t.completed : t.notPlayed)}</div><div class="lp-val"></div></div>`).join('');
    app.innerHTML = `<button type="button" class="lp-summary-close" aria-label="${esc(t.close)}">✕</button>
      <div class="lp-card"><h1>${esc(t.gamesTitle)}</h1><p class="lp-lead">${esc(t.gamesLead)}</p>${games}
        <div class="lp-axis"><div></div><div><span>0%</span><span>50%</span><span>100%</span></div><div></div></div>
        <div class="lp-actions"><button type="button" class="lp-cont lp-reveal">${esc(t.cont)}</button></div></div>
      <div class="lp-card lp-screening" hidden><h1>${esc(t.title)}</h1><p class="lp-lead">${esc(t.lead)}</p>${bars}${foot}
      <div class="lp-actions"><button type="button" class="lp-cont lp-next">${esc(t.next)}</button></div></div>`;
    app.querySelector('.lp-summary-close').onclick = () => this.close();
    // "See what my results mean" shows the screening results; their Continue opens LexPace's explanation page.
    app.querySelector('.lp-reveal').onclick = (e) => {
      const card = app.querySelector('.lp-screening');
      card.hidden = false;
      e.currentTarget.closest('.lp-actions').remove();
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    app.querySelector('.lp-next').onclick = () => this.results();
  },

};
window.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('panel') || typeof show !== 'function') return;
  const css = document.createElement('style');
  css.textContent = '#panel.lp-summary{align-items:flex-start;padding:0}'
    + '#panel.lp-summary .panel-card{width:100%;max-width:none;min-height:100%;max-height:none;border-radius:0;box-shadow:none;position:relative}'
    + '#panel.lp-summary .panel-head{display:none}'
    + '#panel.lp-summary{background:#f8f8f8}'
    + '#panel.lp-summary .panel-card{background:#f8f8f8;border:0}'
    + '#panel.lp-summary #app{max-width:1000px;margin:0 auto;padding:56px 24px 40px;font-family:"Open Sans","Segoe UI",system-ui,sans-serif;color:#262626}'
    + '.lp-card{background:#fff;border:1px solid #e6e6e6;border-top:4px solid #5b4061;padding:30px 36px 28px}'
    + '.lp-card h1{margin:0 0 8px;font-size:26px;font-weight:600;color:#262626;letter-spacing:0}'
    + '.lp-lead{color:#5c5c5c;margin:0 0 24px;font-size:15px}'
    + '.lp-row{display:grid;grid-template-columns:180px 1fr 64px;align-items:center;gap:18px;margin:20px 0}'
    + '.lp-name{font-weight:700;font-size:18px}.lp-val{font-weight:700;font-size:18px;text-align:end}'
    + '.lp-track{position:relative;height:26px;background:#efebf0;border-radius:4px}'
    + '.lp-fill{position:absolute;top:0;bottom:0;inset-inline-start:0;border-start-end-radius:4px;border-end-end-radius:4px;background:#5b4061}'
    + '.lp-fill.is-low{background:#cdbfd2}'
    + '.lp-thr{position:absolute;top:-8px;bottom:-8px;inset-inline-start:50%;border-inline-start:2px dashed #9a9a9a}'
    + '.lp-axis{display:grid;grid-template-columns:180px 1fr 64px;gap:18px;font-size:12px;color:#5c5c5c}.lp-axis div:nth-child(2){display:flex;justify-content:space-between}'
    + '.lp-foot{margin-top:24px;padding-top:16px;border-top:1px solid #ececec;font-size:14px;color:#5c5c5c;line-height:1.7}.lp-foot b{color:#262626}'
    + '.lp-tag{display:inline-block;font-size:13px;font-weight:700;padding:1px 10px;border-radius:999px;background:#f1ebf3;color:#5b4061}'
    + '.lp-pending{color:#5c5c5c}'
    + '.lp-card+.lp-card{margin-top:20px}.lp-card[hidden]{display:none}'
    + '.lp-val small{display:block;font-size:12px;font-weight:400;color:#5c5c5c}'
    + '.lp-none{background:none;height:auto;font-size:13px;color:#5c5c5c}'
    + '.lp-actions{margin-top:22px}.lp-cont{background:#5b4061;color:#fff;border:0;border-radius:4px;padding:11px 20px;font:600 15px "Open Sans","Segoe UI",sans-serif;cursor:pointer}.lp-cont:hover{background:#4a3350}'
    + '.lp-summary-close{position:absolute;top:14px;inset-inline-end:16px;width:40px;height:40px;border-radius:50%;border:1px solid #c9d6d2;background:#fff;font-size:18px;cursor:pointer;color:#26394a}'
    + '.lp-summary-close:hover{background:#eef4f2}'
    + '.panel-card{position:relative}'
    + '.lp-card-close{position:absolute;top:12px;inset-inline-end:12px;width:36px;height:36px;border-radius:50%;border:1px solid #c9d6d2;background:#fff;font-size:16px;cursor:pointer;color:#26394a;z-index:1}'
    + '.lp-card-close:hover{background:#eef4f2}'
    + '#panel.lp-summary .lp-card-close,#panel.lp-noclose .lp-card-close{display:none}';
  document.head.appendChild(css);
  // Station cards: an X (top right) that works like "Return to village"; the station keeps its progress.
  const card = document.querySelector('#panel .panel-card');
  if (card) {
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'lp-card-close'; x.textContent = '✕';
    x.setAttribute('aria-label', document.documentElement.lang === 'ar' ? 'العودة إلى القرية' : 'Return to village');
    x.onclick = () => {
      if (typeof stopMathClock === 'function') stopMathClock();
      try { speechSynthesis.cancel(); } catch (e) {}
      closePanel();
      if (typeof Village !== 'undefined' && Village.scene && Village.scene.house) Village.toVillage();
    };
    card.prepend(x);
    // No X on the setup cards (they must be answered). House cards are drawn straight into #app, so watch it.
    const panel = document.getElementById('panel'), app = document.getElementById('app');
    const sync = () => panel.classList.toggle('lp-noclose', stage < 2);
    new MutationObserver(sync).observe(app, { childList: true });
    sync();
  }
  const pageShow = show;
  let saved = null; // the LP.final last saved ('reopen': the summary shown again, nothing new to save)
  window.show = function (html) {
    pageShow(html);
    const panel = document.getElementById('panel');
    if (stage === stages.length - 1 && LP.final) {
      if (saved === 'reopen') saved = LP.final;
      else if (saved !== LP.final) { saved = LP.final; LP_SUMMARY.save(); }
      LP_SUMMARY.decorate();
    } else if (panel) panel.classList.remove('lp-summary');
  };
  // Opened from LexPace's "My results" (or back from the interpretation page): show the last summary.
  if (new URLSearchParams(location.search).has('summary')) { saved = 'reopen'; if (!LP_SUMMARY.reopen()) saved = null; }
});

// DEMO ONLY (remove before merging): shortcuts for demos and the showcase video.
//  - "Skip to end": answers every activity with a demo answer through the real API and opens the summary.
//  - Village journal: a LOCKED house can be clicked at any time (it still reads LOCKED). Every station before it is filled with demo answers
//    (marked done, as if played) and the player is taken into the chosen house.
// Demo sessions are marked as such, so the backend returns sample results.
const LP_DEMO = {
  STATIONS: ['lexical', 'sound', 'spelling', 'writing', 'comprehension', 'number', 'reasoning'], // stages 2..8; 9 = history
  labels: {
    en: { lexical: 'Real or Not?', sound: 'Sound Lab', spelling: 'Echo', writing: 'Express Your Idea', comprehension: 'Read & Listen', number: 'Number Challenge', reasoning: 'Math Reasoning' },
    ar: { lexical: 'كلمة أم لا؟', sound: 'مختبر الأصوات', spelling: 'اسمع واكتب', writing: 'التعبير الكتابي', comprehension: 'اقرأ واستمع', number: 'تحدي الأعداد', reasoning: 'التفكير الرياضي' },
  },
  text: {
    en: { skip: 'Skip to end (demo)', filling: (a, b) => `Filling demo answers… ${a}/${b}`, unlock: 'UNLOCK', unlockTip: 'Demo: mark the earlier stations done and open this one' },
    ar: { skip: 'تخطَّ إلى النهاية (عرض)', filling: (a, b) => `تعبئة إجابات تجريبية… ${a}/${b}`, unlock: 'افتح', unlockTip: 'عرض: إكمال المحطات السابقة وفتح هذه المحطة' },
  },
  writing: {
    en: 'A good study space is quiet and tidy. I like to work at a desk near a window, with my notes and a glass of water close by.',
    ar: 'مكان الدراسة الجيد هادئ ومرتب. أحب أن أدرس على مكتب قرب النافذة، وأضع ملاحظاتي وكوب ماء بجانبي.',
  },
  running: false,
  lang() { return document.documentElement.lang === 'ar' ? 'ar' : 'en'; },
  // A fresh session marked as a demo (unless the current one already is).
  async ensureSession() {
    if (LP.sid && LP.demo) return;
    context = { ...(context || {}), demo: true };
    await LP.start(this.lang(), context);
    LP.demo = true;
    results = [];
    passageDone = false; passageStart = 0;
  },
  // Answers every remaining item of one station; items already served or answered are skipped.
  async fillStation(activity, progress) {
    const names = this.labels[this.lang()];
    for (let i = 0; i < (LP.plan[activity] || 0); i++) {
      progress();
      const key = activity + ':' + i;
      const item = LP.cache[key] || await LP.post('/sessions/' + LP.sid + '/items', { activity }).catch(() => null);
      if (!item) continue;
      LP.cache[key] = item;
      if (activity === 'comprehension') {
        for (let q = 0; q < item.questions.length; q++) {
          const r = await LP.post('/sessions/' + LP.sid + '/answers', { item_id: item.item_id, response: 0, question_index: q, latency_ms: 4000, lookbacks: 0 }).catch(() => null);
          if (r) record(names[activity], item.questions[q].question, item.questions[q].options[0], r.correct, { demo: true });
        }
        continue;
      }
      const response = activity === 'writing' ? this.writing[this.lang()] : activity === 'spelling' ? (item.spoken || 'demo') : 0;
      const r = await LP.post('/sessions/' + LP.sid + '/answers', { item_id: item.item_id, response, latency_ms: 2500, audio_plays: 1 }).catch(() => null);
      if (r) record(names[activity], item.stimulus || item.word || item.spoken || item.question || item.prompt || '', String(response), activity === 'writing' ? null : r.correct, { demo: true });
    }
  },
  // Fills stations from the current one up to (not including) stage `target`.
  async fillUpTo(target, onProgress) {
    await this.ensureSession();
    const from = Math.max(2, stage);
    const todo = this.STATIONS.filter((a, i) => i + 2 >= from && i + 2 < target);
    const total = todo.reduce((n, a) => n + (LP.plan[a] || 0), 0);
    let done = 0;
    for (const a of todo) await this.fillStation(a, () => onProgress(++done, total));
    if (target > 6) passageDone = true; // the passage was "read"
    if (target > 9) {
      historyCodes = { reading: 1, spelling: 1, math: 0, support: 1, persistent: 1 };
      historyAnswers = { reading: 'demo', spelling: 'demo', math: 'demo', support: 'demo', persistent: 'demo' };
    }
  },
  async run(btn) {
    if (this.running) return;
    this.running = true;
    btn.disabled = true;
    try {
      LP.demo = false; // the summary always comes from a fresh demo session
      await this.fillUpTo(10, (a, b) => { btn.textContent = this.text[this.lang()].filling(a, b); });
      btn.remove();
      go(stages.length - 1); // summary
    } catch (e) {
      btn.disabled = false; btn.textContent = this.text[this.lang()].skip; LP.fail(e);
    } finally {
      this.running = false;
    }
  },
  // Journal: open a locked house, as if every station before it was played.
  async jumpTo(house, label) {
    if (this.running) return;
    this.running = true;
    try {
      // Playing a station right now: leave it first (its progress is kept, then filled with demo answers).
      if (Village.scene && Village.scene.house) {
        if (typeof stopMathClock === 'function') stopMathClock();
        try { speechSynthesis.cancel(); } catch (e) {}
        closePanel();
        Village.toVillage();
        await new Promise((r) => setTimeout(r, 700));
      }
      await this.fillUpTo(house.stage, (a, b) => { if (label) label.textContent = `${a}/${b}`; });
      closePanel();
      go(house.stage);
      setTimeout(() => Village.travelTo(house.id), 400);
    } catch (e) {
      LP.fail(e);
    } finally {
      this.running = false;
    }
  },
  // Makes the journal's LOCKED rows clickable (the page re-draws the journal often).
  patchJournal() {
    if (typeof Village === 'undefined') return;
    const t = this.text[this.lang()];
    document.querySelectorAll('#missions .mission').forEach((b, i) => {
      const h = Village.HOUSES[i];
      if (!h || Village.houseState(h) !== 'locked') return;
      // Still shown as LOCKED, but clickable at any time (also while playing a station).
      b.disabled = false;
      b.title = t.unlockTip;
      b.style.cursor = 'pointer';
      const tag = b.querySelector('.t');
      b.onclick = (e) => { e.preventDefault(); this.jumpTo(h, tag); };
    });
  },
};
window.addEventListener('DOMContentLoaded', () => {
  const t = LP_DEMO.text[LP_DEMO.lang()];
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn ghost';
  btn.textContent = t.skip;
  btn.onclick = () => LP_DEMO.run(btn);
  const hud = document.getElementById('guide'); // village pages: under the quest journal's "next stop" box
  if (hud) {
    btn.style.cssText = 'display:block;width:100%;margin:10px 0';
    hud.after(btn);
  } else {
    btn.style.cssText = 'position:fixed;top:12px;inset-inline-end:16px;z-index:10;box-shadow:0 2px 8px rgba(0,0,0,.12)';
    document.body.appendChild(btn);
  }
  // The village re-draws the journal itself, so watch it and patch every new version.
  const missions = document.getElementById('missions');
  if (missions) {
    new MutationObserver(() => LP_DEMO.patchJournal()).observe(missions, { childList: true });
    LP_DEMO.patchJournal();
  }
});
