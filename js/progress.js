// Progress tracking + simple spaced repetition (Leitner boxes), stored in localStorage.
const Progress = (() => {
  const KEY = 'lt.progress.v1';
  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  // Box 0 = new/forgotten, box 5 = long-term. Interval before an item is "due" again.
  const INTERVALS = [0, 10 * MIN, DAY, 3 * DAY, 7 * DAY, 21 * DAY];
  const MASTERED_BOX = 4;

  let d = load();

  function load() {
    try {
      const x = JSON.parse(localStorage.getItem(KEY));
      if (x && x.words && x.days && x.bests) return x;
    } catch (_) {}
    return { words: {}, days: {}, bests: {} };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (_) {}
  }

  function dayKey(date = new Date()) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function dayRec() {
    const k = dayKey();
    if (!d.days[k]) d.days[k] = { secs: 0, answered: 0, right: 0 };
    return d.days[k];
  }

  const key = (packId, item) => packId + '|' + item.t;
  const word = (packId, item) => d.words[key(packId, item)];

  function ensure(packId, item) {
    const k = key(packId, item);
    if (!d.words[k]) d.words[k] = { box: 0, seen: 0, right: 0, due: 0, last: 0 };
    return d.words[k];
  }

  function record(packId, item, correct) {
    const w = ensure(packId, item);
    w.seen++;
    w.last = Date.now();
    if (correct) { w.right++; w.box = Math.min(5, w.box + 1); }
    else w.box = Math.max(0, w.box - 2);
    w.due = Date.now() + INTERVALS[w.box];
    const r = dayRec();
    r.answered++;
    if (correct) r.right++;
    save();
  }

  // Heard it, but no answer was checked (audio flashcards).
  function touch(packId, item) {
    const w = ensure(packId, item);
    w.seen++;
    w.last = Date.now();
    save();
  }

  function addTime(secs) {
    dayRec().secs += Math.round(secs);
    save();
  }

  function best(game, packId) { return d.bests[game + '|' + packId] || 0; }
  function setBest(game, packId, score) {
    const k = game + '|' + packId;
    if (score > (d.bests[k] || 0)) { d.bests[k] = score; save(); return true; }
    return false;
  }

  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // prefer: 'new' (learning, keeps pack order) or 'due' (review).
  function pick(packId, pool, n, prefer) {
    const now = Date.now();
    const rows = pool.map(it => ({ it, w: word(packId, it) }));
    const fresh = rows.filter(x => !x.w || x.w.seen === 0);
    const due = rows.filter(x => x.w && x.w.seen > 0 && x.w.due <= now).sort((a, b) => a.w.due - b.w.due);
    const later = rows.filter(x => x.w && x.w.seen > 0 && x.w.due > now).sort((a, b) => a.w.box - b.w.box || a.w.due - b.w.due);
    if (prefer === 'new') {
      return [...fresh, ...due, ...later].slice(0, n).map(x => x.it);
    }
    return shuffle([...due, ...fresh, ...later].slice(0, n).map(x => x.it));
  }

  function streakDays() {
    const active = k => d.days[k] && (d.days[k].answered > 0 || d.days[k].secs >= 30);
    const date = new Date();
    if (!active(dayKey(date))) date.setDate(date.getDate() - 1);
    let n = 0;
    while (active(dayKey(date))) { n++; date.setDate(date.getDate() - 1); }
    return n;
  }

  function lastDays(n = 7) {
    const out = [];
    const date = new Date();
    date.setDate(date.getDate() - (n - 1));
    for (let i = 0; i < n; i++) {
      const k = dayKey(date);
      const r = d.days[k] || { secs: 0, answered: 0, right: 0 };
      out.push({ key: k, label: date.toLocaleDateString(undefined, { weekday: 'short' }), ...r });
      date.setDate(date.getDate() + 1);
    }
    return out;
  }

  function packStats(packId, pool) {
    let learned = 0, mastered = 0, due = 0;
    const now = Date.now();
    for (const it of pool) {
      const w = word(packId, it);
      if (!w || w.seen === 0) continue;
      learned++;
      if (w.box >= MASTERED_BOX) mastered++;
      if (w.due <= now) due++;
    }
    return { total: pool.length, learned, mastered, due };
  }

  function totals() {
    let answered = 0, right = 0, secs = 0;
    for (const k in d.days) { answered += d.days[k].answered; right += d.days[k].right; secs += d.days[k].secs; }
    return { answered, right, secs, today: d.days[dayKey()] || { secs: 0, answered: 0, right: 0 } };
  }

  function reset() { d = { words: {}, days: {}, bests: {} }; save(); }

  // Mark an item as already known (placement test), due for a light check some time in the next `spreadDays`.
  function seed(packId, item, box, spreadDays) {
    const w = ensure(packId, item);
    if (w.seen > 0) return;
    w.seen = 1; w.right = 1; w.box = box;
    w.due = Date.now() + Math.random() * spreadDays * DAY;
    w.last = Date.now();
    save();
  }

  // Accuracy over the last n days (null if too few answers to judge).
  function recentAccuracy(n = 7, min = 15) {
    let a = 0, r = 0;
    for (const day of lastDays(n)) { a += day.answered; r += day.right; }
    return a >= min ? r / a : null;
  }

  function isDue(packId, item) {
    const w = word(packId, item);
    return !!w && w.seen > 0 && w.due <= Date.now();
  }
  function isWeak(packId, item) {
    const w = word(packId, item);
    return !!w && w.seen >= 3 && (w.right / w.seen < 0.6 || w.box === 0);
  }

  return { record, touch, addTime, best, setBest, pick, shuffle, streakDays, lastDays, packStats, totals, reset, word, seed, recentAccuracy, isDue, isWeak, MASTERED_BOX };
})();
