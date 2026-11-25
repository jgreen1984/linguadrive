// Hands-free session engine: speaks prompts, listens for answers and commands, scores, records progress.
const Engine = (() => {
  const STOP = Symbol('stop');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = a => a[Math.floor(Math.random() * a.length)];

  // ---------- answer matching ----------
  function norm(s) {
    return String(s).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ß/g, 'ss').replace(/['’]/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }
  const ratio = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

  // 0..1 — how well anything heard matches any accepted answer.
  function score(alts, answers) {
    let best = 0;
    for (const a0 of alts) {
      const a = norm(a0);
      if (!a) continue;
      const aw = a.split(' ');
      for (const b0 of answers) {
        const b = norm(b0);
        if (!b) continue;
        if (a === b || (' ' + a + ' ').includes(' ' + b + ' ')) return 1;
        const bw = b.split(' ');
        const cover = bw.filter(w => aw.some(x => ratio(x, w) >= 0.8)).length / bw.length;
        best = Math.max(best, ratio(a, b), cover * 0.95);
      }
    }
    return best;
  }
  const GOOD = 0.8, CLOSE = 0.6;

  const targetAnswers = it => [it.t, ...(it.alt || []), ...(it.n != null ? [String(it.n)] : [])];
  const englishAnswers = it => [it.en, ...(it.ea || []), ...(it.n != null ? [String(it.n)] : [])];

  // ---------- voice commands (whole utterance must match) ----------
  const COMMANDS = {
    skip: ['skip', 'next', 'pass', 'skip it', 'next one', 'siguiente', 'suivant', 'weiter', 'avanti', 'prossimo'],
    dontknow: ['i dont know', 'dont know', 'i don t know', 'no idea', 'tell me', 'help', 'no se', 'je ne sais pas', 'je sais pas', 'ich weiss nicht', 'weiss nicht', 'keine ahnung', 'non lo so', 'non so'],
    repeat: ['repeat', 'again', 'say again', 'say that again', 'repeat that', 'pardon', 'what', 'one more time', 'repite', 'otra vez', 'repete', 'encore', 'nochmal', 'noch einmal', 'wiederholen', 'ripeti', 'ancora'],
    pause: ['pause', 'wait', 'hold on', 'hang on', 'pausa', 'attends', 'warte', 'aspetta'],
    stop: ['stop', 'finish', 'quit', 'exit', 'end session', 'im done', 'i m done', 'that s enough', 'thats enough', 'arrete', 'stopp', 'basta'],
    slower: ['slower', 'slow down', 'more slowly', 'slowly', 'mas despacio', 'plus lentement', 'langsamer', 'piu lentamente'],
    faster: ['faster', 'speed up', 'quicker'],
    resume: ['resume', 'continue', 'go', 'go on', 'carry on', 'play', 'start', 'ready', 'ok', 'okay', 'yes', 'lets go', 'let s go'],
  };
  function detect(alts, names) {
    for (const a of alts.slice(0, 3)) {
      const n = norm(a);
      for (const name of names) if (COMMANDS[name].includes(n)) return name;
    }
    return null;
  }

  const YES = ['yes', 'yeah', 'yep', 'yup', 'true', 'correct', 'right', 'it does', 'yes it does', 'sure', 'si', 'oui', 'ja'];
  const NO = ['no', 'nope', 'false', 'wrong', 'it doesn t', 'it doesnt', 'no it doesn t', 'no it doesnt', 'not', 'non', 'nein'];
  function yesNo(alts) {
    for (const a of alts) {
      const n = norm(a);
      const first = n.split(' ')[0];
      if (YES.includes(n) || ['yes', 'yeah', 'yep', 'true', 'correct', 'right'].includes(first)) return 'yes';
      if (NO.includes(n) || ['no', 'nope', 'false', 'wrong'].includes(first)) return 'no';
    }
    return null;
  }

  const FATAL_MIC = ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'unsupported', 'language-not-supported'];

  // ---------- session ----------
  class Session {
    constructor({ pack, pool, mode, settings, ui }) {
      this.pack = pack;
      this.pool = pool;
      this.mode = mode;
      this.settings = settings;
      this.ui = ui;
      this.rate = settings.speed || 1;
      this.mic = Speech.canListen && mode !== 'flash';
      this.stopped = false;
      this.voiceStop = false;
      this.paused = false;
      this.inPause = false;
      this.flag = null;
      this.right = 0;
      this.total = 0;
      this.started = Date.now();
    }
    get T() { return this.pack.lang; }
    get E() { return this.settings.accent || 'en-GB'; }
    get think() { return (this.settings.think || 5) * 1000; }

    // Buttons, media keys, etc.
    press(action) {
      if (this.stopped) return;
      if (action === 'stop') { this.stopped = true; Speech.cancel(); return; }
      if (action === 'pause') { this.paused = !this.paused; Speech.cancel(); this.ui.paused(this.paused); return; }
      this.flag = action;
      Speech.cancel();
    }
    takeFlag() { const f = this.flag; this.flag = null; return f; }

    async cp() {
      if (this.stopped) throw STOP;
      if (this.paused && !this.inPause) await this.pausedLoop();
    }

    async pausedLoop() {
      this.inPause = true;
      try {
        this.ui.status('paused');
        this.ui.paused(true);
        await Speech.speak(this.mic ? 'Paused. Say resume when you are ready.' : 'Paused.', this.E, { rate: this.rate });
        while (this.paused && !this.stopped) {
          if (this.mic) {
            const r = await Speech.listen(this.E, 10000);
            if (!this.paused || this.stopped) break;
            const cmd = detect(r.alts, ['resume', 'stop']);
            if (cmd === 'resume') this.paused = false;
            else if (cmd === 'stop') { this.stopped = true; this.voiceStop = true; }
            if (r.error && FATAL_MIC.includes(r.error)) this.mic = false;
            await sleep(250);
          } else {
            await sleep(250);
          }
        }
        if (this.stopped) throw STOP;
        this.ui.paused(false);
        await Speech.speak('Okay, carrying on.', this.E, { rate: this.rate });
        this.flag = 'repeat'; // re-say whatever was interrupted
      } finally {
        this.inPause = false;
      }
    }

    async say(text, lang, rateMul = 1) {
      await this.cp();
      if (this.flag === 'skip') return;
      this.ui.status('speaking');
      await Speech.speak(text, lang, { rate: this.rate * rateMul });
      await this.cp();
    }
    sayEn(text) { return this.say(text, this.E); }
    sayT(text, slow) { return this.say(text, this.T, slow ? 0.75 : 1); }

    async wait(ms) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        await sleep(100);
        await this.cp();
        if (this.flag) return;
      }
    }

    // Say a prompt, then listen. Handles commands, repeats and mic failures.
    // Returns { type: 'answer'|'skip'|'silence', alts, score }.
    async ask(sayFn, lang, answers) {
      for (let loops = 0; loops < 6; loops++) {
        this.flag = null;
        await sayFn();
        let f = this.takeFlag();
        if (f === 'skip') return { type: 'skip', alts: [] };
        if (f === 'repeat') continue;

        if (!this.mic) {
          this.ui.status('thinking');
          await this.wait(this.think);
          f = this.takeFlag();
          if (f === 'repeat') continue;
          return { type: f === 'skip' ? 'skip' : 'silence', alts: [] };
        }

        await this.cp();
        await Speech.cues.listen();
        this.ui.status('listening');
        const r = await Speech.listen(lang, this.think + 1500);
        this.ui.status('idle');
        await this.cp();
        f = this.takeFlag();
        if (f === 'repeat') continue;
        if (f === 'skip') return { type: 'skip', alts: [] };

        if (r.error && FATAL_MIC.includes(r.error)) {
          this.mic = false;
          this.ui.notice(r.error === 'network'
            ? 'Speech recognition needs an internet connection. Switched to listen-only.'
            : 'Microphone unavailable. Switched to listen-only: answer out loud, then hear the answer.');
          await this.sayEn("I can't hear you right now, so I'll switch to listen only. Answer out loud, and I'll tell you the answer.");
          continue;
        }

        const alts = r.alts;
        if (!alts.length) return { type: 'silence', alts: [] };
        this.ui.heard(alts[0]);

        const sc = answers ? score(alts, answers) : 0;
        if (sc >= CLOSE) return { type: 'answer', alts, score: sc };

        const cmd = detect(alts, ['repeat', 'skip', 'dontknow', 'pause', 'stop', 'slower', 'faster']);
        if (cmd === 'repeat') continue;
        if (cmd === 'skip' || cmd === 'dontknow') return { type: 'skip', alts };
        if (cmd === 'pause') { this.paused = true; await this.cp(); continue; }
        if (cmd === 'stop') { this.stopped = true; this.voiceStop = true; throw STOP; }
        if (cmd === 'slower') { this.rate = Math.max(0.6, this.rate - 0.15); await this.sayEn('Okay, slower.'); continue; }
        if (cmd === 'faster') { this.rate = Math.min(1.4, this.rate + 0.15); await this.sayEn('Okay, faster.'); continue; }
        return { type: 'answer', alts, score: sc };
      }
      return { type: 'skip', alts: [] };
    }

    // Standard feedback for "say it in the target language" questions. Returns true if correct.
    async feedback(item, res) {
      const it = item;
      this.ui.reveal(it.t);
      if (res.type === 'answer' && res.score >= GOOD) {
        this.ui.verdict('good');
        await Speech.cues.good();
        await this.sayEn(rand(['Correct!', 'Yes!', 'Spot on.', 'Nice one.', 'Perfect.']));
        await this.sayT(it.t);
        return true;
      }
      if (res.type === 'answer' && res.score >= CLOSE) {
        this.ui.verdict('close');
        await Speech.cues.good();
        await this.sayEn('Close enough. Listen:');
        await this.sayT(it.t, true);
        return true;
      }
      this.ui.verdict('bad');
      if (this.mic || res.type === 'answer') await Speech.cues.bad();
      await this.sayEn(res.type === 'answer' ? "Not quite. It's" : "It's");
      await this.sayT(it.t, true);
      if (this.settings.repeatBack && this.mic && !this.stopped) {
        const r2 = await this.ask(() => this.sayEn('Say it after me.'), this.T, targetAnswers(it));
        if (r2.type === 'answer' && r2.score >= CLOSE) { await Speech.cues.good(); await this.sayEn('Good.'); }
        else await this.sayT(it.t);
      } else {
        await this.wait(1200);
        await this.sayT(it.t);
      }
      return false;
    }

    // ---------- run ----------
    async run() {
      let summary = null;
      try {
        if (this.mic && !(await Speech.ensureMic())) {
          this.mic = false;
          if (this.mode !== 'flash') this.ui.notice('No microphone access, so this runs in listen-only mode.');
        }
        const m = MODES[this.mode];
        this.ui.title(m.name);
        await this.sayEn(`${m.name}. ${this.pack.name}.`);
        if (this.settings.hints && this.mic) await this.sayEn('You can say skip, repeat, or pause at any time.');
        summary = await m.run.call(this);
      } catch (e) {
        if (e !== STOP) {
          console.error(e);
          summary = { title: 'Something went wrong', lines: [String((e && e.message) || e)] };
        }
      }
      Progress.addTime((Date.now() - this.started) / 1000);
      if (!summary) summary = this.summary(MODES[this.mode].name, 'stopped');
      this.ui.status('idle');
      if (summary.spoken && (!this.stopped || this.voiceStop)) {
        this.stopped = false;
        try { await this.sayEn(summary.spoken); } catch (_) {}
      }
      this.stopped = true;
      return summary;
    }

    summary(title, why) {
      const lines = [];
      if (this.total) lines.push(`${this.right} of ${this.total} correct`);
      const streak = Progress.streakDays();
      if (streak) lines.push(`${streak}-day streak`);
      let spoken = this.total ? `You got ${this.right} out of ${this.total}.` : 'Session finished.';
      if (streak > 1) spoken += ` That's a ${streak} day streak.`;
      return { title: why === 'stopped' ? 'Session stopped' : title + ' complete', lines, spoken };
    }
  }

  // ---------- modes ----------
  const MODES = {
    learn: {
      name: 'Learn new words',
      async run() {
        const items = Progress.pick(this.pack.id, this.pool, this.settings.length, 'new');
        await this.sayEn(`${items.length} phrases. Listen, then say each one back.`);
        for (const it of items) {
          this.total++;
          this.ui.card({ main: it.en, sub: it.t });
          const res = await this.ask(async () => {
            await this.sayEn(it.en);
            await this.sayT(it.t, true);
            await this.wait(250);
            await this.sayT(it.t);
          }, this.T, targetAnswers(it));
          let ok = false;
          if (!this.mic) {
            ok = true; // listen-and-repeat: count as practised
            Progress.touch(this.pack.id, it);
          } else if (res.type === 'answer' && res.score >= CLOSE) {
            ok = true;
            this.ui.verdict(res.score >= GOOD ? 'good' : 'close');
            await Speech.cues.good();
            if (res.score >= GOOD) await this.sayEn(rand(['Great.', 'Lovely.', 'Nice.', 'Good pronunciation.']));
            else { await this.sayEn('Nearly. Once more:'); await this.sayT(it.t, true); }
          } else if (res.type !== 'skip') {
            this.ui.verdict('bad');
            await this.sayEn('Listen again:');
            await this.sayT(it.t, true);
          }
          if (this.mic) Progress.record(this.pack.id, it, ok);
          if (ok) this.right++;
        }
        return this.summary(MODES.learn.name);
      },
    },

    recall: {
      name: 'Quick recall',
      async run() {
        const items = Progress.pick(this.pack.id, this.pool, this.settings.length, 'due');
        await this.sayEn(`I'll say it in English. You say it in ${this.pack.name}.`);
        for (const it of items) {
          this.total++;
          this.ui.card({ main: it.en, sub: '' });
          const res = await this.ask(() => this.sayEn(it.en), this.T, targetAnswers(it));
          const ok = await this.feedback(it, res);
          if (this.mic) Progress.record(this.pack.id, it, ok); else Progress.touch(this.pack.id, it);
          if (ok) this.right++;
        }
        return this.summary(MODES.recall.name);
      },
    },

    flash: {
      name: 'Audio flashcards',
      async run() {
        const items = Progress.pick(this.pack.id, this.pool, this.settings.length, 'due');
        await this.sayEn(`I'll say it in English, then give you a moment to answer out loud.`);
        for (const it of items) {
          this.ui.card({ main: it.en, sub: '' });
          const res = await this.ask(() => this.sayEn(it.en), this.T, null);
          this.ui.reveal(it.t);
          if (res.type !== 'skip') {
            await this.sayT(it.t);
            await this.wait(700);
            await this.sayT(it.t, true);
          }
          Progress.touch(this.pack.id, it);
          this.total++;
        }
        this.total = 0; // nothing was scored
        const s = this.summary(MODES.flash.name);
        s.lines.unshift(`${items.length} cards heard`);
        s.spoken = `That's ${items.length} cards done. ` + s.spoken.replace('Session finished.', '');
        return s;
      },
    },

    streak: {
      name: 'Streak Challenge',
      async run() {
        if (!this.mic) return noMicGame(this, 'Streak Challenge');
        let lives = 3, score = 0;
        const best = Progress.best('streak', this.pack.id);
        await this.sayEn(`Three lives. Answer in ${this.pack.name}. ${best ? `Your best is ${best}.` : ''}`);
        let deck = Progress.shuffle(this.pool);
        while (lives > 0 && score < 99) {
          if (!deck.length) deck = Progress.shuffle(this.pool);
          const it = deck.pop();
          this.total++;
          this.ui.card({ main: it.en, sub: '' });
          this.ui.score(`Score ${score} · ${'♥'.repeat(lives)}`);
          const res = await this.ask(() => this.sayEn(it.en), this.T, targetAnswers(it));
          this.ui.reveal(it.t);
          if (res.type === 'answer' && res.score >= CLOSE) {
            score++; this.right++;
            this.ui.verdict('good');
            await Speech.cues.good();
            if (score % 5 === 0) await this.sayEn(`${score}! Keep going.`);
            else await this.sayT(it.t);
          } else {
            lives--;
            this.ui.verdict('bad');
            await Speech.cues.bad();
            await this.sayEn("It's");
            await this.sayT(it.t, true);
            if (lives) await this.sayEn(lives === 1 ? 'Last life.' : 'Two lives left.');
          }
          Progress.record(this.pack.id, it, res.type === 'answer' && res.score >= CLOSE);
        }
        this.ui.score(`Score ${score}`);
        return gameOver(this, 'streak', 'Streak Challenge', score);
      },
    },

    tf: {
      name: 'True or False',
      async run() {
        const rounds = Math.min(this.settings.length, 20);
        const items = Progress.shuffle(this.pool).slice(0, rounds);
        if (this.pool.length < 2) return { title: 'Not enough words', lines: ['Pick a bigger topic.'], spoken: 'This topic needs more words for that game.' };
        await this.sayEn(this.mic ? "I'll say a word and a meaning. Just say yes or no." : "I'll say a word and a meaning. Decide if it's true, then I'll tell you.");
        let score = 0;
        for (const it of items) {
          const truth = Math.random() < 0.5;
          const other = rand(this.pool.filter(x => norm(x.en) !== norm(it.en)));
          const shown = truth ? it.en : other.en;
          this.total++;
          this.ui.card({ main: `${it.t} = ${shown}?`, sub: '' });
          this.ui.score(`Score ${score}`);
          const res = await this.ask(async () => {
            await this.sayEn('Does');
            await this.sayT(it.t);
            await this.sayEn(`mean ${shown}?`);
          }, this.E, [...YES, ...NO]);
          const said = res.type === 'answer' ? yesNo(res.alts) : null;
          this.ui.reveal(`${it.t} = ${it.en}`);
          if (said && (said === 'yes') === truth) {
            score++; this.right++;
            this.ui.verdict('good');
            await Speech.cues.good();
            await this.sayEn(truth ? 'Correct, it does.' : `Correct. It means ${it.en}.`);
          } else {
            this.ui.verdict(this.mic ? 'bad' : null);
            if (this.mic) await Speech.cues.bad();
            await this.sayEn(truth ? `${this.mic ? 'No, ' : ''}that's true. It means ${it.en}.` : `${this.mic ? 'No, ' : ''}that's false. It means ${it.en}.`);
          }
        }
        if (!this.mic) { this.total = 0; return this.summary('True or False'); }
        return gameOver(this, 'tf', 'True or False', score);
      },
    },

    meaning: {
      name: 'Meaning Match',
      async run() {
        const items = Progress.pick(this.pack.id, this.pool, this.settings.length, 'due');
        await this.sayEn(`I'll say something in ${this.pack.name}. You tell me what it means in English.`);
        let score = 0;
        for (const it of items) {
          this.total++;
          this.ui.card({ main: it.t, sub: '' });
          this.ui.score(`Score ${score}`);
          const res = await this.ask(() => this.sayT(it.t), this.E, englishAnswers(it));
          this.ui.reveal(it.en);
          const ok = res.type === 'answer' && res.score >= CLOSE;
          if (ok) {
            score++; this.right++;
            this.ui.verdict('good');
            await Speech.cues.good();
            await this.sayEn(rand(['Yes,', 'Right,', 'Correct,']) + ` ${it.en}.`);
          } else {
            this.ui.verdict(this.mic ? 'bad' : null);
            if (this.mic) await Speech.cues.bad();
            await this.sayEn(`It means ${it.en}.`);
          }
          if (this.mic) Progress.record(this.pack.id, it, ok);
        }
        if (!this.mic) { this.total = 0; return this.summary('Meaning Match'); }
        return gameOver(this, 'meaning', 'Meaning Match', score);
      },
    },

    numbers: {
      name: 'Number Crunch',
      async run() {
        const all = Packs.items(this.pack, 'all').filter(x => x.n != null && x.n >= 1 && x.n <= 10);
        const byN = new Map(all.map(x => [x.n, x]));
        if (byN.size < 10) {
          return { title: 'Number Crunch unavailable', lines: ['This pack needs numbers 1–10 (items with "n").'], spoken: "This language pack doesn't have the numbers one to ten yet." };
        }
        const rounds = Math.min(this.settings.length, 15);
        await this.sayEn(`Quick sums. I'll mix English and ${this.pack.name}. Answer in ${this.pack.name}.`);
        let score = 0;
        for (let i = 0; i < rounds; i++) {
          const plus = Math.random() < 0.6;
          let a, b, ans;
          if (plus) { a = 1 + Math.floor(Math.random() * 9); b = 1 + Math.floor(Math.random() * (10 - a)); ans = a + b; }
          else { a = 2 + Math.floor(Math.random() * 9); b = 1 + Math.floor(Math.random() * (a - 1)); ans = a - b; }
          const A = byN.get(a), B = byN.get(b), R = byN.get(ans);
          this.total++;
          this.ui.card({ main: `${A.t} ${plus ? '+' : '−'} ${B.t} = ?`, sub: '' });
          this.ui.score(`Score ${score}`);
          const res = await this.ask(async () => {
            await this.sayEn('What is');
            await this.sayT(A.t);
            await this.sayEn(plus ? 'plus' : 'minus');
            await this.sayT(B.t);
          }, this.T, targetAnswers(R));
          const ok = await this.feedback(R, res);
          if (ok) { score++; this.right++; }
        }
        if (!this.mic) { this.total = 0; return this.summary('Number Crunch'); }
        return gameOver(this, 'numbers', 'Number Crunch', score);
      },
    },
  };

  // Hands-free AI conversation: the tutor speaks Spanish, you answer out loud, small corrections are spoken.
  MODES.chat = {
    name: 'Talk with your tutor',
    async run() {
      if (!this.mic) {
        await this.sayEn('Conversation needs the microphone. Try audio flashcards instead.');
        return { title: 'Conversation needs a microphone', lines: ['Try Audio flashcards, which work without one.'] };
      }
      if (!Tutor.enabled()) {
        await this.sayEn('The AI tutor is not set up yet. Add your key on the tutor tab when you are parked.');
        return { title: 'AI tutor not set up', lines: ['Add your API key on the Tutor tab.'] };
      }
      const ctx = { ...Tutor.freeContext(this.settings.level || 'A1', Course.knownWords()), spoken: true };
      const history = [];
      let turns = 0, fixes = 0, failures = 0;
      await this.sayEn("Let's chat in Spanish. Answer out loud. Say stop when you're done.");
      let pendingText = null;
      while (turns < 30) {
        this.ui.status('waiting');
        let r;
        try {
          r = await Tutor.roleplayTurn(ctx, history);
          failures = 0;
        } catch (err) {
          failures++;
          this.ui.notice(err.message);
          if (pendingText != null) history.pop();
          if (failures >= 2 || err.code === 'nokey' || err.code === 'auth') { await this.sayEn("I can't reach the tutor right now, so let's stop here."); break; }
          await this.sayEn('Sorry, I lost the connection. Trying again.');
          if (pendingText != null) history.push({ role: 'user', text: pendingText });
          continue;
        }
        await this.cp();
        history.push({ role: 'assistant', text: JSON.stringify(r) });
        if (pendingText != null && r.feedback && !r.feedback.ok && r.feedback.corrected) {
          fixes++;
          this.ui.card({ main: r.feedback.corrected, sub: r.feedback.note });
          await this.sayEn('Small fix:');
          await this.sayT(r.feedback.corrected, true);
        }
        this.ui.card({ main: r.reply_es, sub: r.reply_en });
        const res = await this.ask(() => this.sayT(r.reply_es), this.T, null);
        if (res.type === 'skip') {
          // "skip" / "I don't know": hear the English and a suggestion, then carry on
          await this.sayEn(`That means: ${r.reply_en}. You could say:`);
          await this.sayT(r.suggestion || 'No sé.', true);
          pendingText = '(The learner was stuck and did not answer. Rephrase more simply or ask something easier.)';
          history.push({ role: 'user', text: pendingText });
          continue;
        }
        if (res.type === 'silence') {
          pendingText = '(The learner did not answer. Ask again more simply.)';
          history.push({ role: 'user', text: pendingText });
          continue;
        }
        pendingText = res.alts[0];
        history.push({ role: 'user', text: pendingText });
        turns++;
        this.total++;
      }
      const lines = [`${turns} replies in Spanish`, `${fixes} corrections`];
      return { title: 'Conversation finished', lines, spoken: `Nice chat. You gave ${turns} replies in Spanish.` };
    },
  };

  async function gameOver(s, game, name, score) {
    const isBest = score > 0 && Progress.setBest(game, s.pack.id, score);
    const sum = s.summary(name);
    sum.title = `${name}: ${score}`;
    if (isBest) {
      sum.lines.unshift('New personal best!');
      await Speech.cues.best();
      sum.spoken = `Game over. You scored ${score}. That's a new personal best!`;
    } else {
      const b = Progress.best(game, s.pack.id);
      sum.lines.push(`Best: ${b}`);
      sum.spoken = `Game over. You scored ${score}. Your best is ${b}.`;
    }
    return sum;
  }

  async function noMicGame(s, name) {
    await s.sayEn(`${name} needs the microphone. Try audio flashcards instead.`);
    return { title: `${name} needs a microphone`, lines: ['Try Audio flashcards, which work without one.'] };
  }

  function start(opts) {
    const s = new Session(opts);
    return { session: s, done: s.run() };
  }

  return { start, MODES, score, norm };
})();
