// Gmail + Google Calendar for admin@mountatlanta.com, READ-ONLY (GET requests only). Not exposed as a route.
import { accessToken } from './_oauthcfg.js';

const s = (v, max = 200) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);
const tz = () => process.env.ATLAS_TZ || 'America/New_York';
const fmt = (d, opts) => isNaN(d) ? '' : new Intl.DateTimeFormat('en-US', { timeZone: tz(), ...opts }).format(d);
const when = v => fmt(new Date(v), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const clampInt = (v, d, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Math.round(Number(v)) : d));

async function gget(base, path, params) {
  const token = await accessToken('google');
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') [].concat(v).forEach(x => url.searchParams.append(k, String(x)));
  const r = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status === 401 ? 'Google sign-in was rejected; reconnect Google on the dashboard' : r.status === 403 ? 'Google refused this (permission or API not enabled in Google Cloud)' : `Google returned ${r.status}`);
  return r.json();
}
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CAL = 'https://www.googleapis.com/calendar/v3';

const b64 = d => { try { const bin = atob(d.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); } catch { return ''; } };
function bodyText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return b64(part.body.data);
  for (const p of part.parts || []) { const t = bodyText(p); if (t) return t; }
  if (part.mimeType === 'text/html' && part.body?.data) return b64(part.body.data).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return '';
}
const header = (m, n) => (m.payload?.headers || []).find(h => h.name.toLowerCase() === n.toLowerCase())?.value || '';

export const GOOGLE_TOOLS = [
  {
    name: 'gmail_search',
    description: 'Gmail (admin@mountatlanta.com, read-only): search email with Gmail search syntax, e.g. "is:unread", "from:jane", "newer_than:2d", "subject:quote". Returns sender, subject, date, snippet and message id. Default: recent inbox.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', description: '1-20, default 10.' } } }
  },
  {
    name: 'gmail_read',
    description: 'Gmail (read-only): read one email in full by message id (from gmail_search).',
    input_schema: { type: 'object', properties: { messageId: { type: 'string' } }, required: ['messageId'] }
  },
  {
    name: 'calendar_upcoming',
    description: 'Google Calendar (admin@mountatlanta.com, read-only): upcoming events, soonest first.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', description: '1-60, default 7.' }, query: { type: 'string', description: 'Optional text to match.' } } }
  }
];

export const GOOGLE_GUIDE = `Gmail and Google Calendar (admin@mountatlanta.com): CONNECTED, READ-ONLY. Use gmail_search, gmail_read and calendar_upcoming before answering about his email or schedule. You cannot send, delete, label or archive email, or add or change events. For replies, draft the text and he sends it himself (you can give him an email button with the phone tool). Never invent emails or events.`;

export async function runGoogle(tool, input) {
  input = input || {};
  if (tool === 'gmail_search') {
    const q = s(input.query, 200) || 'in:inbox';
    const list = (await gget(GMAIL, '/messages', { q, maxResults: clampInt(input.limit, 10, 1, 20) })).messages || [];
    if (!list.length) return { text: `No emails match "${q}".` };
    const msgs = await Promise.all(list.map(m => gget(GMAIL, `/messages/${m.id}`, { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] }).catch(() => null)));
    return { text: msgs.filter(Boolean).map(m => `${when(Number(m.internalDate))} | ${s(header(m, 'From'), 80)} | ${s(header(m, 'Subject'), 120) || '(no subject)'}${(m.labelIds || []).includes('UNREAD') ? ' | UNREAD' : ''} | id ${m.id} | "${s(m.snippet, 160)}"`).join('\n') };
  }
  if (tool === 'gmail_read') {
    const id = s(input.messageId, 40);
    if (!/^[A-Za-z0-9]+$/.test(id)) return { text: 'That message id is not valid.', error: true };
    const m = await gget(GMAIL, `/messages/${id}`, { format: 'full' });
    const text = bodyText(m.payload).replace(/\n{3,}/g, '\n\n').trim();
    const files = [];
    (function walk(p) { if (!p) return; if (p.filename) files.push(p.filename); (p.parts || []).forEach(walk); })(m.payload);
    return { text: [`From: ${header(m, 'From')}`, `To: ${header(m, 'To')}`, `Date: ${header(m, 'Date')}`, `Subject: ${header(m, 'Subject')}`, files.length ? `Attachments: ${files.slice(0, 10).join(', ')}` : null, '', (text || s(m.snippet, 500)).slice(0, 8000)].filter(l => l !== null).join('\n') };
  }
  if (tool === 'calendar_upcoming') {
    const days = clampInt(input.days, 7, 1, 60);
    const now = new Date();
    const j = await gget(CAL, '/calendars/primary/events', { timeMin: now.toISOString(), timeMax: new Date(now.getTime() + days * 86400000).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: 50, q: s(input.query, 100) });
    const ev = (j.items || []).filter(e => e.status !== 'cancelled');
    if (!ev.length) return { text: `Nothing on the Google Calendar in the next ${days} day${days > 1 ? 's' : ''}.` };
    return { text: ev.map(e => {
      const allDay = !!e.start?.date;
      const start = allDay ? fmt(new Date(e.start.date + 'T12:00:00Z'), { weekday: 'short', month: 'short', day: 'numeric' }) + ' (all day)' : when(e.start?.dateTime);
      return `${start} | ${s(e.summary, 100) || '(no title)'}${e.location ? ' | ' + s(e.location, 120) : ''}`;
    }).join('\n') };
  }
  return { text: `Unknown Google tool ${tool}.`, error: true };
}
