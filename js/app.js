// App shell: tabs, Today plan, Course map, Drive (hands-free), Tutor, Progress & settings.
(() => {
  const $ = id => document.getElementById(id);
  const h = Lesson.h;
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
  const SKEY = 'lt.settings.v1';
  const DEFAULTS = {
    packId: 'course', topicId: 'all', length: 10, think: 5, speed: 1, accent: 'en-GB',
    repeatBack: true, hints: true, safetySeen: false, speakEx: true, tab: 'today',
  };
  let S = { ...DEFAULTS };
  try { S = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SKEY)) || {}) }; } catch (_) {}
  const saveS = () => { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch (_) {} };

  const lessonCfg = () => ({ rate: S.speed, mic: S.speakEx && Speech.canListen, level: (Course.currentUnit() || Course.units[Course.units.length - 1] || {}).level || 'A1' });

  function chips(container, options, current, onPick) {
    container.replaceChildren(...options.map(o =>
      h('button', { class: 'chip', 'aria-pressed': String(o.value === current), onclick: () => onPick(o.value) }, o.label)));
  }

  // ---------- tabs ----------
  function showTab(tab) {
    S.tab = tab; saveS();
    document.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('[data-page]').forEach(p => { p.hidden = p.dataset.page !== tab; });
    render();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[role=tab]').forEach(b => { b.onclick = () => showTab(b.dataset.tab); });

  function render() {
    const streak = Progress.streakDays();
    $('streakChip').textContent = streak ? `🔥 ${streak}` : '';
    ({ today: renderToday, course: renderCourse, drive: renderDrive, tutor: renderTutor, progress: renderProgressTab }[S.tab] || renderToday)();
  }

  // ---------- running lessons ----------
  async function runStage(u, stageId) {
    Speech.unlockAudio();
    const cfg = lessonCfg();
    cfg.level = u.level;
    const lesson = Course.stageLesson(u, stageId, cfg.mic);
    if (stageId === 'check') {
      lesson.summaryText = r => {
        const pct = Math.round(100 * r.right / Math.max(1, r.total));
        return pct >= 80 ? `Unit passed with ${pct}%. The next unit is unlocked.` : `${pct}%. You need 80% to pass. Your reviews will focus on the misses, then try again.`;
      };
    }
    const res = await Lesson.run(lesson, cfg);
    if (!res.aborted) Course.finishStage(u, stageId, res);
    render();
    return res;
  }
  async function runReview(count) {
    Speech.unlockAudio();
    const res = await Lesson.run(Course.reviewLesson(count, lessonCfg().mic), lessonCfg());
    render();
    return res;
  }
  async function runWeak(count) {
    Speech.unlockAudio();
    const res = await Lesson.run(Course.weakLesson(count, lessonCfg().mic), lessonCfg());
    render();
    return res;
  }

  async function runPlacement() {
    Speech.unlockAudio();
    const blocks = Course.placementSteps();
    const steps = blocks.flatMap(b => b.qs);
    const tally = {};
    let weakRun = 0;
    const lesson = {
      title: 'Placement check',
      steps: [{ type: 'grammar', g: { title: "Let's find your level", explain: "You'll get a few quick questions from each unit, getting harder as you go. Don't guess wildly: it's fine to get things wrong, and the check stops once it finds where you should start.", examples: [] } }, ...steps],
      noRequeue: true,
      onAnswer(step, ok, queue, idx) {
        const id = step.placement;
        if (!id) return;
        const t = (tally[id] ||= { right: 0, n: 0 });
        t.n++; if (ok) t.right++;
        if (t.n === 3) {
          weakRun = t.right < 2 ? weakRun + 1 : 0;
          if (weakRun >= 2) queue.length = idx + 1;
        }
      },
      summaryText() {
        const placed = [];
        for (const b of blocks) { const t = tally[b.unit.id]; if (t && t.n === 3 && t.right >= 2) placed.push(b.unit); else break; }
        lesson._placed = placed;
        return placed.length
          ? `You can skip ${placed.length} unit${placed.length > 1 ? 's' : ''} (up to “${placed[placed.length - 1].title}”). Their words will come back in light reviews to make sure they stick.`
          : "Let's start from the first unit. It will move quickly over anything you already know.";
      },
    };
    const res = await Lesson.run(lesson, lessonCfg());
    if (res.aborted) { render(); return res; }
    Course.placeOut((lesson._placed || []).map(u => u.id));
    render();
    return res;
  }

  async function runPlanStep(s) {
    if (s.kind === 'placement') return runPlacement();
    if (s.kind === 'review') return runReview(s.count);
    if (s.kind === 'weak') return runWeak(s.count);
    if (s.kind === 'stage') return runStage(s.unit, s.stage.id);
  }

  // Work through the plan, recomputing it after each step so it adapts as you go.
  async function runToday() {
    for (let i = 0; i < 6; i++) {
      const p = Course.plan();
      const s = p.steps[0];
      if (!s) break;
      const res = await runPlanStep(s);
      if (!res || res.aborted) break;
      if (s.kind === 'stage' && !Course.plan().steps.some(x => x.kind !== 'stage') && i > 0) break;
    }
    render();
  }

  // ---------- TODAY ----------
  function planLabel(s) {
    if (s.kind === 'placement') return ['🧭', 'Placement check', 'A few minutes to find where you should start.'];
    if (s.kind === 'review') return ['🔁', `Review ${s.count} item${s.count > 1 ? 's' : ''}`, 'Spaced repetition: things you are about to forget.'];
    if (s.kind === 'weak') return ['🎯', `Fix weak spots (${s.count})`, 'Items you keep missing, from easy to hard.'];
    return [s.stage.icon, `${s.unit.title}: ${s.stage.name}${s.bonus ? ' (bonus)' : ''}`, s.stage.desc];
  }

  function renderToday() {
    const p = Course.plan();
    const tot = Progress.totals();
    const mins = Math.round(tot.today.secs / 60);
    const goal = Course.goalMins;
    const pct = Math.min(100, Math.round(100 * mins / goal));
    const paceName = { consolidate: 'Consolidation day', steady: 'Steady progress', stretch: 'Stretch day' }[p.pace];
    const cu = p.unit;

    const box = $('todayBox');
    if (!Course.units.length) { box.replaceChildren(h('section', { class: 'card' }, 'Course content failed to load.')); return; }

    fill(box,
      h('section', { class: 'card hero' },
        h('div', { class: 'ring', style: `--p:${pct}`, role: 'img', 'aria-label': `${mins} of ${goal} minutes today` }, h('div', {}, h('b', {}, String(mins)), h('small', {}, `/ ${goal} min`))),
        h('div', {},
          h('div', { class: 'eyebrow' }, cu ? `${cu.level} · Unit ${Course.units.indexOf(cu) + 1} of ${Course.units.length}` : 'Course complete'),
          h('h2', {}, cu ? cu.title : '¡Enhorabuena! You finished the course.'),
          cu ? h('p', { class: 'muted' }, cu.goal) : null)),
      h('section', { class: 'card' },
        h('div', { class: 'pace ' + p.pace }, paceName),
        h('p', {}, p.why),
        p.steps.length ? h('ol', { class: 'plan' }, ...p.steps.map((s, i) => {
          const [ic, t, d] = planLabel(s);
          return h('li', {}, h('span', { class: 'ic' }, ic), h('div', {}, h('b', {}, t), h('small', {}, d)), h('button', { class: 'btn ghost small', onclick: () => runPlanStep(s) }, i === 0 ? 'Start' : 'Do this'));
        })) : h('p', { class: 'muted' }, "You're all caught up. Try a conversation with your tutor, or a hands-free session in the car."),
        p.steps.length ? h('button', { class: 'btn wide', onclick: runToday }, "▶ Start today's session") : null),
      h('section', { class: 'card' },
        h('h2', {}, 'In the car'),
        h('p', { class: 'muted' }, `${Course.metItems().length} words and sentences you've met are ready for hands-free review. Set it up before you set off.`),
        h('button', { class: 'btn ghost', onclick: () => showTab('drive') }, '🚗 Hands-free practice')),
      h('section', { class: 'card' },
        h('h2', {}, 'How this works'),
        h('ul', { class: 'cmds' },
          h('li', {}, h('b', {}, 'Your pace: '), 'each day starts with reviews that are due. New material only comes when your recent accuracy and review pile say you are ready.'),
          h('li', {}, h('b', {}, 'Spaced repetition: '), 'every word, sentence and grammar drill comes back just before you would forget it, at growing intervals.'),
          h('li', {}, h('b', {}, 'Getting harder: '), 'items move from recognising, to typing, to hearing and saying them as you get them right.'),
          h('li', {}, h('b', {}, 'Mistakes come back: '), 'anything you miss reappears at the end of the lesson and in your next reviews.'))));
  }

  // ---------- COURSE ----------
  function renderCourse() {
    const box = $('courseBox');
    const levels = ['A1', 'A2', 'B1'];
    const cu = Course.currentUnit();
    fill(box,
      !Course.placementDone && !Course.metItems().length ? h('section', { class: 'card' },
        h('h2', {}, 'Already know some Spanish?'),
        h('p', { class: 'muted' }, 'Take a short placement check to skip units you know.'),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: runPlacement }, 'Take placement check'), h('button', { class: 'btn ghost', onclick: () => { Course.skipPlacement(); render(); } }, 'Start from unit 1'))) : null,
      ...levels.map(lv => {
        const us = Course.units.filter(u => u.level === lv);
        if (!us.length) return h('section', { class: 'card' }, h('h2', {}, lv), h('p', { class: 'muted' }, 'Coming soon.'));
        return h('section', { class: 'card' },
          h('h2', {}, { A1: 'A1 · Beginner', A2: 'A2 · Elementary', B1: 'B1 · Intermediate' }[lv]),
          h('div', { class: 'units' }, ...us.map(u => unitCard(u, u === cu))));
      }));
  }

  function unitCard(u, isCurrent) {
    const i = Course.units.indexOf(u);
    const open = Course.isUnlocked(i);
    const p = Course.unitProgress(u);
    const status = p.passed ? '✅ Passed' + (p.best ? ` · ${p.best}%` : '') : p.placedOut ? '⏭ Placed out' : isCurrent ? '▶ Current' : open ? '' : '🔒 Locked';
    const learnedPct = Math.round(100 * p.learned / Math.max(1, p.total));
    const masteredPct = Math.round(100 * p.mastered / Math.max(1, p.total));
    const card = h('details', { class: 'unit' + (isCurrent ? ' current' : '') + (open ? '' : ' locked'), open: isCurrent || null },
      h('summary', {},
        h('div', { class: 'u-n' }, String(i + 1)),
        h('div', { class: 'u-t' }, h('b', {}, u.title), h('small', {}, u.goal)),
        h('div', { class: 'u-s' }, status),
        h('div', { class: 'track' }, h('div', { class: 'm', style: `width:${masteredPct}%` }), h('div', { class: 's', style: `width:${learnedPct - masteredPct}%` }))));
    if (open) {
      const st = Course.us(u.id);
      card.append(h('div', { class: 'stages' }, ...Course.STAGES.map(s => {
        const done = st.stages[s.id];
        return h('button', { class: 'stage' + (done ? ' done' : ''), onclick: () => runStage(u, s.id) },
          h('span', {}, s.icon), h('b', {}, s.name), h('small', {}, done === 'skipped' ? 'skipped' : done ? 'done ✓' : s.desc));
      })),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost small', onclick: async e => {
          if (!Tutor.enabled()) { alert('Add your API key on the Tutor tab to generate extra practice.'); return; }
          const b = e.currentTarget; b.disabled = true; b.textContent = 'Writing new practice…';
          try {
            const out = await Tutor.generate({ unit: u, known: Course.knownWords() });
            const cur = Course.addExtra(u.id, out.sentences, out.drills);
            b.textContent = `Added ${out.sentences.length} sentences and ${out.drills.length} drills (${cur.sentences.length + cur.drills.length} extra in total)`;
          } catch (err) { b.textContent = err.message; b.disabled = false; }
        } }, '✨ More practice from AI tutor'),
        h('button', { class: 'btn ghost small', onclick: () => { S.packId = 'course-unit:' + u.id; saveS(); showTab('drive'); } }, '🚗 Practise this unit hands-free')));
    }
    return card;
  }

  // ---------- DRIVE ----------
  const DRIVE_MODES = [
    { id: 'learn', group: 'lesson', icon: '🎧', name: 'Learn new words', desc: 'Hear it, then say it back.' },
    { id: 'recall', group: 'lesson', icon: '💬', name: 'Quick recall', desc: 'Hear English, answer in {lang}.' },
    { id: 'flash', group: 'lesson', icon: '📻', name: 'Audio flashcards', desc: 'Listen only. No microphone needed.' },
    { id: 'chat', group: 'lesson', icon: '🗣️', name: 'Talk with your tutor', desc: 'A free spoken conversation (AI).', needs: 'ai' },
    { id: 'streak', group: 'game', icon: '🔥', name: 'Streak Challenge', desc: 'Three lives. How far can you go?', best: true },
    { id: 'tf', group: 'game', icon: '✅', name: 'True or False', desc: 'Just say yes or no.', best: true },
    { id: 'meaning', group: 'game', icon: '🔄', name: 'Meaning Match', desc: 'Hear {lang}, say the English.', best: true },
    { id: 'numbers', group: 'game', icon: '🔢', name: 'Number Crunch', desc: 'Quick sums, answered in {lang}.', best: true },
  ];
  const COURSE_PACK = { id: 'es', name: 'Spanish', lang: 'es-ES', flag: '🇪🇸' };

  // Resolves the current drive selection into { pack, pool, label, topics }.
  function driveSource() {
    if (S.packId === 'course' || S.packId.startsWith('course-unit:')) {
      const unitId = S.packId.startsWith('course-unit:') ? S.packId.slice(12) : null;
      const u = unitId && Course.units.find(x => x.id === unitId);
      let pool;
      if (u) pool = [...Course.vocabItems(u), ...Course.sentenceItems(u)];
      else if (S.topicId === 'current') pool = Course.drivePool('current');
      else if (S.topicId === 'due') pool = Course.dueItems().filter(it => it.kind !== 'd');
      else pool = Course.drivePool('met');
      if (!pool.length && !u) pool = Course.drivePool('current');
      // numbers for Number Crunch come from the phrasebook if the course hasn't covered them yet
      const numberSrc = Packs.get('es');
      const pack = { ...COURSE_PACK, topics: [{ id: 'all', name: 'All', items: [...pool, ...Packs.items(numberSrc, 'all').filter(x => x.n != null)] }] };
      return { pack, pool, unit: u, course: true };
    }
    const p = Packs.get(S.packId) || Packs.all()[0];
    if (S.topicId !== 'all' && !p.topics.some(t => t.id === S.topicId)) S.topicId = 'all';
    return { pack: p, pool: Packs.items(p, S.topicId), course: false };
  }

  function renderDrive() {
    $('safety').hidden = S.safetySeen;
    const src = driveSource();
    const packOpts = [{ value: 'course', label: '🇪🇸 My Spanish course' }];
    if (src.unit) packOpts.push({ value: S.packId, label: `📘 ${src.unit.title}` });
    packOpts.push(...Packs.all().map(x => ({ value: x.id, label: `${x.flag} ${x.name} phrasebook` })));
    chips($('packList'), packOpts, S.packId, v => { S.packId = v; S.topicId = v === 'course' ? 'all' : 'all'; saveS(); render(); });
    if (src.course && !src.unit) {
      chips($('topicList'), [
        { value: 'all', label: `Everything I've met (${Course.drivePool('met').length})` },
        { value: 'due', label: `Due for review (${Course.dueItems().filter(it => it.kind !== 'd').length})` },
        { value: 'current', label: 'Current unit' },
      ], S.topicId, v => { S.topicId = v; saveS(); render(); });
    } else if (src.unit) {
      $('topicList').replaceChildren(h('span', { class: 'muted' }, `${src.pool.length} words and sentences from this unit`));
    } else {
      chips($('topicList'), [{ value: 'all', label: 'Everything' }, ...src.pack.topics.map(t => ({ value: t.id, label: t.name }))], S.topicId, v => { S.topicId = v; saveS(); render(); });
    }
    chips($('lenList'), [5, 10, 20].map(n => ({ value: n, label: `${n} items` })), S.length, v => { S.length = v; saveS(); render(); });

    for (const group of ['lesson', 'game']) {
      fill($(group === 'lesson' ? 'lessonModes' : 'gameModes'), ...DRIVE_MODES.filter(m => m.group === group).map(m => {
        if (m.needs === 'ai' && (!src.course)) return null;
        const best = m.best ? Progress.best(m.id, src.pack.id) : 0;
        const off = m.needs === 'ai' && !Tutor.enabled();
        return h('button', { class: 'mode' + (off ? ' off' : ''), onclick: () => off ? showTab('tutor') : startSession(m.id) },
          h('span', { class: 'ic', 'aria-hidden': 'true' }, m.icon),
          h('b', {}, m.name),
          h('small', {}, off ? 'Set up the AI tutor first.' : m.desc.replace('{lang}', src.pack.name)),
          best ? h('span', { class: 'best' }, `Best: ${best}`) : null);
      }));
    }
  }

  // ---------- TUTOR ----------
  let chatOpen = false;
  function renderTutor() {
    const box = $('tutorBox');
    if (chatOpen) return;
    const key = Tutor.getKey();
    const masked = key ? key.slice(0, 10) + '…' + key.slice(-4) : '';
    const keyInput = h('input', { class: 'inp', type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off', 'aria-label': 'Anthropic API key' });
    const msg = h('p', { class: 'msg', role: 'status' });
    const cu = Course.currentUnit() || Course.units[0];
    const topicInp = h('input', { class: 'inp', placeholder: 'Optional topic, e.g. “my weekend”, “ordering at a café”…' });
    fill(box,
      h('section', { class: 'card' },
        h('h2', {}, '🤖 Your AI tutor'),
        h('p', {}, 'The tutor uses Claude to: run role-play conversations at the end of each unit, explain your mistakes in plain English, check whether your own wording is also correct, write fresh practice at your level, and chat with you hands-free in the car.'),
        key ? h('div', {}, h('p', {}, '✅ Connected with key ', h('code', {}, masked)),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost', onclick: async e => { const b = e.target; b.disabled = true; msg.textContent = 'Testing…'; try { await Tutor.judge({ level: 'A1', task: 'Say hello', expected: 'hola', given: 'hola' }); msg.textContent = '✓ The tutor is working.'; } catch (err) { msg.textContent = err.message; } b.disabled = false; } }, 'Test connection'),
            h('button', { class: 'btn ghost danger', onclick: () => { if (confirm('Remove the API key from this browser?')) { Tutor.setKey(''); render(); } } }, 'Remove key')))
          : h('div', {},
            h('label', { class: 'lbl' }, 'Anthropic API key', keyInput),
            h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { const v = keyInput.value.trim(); if (!/^sk-ant-/.test(v)) { msg.textContent = 'That does not look like an Anthropic API key (it starts with sk-ant-).'; return; } Tutor.setKey(v); render(); } }, 'Save key')),
            h('p', { class: 'muted small' }, 'Get a key from console.anthropic.com (API keys). It is stored only in this browser on this device and sent only to Anthropic. Each tutor reply costs roughly 1–3p. Anyone using this browser profile could use the key, so only add it on your own device.')),
        msg),
      key ? h('section', { class: 'card' },
        h('h2', {}, '🗣️ Free conversation'),
        h('p', { class: 'muted' }, `Chat in Spanish at your level (${cu ? cu.level : 'A1'}). Type or tap the mic. You get a correction after each message.`),
        topicInp,
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => openChat({ free: true, topic: topicInp.value.trim() }) }, 'Start conversation'))) : null,
      key && cu ? h('section', { class: 'card' },
        h('h2', {}, '🎭 Unit role-play'),
        h('p', { class: 'muted' }, `${cu.title}: ${cu.roleplay.scenario}`),
        h('button', { class: 'btn ghost', onclick: () => runStage(cu, 'talk') }, 'Start role-play')) : null);
  }
  function openChat({ free, topic }) {
    chatOpen = true;
    const cu = Course.currentUnit() || Course.units[Course.units.length - 1];
    const view = Chat.view({ unit: cu, level: cu ? cu.level : 'A1', free, topic, onDone: () => { chatOpen = false; render(); } });
    $('tutorBox').replaceChildren(view);
  }

  // ---------- PROGRESS ----------
  function renderProgressTab() {
    renderStats();
    renderCourseStats();
    chips($('goalList'), [5, 10, 15, 20, 30].map(n => ({ value: n, label: `${n} min` })), Course.goalMins, v => { Course.setGoal(v); render(); });
    chips($('thinkList'), [3, 5, 8].map(n => ({ value: n, label: `${n}s` })), S.think, v => { S.think = v; saveS(); render(); });
    chips($('speedList'), [{ value: 0.8, label: 'Slow' }, { value: 1, label: 'Normal' }, { value: 1.15, label: 'Brisk' }], S.speed, v => { S.speed = v; saveS(); render(); });
    chips($('accentList'), [{ value: 'en-GB', label: 'British' }, { value: 'en-US', label: 'American' }, { value: 'en-AU', label: 'Australian' }], S.accent, v => { S.accent = v; saveS(); render(); });
    $('speakEx').checked = S.speakEx;
    $('repeatBack').checked = S.repeatBack;
    $('hints').checked = S.hints;
    renderPackManager();
  }

  function renderStats() {
    const met = Course.metItems();
    const tot = Progress.totals();
    const streak = Progress.streakDays();
    const acc = tot.answered ? Math.round(100 * tot.right / tot.answered) : 0;
    const wk = Progress.recentAccuracy(7, 1);
    const mastered = met.filter(it => (Progress.word(Course.P, it) || {}).box >= Progress.MASTERED_BOX).length;
    const tile = (v, l) => h('div', { class: 'tile' }, h('div', { class: 'v' }, String(v)), h('div', { class: 'l' }, l));
    const days = Progress.lastDays(14);
    const maxMin = Math.max(5, ...days.map(d => d.secs / 60));
    const week = h('div', { class: 'week', role: 'img', 'aria-label': 'Minutes practised in the last 14 days' },
      ...days.map(d => {
        const m = Math.round(d.secs / 60);
        return h('div', { class: 'd', title: `${d.label}: ${m} min, ${d.answered} answers` },
          h('span', { class: 'num' }, m ? String(m) : ''),
          h('div', { class: 'bar' + (d.secs ? '' : ' zero'), style: `height:${Math.max(2, (d.secs / 60) / maxMin * 80)}%` }),
          h('span', { class: 'lab' }, d.label.slice(0, 2)));
      }));
    const units = Course.units;
    const passed = units.filter(u => Course.us(u.id).passed || Course.us(u.id).placedOut).length;
    $('progress').replaceChildren(
      h('div', { class: 'tiles' },
        tile(streak, 'day streak'),
        tile(Math.round(tot.today.secs / 60), 'minutes today'),
        tile(Math.round(tot.secs / 60), 'minutes in total'),
        tile(`${passed}/${units.length}`, 'units complete'),
        tile(met.length, 'items met'),
        tile(mastered, 'mastered'),
        tile(Course.dueItems().length, 'due for review'),
        tile(wk == null ? '–' : Math.round(wk * 100) + '%', 'accuracy this week'),
        tile(tot.answered ? acc + '%' : '–', 'accuracy (all time)')),
      h('h3', {}, 'Last 14 days (minutes)'), week);
  }

  function renderCourseStats() {
    const rows = Course.units.filter((u, i) => Course.isUnlocked(i)).map(u => {
      const p = Course.unitProgress(u);
      const mPct = 100 * p.mastered / Math.max(1, p.total);
      const sPct = 100 * (p.learned - p.mastered) / Math.max(1, p.total);
      return h('div', { class: 'trow' },
        h('span', {}, `${u.level} · ${u.title}`),
        h('div', { class: 'track', title: `${p.mastered} mastered, ${p.learned} met, of ${p.total}` },
          h('div', { class: 'm', style: `width:${mPct}%` }), h('div', { class: 's', style: `width:${sPct}%` })),
        h('span', { class: 'pc' }, `${p.learned}/${p.total}`));
    });
    const weak = Course.weakItems().slice(0, 10);
    fill($('courseStats'),
      h('div', { class: 'topics' }, ...rows),
      h('div', { class: 'legend' }, h('i', { style: 'background:var(--good)' }), 'mastered', h('i', { style: 'background:var(--accent);opacity:.55' }), 'met'),
      weak.length ? h('div', {}, h('h3', {}, 'Trickiest items right now'),
        h('ul', { class: 'cmds' }, ...weak.map(it => h('li', {}, h('b', {}, it.t), ' — ', it.en)))) : null);
  }

  function renderPackManager() {
    $('packManage').replaceChildren(h('div', { class: 'plist' }, ...Packs.all().map(p => {
      const n = p.topics.reduce((a, t) => a + t.items.length, 0);
      return h('div', { class: 'pitem' },
        h('div', {}, `${p.flag} ${p.name}`, h('small', {}, `${p.topics.length} topics · ${n} phrases · ${p.builtIn ? 'built in' : 'imported'}`)),
        p.builtIn ? null : h('button', { class: 'btn ghost small danger', onclick: () => {
          if (!confirm(`Remove the ${p.name} pack? Your progress for it is kept.`)) return;
          Packs.removeCustom(p.id); render();
        } }, 'Remove'));
    })));
  }

  // ---------- settings handlers ----------
  $('speakEx').onchange = e => { S.speakEx = e.target.checked; saveS(); };
  $('repeatBack').onchange = e => { S.repeatBack = e.target.checked; saveS(); };
  $('hints').onchange = e => { S.hints = e.target.checked; saveS(); };
  $('safetyOk').onclick = () => { S.safetySeen = true; saveS(); render(); };
  $('resetBtn').onclick = () => { if (confirm('Reset ALL progress, streaks, course position and best scores? This cannot be undone.')) { Progress.reset(); Course.resetCourse(); render(); } };
  $('resetCourse').onclick = () => { if (confirm('Go back to the start of the course (keeps your word memory)?')) { Course.resetCourse(); render(); } };

  $('importFile').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const msg = $('importMsg');
    try {
      const p = Packs.addCustom(JSON.parse(await f.text()));
      msg.className = 'msg';
      msg.textContent = `Added ${p.name} (${p.topics.length} topics). Find it on the Drive tab.`;
      render();
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = 'Could not import: ' + (err instanceof SyntaxError ? 'the file is not valid JSON.' : err.message);
    }
  };
  $('tplBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(Packs.template, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'language-pack-template.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  $('micTest').onclick = async () => {
    const msg = $('micMsg');
    Speech.unlockAudio();
    msg.className = 'msg';
    if (!Speech.canSpeak) { msg.className = 'msg err'; msg.textContent = 'This browser cannot speak. Try Chrome or Edge.'; return; }
    msg.textContent = 'Speaking…';
    await Speech.speak('This is the English voice.', S.accent, { rate: S.speed });
    await Speech.speak('Hola, ¿qué tal?', 'es-ES', { rate: S.speed });
    if (!Speech.canListen) { msg.textContent = 'Voices work. This browser has no speech recognition, so speaking exercises are skipped and driving mode is listen-only. Chrome or Edge add it.'; return; }
    if (!(await Speech.ensureMic())) { msg.className = 'msg err'; msg.textContent = 'Microphone permission was blocked. Allow it in the browser’s site settings.'; return; }
    await Speech.speak('Now say: hola.', S.accent, { rate: S.speed });
    await Speech.cues.listen();
    msg.textContent = 'Listening… say “hola”.';
    const r = await Speech.listen('es-ES', 6000);
    if (r.error) { msg.className = 'msg err'; msg.textContent = `Speech recognition error: ${r.error}.` + (r.error === 'network' ? ' It needs an internet connection.' : ''); return; }
    msg.textContent = r.alts.length ? `Heard: “${r.alts[0]}”. All working.` : 'Heard nothing. Check the microphone and try again.';
  };

  // ---------- hands-free session ----------
  let active = null;
  let wakeLock = null;

  // A silent looping track lets steering-wheel / headset media buttons control the session.
  function silentWav() {
    const rate = 8000, n = rate;
    const buf = new ArrayBuffer(44 + n);
    const v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    w(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  const keepAlive = $('keepAlive');
  keepAlive.src = silentWav();
  keepAlive.volume = 0.01;

  function setupMediaKeys(on, name) {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const hd = act => () => active && active.session.press(act);
    const map = { play: hd('pause'), pause: hd('pause'), nexttrack: hd('skip'), previoustrack: hd('repeat'), stop: hd('stop') };
    for (const [k, fn] of Object.entries(map)) { try { ms.setActionHandler(k, on ? fn : null); } catch (_) {} }
    if (on && window.MediaMetadata) ms.metadata = new MediaMetadata({ title: 'LinguaDrive session', artist: name });
  }

  const ui = {
    status(kind) {
      const s = $('sStatus');
      s.className = 'status ' + kind;
      s.textContent = { speaking: 'Speaking', listening: 'Your turn: speak', thinking: 'Answer out loud', paused: 'Paused', waiting: 'Thinking…', idle: '…' }[kind] || kind;
    },
    title(t) { $('sTitle').textContent = t; },
    score(t) { $('sScore').textContent = t; },
    card({ main, sub }) {
      $('sMain').textContent = main;
      $('sSub').textContent = sub || '';
      $('sSub').className = 's-sub';
      $('sHeard').textContent = '';
    },
    reveal(text) { $('sSub').textContent = text; },
    verdict(v) { $('sSub').className = 's-sub' + (v ? ' ' + v : ''); },
    heard(text) { $('sHeard').textContent = `You said: “${text}”`; },
    notice(text) { const n = $('sNotice'); n.textContent = text; n.hidden = false; },
    paused(on) {
      const b = $('pauseBtn');
      b.classList.toggle('on', on);
      b.firstChild.textContent = on ? '▶' : '⏸';
      b.querySelector('span').textContent = on ? 'Resume' : 'Pause';
    },
  };

  async function startSession(modeId) {
    if (active) return;
    const src = driveSource();
    if (!src.pool.length && modeId !== 'chat') {
      alert(src.course ? 'Nothing to practise yet. Do the first lesson of the course on screen, then come back.' : 'This topic is empty.');
      return;
    }
    if (!Speech.canSpeak) { alert('This browser cannot speak. Please use Chrome, Edge or Safari.'); return; }

    Speech.unlockAudio();
    try { await keepAlive.play(); } catch (_) {}
    setupMediaKeys(true, src.pack.name);
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (_) { wakeLock = null; }

    document.body.classList.add('no-scroll');
    $('session').hidden = false;
    $('sSummary').hidden = true;
    $('sNotice').hidden = true;
    ui.score(''); ui.card({ main: '', sub: '' }); ui.paused(false); ui.status('idle');

    const level = (Course.currentUnit() || {}).level || 'A1';
    active = Engine.start({ pack: src.pack, pool: src.pool, mode: modeId, settings: { ...S, level }, ui });
    const summary = await active.done;

    $('sumTitle').textContent = summary.title;
    $('sumLines').replaceChildren(...(summary.lines || []).map(l => h('li', {}, l)));
    $('sSummary').hidden = false;
    $('sumDone').focus();
  }

  function endSession() {
    if (active) active.session.press('stop');
    Speech.cancel();
    active = null;
    keepAlive.pause();
    setupMediaKeys(false);
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    document.body.classList.remove('no-scroll');
    $('session').hidden = true;
    render();
  }

  document.querySelectorAll('#session [data-act]').forEach(b => {
    b.onclick = () => active && active.session.press(b.dataset.act);
  });
  $('sumDone').onclick = endSession;
  document.addEventListener('visibilitychange', async () => {
    if (active && !document.hidden && !wakeLock) { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (_) {} }
  });
  document.addEventListener('keydown', e => {
    if (!active || $('session').hidden) return;
    const k = { ' ': 'pause', ArrowRight: 'skip', ArrowLeft: 'repeat', Escape: 'stop' }[e.key];
    if (k) { e.preventDefault(); active.session.press(k); }
  });

  showTab(S.tab || 'today');
})();
