// POST /api/health with header x-atlas-key and a JSON body like
// { "date": "2026-11-01", "steps": 8421, "sleep_hours": 6.8, "resting_hr": 58, "hrv": 46, "active_kcal": 520 }
// Sent by Ricardo's iPhone Shortcut. GET returns only whether data exists (never the data itself).
import { authorized, json, storageConfig } from './_atlas.js';
import { cleanDay, saveDay, healthStatus } from './_health.js';
import { today } from './_vault.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (!authorized(req)) return json({ error: 'Unauthorized' }, 401);
  if (!storageConfig()) return json({ error: 'Atlas storage is not connected' }, 500);
  if (req.method === 'GET') return json({ ok: true, latest: await healthStatus() });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Send JSON' }, 400); }
  const day = cleanDay(body, today());
  if (!day) return json({ error: 'No health numbers found in that request' }, 400);
  const days = await saveDay(day.date, day.values);
  return json({ ok: true, date: day.date, saved: Object.keys(day.values), daysStored: days });
}
