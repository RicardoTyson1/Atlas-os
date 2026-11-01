// Tiny Upstash Redis helpers shared by the OAuth, Google, Spotify and Health modules. Not exposed as a route.
import { storageConfig } from './_atlas.js';

async function cmd(args) {
  const db = storageConfig();
  if (!db) throw new Error('Atlas storage is not connected');
  const r = await fetch(db.url, { method: 'POST', headers: { Authorization: `Bearer ${db.token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`storage ${r.status}`);
  return (await r.json()).result;
}

export const kvGet = async key => { const v = await cmd(['GET', key]); if (v == null) return null; try { return JSON.parse(v); } catch { return v; } };
export const kvSet = (key, value, ttlSeconds) => cmd(ttlSeconds ? ['SET', key, JSON.stringify(value), 'EX', String(ttlSeconds)] : ['SET', key, JSON.stringify(value)]);
export const kvDel = key => cmd(['DEL', key]);
export const kvTake = async key => { const v = await cmd(['GETDEL', key]); if (v == null) return null; try { return JSON.parse(v); } catch { return v; } };
