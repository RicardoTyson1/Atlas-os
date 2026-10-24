// Spanish tutor for Atlas: the teaching method, the lesson-logging tool, and loading
// Ricardo's progress from the vault's Spanish/ folder. Not exposed as a route.
import { readText, commit, b64FromText, today } from './_vault.js';

export const SPANISH_TUTOR = `SPANISH MODE IS ON. For this conversation you are Ricardo's Spanish tutor. Keep Atlas's character, but the job now is teaching him Latin American (Mexican-leaning) Spanish until he speaks it fluently. He is a total beginner. His goals: talking with customers and crews on job sites, everyday conversation, travel, and family. He gives it 20 to 30 minutes a day, often by voice, sometimes while driving.

How you teach:
Speak first, grammar second. Teach whole useful phrases (chunks) he can say today, then point out the one pattern inside them. Keep explanations in simple English while he is a beginner, and use more Spanish each unit (Units 1-3 mostly English; 4-8 about half Spanish; 9-12 mostly Spanish with English only to unblock him).
One step at a time. Never dump a whole lesson. Give one small piece, ask him to say or answer something, then wait for his reply. Your turns are spoken out loud, so keep each one under 60 words.
For every new word or phrase give the Spanish with correct accents, a simple sound-it-out guide in caps for the stressed syllable, and the meaning, like: la pared (lah pah-RED), the wall.
Make him produce Spanish constantly: repeat after me, English-to-Spanish prompts, then quick questions he must answer in Spanish, then a short role-play.
Corrections: praise what was right, give the correct version once, point out one thing only, and have him say it again. Never pile on several corrections.
Pronunciation: teach the five pure vowels (a e i o u), the tapped r and rolled rr, soft d, silent h, j and g as a throaty h, and ll and y as y. Use Latin American usage: ustedes (not vosotros), seseo (z and c sound like s), carro, celular, computadora, enchufe or tomacorriente for outlet.
Use real job-site situations from his business (TV mounting, cord hiding, brackets, brick and drywall, deposits and prices, scheduling) as much as everyday, travel and family situations.

Daily lesson (when he says lesson, clase, practice, or "start my Spanish"):
1. Warm-up review, about 5 minutes: quiz 4 to 6 words or phrases from his vocabulary that are due (added 1, 3, 7, 14 or 30 days ago, plus anything in recent mistakes).
2. New material, about 10 minutes: 5 to 8 new phrases from his current unit in the course. Drill them both directions.
3. Speaking, about 10 minutes: a role-play using today's phrases (for example a customer asking for a quote). You play the other person in simple Spanish.
4. Wrap-up, about 2 minutes: three things he can now say, one thing to practice today, then call spanish_log.
If he only has a few minutes or is driving, do a short voice-only version: review plus one role-play, no reading needed.

Tracking: call spanish_log at the end of every lesson, and whenever he finishes a unit, with the new words he practiced, his mistakes, and a one-line summary. Move to the next unit only when he can use most of the current unit's phrases without help. Never invent progress he did not make.
Outside lessons in Spanish mode, answer his "how do I say..." questions with the phrase, sound guide and meaning, then have him say it.
If he says "English" or "stop Spanish", answer normally in English.`;

export const SPANISH_TOOL = {
  name: 'spanish_log',
  description: "Record a Spanish lesson in the vault: new words and phrases, mistakes, a short summary, and (if he completed it) the unit he moves to next.",
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One line: what he practiced and how it went.' },
      minutes: { type: 'number', description: 'About how long the lesson ran.' },
      words: {
        type: 'array',
        description: 'New words or phrases practiced this lesson.',
        items: { type: 'object', properties: { es: { type: 'string' }, en: { type: 'string' } }, required: ['es', 'en'] }
      },
      mistakes: {
        type: 'array',
        description: 'Mistakes worth reviewing, with the correct form.',
        items: { type: 'object', properties: { said: { type: 'string' }, correct: { type: 'string' }, note: { type: 'string' } }, required: ['correct'] }
      },
      next_unit: { type: 'number', description: 'Set only when he has finished his current unit: the unit number he moves on to.' }
    },
    required: ['summary']
  }
};

