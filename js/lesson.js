// Screen lesson player: renders exercises one at a time, checks answers, records progress.
const Lesson = (() => {
  const LANG = 'es-ES';
  const root = () => document.getElementById('lesson');
  let cfg = { rate: 1, mic: false, level: 'A1' };

  // ---------- DOM helper ----------
  function h(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
    return n;
  }
  const say = (t, slow) => { Speech.cancel(); return Speech.speak(t, LANG, { rate: cfg.rate * (slow ? 0.7 : 1) }); };
  const playBtn = (t, label = '🔊', slow) => h('button', { class: 'play', type: 'button', 'aria-label': 'Play audio', onclick: e => { e.stopPropagation(); say(t, slow); } }, label);

  // ---------- answer checking ----------
  const ARTICLES = /^(el|la|los|las|un|una|unos|unas|l)\s+/;
  const PRONOUNS = /^(yo|tu|tú|el|él|ella|usted|nosotros|nosotras|vosotros|vosotras|ellos|ellas|ustedes)\s+/;
  const clean = s => String(s).toLowerCase().replace(/[¿?¡!.,;:"“”«»()…]/g, ' ').replace(/['’]/g, ' ').replace(/\s+/g, ' ').trim();
  const loose = s => Engine.norm(s);

  function checkTyped(raw, answers, opts = {}) {
    const input = clean(raw);
    if (!input) return { ok: false };
    const main = answers[0];
    for (const a of answers) if (clean(a) === input) return { ok: true, exact: true };
    for (const a of answers) if (loose(a) === loose(raw)) return { ok: true, note: `Watch the accents: ${main}` };
    if (!opts.english) {
      for (const a of answers) {
        if (loose(a).replace(ARTICLES, '') === loose(raw).replace(ARTICLES, '') && ARTICLES.test(loose(a))) {
          return { ok: true, note: `Remember the article: ${main}` };
        }
        if (loose(a).replace(PRONOUNS, '') === loose(raw).replace(PRONOUNS, '')) return { ok: true, note: `Also right. Model answer: ${main}` };
      }
    }
    const sc = Engine.score([raw], answers);
    const bar = opts.english ? 0.8 : 0.88;
    if (sc >= bar && !(opts.english ? false : loose(main).length <= 4)) return { ok: true, note: `Nearly exact. Precisely: ${main}` };
    return { ok: false, close: sc >= 0.6 };
  }
  const esAnswers = it => [it.t, ...(it.alt || []), ...(it.n != null ? [String(it.n)] : [])];
  const enAnswers = it => [it.en, ...(it.ea || []), ...(it.n != null ? [String(it.n)] : [])];

  // ---------- player ----------
  function run(lesson, config) {
    cfg = { ...cfg, ...config };
    return new Promise(resolve => {
      const r = root();
      const queue = lesson.steps.slice();
      const requeued = new Set();
      let idx = 0;
      let right = 0, total = 0;
      const mistakes = [];
      const started = Date.now();
      let finished = false;

      const bar = h('div', { class: 'l-bar' }, h('i'));
      const body = h('div', { class: 'l-body' });
      const foot = h('div', { class: 'l-foot' });
      const closeBtn = h('button', { class: 'l-close', 'aria-label': 'Close lesson', onclick: () => {
        if (idx > 1 && !confirm('Leave this lesson? Answers so far are saved.')) return;
        finish(true);
      } }, '✕');
      r.replaceChildren(h('div', { class: 'l-top' }, closeBtn, bar, h('span', { class: 'l-title' }, lesson.title)), body, foot);
      r.hidden = false;
      document.body.classList.add('no-scroll');

      function setBar() { bar.firstChild.style.width = `${Math.round(100 * idx / Math.max(1, queue.length))}%`; }

      function finish(aborted) {
        if (finished) return;
        finished = true;
        Speech.cancel();
        Progress.addTime((Date.now() - started) / 1000);
        document.removeEventListener('keydown', onKey);
        const result = { right, total, mistakes, aborted, skipped: lesson._skipped };
        if (aborted) { close(); resolve(result); return; }
        if (lesson.onDone) lesson.onDone(result);
        showSummary(result);
      }
      function close() { r.hidden = true; r.replaceChildren(); document.body.classList.remove('no-scroll'); }

      function showSummary(result) {
        bar.firstChild.style.width = '100%';
        const pct = result.total ? Math.round(100 * result.right / result.total) : null;
        const msg = lesson.summaryText ? lesson.summaryText(result) : (pct == null ? 'Done.' : pct >= 90 ? 'Excellent work.' : pct >= 70 ? 'Good work. The tricky ones will come back in your reviews.' : "That was a tough one. You'll see these again soon, which is how they stick.");
        body.replaceChildren(h('div', { class: 'l-summary' },
          h('div', { class: 'l-big' }, pct == null ? '✓' : `${pct}%`),
          h('p', {}, msg),
          result.mistakes.length ? h('div', { class: 'l-mist' }, h('h3', {}, 'To practise'),
            h('ul', {}, ...dedupe(result.mistakes).slice(0, 8).map(m => h('li', {}, h('b', {}, m.t), ' — ', m.en || '')))) : null));
        foot.replaceChildren(h('button', { class: 'btn wide', onclick: () => { close(); resolve(result); } }, 'Continue'));
        foot.querySelector('button').focus();
      }
      const dedupe = list => { const s = new Set(); return list.filter(m => !s.has(m.t) && s.add(m.t)); };

      // Called by each exercise once the learner has answered.
      function answered(step, ok, info = {}) {
        const scored = !['learn', 'grammar', 'dialogue', 'roleplay'].includes(step.type);
        if (scored && !step._retry) {
          total++;
          if (ok) right++;
          const it = step.item;
          if (it && !step.noRecord && it.kind !== 'line') Progress.record(Course.P, it, ok);
        }
        if (!ok && step.item && step.item.t) mistakes.push({ t: step.item.t, en: step.item.en });
        if (!ok && scored && !lesson.noRequeue && !step._retry && !requeued.has(step) && step.item) {
          requeued.add(step);
          const again = Course.exerciseFor(step.item, { mic: cfg.mic });
          again._retry = true;
          queue.push(again.type === 'speak' && !cfg.mic ? { ...again, type: 'type', dir: 'en-es' } : again);
        }
        if (lesson.onAnswer) lesson.onAnswer(step, ok, queue, idx);
        feedback(step, ok, info);
      }

      function feedback(step, ok, info) {
        const it = step.item || {};
        const expected = info.expected || it.t;
        const box = h('div', { class: 'fb ' + (ok ? 'good' : 'bad'), role: 'status' },
          h('div', { class: 'fb-h' }, ok ? (info.exact === false || info.note ? '✓ Correct' : '✓ ' + pick(['Correct!', 'Nice!', 'Spot on.', 'Great.'])) : '✗ Not quite'),
          info.note ? h('div', {}, info.note) : null,
          !ok && expected ? h('div', {}, 'Answer: ', h('b', {}, expected), it.t && expected === it.t ? playBtn(it.t) : null) : null,
          !ok && it.en && expected !== it.en ? h('div', { class: 'muted' }, it.en) : null,
          info.heard ? h('div', { class: 'muted' }, `Heard: “${info.heard}”`) : null);
        const extras = h('div', { class: 'fb-x' });
        if (!ok && info.given && Tutor.enabled()) {
          extras.append(h('button', { class: 'btn ghost small', onclick: async e => {
            e.target.disabled = true; e.target.textContent = 'Asking…';
            try {
              const r = await Tutor.explain({ level: cfg.level, task: info.task || describe(step), expected, given: info.given });
              extras.replaceChildren(h('div', { class: 'ai' }, h('p', {}, r.explanation), h('p', {}, h('b', {}, 'Tip: '), r.tip), h('p', { class: 'muted' }, r.example)));
            } catch (err) { e.target.textContent = err.message; }
          } }, '💡 Explain'));
          if (info.canJudge) extras.append(h('button', { class: 'btn ghost small', onclick: async e => {
            e.target.disabled = true; e.target.textContent = 'Checking…';
            try {
              const r = await Tutor.judge({ level: cfg.level, task: info.task || describe(step), expected, given: info.given });
              if (r.acceptable) overrule(step);
              extras.append(h('div', { class: 'ai' }, h('p', {}, (r.acceptable ? '✓ Your answer works too. ' : '✗ ') + r.explanation)));
              e.target.remove();
            } catch (err) { e.target.textContent = err.message; }
          } }, '🤔 Was mine OK too?'));
        }
        if (!ok && info.canOverrule) extras.append(h('button', { class: 'btn ghost small', onclick: e => { overrule(step); e.target.replaceWith(h('span', { class: 'muted' }, 'Counted as correct.')); } }, 'I was right'));
        foot.replaceChildren(box, extras, h('button', { class: 'btn wide', id: 'lnext', onclick: next }, 'Continue'));
        foot.querySelector('#lnext').focus();
        if (ok && it.t && step.type !== 'speak' && step.type !== 'dictation' && !step.noAudio) say(it.t);
      }

      // Learner says their answer was fine: undo the miss.
      function overrule(step) {
        if (step._overruled) return;
        step._overruled = true;
        if (!step._retry) {
          right++;
          if (step.item && !step.noRecord) { Progress.record(Course.P, step.item, true); }
        }
        mistakes.pop();
        const k = queue.findIndex((s, i) => i > idx && s._retry && s.item === step.item);
        if (k > -1) queue.splice(k, 1);
      }

      function next() {
        idx++;
        if (idx >= queue.length) return finish(false);
        show();
      }
      function show() {
        setBar();
        foot.replaceChildren();
        const step = queue[idx];
        const view = (VIEWS[step.type] || VIEWS.unknown)(step, { answered, next, foot, body, lesson });
        body.replaceChildren(view);
        const f = body.querySelector('[autofocus]');
        if (f) f.focus();
      }
      function onKey(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          const b = foot.querySelector('button.btn.wide:not([disabled])');
          if (b && document.activeElement && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); b.click(); }
        }
      }
      document.addEventListener('keydown', onKey);
      if (!queue.length) return finish(false);
      show();
    });
  }

  const pick = a => a[Math.floor(Math.random() * a.length)];
  function describe(step) {
    const it = step.item || {};
    switch (step.type) {
      case 'mcq': return step.dir === 'es-en' ? `What does "${it.t}" mean?` : `Say "${it.en}" in Spanish.`;
      case 'type': return step.dir === 'es-en' ? `Translate into English: "${it.t}"` : `Translate into Spanish: "${it.en}"`;
      case 'tiles': return `Build the Spanish for: "${it.en}"`;
      case 'dictation': return 'Write down the Spanish you hear.';
      case 'gap': return `Fill the gap: "${it.t}" (${it.en})`;
      case 'speak': return `Say in Spanish: "${it.en}"`;
      default: return 'Spanish exercise';
    }
  }

  // Footer with a Check button bound to fn.
  function checkBar(foot, fn, label = 'Check') {
    const b = h('button', { class: 'btn wide', onclick: fn }, label);
    foot.replaceChildren(b);
    return b;
  }

  // ---------- exercise views ----------
  const VIEWS = {
    learn(step, ctx) {
      const it = step.item;
      setTimeout(() => say(it.t), 150);
      checkBar(ctx.foot, ctx.next, 'Got it');
      return h('div', { class: 'card-x learn' },
        h('div', { class: 'eyebrow' }, 'New word'),
        h('div', { class: 'es big' }, it.t, ' ', playBtn(it.t), playBtn(it.t, '🐢', true)),
        h('div', { class: 'en' }, it.en),
        it.g ? h('div', { class: 'tag' }, it.g === 'm' ? 'masculine' : 'feminine') : null,
        it.alt && it.alt.length ? h('div', { class: 'muted' }, 'Also: ' + it.alt.join(', ')) : null);
    },

    grammar(step, ctx) {
      const g = step.g;
      checkBar(ctx.foot, ctx.next, 'Got it');
      return h('div', { class: 'card-x grammar' },
        h('div', { class: 'eyebrow' }, 'Grammar'),
        h('h2', {}, g.title),
        h('p', {}, g.explain),
        g.table ? h('table', { class: 'gt' },
          h('thead', {}, h('tr', {}, ...g.table.head.map(c => h('th', {}, c)))),
          h('tbody', {}, ...g.table.rows.map(r => h('tr', {}, ...r.map((c, i) => h('td', { class: i ? 'es' : '' }, c)))))) : null,
        h('div', { class: 'ex' }, ...g.examples.map(e => h('div', { class: 'exl' }, playBtn(e.t), h('div', {}, h('div', { class: 'es' }, e.t), h('div', { class: 'muted' }, e.en))))));
    },

    mcq(step, ctx) {
      const it = step.item;
      if (step.promptLang) setTimeout(() => say(step.prompt), 150);
      let done = false;
      const opts = h('div', { class: 'opts' }, ...step.options.map((o, i) => h('button', { class: 'opt', 'data-k': i + 1, 'data-v': o, onclick: e => {
        if (done) return;
        done = true;
        const ok = o === step.answer;
        e.currentTarget.classList.add(ok ? 'good' : 'bad');
        opts.querySelectorAll('.opt').forEach(b => { if (b.dataset.v === step.answer) b.classList.add('good'); b.disabled = true; });
        ctx.answered(step, ok, { expected: step.answer, given: o, task: describe(step) });
      } }, h('span', { class: 'k' }, String(i + 1)), o)));
      const keyer = e => { if (done) return document.removeEventListener('keydown', keyer); const b = opts.querySelector(`[data-k="${e.key}"]`); if (b) b.click(); };
      document.addEventListener('keydown', keyer);
      return h('div', { class: 'card-x' },
        h('div', { class: 'eyebrow' }, step.dir === 'es-en' ? 'What does this mean?' : 'Choose the Spanish'),
        h('div', { class: step.dir === 'es-en' ? 'es big' : 'en big' }, step.prompt, step.promptLang ? playBtn(step.prompt) : null),
        opts);
    },

    type(step, ctx) {
      const it = step.item;
      const toEn = step.dir === 'es-en';
      const sentence = it.kind === 's' || it.kind === 'line';
      const inp = h('input', { class: 'inp', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', lang: toEn ? 'en' : 'es', placeholder: toEn ? 'Type the English…' : 'Escribe en español…', autofocus: true });
      if (toEn) setTimeout(() => say(it.t), 150);
      checkBar(ctx.foot, () => {
        if (!inp.value.trim()) return inp.focus();
        inp.disabled = true;
        const res = checkTyped(inp.value, toEn ? enAnswers(it) : esAnswers(it), { english: toEn });
        ctx.answered(step, res.ok, { ...res, expected: toEn ? it.en : it.t, given: inp.value, canJudge: sentence && !res.ok, canOverrule: toEn && !res.ok });
      });
      return h('div', { class: 'card-x' },
        h('div', { class: 'eyebrow' }, toEn ? 'Translate into English' : 'Translate into Spanish'),
        h('div', { class: toEn ? 'es big' : 'en big' }, toEn ? it.t : it.en, toEn ? playBtn(it.t) : null),
        inp, toEn ? null : accentBar(inp));
    },

    dictation(step, ctx) {
      const it = step.item;
      setTimeout(() => say(it.t), 200);
      const inp = h('input', { class: 'inp', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', lang: 'es', placeholder: 'Write what you hear…', autofocus: true });
      checkBar(ctx.foot, () => {
        if (!inp.value.trim()) return inp.focus();
        inp.disabled = true;
        const res = checkTyped(inp.value, [it.t, ...(it.alt || [])]);
        ctx.answered(step, res.ok, { ...res, expected: it.t, given: inp.value });
      });
      return h('div', { class: 'card-x' },
        h('div', { class: 'eyebrow' }, 'Listen and write'),
        h('div', { class: 'listen' }, h('button', { class: 'play huge', onclick: () => say(it.t) }, '🔊'), h('button', { class: 'play huge', onclick: () => say(it.t, true) }, '🐢')),
        inp, accentBar(inp));
    },

    tiles(step, ctx) {
      const it = step.item;
      const words = it.t.split(/\s+/);
      const others = Course.sentenceItems(Course.units.find(u => u.id === it.unit) || Course.units[0])
        .filter(s => s.t !== it.t).flatMap(s => s.t.split(/\s+/))
        .filter(w => !words.some(x => loose(x) === loose(w)));
      const extra = Progress.shuffle([...new Set(others)]).slice(0, Math.min(3, Math.max(1, Math.round(words.length / 3))));
      const bank = Progress.shuffle([...words, ...extra]).map((w, i) => ({ w, i }));
      const line = h('div', { class: 'tline' });
      const pool = h('div', { class: 'tpool' });
      const chosen = [];
      const render = () => {
        line.replaceChildren(...chosen.map(c => h('button', { class: 'tile', onclick: () => { chosen.splice(chosen.indexOf(c), 1); render(); } }, c.w)));
        pool.replaceChildren(...bank.map(c => h('button', { class: 'tile', disabled: chosen.includes(c), onclick: () => { chosen.push(c); say(c.w); render(); } }, c.w)));
      };
      render();
      checkBar(ctx.foot, () => {
        if (!chosen.length) return;
        const given = chosen.map(c => c.w).join(' ');
        line.querySelectorAll('button').forEach(b => b.disabled = true);
        pool.querySelectorAll('button').forEach(b => b.disabled = true);
        const res = checkTyped(given, [it.t, ...(it.alt || [])]);
        ctx.answered(step, res.ok, { ...res, expected: it.t, given, canJudge: !res.ok });
      });
      return h('div', { class: 'card-x' }, h('div', { class: 'eyebrow' }, 'Build the sentence'), h('div', { class: 'en big' }, it.en), line, pool);
    },

    gap(step, ctx) {
      const d = step.item;
      const [a, b] = d.t.split('___');
      const full = a + d.answer + b;
      const sentence = h('div', { class: 'es big gap' }, a, h('span', { class: 'blank' }, '____'), b);
      const reveal = ok => { sentence.querySelector('.blank').textContent = d.answer; sentence.querySelector('.blank').classList.add(ok ? 'good' : 'bad'); say(full); };
      const it = { ...d, t: full, en: d.en, kind: 'd', unit: d.unit };
      const recordItem = d; // progress keyed by the drill template
      const common = h('div', {}, h('div', { class: 'eyebrow' }, 'Fill the gap'), sentence, h('div', { class: 'muted' }, d.en), d.hint ? h('div', { class: 'tag' }, d.hint) : null);
      const fakeStep = { ...step, item: recordItem, noAudio: true };
      if (step.mode === 'mcq') {
        let done = false;
        const opts = h('div', { class: 'opts' }, ...Progress.shuffle(d.options).map(o => h('button', { class: 'opt', onclick: e => {
          if (done) return; done = true;
          const ok = o === d.answer;
          e.currentTarget.classList.add(ok ? 'good' : 'bad');
          opts.querySelectorAll('.opt').forEach(x => x.disabled = true);
          reveal(ok);
          answeredGap(ok, o);
        } }, o)));
        return h('div', { class: 'card-x' }, common, opts);
      }
      const inp = h('input', { class: 'inp', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', lang: 'es', placeholder: 'Missing word(s)…', autofocus: true });
      checkBar(ctx.foot, () => {
        if (!inp.value.trim()) return inp.focus();
        inp.disabled = true;
        const res = checkTyped(inp.value, [d.answer]);
        reveal(res.ok);
        answeredGap(res.ok, inp.value, res);
      });
      return h('div', { class: 'card-x' }, common, inp, accentBar(inp));

      function answeredGap(ok, given, res = {}) {
        ctx.answered(fakeStep, ok, { ...res, expected: d.answer, given, task: `Fill the gap: "${d.t}" (${d.en})` });
        step._overruled = fakeStep._overruled;
        void it;
      }
    },

    speak(step, ctx) {
      const it = step.item;
      const shadow = step.shadow;
      if (shadow) setTimeout(() => say(it.t), 150);
      let tries = 0;
      const status = h('div', { class: 'muted', role: 'status' }, Speech.canListen ? 'Tap the microphone and speak.' : 'Speech recognition is not available in this browser.');
      const micBtn = h('button', { class: 'mic', onclick: listen, 'aria-label': 'Speak' }, '🎙️');
      async function listen() {
        micBtn.disabled = true; micBtn.classList.add('on'); status.textContent = 'Listening…';
        await Speech.cues.listen();
        const r = await Speech.listen(LANG, 7000);
        micBtn.disabled = false; micBtn.classList.remove('on');
        if (r.error) { status.textContent = `Microphone problem (${r.error}). You can type instead.`; return; }
        if (!r.alts.length) { status.textContent = "I didn't catch that. Try again."; return; }
        const sc = Engine.score(r.alts, esAnswers(it));
        tries++;
        if (sc >= 0.8 || (sc >= 0.6 && tries >= 1)) {
          micBtn.disabled = true;
          ctx.answered(step, true, { heard: r.alts[0], note: sc < 0.8 ? 'Close enough. Listen to it once more.' : null });
          if (sc < 0.8) say(it.t);
        } else if (tries < 2) {
          status.textContent = `Heard “${r.alts[0]}”. Try once more.`;
          say(it.t, true);
        } else {
          micBtn.disabled = true;
          ctx.answered(step, false, { heard: r.alts[0], expected: it.t });
        }
      }
      ctx.foot.replaceChildren(h('button', { class: 'btn ghost wide', onclick: () => {
        // fall back to typing
        const s2 = { ...step, type: 'type', dir: 'en-es' };
        ctx.body.replaceChildren(VIEWS.type(s2, { ...ctx, answered: (_s, ok, info) => ctx.answered(step, ok, info) }));
        ctx.body.querySelector('input').focus();
      } }, "Can't speak now: type it"));
      return h('div', { class: 'card-x' },
        h('div', { class: 'eyebrow' }, shadow ? 'Say it after the speaker' : 'Say it in Spanish'),
        h('div', { class: shadow ? 'es big' : 'en big' }, shadow ? it.t : it.en, shadow ? playBtn(it.t) : null),
        h('div', { class: 'listen' }, micBtn), status);
    },

    dialogue(step, ctx) {
      const d = step.dialogue;
      let showEn = false;
      const list = h('div', { class: 'dlg' });
      const render = () => list.replaceChildren(...d.lines.map(l => h('div', { class: 'dl' }, playBtn(l.t), h('div', {}, h('b', {}, l.who + ': '), h('span', { class: 'es' }, l.t), showEn ? h('div', { class: 'muted' }, l.en) : null))));
      render();
      let playing = false;
      async function playAll() {
        if (playing) { playing = false; Speech.cancel(); return; }
        playing = true;
        for (const l of d.lines) { if (!playing) break; await Speech.speak(l.t, LANG, { rate: cfg.rate }); await new Promise(r => setTimeout(r, 350)); }
        playing = false;
      }
      checkBar(ctx.foot, () => { playing = false; Speech.cancel(); ctx.next(); }, 'On to the questions');
      setTimeout(playAll, 300);
      return h('div', { class: 'card-x' },
        h('div', { class: 'eyebrow' }, 'Listen: ' + d.title),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost small', onclick: playAll }, '▶ Play / stop'), h('button', { class: 'btn ghost small', onclick: () => { showEn = !showEn; render(); } }, 'Show / hide English')),
        list);
    },

    question(step, ctx) {
      const q = step.q;
      let done = false;
      const opts = h('div', { class: 'opts' }, ...q.options.map((o, i) => h('button', { class: 'opt', onclick: e => {
        if (done) return; done = true;
        const ok = i === q.answer;
        e.currentTarget.classList.add(ok ? 'good' : 'bad');
        opts.children[q.answer].classList.add('good');
        opts.querySelectorAll('.opt').forEach(x => x.disabled = true);
        ctx.answered({ ...step, item: null }, ok, { expected: q.options[q.answer] });
      } }, o)));
      return h('div', { class: 'card-x' },
        h('div', { class: 'eyebrow' }, 'Question about: ' + step.dialogue.title),
        h('div', { class: 'en big' }, q.q),
        h('button', { class: 'btn ghost small', onclick: async () => { for (const l of step.dialogue.lines) await Speech.speak(l.t, LANG, { rate: cfg.rate }); } }, '🔊 Hear it again'),
        opts);
    },

    roleplay(step, ctx) {
      return Chat.view({
        unit: step.unit,
        level: step.unit.level,
        onDone(res) { ctx.lesson._skipped = res.skipped; ctx.next(); },
        foot: ctx.foot,
      });
    },

    unknown(step, ctx) { checkBar(ctx.foot, ctx.next, 'Skip'); return h('div', {}, 'Unknown exercise.'); },
  };

  function accentBar(inp) {
    return h('div', { class: 'accents' }, ...['á', 'é', 'í', 'ó', 'ú', 'ñ', 'ü', '¿', '¡'].map(c => h('button', { type: 'button', class: 'acc', onclick: () => {
      const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? s;
      inp.value = inp.value.slice(0, s) + c + inp.value.slice(e);
      inp.focus(); inp.setSelectionRange(s + 1, s + 1);
    } }, c)));
  }

  return { run, h, say, playBtn, checkTyped };
})();

// ---------- AI conversation view (used in lessons and the Tutor tab) ----------
const Chat = (() => {
  const h = (...a) => Lesson.h(...a);

  function view({ unit, level, onDone, foot, free, topic }) {
    const known = Course.knownWords();
    const ctx = free
      ? Tutor.freeContext(level, known, topic)
      : { level, scenario: unit.roleplay.scenario, aiRole: unit.roleplay.aiRole, learnerGoal: unit.roleplay.learnerGoal, known, grammar: unit.grammar.map(g => g.title) };

    if (!Tutor.enabled()) {
      if (foot) foot.replaceChildren(h('button', { class: 'btn wide', onclick: () => onDone({ skipped: true }) }, 'Skip for now'));
      return h('div', { class: 'card-x' },
        h('div', { class: 'eyebrow' }, 'Conversation practice'),
        h('h2', {}, 'Your AI tutor is not set up yet'),
        h('p', {}, 'Role-play conversations need an Anthropic API key. Add one on the Tutor tab, then come back to this step. You can skip it for now and still unlock the unit check.'),
        unit ? h('p', { class: 'muted' }, 'Scenario: ' + unit.roleplay.scenario) : null);
    }

    const history = [];
    let turns = 0;
    let goalMet = false;
    let busy = false;
    let autoSpeak = true;
    const log = h('div', { class: 'chat', 'aria-live': 'polite' });
    const inp = h('textarea', { class: 'inp chat-inp', rows: 2, lang: 'es', placeholder: 'Escribe tu respuesta… (Enter to send)' });
    const hint = h('div', { class: 'muted small' });
    const send = h('button', { class: 'btn', onclick: () => submit(inp.value) }, 'Send');
    const mic = h('button', { class: 'mic small', 'aria-label': 'Speak your reply', onclick: speak }, '🎙️');
    const status = h('div', { class: 'muted small', role: 'status' });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(inp.value); } });

    function bubble(who, main, sub, extra) {
      const b = h('div', { class: 'msg ' + who }, h('div', { class: who === 'ai' ? 'es' : '' }, main, who === 'ai' ? Lesson.playBtn(main) : null), sub ? h('div', { class: 'muted small' }, sub) : null, extra);
      log.append(b);
      log.scrollTop = log.scrollHeight;
      return b;
    }

    async function turn(text, spoken) {
      busy = true; send.disabled = true; mic.disabled = true;
      status.textContent = 'Thinking…';
      if (text != null) history.push({ role: 'user', text });
      try {
        const r = await Tutor.roleplayTurn({ ...ctx, spoken }, history);
        history.push({ role: 'assistant', text: JSON.stringify(r) });
        if (text != null && r.feedback) {
          const last = log.lastElementChild;
          const fb = r.feedback.ok
            ? h('div', { class: 'fbk good' }, '✓ ' + (r.feedback.note || 'Good.'))
            : h('div', { class: 'fbk bad' }, '✎ ', h('b', {}, r.feedback.corrected), r.feedback.note ? h('div', {}, r.feedback.note) : null);
          if (last) last.append(fb);
          Progress.addTime(0);
        }
        let revealed = false;
        const enLine = h('div', { class: 'muted small', hidden: true }, r.reply_en);
        bubble('ai', r.reply_es, null, h('div', {}, h('button', { class: 'linkish', onclick: e => { revealed = !revealed; enLine.hidden = !revealed; e.target.textContent = revealed ? 'Hide English' : 'Show English'; } }, 'Show English'), enLine));
        hint.textContent = r.suggestion ? 'Idea: ' + r.suggestion : '';
        if (autoSpeak) Lesson.say(r.reply_es);
        if (text != null) turns++;
        if (r.goal_met && !goalMet) {
          goalMet = true;
          status.textContent = '🎉 Goal reached! Finish when you like, or keep chatting.';
        } else status.textContent = '';
      } catch (err) {
        status.textContent = err.message;
        if (text != null) history.pop();
      }
      busy = false; send.disabled = false; mic.disabled = false;
      inp.focus();
    }
    function submit(text) {
      text = (text || '').trim();
      if (!text || busy) return;
      bubble('me', text);
      inp.value = '';
      turn(text, false);
    }
    async function speak() {
      if (busy) return;
      if (!Speech.canListen) { status.textContent = 'Speech recognition is not available in this browser.'; return; }
      Speech.cancel();
      mic.classList.add('on'); status.textContent = 'Listening… speak in Spanish';
      await Speech.cues.listen();
      const r = await Speech.listen('es-ES', 9000);
      mic.classList.remove('on'); status.textContent = '';
      if (r.error) { status.textContent = `Microphone problem (${r.error}).`; return; }
      if (!r.alts.length) { status.textContent = "I didn't catch that."; return; }
      bubble('me', r.alts[0]);
      turn(r.alts[0], true);
    }

    const doneBtn = h('button', { class: 'btn wide', onclick: () => { Speech.cancel(); onDone({ skipped: false, turns, goalMet }); } }, free ? 'End conversation' : 'Finish conversation');
    if (foot) foot.replaceChildren(doneBtn);
    turn(null, false);

    return h('div', { class: 'card-x chatwrap' },
      h('div', { class: 'eyebrow' }, free ? 'Free conversation' : 'Role-play'),
      unit && !free ? h('div', {}, h('b', {}, 'Your goal: '), unit.roleplay.learnerGoal) : null,
      h('label', { class: 'toggle small' }, h('input', { type: 'checkbox', checked: true, onchange: e => { autoSpeak = e.target.checked; } }), 'Read replies aloud'),
      log,
      hint,
      h('div', { class: 'chat-row' }, mic, inp, send),
      status,
      foot ? null : doneBtn);
  }

  return { view };
})();
