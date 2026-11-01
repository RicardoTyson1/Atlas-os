// Apple Health: Ricardo's iPhone Shortcut posts a daily summary to /api/health; Atlas reads it here.
// Health data is private: only for Ricardo. Not exposed as a route.
import { kvGet, kvSet } from './_kv.js';

export const HEALTH_KEY = 'atlas:health';
export const HEALTH_FIELDS = {
  steps: 'Steps', sleep_hours: 'Sleep (h)', resting_hr: 'Resting HR', hrv: 'HRV (ms)', active_kcal: 'Active kcal',
  exercise_min: 'Exercise (min)', stand_hours: 'Stand (h)', weight_lb: 'Weight (lb)', walking_hr: 'Walking HR', respiratory_rate: 'Resp. rate'
};

const num = v => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? Math.round(n * 10) / 10 : null; };

// Clean an incoming day of data. Returns { date, values } or null.
export function cleanDay(body, today) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || '')) ? body.date : today;
  const values = {};
  for (const k of Object.keys(HEALTH_FIELDS)) { const n = num(body?.[k]); if (n !== null && n >= 0 && n < 100000) values[k] = n; }
  return Object.keys(values).length ? { date, values } : null;
}

export async function saveDay(date, values) {
  const all = (await kvGet(HEALTH_KEY)) || {};
  all[date] = { ...(all[date] || {}), ...values, at: Date.now() };
  const keep = Object.keys(all).sort().slice(-120);
  const trimmed = Object.fromEntries(keep.map(k => [k, all[k]]));
  await kvSet(HEALTH_KEY, trimmed);
  return Object.keys(trimmed).length;
}

export async function healthStatus() {
  try { const all = (await kvGet(HEALTH_KEY)) || {}; const d = Object.keys(all).sort(); return d.length ? d[d.length - 1] : null; } catch { return null; }
}

export const HEALTH_TOOL = {
  name: 'health_summary',
  description: 'Apple Health (sent daily from his iPhone): sleep, steps, resting heart rate, HRV, active calories, exercise and weight for recent days, with averages.',
  input_schema: { type: 'object', properties: { days: { type: 'integer', description: '1-60, default 7.' } } }
};

export const HEALTH_GUIDE = `Apple Health: CONNECTED (his iPhone sends a daily summary). Use health_summary when he asks about sleep, energy, recovery, stress or activity, or in a check-in. Use it to coach rest and recovery, never to diagnose; suggest a doctor for anything medical. His health data is private: never repeat it in messages to anyone else.`;

export async function runHealth(input) {
  const days = Math.min(60, Math.max(1, Math.round(Number(input?.days) || 7)));
  const all = (await kvGet(HEALTH_KEY)) || {};
  const dates = Object.keys(all).sort().slice(-days);
  if (!dates.length) return { text: 'No Apple Health data has arrived yet. His iPhone Shortcut needs to run at least once.' };
  const lines = dates.map(d => `${d}: ` + Object.entries(HEALTH_FIELDS).filter(([k]) => all[d][k] != null).map(([k, l]) => `${l} ${all[d][k]}`).join(', '));
  const avg = Object.entries(HEALTH_FIELDS).map(([k, l]) => { const v = dates.map(d => all[d][k]).filter(x => x != null); return v.length > 1 ? `${l} ${Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10}` : null; }).filter(Boolean);
  return { text: lines.join('\n') + (avg.length ? `\nAverages over ${dates.length} days: ${avg.join(', ')}` : '') };
}
