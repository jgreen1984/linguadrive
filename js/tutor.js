// AI tutor powered by Claude (Anthropic SDK, loaded from a CDN as an ES module).
// The API key is the user's own and stays in this browser's localStorage.
const Tutor = (() => {
  const KEY = 'lt.anthropicKey';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.8.0/+esm';
  const MODEL = 'claude-opus-5-5';
  let sdk = null;
  let client = null;
  let clientKey = null;

  const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch (_) { return ''; } };
  function setKey(k) {
    try { k ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); } catch (_) {}
    client = null;
  }
  const enabled = () => !!getKey();

  async function getClient() {
    const key = getKey();
    if (!key) throw new TutorError('Add your Anthropic API key in Tutor settings to use the AI tutor.', 'nokey');
    if (!sdk) sdk = await import(SDK_URL);
    if (!client || clientKey !== key) {
      // The key belongs to the person using this page and is only sent to Anthropic.
      client = new sdk.default({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
      clientKey = key;
    }
    return client;
  }

  class TutorError extends Error {
    constructor(msg, code) { super(msg); this.code = code; }
  }

  function friendly(err) {
    if (err instanceof TutorError) return err;
    const A = sdk && sdk.default;
    if (A) {
      if (err instanceof A.AuthenticationError) return new TutorError('That API key was not accepted. Check it in Tutor settings.', 'auth');
      if (err instanceof A.PermissionDeniedError) return new TutorError('This API key does not have permission to use the model.', 'perm');
      if (err instanceof A.RateLimitError) return new TutorError('The tutor is busy (rate limit). Try again in a minute.', 'rate');
      if (err instanceof A.APIConnectionError) return new TutorError('Could not reach the tutor. Check your internet connection.', 'net');
      if (err instanceof A.BadRequestError) return new TutorError('The tutor could not handle that request: ' + (err.message || 'bad request'), 'bad');
      if (err instanceof A.APIError) return new TutorError('The tutor had a problem (' + (err.status || 'error') + '). Try again.', 'api');
    }
    if (String(err && err.message).includes('import')) return new TutorError('Could not load the tutor. Check your internet connection.', 'net');
    return new TutorError('Something went wrong with the tutor: ' + ((err && err.message) || err), 'other');
  }

  // One structured-output request. Returns the parsed JSON object.
  async function ask({ system, messages, schema, maxTokens = 4000, effort = 'low' }) {
    try {
      const c = await getClient();
      const params = {
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages,
        output_config: { effort, format: { type: 'json_schema', schema } },
      };
      let res;
      try {
        // Server-side refusal fallback: if the model declines, the API retries on a fallback model.
        res = await c.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
      } catch (e) {
        if (sdk && e instanceof sdk.default.BadRequestError && /fallback/i.test(e.message || '')) {
          res = await c.messages.create(params);
        } else throw e;
      }
      if (res.stop_reason === 'refusal') throw new TutorError("The tutor couldn't help with that one. Try rephrasing.", 'refusal');
      if (res.stop_reason === 'max_tokens') throw new TutorError('The reply was cut off. Try again.', 'cut');
      const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
      return JSON.parse(text);
    } catch (e) {
      throw friendly(e);
    }
  }

  const levelName = { A1: 'beginner (CEFR A1)', A2: 'elementary (CEFR A2)', B1: 'intermediate (CEFR B1)' };

  // ---------- role-play conversation ----------
  const TURN_SCHEMA = {
    type: 'object',
    properties: {
      reply_es: { type: 'string', description: 'Your next line in Spanish, in character.' },
      reply_en: { type: 'string', description: 'English translation of reply_es.' },
      feedback: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', description: "True if the learner's last message was correct enough." },
          corrected: { type: 'string', description: "Corrected Spanish version of the learner's last message, or empty string if ok." },
          note: { type: 'string', description: 'One short English sentence explaining the main fix, or a brief encouragement if ok. Empty on the first turn.' },
        },
        required: ['ok', 'corrected', 'note'],
        additionalProperties: false,
      },
      goal_met: { type: 'boolean', description: 'True once the learner has achieved the scenario goal.' },
      suggestion: { type: 'string', description: 'A short example of something the learner could say next, in Spanish.' },
    },
    required: ['reply_es', 'reply_en', 'feedback', 'goal_met', 'suggestion'],
    additionalProperties: false,
  };

  function roleplaySystem({ level, scenario, aiRole, learnerGoal, known, grammar, spoken }) {
    return [
      `You are a Spanish conversation partner for an adult British English speaker learning Spanish at ${levelName[level] || level} level.`,
      `Role-play: you are ${aiRole}. Scenario: ${scenario} The learner's goal: ${learnerGoal}`,
      `Keep each of your lines short (1-2 sentences) and natural, using Spain Spanish. Stay within the learner's level: mostly use words and grammar they know, and if you need a new word, keep the sentence simple enough to guess it.`,
      known && known.length ? `Words the learner has met: ${known.join(', ')}.` : '',
      grammar && grammar.length ? `Grammar they have studied: ${grammar.join('; ')}.` : '',
      `After each learner message, judge it. Ignore missing accents and capitalisation${spoken ? ', and allow for speech-recognition slips (the learner is speaking, not typing)' : ''}. Mark ok=false only for real errors in grammar, word choice or meaning, and give the corrected version and a one-sentence explanation in English.`,
      `Keep the conversation moving towards the goal. When the goal is met, set goal_met=true and wrap up warmly in one line. If the learner writes in English or is stuck, gently help them with a suggestion and keep going in Spanish.`,
    ].filter(Boolean).join('\n');
  }

  // history: [{ role: 'user'|'assistant', text }]; assistant text is the previous reply JSON.
  async function roleplayTurn(ctx, history) {
    const messages = history.length
      ? history.map(h => ({ role: h.role, content: h.text }))
      : [{ role: 'user', content: '(The conversation is starting. Open the conversation in character with a short greeting or question.)' }];
    return ask({ system: roleplaySystem(ctx), messages, schema: TURN_SCHEMA, maxTokens: 3000 });
  }

  // ---------- explain a mistake ----------
  const EXPLAIN_SCHEMA = {
    type: 'object',
    properties: {
      explanation: { type: 'string', description: 'Plain-English explanation of why the expected answer is right and what was wrong with the learner answer, 2-4 short sentences.' },
      tip: { type: 'string', description: 'One memorable tip or pattern to avoid this mistake next time.' },
      example: { type: 'string', description: 'One extra short Spanish example sentence using the same point, with English in brackets.' },
    },
    required: ['explanation', 'tip', 'example'],
    additionalProperties: false,
  };
  function explain({ level, task, expected, given }) {
    return ask({
      system: `You are a patient Spanish tutor for an adult British English speaker at ${levelName[level] || level} level. Explain mistakes clearly and briefly in plain English, without jargon unless you define it. Be encouraging but specific.`,
      messages: [{ role: 'user', content: `Exercise: ${task}\nExpected answer: ${expected}\nMy answer: ${given || '(no answer)'}\nWhy was mine wrong?` }],
      schema: EXPLAIN_SCHEMA,
      maxTokens: 2000,
    });
  }

  // ---------- is my alternative answer also right? ----------
  const JUDGE_SCHEMA = {
    type: 'object',
    properties: {
      acceptable: { type: 'boolean', description: "True if the learner's answer is a correct, natural way to say it (ignoring missing accents)." },
      explanation: { type: 'string', description: 'One or two short English sentences explaining the verdict.' },
    },
    required: ['acceptable', 'explanation'],
    additionalProperties: false,
  };
  function judge({ level, task, expected, given }) {
    return ask({
      system: `You are a fair Spanish examiner for an adult learner at ${levelName[level] || level} level. Decide whether the learner's answer is also correct. Accept valid alternatives (dropped subject pronouns, different but correct word order, synonyms, Latin American usage). Ignore missing accents and capitalisation. Reject real grammar or meaning errors.`,
      messages: [{ role: 'user', content: `Exercise: ${task}\nModel answer: ${expected}\nMy answer: ${given}` }],
      schema: JUDGE_SCHEMA,
      maxTokens: 1500,
    });
  }

  // ---------- generate more practice ----------
  const GEN_SCHEMA = {
    type: 'object',
    properties: {
      sentences: {
        type: 'array',
        items: {
          type: 'object',
          properties: { t: { type: 'string' }, en: { type: 'string' } },
          required: ['t', 'en'], additionalProperties: false,
        },
      },
      drills: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            t: { type: 'string', description: 'Spanish sentence with exactly one ___ gap.' },
            answer: { type: 'string' },
            options: { type: 'array', items: { type: 'string' }, description: '3 options including the answer.' },
            en: { type: 'string' },
            hint: { type: 'string' },
          },
          required: ['t', 'answer', 'options', 'en', 'hint'], additionalProperties: false,
        },
      },
    },
    required: ['sentences', 'drills'],
    additionalProperties: false,
  };
  async function generate({ unit, known }) {
    const g = unit.grammar.map(x => `${x.title}: ${x.explain}`).join('\n');
    const out = await ask({
      system: 'You write accurate Spain-Spanish practice material for adult learners. Every sentence must be grammatically perfect, natural, and under 10 words. Gap drills must have exactly one "___" and exactly one grammatical option.',
      messages: [{ role: 'user', content: `Unit: ${unit.title} (${unit.level}). Goal: ${unit.goal}\nGrammar:\n${g}\nUnit words: ${unit.vocab.map(v => v.t).join(', ')}\nOther known words: ${known.slice(-80).join(', ')}\n\nWrite 6 new practice sentences and 5 new gap drills on this unit's grammar, different from these existing ones: ${unit.sentences.map(s => s.t).join(' | ')}` }],
      schema: GEN_SCHEMA,
      maxTokens: 6000,
      effort: 'medium',
    });
    const drills = (out.drills || []).filter(d => d.t.split('___').length === 2 && d.options.includes(d.answer));
    return { sentences: (out.sentences || []).filter(s => s.t && s.en), drills };
  }

  // ---------- free conversation (driving / at home) ----------
  function freeContext(level, known, topic) {
    return {
      level,
      aiRole: 'a friendly Spanish speaker called Marta who is chatting with the learner',
      scenario: topic || 'A relaxed everyday chat about the learner\'s day, plans, family, work and interests.',
      learnerGoal: 'Keep a conversation going for several turns.',
      known,
      grammar: [],
    };
  }

  return { getKey, setKey, enabled, roleplayTurn, explain, judge, generate, freeContext, TutorError, MODEL };
})();
