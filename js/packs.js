// Language pack registry: built-in packs (packs/*.js) plus packs imported as JSON.
const Packs = (() => {
  const CUSTOM_KEY = 'lt.customPacks.v1';
  const builtIn = [];

  function register(p) { builtIn.push({ ...validate(p), builtIn: true }); }

  function custom() {
    try {
      const list = JSON.parse(localStorage.getItem(CUSTOM_KEY)) || [];
      return list.map(p => { try { return validate(p); } catch (_) { return null; } }).filter(Boolean);
    } catch (_) { return []; }
  }

  function all() { return [...builtIn, ...custom()]; }
  function get(id) { return all().find(p => p.id === id) || null; }

  const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  // Returns a clean copy containing only known fields; throws a readable error if invalid.
  function validate(p) {
    if (!p || typeof p !== 'object') throw new Error('The file is not a language pack.');
    const name = str(p.name, 60);
    const lang = str(p.lang, 20);
    if (!name) throw new Error('The pack needs a "name".');
    if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) throw new Error('The pack needs a "lang" speech code, e.g. "es-ES" or "pt-BR".');
    if (!Array.isArray(p.topics) || !p.topics.length) throw new Error('The pack needs a "topics" list.');
    const topics = p.topics.map((t, i) => {
      const tname = str(t && t.name, 60) || 'Topic ' + (i + 1);
      const items = (Array.isArray(t && t.items) ? t.items : []).map(it => {
        if (!it || !str(it.en) || !str(it.t)) return null;
        const out = { en: str(it.en), t: str(it.t) };
        if (Array.isArray(it.alt)) out.alt = it.alt.map(a => str(a)).filter(Boolean);
        if (Array.isArray(it.ea)) out.ea = it.ea.map(a => str(a)).filter(Boolean);
        if (Number.isInteger(it.n)) out.n = it.n;
        return out;
      }).filter(Boolean);
      return { id: slug(t.id || tname) || 'topic-' + i, name: tname, items };
    }).filter(t => t.items.length);
    if (!topics.length) throw new Error('No usable items found. Each item needs "en" and "t".');
    return { id: slug(p.id || name + '-' + lang), name, lang, flag: str(p.flag, 8) || '🌍', topics };
  }

  function addCustom(raw) {
    const p = validate(raw);
    if (builtIn.some(b => b.id === p.id)) p.id += '-custom';
    const list = custom().filter(x => x.id !== p.id);
    list.push(p);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
    return p;
  }

  function removeCustom(id) {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom().filter(x => x.id !== id)));
  }

  function items(pack, topicId) {
    const topics = topicId === 'all' ? pack.topics : pack.topics.filter(t => t.id === topicId);
    return topics.flatMap(t => t.items.map(it => ({ ...it, topic: t.id })));
  }

  const template = {
    name: 'Portuguese (Brazil)',
    lang: 'pt-BR',
    flag: '🇧🇷',
    topics: [
      {
        name: 'Greetings',
        items: [
          { en: 'hello', t: 'olá', alt: ['oi'] },
          { en: 'good morning', t: 'bom dia' },
          { en: 'thank you', t: 'obrigado', alt: ['obrigada'], ea: ['thanks'] },
        ],
      },
      {
        name: 'Numbers',
        items: [
          { en: 'one', t: 'um', n: 1 },
          { en: 'two', t: 'dois', n: 2 },
        ],
      },
    ],
  };

  return { register, all, get, addCustom, removeCustom, items, validate, template };
})();

window.registerPack = Packs.register;