const one = s => String(s || '').replace(/[\r\n|]+/g, ' ').trim().slice(0, 200);
const tail = (text, n) => text.split('\n').filter(l => l.trim()).slice(-n).join('\n');

export async function loadSpanish(cfg) {
  const [progress, vocab, mistakes, course] = await Promise.all(
    ['Spanish/Progress.md', 'Spanish/Vocabulary.md', 'Spanish/Mistakes.md', 'Spanish/Curriculum.md'].map(p => readText(cfg, p).catch(() => null))
  );
  const parts = [`Today is ${today()}. Use the dates below to pick review words that are due.`];
  if (progress) {
    // Keep the profile part plus only the latest lesson log lines.
    const [head, log = ''] = progress.split(/\n## Log\n/);
    parts.push(`His progress:\n${head.trim().slice(0, 2500)}${log.trim() ? `\nRecent lessons:\n${tail(log, 8)}` : ''}`);
  } else {
    parts.push('His progress: no lessons logged yet. Start at Unit 1.');
  }
  if (vocab) parts.push(`His vocabulary (date | Spanish | English), newest last:\n${tail(vocab.replace(/^#.*$/gm, ''), 150)}`);
  if (mistakes) parts.push(`Recent mistakes to recycle:\n${tail(mistakes.replace(/^#.*$/gm, ''), 25)}`);
  if (course) parts.push(`The course:\n${course.slice(0, 9000)}`);
  return parts.join('\n\n');
}

export async function logSpanish(cfg, input) {
  const date = today();
  const words = (Array.isArray(input.words) ? input.words : []).filter(w => w && w.es && w.en).slice(0, 40);
  const mistakes = (Array.isArray(input.mistakes) ? input.mistakes : []).filter(m => m && m.correct).slice(0, 20);
  const minutes = Math.max(0, Math.min(180, Math.round(Number(input.minutes) || 0)));
  const nextUnit = Number.isInteger(input.next_unit) && input.next_unit >= 1 && input.next_unit <= 12 ? input.next_unit : null;
  const changes = [];
  if (words.length) changes.push({ path: 'Spanish/Vocabulary.md', append: words.map(w => `- ${date} | ${one(w.es)} | ${one(w.en)}`).join('\n'), header: '# Vocabulary\n\n' });
  if (mistakes.length) changes.push({ path: 'Spanish/Mistakes.md', append: mistakes.map(m => `- ${date} | ${m.said ? `said "${one(m.said)}" → ` : ''}${one(m.correct)}${m.note ? ` (${one(m.note)})` : ''}`).join('\n'), header: '# Mistakes\n\n' });

  let progress = (await readText(cfg, 'Spanish/Progress.md')) || '# Spanish progress\n\nCurrent unit: 1\nLessons completed: 0\n\n## Log\n';
  if (!/\n## Log\n/.test(progress)) progress = progress.trimEnd() + '\n\n## Log\n';
  progress = progress.replace(/^Lessons completed: (\d+)/m, (_, n) => `Lessons completed: ${Number(n) + 1}`);
  if (nextUnit) progress = progress.replace(/^Current unit: .*$/m, `Current unit: ${nextUnit}`);
  const line = `- ${date}${minutes ? ` (${minutes} min)` : ''}: ${one(input.summary)}${words.length ? ` [${words.length} new]` : ''}${nextUnit ? ` → moved to Unit ${nextUnit}` : ''}`;
  changes.push({ path: 'Spanish/Progress.md', b64: b64FromText(progress.trimEnd() + '\n' + line + '\n') });

  await commit(cfg, changes, `Spanish lesson ${date}`);
  return { text: `Logged: ${words.length} words, ${mistakes.length} mistakes${nextUnit ? `, now on Unit ${nextUnit}` : ''}.` };
}
