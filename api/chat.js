import { authorized, json, ATLAS_CODE, MODES } from './_atlas.js';
import { vaultConfig, loadMemory, searchVault, readText, commit, exists, b64FromText, today, slug, titleSafe, cleanPath } from './_vault.js';
import { SPANISH_TUTOR, SPANISH_TOOL, loadSpanish, logSpanish } from './_spanish.js';
import { MAC_TOOL, DESKTOP_GUIDE, desktopDb, macOnline, markHot, runMac } from './_desktop.js';

export const config = { runtime: 'edge' };

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const TEXT_EXT = new Set(['txt', 'md', 'csv', 'json']);
const MAX_FILES = 10;
const MAX_TOTAL_B64 = 4_000_000; // keeps each request under Vercel's body limit
const MAX_TEXT_DOC = 150_000;

const MEMORY_FILES = {
  business: 'Business', customers: 'Customers', preferences: 'Preferences',
  people: 'People', ideas: 'Ideas', other: 'Inbox'
};

const VAULT_GUIDE = `Memory vault: ONLINE. Your long-term memory is Ricardo's Obsidian vault (folders: Memory/ for lasting facts, Jobs/ for one note per job with photos, quotes and install docs, Customers/, Daily/, Templates/, Attachments/ for uploaded files). The Memory/ notes are loaded below; everything else you reach with your vault tools.
Use remember whenever he tells you something lasting about the business, customers, people, preferences or ideas, or says "remember". Save his words faithfully, one fact per call, and never save card numbers, passwords or ID numbers.
Before answering about past jobs, customers, quotes or decisions that are not in Memory, search the vault. Never invent vault contents; if a search finds nothing, say so.
Prefer append over replace. Replace a note only when he asks you to rewrite it; the vault keeps every past version.
Work quietly: do not narrate tool calls, just give the answer and say briefly what you saved or filed.`;

const UPLOAD_GUIDE = `File uploads: when Ricardo uploads photos, videos, PDFs or documents, study them closely like an installer would: wall type (drywall, brick, stone, tile, plaster), studs or masonry anchors, mount and bracket type, TV size and placement, viewing height, cable runs and concealment, outlets, fireplace heat, damage, and anything unsafe. For quotes and invoices read every line item and number exactly; never change his prices.
The vault paths of saved uploads are listed at the end of his message. If the files clearly belong to a job, file them with save_job_note (include those attachment paths) and tell him where they are filed. If the job or customer is unclear, ask one short question before filing.
Videos arrive as a few still frames, not the full clip. If something cannot be judged from stills, say so.`;

const TOOLS = [
  {
    name: 'remember',
    description: 'Save one lasting fact to long-term memory (Memory/ notes in the vault). Use for business facts, customer details, people, preferences and ideas Ricardo wants kept.',
    input_schema: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'The fact, in plain words, as Ricardo stated it.' },
        topic: { type: 'string', enum: Object.keys(MEMORY_FILES), description: 'Which memory note it belongs in.' }
      },
      required: ['fact', 'topic']
    }
  },
  {
    name: 'vault_search',
    description: 'Search the vault notes (jobs, customers, daily notes, memory) by keywords. Returns matching note paths with the matching lines.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Keywords, e.g. a customer name, street, product or job type.' } }, required: ['query'] }
  },
  {
    name: 'vault_read',
    description: 'Read one note from the vault by its path, e.g. "Jobs/2026-10-24 Smith 75in mount.md".',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'vault_write',
    description: 'Create, append to, or replace a Markdown note in the vault. Use append for logs and updates. Paths must end in .md and cannot be inside Attachments/.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'e.g. "Customers/Jane Smith.md" or "Daily/2026-10-24.md"' },
        content: { type: 'string', description: 'Markdown content.' },
        mode: { type: 'string', enum: ['append', 'create', 'replace'] }
      },
      required: ['path', 'content', 'mode']
    }
  },
  {
    name: 'save_job_note',
    description: 'File job documentation: creates (or updates) a note in Jobs/ with the job summary and embeds the uploaded photos, frames, quotes or documents.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short job title, e.g. "Smith - 75in TV over fireplace".' },
        customer: { type: 'string' },
        address: { type: 'string' },
        summary: { type: 'string', description: 'What the files show and what matters for the job: wall type, mount, measurements, issues, quote totals, next steps.' },
        status: { type: 'string', enum: ['quote', 'scheduled', 'in progress', 'done', 'follow-up'] },
        attachments: { type: 'array', items: { type: 'string' }, description: 'Vault paths of uploaded files to embed (from the upload list).' }
      },
      required: ['title', 'summary']
    }
  }
];

/* ---------- tools ---------- */

