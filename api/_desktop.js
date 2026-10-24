// Desktop module: Atlas sends commands to Ricardo's Mac through a small queue in Upstash Redis.
// The Mac helper (mac/atlas-helper.js) polls for commands, runs them and posts results back.
// Not exposed as a route.
import { storageConfig } from './_atlas.js';

export const ORGANIZE_FOLDERS = ['Jobs', 'Quotes and Invoices', 'Customers', 'Commercial', 'Marketing', 'Personal', 'Archive', 'To Review'];

// safe: runs immediately. ask: waits for Ricardo to tap Allow in Atlas.
const ACTIONS = {
  open_app: { safe: true, check: a => str(a.name, 80) && { name: str(a.name, 80) }, say: a => `Open ${a.name}` },
  open_url: { safe: true, check: a => /^https?:\/\/[^\s]{3,500}$/i.test(a.url || '') && { url: a.url }, say: a => `Open ${a.url}` },
  open_path: { safe: true, check: a => str(a.path, 400) && { path: str(a.path, 400) }, say: a => `Open ${a.path}` },
  find_files: { safe: true, check: a => str(a.query, 100) && { query: str(a.query, 100) }, say: a => `Find files named "${a.query}"` },
  volume: { safe: true, check: a => volumeArg(a.level), say: a => `Volume ${a.level}` },
  media: { safe: true, check: a => ['play_pause', 'next', 'previous'].includes(a.command) && { command: a.command }, say: a => `Media ${a.command.replace('_', '/')}` },
  lock_screen: { safe: true, check: () => ({}), say: () => 'Lock the screen' },
  list_desktop: { safe: true, check: () => ({}), say: () => 'List the Desktop' },
  screenshot: { safe: false, check: () => ({}), say: () => 'Take a screenshot so Atlas can see your screen' },
  run_shortcut: { safe: false, check: a => str(a.name, 100) && { name: str(a.name, 100) }, say: a => `Run the Shortcut "${a.name}"` },
  organize_desktop: { safe: false, check: organizeArgs, say: a => `Move ${a.moves.length} Desktop item${a.moves.length === 1 ? '' : 's'} into folders (move only, nothing deleted or renamed)` },
  undo_organize: { safe: false, check: () => ({}), say: () => 'Undo the last Desktop organize (move items back)' }
};

function str(v, max) { v = typeof v === 'string' ? v.trim() : ''; return v && v.length <= max ? v : ''; }
function volumeArg(level) {
  if (['up', 'down', 'mute', 'unmute'].includes(level)) return { level };
  const n = Number(level);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? { level: Math.round(n) } : null;
}
function organizeArgs(a) {
  const moves = Array.isArray(a.moves) ? a.moves : [];
  if (!moves.length || moves.length > 40) return null;
  const clean = [];
  for (const m of moves) {
    const name = typeof m?.name === 'string' ? m.name : '';
    if (!name || name.includes('/') || name.startsWith('.') || name.length > 255) return null;
    if (!ORGANIZE_FOLDERS.includes(m.folder)) return null;
    if (ORGANIZE_FOLDERS.includes(name)) return null;
    clean.push({ name, folder: m.folder });
  }
  return { moves: clean };
}

export function checkAction(action, args) {
  const spec = ACTIONS[action];
  if (!spec) return { error: `Unknown Mac action "${action}".` };
  const clean = spec.check(args || {});
  if (!clean) return { error: `The details for ${action} were not valid.` };
  return { clean, safe: spec.safe, summary: spec.say(clean) };
}

export const MAC_TOOL = {
  name: 'mac',
  description: 'Control Ricardo\'s MacBook through the Atlas helper. Actions: open_app {name}, open_url {url}, open_path {path} (a file or folder, ~ allowed), find_files {query} (search file names in his home folder), volume {level: 0-100 | "up" | "down" | "mute" | "unmute"}, media {command: play_pause | next | previous}, lock_screen, list_desktop (read-only list of everything on the Desktop), screenshot (see his screen; needs his Allow), run_shortcut {name} (an Apple Shortcut; needs Allow), organize_desktop {moves: [{name, folder}]} (move-only; needs Allow), undo_organize (needs Allow).',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: Object.keys(ACTIONS) },
      args: { type: 'object', description: 'Details for the action, as listed in the description.' }
    },
    required: ['action']
  }
};

