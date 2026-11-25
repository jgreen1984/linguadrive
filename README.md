# LinguaDrive

A Spanish course (A1 → B1) that adapts to your pace, with screen lessons for home and a hands-free voice mode for the car. It's plain HTML/JS with no build step, and progress is saved in your browser.

## Run it

```powershell
python -m http.server 8642
```

Then open http://localhost:8642 in Chrome or Edge. Microphone features need `localhost` or HTTPS, so to use it on your phone, host the folder over HTTPS (for example GitHub Pages or Netlify).

## What's in it

- **Today**: your daily plan. Reviews that are due come first. New material depends on your accuracy this week and how many reviews are waiting (*consolidation*, *steady* or *stretch* day).
- **Course**: 22 units (A1 ×8, A2 ×8, B1 ×6). Each unit has six stages: Words → Grammar → Sentences → Listening → Conversation (AI) → Unit check (80% to pass). A placement check skips units you already know.
- **Exercises**: multiple choice, typing (tolerant of missing accents, articles and dropped pronouns), sentence tiles, dictation, speaking, gap-fills and dialogues. Items move up from recognising to typing to hearing and saying them as you learn them. Mistakes come back at the end of the lesson and in spaced-repetition reviews.
- **Drive**: eyes-free practice over what you've met in the course, or the phrasebooks. Answer out loud; say *skip / repeat / pause / stop*; steering-wheel media buttons work. There are also games, and a spoken conversation with the AI tutor.
- **Tutor** (optional): add your own Anthropic API key to get role-plays, mistake explanations, "was my answer also right?" checks, extra AI-written practice, and free conversation. It uses `claude-opus-5-5` through the Anthropic JS SDK, with server-side refusal fallback turned on. The key is stored only in this browser.
- **Progress**: streak, minutes, accuracy, mastery per unit, your trickiest items, and settings.

## Files

| Path | What |
|---|---|
| `js/course/es-*.js` | Course content (format: `docs/course-format.md`) |
| `js/course.js` | Units, unlocking, adaptive plan, lesson builders |
| `js/lesson.js` | Screen lesson player and AI chat view |
| `js/progress.js` | Spaced repetition + stats (localStorage) |
| `js/engine.js` | Hands-free session engine |
| `js/tutor.js` | Claude-powered tutor |
| `js/speech.js` | Text-to-speech and speech recognition |
| `packs/*.js` | Phrasebook packs for the hands-free mode (import more as JSON) |