async function runTool(cfg, name, input) {
  input = input || {};
  const date = today();
  switch (name) {
    case 'remember': {
      const fact = String(input.fact || '').trim().slice(0, 1000);
      if (!fact) return { text: 'Nothing to remember.', error: true };
      const file = MEMORY_FILES[input.topic] || 'Inbox';
      const path = `Memory/${file}.md`;
      await commit(cfg, [{ path, append: `- ${date}: ${fact}`, header: `# ${file}\n\n` }], `remember (${file})`);
      return { text: `Saved to ${path}.` };
    }
    case 'vault_search':
      return { text: await searchVault(cfg, input.query) };
    case 'vault_read': {
      const path = cleanPath(input.path);
      if (!path) return { text: 'That path is not allowed.', error: true };
      const text = await readText(cfg, path);
      if (text === null) return { text: `No note at ${path}.`, error: true };
      return { text: text.length > 15000 ? text.slice(0, 15000) + '\n[...note truncated]' : text };
    }
    case 'vault_write': {
      const path = cleanPath(input.path);
      if (!path || !path.endsWith('.md') || path.startsWith('Attachments/')) return { text: 'Notes must be .md files outside Attachments/.', error: true };
      const content = String(input.content || '').slice(0, 30000);
      if (!content.trim()) return { text: 'Nothing to write.', error: true };
      const mode = ['append', 'create', 'replace'].includes(input.mode) ? input.mode : 'append';
      if (mode === 'create' && await exists(cfg, path)) return { text: `${path} already exists. Use append, or replace if Ricardo asked to rewrite it.`, error: true };
      await commit(cfg, [mode === 'append' ? { path, append: content } : { path, b64: b64FromText(content.endsWith('\n') ? content : content + '\n') }], `${mode} ${path}`);
      return { text: `${mode === 'append' ? 'Appended to' : mode === 'create' ? 'Created' : 'Replaced'} ${path}.` };
    }
    case 'save_job_note': {
      const title = titleSafe(input.title);
      const path = `Jobs/${date} ${title}.md`;
      const files = (Array.isArray(input.attachments) ? input.attachments : []).map(cleanPath).filter(p => p && p.startsWith('Attachments/')).slice(0, 30);
      const embeds = files.map(p => /\.(jpe?g|png|webp|gif|pdf)$/i.test(p) ? `![[${p}]]` : `[[${p}]]`).join('\n');
      const summary = String(input.summary || '').trim().slice(0, 8000);
      const status = input.status || 'quote';
      const one = s => String(s || '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim().slice(0, 200);
      if (await exists(cfg, path)) {
        const time = new Intl.DateTimeFormat('en-US', { timeZone: process.env.ATLAS_TZ || 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date());
        await commit(cfg, [{ path, append: `\n## Update ${time}\n\n${summary}${embeds ? `\n\n${embeds}` : ''}\n` }], `update job ${title}`);
        return { text: `Updated ${path}.` };
      }
      const note = [
        '---',
        `date: ${date}`,
        input.customer ? `customer: "${one(input.customer)}"` : null,
        input.address ? `address: "${one(input.address)}"` : null,
        `status: ${status}`,
        'tags: [job]',
        '---',
        '',
        `# ${title}`,
        '',
        summary,
        '',
        files.length ? '## Files\n\n' + embeds : null
      ].filter(l => l !== null).join('\n') + '\n';
      await commit(cfg, [{ path, b64: b64FromText(note) }], `job ${title}`);
      return { text: `Filed as ${path}.` };
    }
    case 'spanish_log':
      return logSpanish(cfg, input);
    default:
      return { text: `Unknown tool ${name}.`, error: true };
  }
}

/* ---------- uploads ---------- */

function readAttachments(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_FILES) : [];
  const files = [];
  let total = 0;
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    const name = String(a.name || 'file').slice(0, 120);
    if ((a.kind === 'image' || a.kind === 'frame') && IMAGE_TYPES.has(a.media_type) && typeof a.data === 'string') {
      total += a.data.length;
      files.push({ kind: a.kind, name, media_type: a.media_type, data: a.data, video: a.kind === 'frame' ? String(a.video || 'video').slice(0, 120) : null, at: Number(a.at) || 0 });
    } else if (a.kind === 'pdf' && a.media_type === 'application/pdf' && typeof a.data === 'string') {
      total += a.data.length;
      files.push({ kind: 'pdf', name, media_type: 'application/pdf', data: a.data });
    } else if (a.kind === 'text' && typeof a.text === 'string') {
      const text = a.text.slice(0, MAX_TEXT_DOC);
      total += text.length;
      files.push({ kind: 'text', name, text });
    }
  }
  if (total > MAX_TOTAL_B64) return { error: 'Those files are too large to send at once. Send fewer or smaller files.' };
  return { files };
}

