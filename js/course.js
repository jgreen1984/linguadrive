// Spanish course: units, unlocking, adaptive daily plan and lesson builders.
// Every word, sentence and drill is tracked in Progress under the "es" pack id,
// so screen lessons and the driving mode share one memory model.
const Course = (() => {
  const P = 'es';
  const LANG = 'es-ES';
  const units = [];
  const SKEY = 'lt.course.v1';
  const XKEY = 'lt.courseExtra.v1';

  window.registerUnits = list => { for (const u of list) units.push(u); };

  // ---------- state ----------
  let st = load();
  function load() {
    try {
      const x = JSON.parse(localStorage.getItem(SKEY));
      if (x && x.units) return x;
    } catch (_) {}
    return { units: {}, placementDone: false, goalMins: 15 };
  }
  function save() { try { localStorage.setItem(SKEY, JSON.stringify(st)); } catch (_) {} }
  const us = id => (st.units[id] ||= { stages: {}, passed: false, placedOut: false, best: 0 });

  // AI-generated extra practice, per unit.
  function extra() { try { return JSON.parse(localStorage.getItem(XKEY)) || {}; } catch (_) { return {}; } }
  function addExtra(unitId, sentences, drills) {
    const x = extra();
    const cur = x[unitId] || { sentences: [], drills: [] };
    const seenS = new Set(cur.sentences.map(s => s.t));
    const seenD = new Set(cur.drills.map(s => s.t));
    cur.sentences.push(...sentences.filter(s => !seenS.has(s.t)));
    cur.drills.push(...drills.filter(s => !seenD.has(s.t)));
    x[unitId] = cur;
    localStorage.setItem(XKEY, JSON.stringify(x));
    return cur;
  }

  const STAGES = [
    { id: 'words', name: 'Words', icon: '🔤', desc: 'Meet the key words, then recall them.' },
    { id: 'grammar', name: 'Grammar', icon: '🧩', desc: 'One idea at a time, then practise it.' },
    { id: 'practice', name: 'Sentences', icon: '✍️', desc: 'Build, type, hear and say whole sentences.' },
    { id: 'listen', name: 'Listening', icon: '👂', desc: 'A real conversation, then questions.' },
    { id: 'talk', name: 'Conversation', icon: '🗣️', desc: 'Role-play with your AI tutor.', optional: true },
    { id: 'check', name: 'Unit check', icon: '🏁', desc: 'Score 80% to unlock the next unit.' },
  ];

  // ---------- items ----------
  const vocabItems = u => u.vocab.map(v => ({ ...v, kind: 'v', unit: u.id }));
  const sentenceItems = u => [...u.sentences, ...((extra()[u.id] || {}).sentences || [])].map(s => ({ ...s, kind: 's', unit: u.id }));
  const drillItems = u => [...u.drills, ...((extra()[u.id] || {}).drills || [])].map(d => ({ ...d, kind: 'd', unit: u.id }));
  const allItems = u => [...vocabItems(u), ...sentenceItems(u), ...drillItems(u)];

  function isUnlocked(i) {
    if (i === 0) return true;
    const prev = us(units[i - 1].id);
    return prev.passed || prev.placedOut;
  }
  const unlockedUnits = () => units.filter((_, i) => isUnlocked(i));
  function currentUnit() {
    return units.find((u, i) => isUnlocked(i) && !us(u.id).passed && !us(u.id).placedOut) || null;
  }
  function nextStage(u) {
    const s = us(u.id);
    return STAGES.find(x => !s.stages[x.id] && !(x.optional && s.stages[x.id] === 'skipped')) || STAGES[STAGES.length - 1];
  }
  function unitProgress(u) {
    const items = allItems(u);
    const ps = Progress.packStats(P, items);
    return { ...ps, stagesDone: STAGES.filter(x => us(u.id).stages[x.id]).length, ...us(u.id) };
  }

  // Items you've met (seen at least once) in unlocked units.
  function metItems() {
    return unlockedUnits().flatMap(allItems).filter(it => { const w = Progress.word(P, it); return w && w.seen > 0; });
  }
  const dueItems = () => metItems().filter(it => Progress.isDue(P, it)).sort((a, b) => Progress.word(P, a).due - Progress.word(P, b).due);
  const weakItems = () => metItems().filter(it => Progress.isWeak(P, it));

  // ---------- adaptive daily plan ----------
  function plan() {
    const due = dueItems();
    const acc = Progress.recentAccuracy(7);
    const reviewCap = Math.max(10, Math.round(st.goalMins * 1.6));
    let pace = 'steady';
    let why = 'Reviews first, then the next step of your current unit.';
    if ((acc !== null && acc < 0.7) || due.length > reviewCap * 2.5) {
      pace = 'consolidate';
      why = acc !== null && acc < 0.7
        ? `Your accuracy this week is ${Math.round(acc * 100)}%, so today is about locking in what you've met before adding more.`
        : `You have ${due.length} reviews waiting, so today clears some of those before adding new material.`;
    } else if (acc !== null && acc >= 0.9 && due.length < reviewCap / 2) {
      pace = 'stretch';
      why = `You're at ${Math.round(acc * 100)}% this week with few reviews waiting, so you can take on more new material.`;
    }
    const cu = currentUnit();
    const steps = [];
    if (!st.placementDone && !metItems().length) steps.push({ kind: 'placement' });
    if (due.length) steps.push({ kind: 'review', count: Math.min(due.length, pace === 'consolidate' ? reviewCap * 1.5 : reviewCap) | 0 });
    const weak = weakItems();
    if (weak.length >= 4 && pace !== 'stretch') steps.push({ kind: 'weak', count: Math.min(weak.length, 12) });
    // Consolidation holds back new material only while there's a real review pile to clear.
    if (cu && (pace !== 'consolidate' || due.length <= 5)) {
      steps.push({ kind: 'stage', unit: cu, stage: nextStage(cu) });
      if (pace === 'stretch') {
        const after = STAGES[STAGES.indexOf(nextStage(cu)) + 1];
        if (after) steps.push({ kind: 'stage', unit: cu, stage: after, bonus: true });
      }
    }
    return { pace, why, steps, due: due.length, weak: weak.length, acc, unit: cu };
  }

  // ---------- exercise ladder ----------
  const shuffle = Progress.shuffle;
  const rand = a => a[Math.floor(Math.random() * a.length)];
  const pool = () => unlockedUnits().flatMap(vocabItems);

  function distractors(item, field, n, from) {
    const src = (from && from.length > n + 1 ? from : pool()).filter(x => x[field] !== item[field]);
    const seen = new Set();
    const out = [];
    for (const x of shuffle(src)) {
      const k = x[field].toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); out.push(x[field]);
      if (out.length === n) break;
    }
    return out;
  }
  function mcq(item, dir, from) {
    const field = dir === 'es-en' ? 'en' : 't';
    return {
      type: 'mcq', item, dir,
      prompt: dir === 'es-en' ? item.t : item.en,
      promptLang: dir === 'es-en' ? LANG : null,
      options: shuffle([item[field], ...distractors(item, field, 3, from)]),
      answer: item[field],
    };
  }

  // Pick the exercise that fits how well you know this item right now.
  function exerciseFor(item, opts = {}) {
    const w = Progress.word(P, item);
    const box = w ? w.box : 0;
    const mic = opts.mic;
    if (item.kind === 'd') return { type: 'gap', item, mode: box >= 3 ? 'type' : 'mcq' };
    if (item.kind === 's') {
      if (box <= 1) return { type: 'tiles', item };
      if (box <= 3) return rand([{ type: 'type', item, dir: 'en-es' }, { type: 'dictation', item }]);
      return mic ? { type: 'speak', item } : rand([{ type: 'type', item, dir: 'en-es' }, { type: 'dictation', item }]);
    }
    if (box <= 1) return mcq(item, Math.random() < 0.5 ? 'es-en' : 'en-es', opts.from);
    if (box <= 3) return rand([{ type: 'type', item, dir: 'en-es' }, mcq(item, 'es-en', opts.from)]);
    return mic ? rand([{ type: 'speak', item }, { type: 'dictation', item }]) : rand([{ type: 'type', item, dir: 'en-es' }, { type: 'dictation', item }]);
  }

  // ---------- lesson builders: each returns { title, steps, onFinish(result) } ----------
  function wordsLesson(u) {
    const vs = vocabItems(u);
    const steps = [];
    for (let i = 0; i < vs.length; i += 4) {
      const chunk = vs.slice(i, i + 4);
      for (const v of chunk) steps.push({ type: 'learn', item: v });
      for (const v of shuffle(chunk)) steps.push(mcq(v, 'es-en', vs));
      for (const v of shuffle(chunk)) steps.push(mcq(v, 'en-es', vs));
    }
    for (const v of shuffle(vs).slice(0, 5)) steps.push({ type: 'type', item: v, dir: 'en-es' });
    return { title: `${u.title}: words`, steps };
  }

  function grammarLesson(u) {
    const steps = [];
    const ds = shuffle(drillItems(u));
    u.grammar.forEach((g, gi) => {
      steps.push({ type: 'grammar', g });
      const mine = ds.filter((_, i) => i % u.grammar.length === gi);
      mine.forEach((d, i) => steps.push({ type: 'gap', item: d, mode: i < Math.ceil(mine.length / 2) ? 'mcq' : 'type' }));
    });
    for (const s of shuffle(sentenceItems(u)).slice(0, 2)) steps.push({ type: 'tiles', item: s });
    return { title: `${u.title}: grammar`, steps };
  }

  function practiceLesson(u, mic) {
    const ss = shuffle(sentenceItems(u));
    const steps = [];
    ss.slice(0, 3).forEach(s => steps.push({ type: 'tiles', item: s }));
    ss.slice(3, 6).forEach(s => steps.push({ type: 'type', item: s, dir: 'en-es' }));
    ss.slice(6, 8).forEach(s => steps.push({ type: 'dictation', item: s }));
    ss.slice(0, 2).forEach(s => steps.push(mic ? { type: 'speak', item: s } : { type: 'type', item: s, dir: 'es-en' }));
    // interleave a few earlier words so older material keeps coming back
    const older = metItems().filter(it => it.kind === 'v' && it.unit !== u.id);
    shuffle(older).slice(0, 3).forEach(v => steps.splice(1 + Math.floor(Math.random() * steps.length), 0, exerciseFor(v, { mic })));
    return { title: `${u.title}: sentences`, steps };
  }

  function listenLesson(u, mic) {
    const d = u.dialogue;
    const steps = [{ type: 'dialogue', dialogue: d }];
    d.questions.forEach(q => steps.push({ type: 'question', q, dialogue: d }));
    const lines = shuffle(d.lines.filter(l => l.t.split(' ').length <= 9)).slice(0, 2);
    lines.forEach(l => steps.push(mic ? { type: 'speak', item: { t: l.t, en: l.en, kind: 'line' }, shadow: true } : { type: 'dictation', item: { t: l.t, en: l.en, kind: 'line' } }));
    return { title: `${u.title}: listening`, steps };
  }

  function talkLesson(u) {
    return { title: `${u.title}: conversation`, steps: [{ type: 'roleplay', unit: u }] };
  }

  function checkLesson(u, mic) {
    const vs = shuffle(vocabItems(u)).slice(0, 5).map(v => rand([{ type: 'type', item: v, dir: 'en-es' }, mcq(v, 'es-en', vocabItems(u))]));
    const ds = shuffle(drillItems(u)).slice(0, 4).map(d => ({ type: 'gap', item: d, mode: 'type' }));
    const ss = shuffle(sentenceItems(u)).slice(0, 3).map((s, i) => i === 2 && mic ? { type: 'speak', item: s } : rand([{ type: 'type', item: s, dir: 'en-es' }, { type: 'dictation', item: s }]));
    return { title: `${u.title}: unit check`, steps: shuffle([...vs, ...ds, ...ss]), scored: true, noRequeue: true };
  }

  function stageLesson(u, stageId, mic) {
    const b = { words: wordsLesson, grammar: grammarLesson, practice: practiceLesson, listen: listenLesson, talk: talkLesson, check: checkLesson }[stageId];
    const lesson = b(u, mic);
    lesson.unit = u;
    lesson.stage = stageId;
    return lesson;
  }

  function reviewLesson(count, mic) {
    const items = dueItems().slice(0, count);
    return { title: 'Review', steps: shuffle(items).map(it => exerciseFor(it, { mic })), review: true };
  }
  function weakLesson(count, mic) {
    const items = shuffle(weakItems()).slice(0, count);
    // weak items get the easier rung first, then the harder one
    const steps = [];
    for (const it of items) {
      if (it.kind === 'v') steps.push(mcq(it, 'en-es'));
      steps.push(exerciseFor(it, { mic }));
    }
    return { title: 'Fix weak spots', steps, review: true };
  }

  // Placement: walk through units; 3 questions each; stop after two weak units in a row.
  function placementSteps() {
    return units.map(u => {
      const qs = [mcq(rand(vocabItems(u)), 'en-es', vocabItems(u)), ...shuffle(drillItems(u)).slice(0, 2).map(d => ({ type: 'gap', item: d, mode: 'mcq' }))];
      qs.forEach(q => { q.placement = u.id; q.noRecord = true; });
      return { unit: u, qs };
    });
  }

  // ---------- results ----------
  function finishStage(u, stageId, result) {
    const s = us(u.id);
    const acc = result.total ? result.right / result.total : 1;
    if (stageId === 'check') {
      s.best = Math.max(s.best || 0, Math.round(acc * 100));
      if (acc >= 0.8) { s.passed = true; s.stages.check = true; }
    } else if (stageId === 'talk' && result.skipped) {
      s.stages.talk = 'skipped';
    } else if (acc >= 0.6 || stageId === 'talk') {
      s.stages[stageId] = true;
    }
    save();
    return { acc, passed: s.passed, done: !!s.stages[stageId] };
  }

  function placeOut(unitIds) {
    for (const id of unitIds) {
      const u = units.find(x => x.id === id);
      if (!u) continue;
      const s = us(id);
      s.placedOut = true;
      for (const it of allItems(u)) Progress.seed(P, it, 2, 14);
    }
    st.placementDone = true;
    save();
  }
  function skipPlacement() { st.placementDone = true; save(); }

  function setGoal(m) { st.goalMins = m; save(); }
  function resetCourse() { st = { units: {}, placementDone: false, goalMins: st.goalMins }; save(); }

  // Vocabulary you've met, for the AI tutor to stay within your level.
  function knownWords(limit = 150) {
    return metItems().filter(it => it.kind === 'v').slice(-limit).map(it => it.t);
  }

  // Items for the hands-free driving mode.
  function drivePool(scope) {
    if (scope === 'current') { const u = currentUnit() || units[0]; return u ? [...vocabItems(u), ...sentenceItems(u)] : []; }
    const met = metItems().filter(it => it.kind !== 'd');
    return met;
  }

  return {
    P, LANG, units, STAGES, us, plan, currentUnit, nextStage, isUnlocked, unitProgress,
    stageLesson, reviewLesson, weakLesson, placementSteps, finishStage, placeOut, skipPlacement,
    exerciseFor, dueItems, weakItems, metItems, setGoal, resetCourse, knownWords, drivePool, addExtra,
    vocabItems, sentenceItems, drillItems,
    get goalMins() { return st.goalMins; },
    get placementDone() { return st.placementDone; },
  };
})();
