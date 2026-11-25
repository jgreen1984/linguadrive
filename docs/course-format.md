# Course unit format

Course content lives in `js/course/*.js`. Each file calls `registerUnits([...])` with an array of units, in order.
Use **double-quoted JavaScript strings** everywhere (Spanish and English text contain apostrophes). Plain ASCII
quotes only; Spanish characters (á é í ó ú ñ ü ¿ ¡) are fine as-is (files are UTF-8).

```js
registerUnits([
  {
    id: "a1-01",                 // level-number, unique
    level: "A1",                 // "A1" | "A2" | "B1"
    title: "Meeting people",     // short, English
    goal: "Greet people, say your name and where you're from",  // one line: "can do" statement

    // 10–14 key words/phrases for the unit. Spain Spanish by default.
    vocab: [
      { en: "hello", t: "hola" },
      { en: "my name is…", t: "me llamo…", ea: ["I'm called"] },
      { en: "the brother", t: "el hermano", pos: "noun", g: "m" },
      { en: "seven", t: "siete", n: 7 },
    ],
    //   en   English meaning (lowercase unless proper noun)
    //   t    Spanish. Nouns WITH article ("el coche"). Verbs as infinitive ("hablar").
    //   alt  optional other accepted Spanish answers (e.g. Latin American "el carro", or without article)
    //   ea   optional other accepted English answers
    //   n    integer, only for numbers (lets "7" be accepted)
    //   pos  optional: noun | verb | adj | adv | phrase | other
    //   g    optional for nouns: "m" | "f"

    // 1–2 grammar points. Explanations are short, friendly, plain English, 2–5 sentences.
    grammar: [
      {
        id: "a1-01-ser",
        title: "Ser – to be (who you are)",
        explain: "Use ser for identity, nationality and where you're from. It's irregular, so learn the forms as a set.",
        table: { head: ["Person", "Ser"], rows: [["yo", "soy"], ["tú", "eres"], ["él / ella / usted", "es"]] },  // optional
        examples: [ { t: "Soy de Londres.", en: "I'm from London." } ],   // 2–4
      },
    ],

    // 8–10 short sentences using this unit's vocab + grammar (and earlier units), getting gradually harder.
    // Used for translation, sentence-building tiles, dictation and speaking. Keep each under ~10 words.
    sentences: [
      { t: "Me llamo Ana y soy de Madrid.", en: "My name is Ana and I'm from Madrid.", alt: ["Soy Ana y soy de Madrid."] },
    ],

    // 6–8 gap-fill drills on the unit's grammar. Exactly one "___" in t. options include the answer (3–4 options).
    drills: [
      { t: "Yo ___ de Inglaterra.", answer: "soy", options: ["soy", "eres", "es"], en: "I'm from England.", hint: "ser, yo form" },
    ],

    // A short natural dialogue (6–10 lines) using the unit language, plus 2–3 comprehension questions in English.
    dialogue: {
      title: "At a party",
      lines: [ { who: "Ana", t: "¡Hola! ¿Cómo te llamas?", en: "Hi! What's your name?" } ],
      questions: [ { q: "Where is Ana from?", options: ["Madrid", "Seville", "London"], answer: 0 } ],  // answer = index
    },

    // Brief for the AI tutor role-play at the end of the unit.
    roleplay: {
      aiRole: "a friendly Spanish colleague called Lucía",
      scenario: "You meet Lucía at a work event in Madrid.",
      learnerGoal: "Greet Lucía, say your name and where you're from, and ask how she is.",
    },
  },
]);
```

## Rules
- Accuracy first: correct spelling, accents and agreement. Spain Spanish (vosotros exists, but drills focus on yo/tú/él/usted/nosotros/ellos), with common Latin American alternatives in `alt` where natural.
- Content must build on earlier units only; don't use grammar from later units in sentences/dialogues.
- Keep it practical and adult (work, travel, driving, family, daily life). No childish content.
- No HTML in strings.
