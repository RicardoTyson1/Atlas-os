import { authorized, json, storageConfig } from './_atlas.js';

export const config = { runtime: 'edge' };
const KEY = 'atlas:history';

export default async function handler(req) {
  if (!authorized(req)) return json({ error: 'Unauthorized' }, 401);
  const db = storageConfig();
  if (!db) return json({ history: [], storage: false });
  const auth = { Authorization: `Bearer ${db.token}` };

  if (req.method === 'GET') {
    const r = await fetch(`${db.url}/get/${KEY}`, { headers: auth });
    if (!r.ok) return json({ error: 'Storage read failed' }, 502);
    const { result } = await r.json();
    let history = [];
    try { history = result ? JSON.parse(result) : []; } catch { history = []; }
    return json({ history, storage: true });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
    const history = (Array.isArray(body.history) ? body.history : [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-200)
      .map(m => ({ role: m.role, content: m.content.slice(0, 6000), at: Number(m.at) || Date.now() }));
    const r = await fetch(`${db.url}/set/${KEY}`, { method: 'POST', headers: auth, body: JSON.stringify(history) });
    if (!r.ok) return json({ error: 'Storage write failed' }, 502);
    return json({ ok: true, count: history.length });
  }

  return json({ error: 'Method not allowed' }, 405);
}