export const DESKTOP_GUIDE = `Desktop module: ONLINE. You can control Ricardo's MacBook with the mac tool, from wherever he is talking to you. Safe actions (open apps, sites and files, find files, volume, media, lock screen, list the Desktop) run immediately. Screenshots, Shortcuts and moving files wait for him to tap Allow in Atlas; tell him when an Allow is waiting. If the Mac is offline, say so plainly (the helper only runs while the Mac is awake).
To find a file he names, use find_files first, then open_path with the exact path. Brightness and Do Not Disturb are done by running his Apple Shortcuts by name if he has made them.
Organizing the Desktop follows his rules exactly, in this order:
1. Call list_desktop and give him the complete list of every file and folder, changing nothing.
2. Propose where each item goes, using only these folders: Jobs, Quotes and Invoices, Customers, Commercial, Marketing, Personal, Archive, To Review. Anything unclear goes to To Review. Show the plan grouped by folder and ask for his approval. Stop and wait.
3. Only after he clearly approves (and only with any changes he asked for), move the items. If the exact names are not in this conversation, call list_desktop again first. Send the moves in batches of at most 40 items per organize_desktop call, using exact names. The first batch needs his Allow; once he allows it, the remaining batches of that run go through without asking again (for 15 minutes). While batching, keep your words very short. Moving only ever moves: it never deletes, renames or overwrites, and it skips anything whose name already exists in the destination.
4. When all batches finish, give him a short summary per folder of what moved and list anything skipped. Mention he can say "undo the Desktop organize" to put the whole run back.
Never reveal or speak passwords or secrets you might see on screen.`;

/* ---------- Upstash Redis (REST) ---------- */

export const K = {
  seen: 'atlas:mac:seen',
  queue: 'atlas:mac:queue',
  pending: 'atlas:mac:pending',
  hot: 'atlas:mac:hot',
  organizeOk: 'atlas:mac:organize-ok',
  cmd: id => `atlas:mac:cmd:${id}`
};

export async function redis(db, command) {
  const r = await fetch(db.url, { method: 'POST', headers: { Authorization: `Bearer ${db.token}`, 'content-type': 'application/json' }, body: JSON.stringify(command) });
  if (!r.ok) throw new Error(`Storage ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`Storage: ${j.error}`);
  return j.result;
}

export const desktopDb = () => storageConfig();

export async function macOnline(db) {
  const seen = await redis(db, ['GET', K.seen]);
  if (!seen) return null;
  try { return JSON.parse(seen); } catch { return { host: 'Mac' }; }
}

export const markHot = db => redis(db, ['SET', K.hot, '1', 'EX', '120']).catch(() => {});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Queue a command and wait for its result. Returns { text, image? , error? }.
export async function runMac(db, action, args) {
  const v = checkAction(action, args);
  if (v.error) return { text: v.error, error: true };
  const online = await macOnline(db);
  if (!online) return { text: 'The Mac is offline: the Atlas helper is not running or the Mac is asleep. Nothing was done.', error: true };

  // Once he allows the first organize batch, the rest of that run doesn't ask again.
  if (action === 'organize_desktop' && !v.safe && await redis(db, ['GET', K.organizeOk])) v.safe = true;
  const id = crypto.randomUUID();
  const cmd = { id, action, args: v.clean, summary: v.summary, status: v.safe ? 'queued' : 'approval', created: Date.now() };
  await redis(db, ['SET', K.cmd(id), JSON.stringify(cmd), 'EX', '600']);
  await redis(db, v.safe ? ['RPUSH', K.queue, id] : ['SADD', K.pending, id]);

  const limit = Date.now() + (v.safe ? 20000 : 110000);
  let last = cmd;
  while (Date.now() < limit) {
    await sleep(v.safe ? 900 : 1500);
    const raw = await redis(db, ['GET', K.cmd(id)]);
    if (!raw) break;
    last = JSON.parse(raw);
    if (last.status === 'done') {
      const res = last.result || {};
      return { text: (res.ok === false ? 'The Mac reported a problem: ' : '') + (res.text || 'Done.'), image: res.image || null, error: res.ok === false };
    }
    if (last.status === 'denied') return { text: 'Ricardo tapped Deny, so nothing was done.' };
  }
  if (last.status === 'approval') return { text: `Still waiting for Ricardo to tap Allow in Atlas ("${v.summary}"). The request stays open for 10 minutes and runs as soon as he allows it.` };
  if (v.safe) await redis(db, ['LREM', K.queue, '0', id]).catch(() => {});
  return { text: 'The Mac did not respond in time, so nothing was confirmed. It may be asleep.', error: true };
}

/* Lua scripts keep each poll to a single Redis command. */
export const NEXT_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1], 'EX', 90)
local hot = redis.call('EXISTS', KEYS[3])
for i = 1, 5 do
  local id = redis.call('LPOP', KEYS[2])
  if not id then return {'', '', hot} end
  local c = redis.call('GET', 'atlas:mac:cmd:' .. id)
  if c then return {id, c, hot} end
end
return {'', '', hot}`;

export const STATUS_SCRIPT = `
local out = {redis.call('GET', KEYS[1]) or ''}
local ids = redis.call('SMEMBERS', KEYS[2])
for _, id in ipairs(ids) do
  local c = redis.call('GET', 'atlas:mac:cmd:' .. id)
  if c then table.insert(out, c) else redis.call('SREM', KEYS[2], id) end
end
return out`;
