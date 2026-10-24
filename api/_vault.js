// Atlas memory vault: an Obsidian vault stored in a private GitHub repo.
// Atlas reads and writes Markdown notes and attachments through the GitHub API;
// the Obsidian Git plugin keeps Ricardo's Mac in sync with the same repo.
// Files starting with "_" are not exposed as routes on Vercel.

export function vaultConfig() {
  const token = process.env.ATLAS_VAULT_TOKEN || '';
  const repo = (process.env.ATLAS_VAULT_REPO || '').trim();
  const branch = (process.env.ATLAS_VAULT_BRANCH || 'main').trim();
  return token && /^[\w.-]+\/[\w.-]+$/.test(repo) ? { token, repo, branch } : null;
}

const API = 'https://api.github.com';

async function gh(cfg, path, init = {}) {
  return fetch(`${API}/repos/${cfg.repo}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'atlas-os',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
}

async function ghJson(cfg, path, init) {
  const r = await gh(cfg, path, init);
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    const err = new Error(`GitHub ${r.status} on ${path}: ${detail.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/* ---------- text and path helpers ---------- */

export function b64FromText(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function today(tz = process.env.ATLAS_TZ || 'America/New_York') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function slug(s, max = 48) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .toLowerCase().slice(0, max) || 'file';
}

// Note titles keep spaces and capitals so they read well in Obsidian.
export function titleSafe(s, max = 80) {
  return String(s || '').replace(/[\\/:*?"<>|#^[\]\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || 'Untitled';
}

// Reject anything that could escape the vault or touch hidden/config folders.
export function cleanPath(p) {
  p = String(p || '').replace(/\\/g, '/').trim().replace(/^\/+/, '');
  if (!p || p.length > 220) return null;
  if (/[\x00-\x1f<>:"|?*]/.test(p)) return null;
  const parts = p.split('/');
  if (parts.some(s => !s || s === '.' || s === '..' || s.startsWith('.'))) return null;
  return p;
}

const enc = p => p.split('/').map(encodeURIComponent).join('/');

/* ---------- reading ---------- */

export async function readText(cfg, path, ref) {
  const r = await gh(cfg, `contents/${enc(path)}?ref=${encodeURIComponent(ref || cfg.branch)}`, {
    headers: { Accept: 'application/vnd.github.raw' }
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status} reading ${path}`);
  return r.text();
}

export async function listFiles(cfg) {
  const t = await ghJson(cfg, `git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`);
  return (t.tree || []).filter(x => x.type === 'blob' && !x.path.split('/').some(s => s.startsWith('.'))).map(x => x.path);
}

// Long-term memory: every note in Memory/, newest-looking first, capped for the prompt.
export async function loadMemory(cfg, cap = 12000) {
  const r = await gh(cfg, `contents/Memory?ref=${encodeURIComponent(cfg.branch)}`);
  if (!r.ok) return '';
  const items = (await r.json()).filter(x => x.type === 'file' && x.name.endsWith('.md'));
  const texts = await Promise.all(items.map(x => readText(cfg, x.path).catch(() => '')));
  let out = '';
  items.forEach((x, i) => {
    const body = (texts[i] || '').trim();
    if (body && out.length < cap) out += `\n### ${x.path}\n${body.slice(0, cap - out.length)}\n`;
  });
  return out.trim();
}

export async function searchVault(cfg, query, limit = 8) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(t => t.length > 1).slice(0, 8);
  if (!terms.length) return 'Give me at least one search word.';
  const notes = (await listFiles(cfg)).filter(p => /\.(md|txt|csv)$/i.test(p) && !p.startsWith('Attachments/'));
  // Path matches first, then the rest, newest dates first (most notes are date-prefixed).
  const pathScore = p => terms.reduce((n, t) => n + (p.toLowerCase().includes(t) ? 3 : 0), 0);
  const ordered = notes.sort((a, b) => pathScore(b) - pathScore(a) || b.localeCompare(a)).slice(0, 120);
  const results = [];
  for (let i = 0; i < ordered.length; i += 12) {
    const batch = ordered.slice(i, i + 12);
    const texts = await Promise.all(batch.map(p => readText(cfg, p).catch(() => '')));
    batch.forEach((p, j) => {
      const text = texts[j] || '';
      const low = text.toLowerCase();
      const hits = terms.reduce((n, t) => n + (low.split(t).length - 1), 0);
      const score = hits + pathScore(p);
      if (!score) return;
      const lines = text.split('\n').filter(l => terms.some(t => l.toLowerCase().includes(t))).slice(0, 4).map(l => l.trim().slice(0, 200));
      results.push({ p, score, lines });
    });
  }
  results.sort((a, b) => b.score - a.score);
  if (!results.length) return `No notes match "${query}".`;
  return results.slice(0, limit).map(r => `${r.p}\n  ${r.lines.join('\n  ') || '(match in file name)'}`).join('\n');
}

/* ---------- writing (one commit per change set, safe to retry) ---------- */

// changes: [{ path, b64 }] to create/replace, or [{ path, append: 'text' }] to add to a note.
export async function commit(cfg, changes, message) {
  const blobCache = new Map();
  for (let attempt = 0; attempt < 4; attempt++) {
    const head = await ghJson(cfg, `git/ref/heads/${encodeURIComponent(cfg.branch)}`);
    const parent = head.object.sha;
    const base = await ghJson(cfg, `git/commits/${parent}`);
    const tree = [];
    for (const c of changes) {
      let b64 = c.b64;
      if (c.append != null) {
        const existing = await readText(cfg, c.path, parent);
        const sep = existing && !existing.endsWith('\n') ? '\n' : '';
        b64 = b64FromText((existing || c.header || '') + sep + c.append + (c.append.endsWith('\n') ? '' : '\n'));
      }
      let sha = c.append == null ? blobCache.get(c.path) : null;
      if (!sha) {
        sha = (await ghJson(cfg, 'git/blobs', { method: 'POST', body: JSON.stringify({ content: b64, encoding: 'base64' }) })).sha;
        if (c.append == null) blobCache.set(c.path, sha);
      }
      tree.push({ path: c.path, mode: '100644', type: 'blob', sha });
    }
    const newTree = await ghJson(cfg, 'git/trees', { method: 'POST', body: JSON.stringify({ base_tree: base.tree.sha, tree }) });
    const newCommit = await ghJson(cfg, 'git/commits', {
      method: 'POST',
      body: JSON.stringify({ message: `Atlas: ${message}`.slice(0, 200), tree: newTree.sha, parents: [parent] })
    });
    const r = await gh(cfg, `git/refs/heads/${encodeURIComponent(cfg.branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha }) });
    if (r.ok) return newCommit.sha;
    if (r.status !== 422 && r.status !== 409) throw new Error(`GitHub ${r.status} updating branch`);
    // Someone (usually Obsidian Git on the Mac) pushed in between: rebuild on the new head.
  }
  throw new Error('Vault was busy, try again');
}

export async function exists(cfg, path) {
  return (await readText(cfg, path)) !== null;
}