function attachmentPath(f, date, n) {
  const month = date.slice(0, 7);
  const tag = crypto.randomUUID().slice(0, 4);
  if (f.kind === 'frame') return `Attachments/${month}/${date}-${slug(f.video)}-frame${n}-${tag}.${IMAGE_EXT[f.media_type]}`;
  if (f.kind === 'image') return `Attachments/${month}/${date}-${slug(f.name)}-${tag}.${IMAGE_EXT[f.media_type]}`;
  if (f.kind === 'pdf') return `Attachments/${month}/${date}-${slug(f.name)}-${tag}.pdf`;
  const ext = (f.name.match(/\.([a-z0-9]{1,5})$/i) || [])[1]?.toLowerCase();
  return `Attachments/${month}/${date}-${slug(f.name)}-${tag}.${TEXT_EXT.has(ext) ? ext : 'txt'}`;
}

const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function fileBlocks(files) {
  const blocks = [];
  let lastVideo = null;
  for (const f of files) {
    if (f.kind === 'frame') {
      if (f.video !== lastVideo) {
        const times = files.filter(x => x.kind === 'frame' && x.video === f.video).map(x => fmtTime(x.at)).join(', ');
        blocks.push({ type: 'text', text: `Still frames from the video "${f.video}" at ${times}:` });
        lastVideo = f.video;
      }
      blocks.push({ type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } });
    } else if (f.kind === 'image') {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: f.media_type, data: f.data } });
    } else if (f.kind === 'pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data }, title: f.name });
    } else {
      blocks.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: f.text || '(empty file)' }, title: f.name });
    }
  }
  return blocks;
}

