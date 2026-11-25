// Thin wrapper around the Web Speech API (text-to-speech + speech recognition).
const Speech = (() => {
  const synth = window.speechSynthesis || null;
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  let voices = [];
  let currentRec = null;

  function loadVoices() { voices = synth ? synth.getVoices() : []; }
  if (synth) {
    loadVoices();
    if ('onvoiceschanged' in synth) synth.onvoiceschanged = loadVoices;
  }

  function pickVoice(lang) {
    const l = lang.toLowerCase();
    const base = l.slice(0, 2);
    return (
      voices.find(v => v.lang.toLowerCase().replace('_', '-') === l && v.localService) ||
      voices.find(v => v.lang.toLowerCase().replace('_', '-') === l) ||
      voices.find(v => v.lang.toLowerCase().startsWith(base)) ||
      null
    );
  }

  function speak(text, lang, opts = {}) {
    return new Promise(resolve => {
      if (!synth || !text) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      const v = pickVoice(lang);
      if (v) u.voice = v;
      u.rate = Math.max(0.5, Math.min(1.6, opts.rate || 1));
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(guard); resolve(); } };
      u.onend = finish;
      u.onerror = finish;
      // Some browsers occasionally never fire onend; don't hang the session.
      const guard = setTimeout(finish, 5000 + text.length * 180 / u.rate);
      if (synth.paused) synth.resume();
      synth.speak(u);
    });
  }

  // Resolves with { alts: [transcripts], error: string|null }.
  function listen(lang, timeoutMs = 7000) {
    return new Promise(resolve => {
      if (!Rec) return resolve({ alts: [], error: 'unsupported' });
      const r = new Rec();
      currentRec = r;
      r.lang = lang;
      r.interimResults = false;
      r.continuous = false;
      r.maxAlternatives = 5;
      let alts = [];
      let error = null;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(hardTimer);
        if (currentRec === r) currentRec = null;
        resolve({ alts, error });
      };
      r.onresult = e => {
        const res = e.results[0];
        alts = Array.from(res).map(a => a.transcript.trim()).filter(Boolean);
      };
      r.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') error = e.error; };
      r.onend = finish;
      const timer = setTimeout(() => { try { r.stop(); } catch (_) {} }, timeoutMs);
      const hardTimer = setTimeout(finish, timeoutMs + 2500);
      try { r.start(); } catch (_) { finish(); }
    });
  }

  function stopListening() {
    if (currentRec) { try { currentRec.abort(); } catch (_) {} }
  }

  function cancel() {
    if (synth) synth.cancel();
    stopListening();
  }

  async function ensureMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      return true;
    } catch (_) {
      return false;
    }
  }

  // Short audio cues so you know what's happening without looking.
  let ctx = null;
  function unlockAudio() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (_) {}
  }
  function tone(freqs, dur = 0.12, gap = 0.02) {
    if (!ctx) return Promise.resolve();
    let t = ctx.currentTime + 0.01;
    for (const f of freqs) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
      t += dur + gap;
    }
    return new Promise(r => setTimeout(r, (t - ctx.currentTime) * 1000 + 30));
  }
  const cues = {
    listen: () => tone([660, 880], 0.08),
    good: () => tone([523, 659, 784], 0.09),
    bad: () => tone([330, 247], 0.14),
    best: () => tone([523, 659, 784, 1047], 0.12),
  };

  return {
    canSpeak: !!synth,
    canListen: !!Rec,
    speak, listen, cancel, stopListening, ensureMic, unlockAudio, cues,
  };
})();
