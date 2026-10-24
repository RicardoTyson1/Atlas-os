import { authorized, json } from './_atlas.js';
import { desktopDb, redis, K, NEXT_SCRIPT, STATUS_SCRIPT } from './_desktop.js';

export const config = { runtime: 'edge' };

// Routes for the Desktop module.
//   Mac helper:  GET ?op=next   (heartbeat + next command)   POST ?op=result  { id, ok, text, image? }
//   Dashboard:   GET ?op=status (online + approvals)          POST ?op=decide  { id, allow }   GET ?op=cmd&id=
export default async function handler(req) {
  if (!authorized(req)) return json({ error: 'Unauthorized' }, 401);
  const db = desktopDb();
  if (!db) return json({ error: 'Storage is not connected', storage: false }, 501);
  const url = new URL(req.url);
  const op = url.searchParams.get('op');

  try {
    if (req.method === 'GET' && op === 'next') {
      const info = JSON.stringify({ host: (url.searchParams.get('host') || 'Mac').slice(0, 60), v: (url.searchParams.get('v') || '').slice(0, 10), at: Date.now() });
      const [id, raw, hot] = await redis(db, ['EVAL', NEXT_SCRIPT, '3', K.seen, K.queue, K.hot, info]);
      if (!id) return json({ hot: !!hot });
      const cmd = JSON.parse(raw);
      if (cmd.status !== 'queued') return json({ hot: !!hot });
      cmd.status = 'running';
      await redis(db, ['SET', K.cmd(id), JSON.stringify(cmd), 'KEEPTTL']);
      return json({ hot: !!hot, cmd: { id, action: cmd.action, args: cmd.args } });
    }

    if (req.method === 'POST' && op === 'result') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
      const id = typeof body.id === 'string' ? body.id : '';
      const raw = id && await redis(db, ['GET', K.cmd(id)]);
      if (!raw) return json({ error: 'Unknown command' }, 404);
      const cmd = JSON.parse(raw);
      cmd.status = 'done';
      cmd.result = {
        ok: body.ok !== false,
        text: String(body.text || '').slice(0, 60000),
        image: typeof body.image === 'string' && body.image.length < 700000 ? body.image : null
      };
      await redis(db, ['SET', K.cmd(id), JSON.stringify(cmd), 'KEEPTTL']);
      return json({ ok: true });
    }

    if (req.method === 'GET' && op === 'status') {
      const [seen, ...items] = await redis(db, ['EVAL', STATUS_SCRIPT, '2', K.seen, K.pending]);
      let mac = null;
      try { mac = seen ? JSON.parse(seen) : null; } catch { mac = { host: 'Mac' }; }
      const pending = items.map(s => { try { const c = JSON.parse(s); return c.status === 'approval' ? { id: c.id, summary: c.summary, created: c.created } : null; } catch { return null; } }).filter(Boolean);
      return json({ online: !!mac, host: mac?.host || null, pending });
    }

    if (req.method === 'GET' && op === 'cmd') {
      const raw = await redis(db, ['GET', K.cmd(url.searchParams.get('id') || '')]);
      if (!raw) return json({ status: 'expired' });
      const c = JSON.parse(raw);
      return json({ status: c.status, text: c.result?.text ? c.result.text.slice(0, 2000) : '' });
    }

    if (req.method === 'POST' && op === 'decide') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
      const id = typeof body.id === 'string' ? body.id : '';
      const raw = id && await redis(db, ['GET', K.cmd(id)]);
      if (!raw) return json({ error: 'That request expired' }, 404);
      const cmd = JSON.parse(raw);
      if (cmd.status !== 'approval') return json({ error: 'Already handled', status: cmd.status }, 409);
      cmd.status = body.allow === true ? 'queued' : 'denied';
      await redis(db, ['SET', K.cmd(id), JSON.stringify(cmd), 'KEEPTTL']);
      await redis(db, ['SREM', K.pending, id]);
      if (cmd.status === 'queued') await redis(db, ['RPUSH', K.queue, id]);
      return json({ ok: true, status: cmd.status });
    }
  } catch (e) {
    console.error('Desktop route error', op, e.message);
    return json({ error: 'Storage error' }, 502);
  }
  return json({ error: 'Unknown operation' }, 400);
}