/* ---------- handler ---------- */

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!authorized(req)) return json({ error: 'Unauthorized' }, 401);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'Server is missing ANTHROPIC_API_KEY' }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }

  // Clean the conversation: valid roles only, trimmed, alternating, starting and ending with the user.
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const clean = [];
  for (const m of raw.slice(-24)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) continue;
    const content = m.content.slice(0, 6000);
    if (clean.length && clean[clean.length - 1].role === m.role) clean[clean.length - 1].content += '\n\n' + content;
    else clean.push({ role: m.role, content });
  }
  while (clean.length && clean[0].role !== 'user') clean.shift();
  if (!clean.length || clean[clean.length - 1].role !== 'user') return json({ error: 'Last message must be from the user' }, 400);

  const att = readAttachments(body.attachments);
  if (att.error) return json({ error: att.error }, 413);
  const files = att.files;

  const vault = vaultConfig();
  const date = today();

  // Save uploads to the vault (one commit) while loading long-term memory.
  let saved = [];
  let saveNote = '';
  const saving = (async () => {
    if (!files.length) return;
    if (!vault) { saveNote = 'The memory vault is not connected, so these files were NOT saved anywhere.'; return; }
    let frameNo = {};
    const changes = files.map(f => {
      const n = f.kind === 'frame' ? (frameNo[f.video] = (frameNo[f.video] || 0) + 1) : 0;
      const path = attachmentPath(f, date, n);
      saved.push({ name: f.kind === 'frame' ? `${f.video} (frame ${n})` : f.name, path });
      return { path, b64: f.kind === 'text' ? b64FromText(f.text) : f.data };
    });
    try {
      await commit(vault, changes, `upload ${files.length} file${files.length > 1 ? 's' : ''}`);
    } catch (e) {
      console.error('Vault upload failed', e.message);
      saved = [];
      saveNote = 'Saving these files to the vault FAILED, so they are not stored. Tell Ricardo.';
    }
  })();
  const mode = MODES[body.mode] ? body.mode : 'work';
  const memory = vault ? loadMemory(vault).catch(e => { console.error('Memory load failed', e.message); return ''; }) : Promise.resolve('');
  const spanish = vault && mode === 'spanish' ? loadSpanish(vault).catch(e => { console.error('Spanish load failed', e.message); return ''; }) : Promise.resolve('');
  const db = desktopDb();
  const mac = db ? Promise.all([macOnline(db), markHot(db)]).then(([m]) => m).catch(e => { console.error('Mac status failed', e.message); return null; }) : Promise.resolve(null);
  const [, memoryText, spanishText, macInfo] = await Promise.all([saving, memory, spanish, mac]);

  if (files.length) {
    const last = clean[clean.length - 1];
    const list = saved.length ? 'Uploaded files saved to the vault:\n' + saved.map(s => `- ${s.name}: ${s.path}`).join('\n') : saveNote;
    last.content = [...fileBlocks(files), { type: 'text', text: `${last.content}\n\n[${list}]` }];
  }

  const now = typeof body.now === 'string' ? body.now.slice(0, 80) : '';
  const parts = [ATLAS_CODE, `Right now: ${now}. Today's date for notes: ${date}. ${MODES[mode]}`];
  if (vault) parts.push(VAULT_GUIDE, memoryText ? `Long-term memory (from the vault):\n${memoryText}` : 'Long-term memory: the Memory/ notes are empty so far.');
  else parts.push('Memory vault: not connected yet. You cannot save or look up notes; if he asks, say the vault needs ATLAS_VAULT_TOKEN and ATLAS_VAULT_REPO set in Vercel.');
  parts.push(UPLOAD_GUIDE);
  if (mode === 'spanish') {
    parts.push(SPANISH_TUTOR);
    parts.push(vault ? (spanishText || 'His Spanish files could not be loaded right now; teach from Unit 1 and do not log.') : 'The vault is not connected, so lessons cannot be logged; teach from Unit 1.');
  }
  if (db) parts.push(DESKTOP_GUIDE, macInfo ? `Right now the Mac (${macInfo.host || 'MacBook'}) is online.` : 'Right now the Mac is offline (helper not running or Mac asleep). Mac actions will not work until it is back.');
  const toolList = [...(vault ? TOOLS : []), ...(vault && mode === 'spanish' ? [SPANISH_TOOL] : []), ...(db ? [MAC_TOOL] : [])];
  const tools = toolList.length ? toolList : null;
  const system = parts.join('\n\n');

  const callClaude = convo => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ATLAS_MODEL || 'claude-sonnet-5-5',
      max_tokens: Number(process.env.ATLAS_MAX_TOKENS || 1500),
      system,
      messages: convo,
      ...(tools ? { tools } : {}),
      stream: true
    })
  });

  const convo = clean;
  const first = await callClaude(convo);
  if (!first.ok || !first.body) {
    const detail = await first.text().catch(() => '');
    console.error('Anthropic API error', first.status, detail.slice(0, 500));
    return json({ error: 'Atlas could not reach Claude', status: first.status }, 502);
  }

  // Stream Claude's text to the dashboard as plain text, running vault tools between turns.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let upstream = first;
      let wrote = false;
      try {
        for (let round = 0; round < 6; round++) {
          const reader = upstream.body.getReader();
          const blocks = [];
          let stop = null, buffer = '', sepPending = wrote;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (!line.startsWith('data:')) continue;
              let ev;
              try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
              if (ev.type === 'content_block_start') {
                const b = ev.content_block || {};
                blocks[ev.index] = b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, json: '' } : { type: b.type, text: '' };
              } else if (ev.type === 'content_block_delta' && blocks[ev.index]) {
                const d = ev.delta || {};
                if (d.type === 'text_delta') {
                  blocks[ev.index].text += d.text;
                  if (sepPending && d.text.trim()) { controller.enqueue(encoder.encode(' ')); sepPending = false; }
                  controller.enqueue(encoder.encode(d.text));
                  if (d.text.trim()) wrote = true;
                } else if (d.type === 'input_json_delta') {
                  blocks[ev.index].json += d.partial_json || '';
                }
              } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) {
                stop = ev.delta.stop_reason;
              } else if (ev.type === 'error') {
                throw new Error(ev.error?.message || 'stream error');
              }
            }
          }
          if (stop !== 'tool_use' || !tools) break;

          const assistant = [];
          const results = [];
          for (const b of blocks.filter(Boolean)) {
            if (b.type === 'text' && b.text.trim()) assistant.push({ type: 'text', text: b.text });
            if (b.type !== 'tool_use') continue;
            let input = {};
            try { input = b.json ? JSON.parse(b.json) : {}; } catch { input = {}; }
            assistant.push({ type: 'tool_use', id: b.id, name: b.name, input });
            let out;
            try { out = b.name === 'mac' ? (db ? await runMac(db, input.action, input.args) : { text: 'The desktop module is not connected.', error: true }) : vault ? await runTool(vault, b.name, input) : { text: 'The vault is not connected.', error: true }; }
            catch (e) { console.error('Tool failed', b.name, e.message); out = { text: `That failed: ${e.message.slice(0, 200)}`, error: true }; }
            const content = out.image ? [{ type: 'text', text: out.text }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: out.image } }] : out.text;
            results.push({ type: 'tool_result', tool_use_id: b.id, content, ...(out.error ? { is_error: true } : {}) });
          }
          convo.push({ role: 'assistant', content: assistant }, { role: 'user', content: results });
          upstream = await callClaude(convo);
          if (!upstream.ok || !upstream.body) {
            const detail = await upstream.text().catch(() => '');
            console.error('Anthropic API error (tool round)', upstream.status, detail.slice(0, 500));
            controller.enqueue(encoder.encode(wrote ? ' (I lost the connection to finish that. Try again.)' : 'I lost the connection while working on that. Try again.'));
            break;
          }
        }
      } catch (e) {
        console.error('Chat stream error', e.message);
        controller.enqueue(encoder.encode(wrote ? ' (Something interrupted me. Try again.)' : 'Something interrupted me. Try again.'));
      } finally {
        controller.close();
      }
    }
  });
  return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
