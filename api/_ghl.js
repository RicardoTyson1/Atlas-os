// GoHighLevel (LeadConnector API v2), READ-ONLY. Not exposed as a route.
// Only GET requests are ever made. The token is read from GHL_TOKEN and is never logged or returned.

const BASE = 'https://services.leadconnectorhq.com';
const V_CONTACTS = '2021-07-28';      // contacts, opportunities
const V_CONVO = '2021-04-15';         // conversations, calendars

export function ghlConfig() {
  const token = process.env.GHL_TOKEN || '';
  const locationId = process.env.GHL_LOCATION_ID || '';
  return token && locationId ? { token, locationId } : null;
}

async function get(cfg, path, params, version) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const r = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.token}`, Version: version, Accept: 'application/json' }
  });
  if (!r.ok) {
    // Status only: never echo headers or anything that could contain the token.
    const hint = r.status === 401 ? 'the GoHighLevel token was rejected' : r.status === 403 ? 'the token lacks permission for this' : r.status === 429 ? 'GoHighLevel rate limit, try again in a minute' : `GoHighLevel returned ${r.status}`;
    throw new Error(hint);
  }
  return r.json();
}

const s = (v, max = 200) => (v === undefined || v === null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);
const tz = () => process.env.ATLAS_TZ || 'America/New_York';
const when = v => {
  if (!v) return '';
  const d = new Date(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : v);
  return isNaN(d) ? s(v, 40) : new Intl.DateTimeFormat('en-US', { timeZone: tz(), month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
};
const name = c => s([c.firstName || c.firstNameLowerCase, c.lastName || c.lastNameLowerCase].filter(Boolean).join(' ') || c.contactName || c.fullName || c.name || c.companyName || 'Unnamed', 80);
const clampInt = (v, d, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Math.round(Number(v)) : d));

export const GHL_TOOLS = [
  {
    name: 'ghl_search_contacts',
    description: 'GoHighLevel (read-only): search Mount Atlanta contacts by name, phone, email or tag text. Returns id, name, phone, email, tags, city and date added.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Name, phone, email or keyword.' }, limit: { type: 'integer', description: '1-25, default 10.' } }, required: ['query'] }
  },
  {
    name: 'ghl_get_contact',
    description: 'GoHighLevel (read-only): full details of one contact by contact id (from a search).',
    input_schema: { type: 'object', properties: { contactId: { type: 'string' } }, required: ['contactId'] }
  },
  {
    name: 'ghl_recent_conversations',
    description: 'GoHighLevel (read-only): list recent conversations (SMS, email, Facebook, Instagram, Google, web chat), newest first, with last message preview and unread count. Optional: unread only, or one contact.',
    input_schema: { type: 'object', properties: { limit: { type: 'integer', description: '1-25, default 10.' }, unreadOnly: { type: 'boolean' }, contactId: { type: 'string' }, query: { type: 'string', description: 'Optional search text.' } } }
  },
  {
    name: 'ghl_conversation_messages',
    description: 'GoHighLevel (read-only): read the latest messages in one conversation by conversation id.',
    input_schema: { type: 'object', properties: { conversationId: { type: 'string' }, limit: { type: 'integer', description: '1-50, default 20.' } }, required: ['conversationId'] }
  },
  {
    name: 'ghl_upcoming_appointments',
    description: 'GoHighLevel (read-only): upcoming calendar appointments across Mount Atlanta calendars, soonest first.',
    input_schema: { type: 'object', properties: { days: { type: 'integer', description: 'How many days ahead, 1-60, default 7.' } } }
  },
  {
    name: 'ghl_opportunities',
    description: 'GoHighLevel (read-only): list pipeline opportunities (deals) with pipeline stage, status, value and contact.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'won', 'lost', 'abandoned', 'all'], description: 'Default open.' }, query: { type: 'string' }, limit: { type: 'integer', description: '1-50, default 20.' } } }
  }
];

export const GHL_GUIDE = `GoHighLevel: CONNECTED, READ-ONLY. With the ghl_ tools you can look up Mount Atlanta's contacts, recent conversations and messages, upcoming appointments and pipeline opportunities. You cannot create, change, send, book, cancel or delete anything in GoHighLevel; if he asks, say it is read-only and draft the reply or step for him to do. Look things up before answering questions about customers, messages, bookings or deals, and never invent records; if a lookup finds nothing or fails, say so. Customer data is private: only discuss it with Ricardo.`;

export async function runGhl(cfg, tool, input) {
  input = input || {};
  const loc = cfg.locationId;
  switch (tool) {
    case 'ghl_search_contacts': {
      const query = s(input.query, 100);
      if (!query) return { text: 'What should I search for?', error: true };
      const j = await get(cfg, '/contacts/', { locationId: loc, query, limit: clampInt(input.limit, 10, 1, 25) }, V_CONTACTS);
      const list = j.contacts || [];
      if (!list.length) return { text: `No GoHighLevel contacts match "${query}".` };
      return { text: list.map(c => `${name(c)} | id ${c.id} | ${s(c.phone, 30) || 'no phone'} | ${s(c.email, 80) || 'no email'}${c.city ? ' | ' + s(c.city, 40) : ''}${c.tags && c.tags.length ? ' | tags: ' + c.tags.slice(0, 8).join(', ') : ''} | added ${when(c.dateAdded)}`).join('\n') };
    }
    case 'ghl_get_contact': {
      const id = s(input.contactId, 60);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return { text: 'That contact id is not valid.', error: true };
      const c = (await get(cfg, `/contacts/${encodeURIComponent(id)}`, {}, V_CONTACTS)).contact || {};
      const addr = [c.address1, c.city, c.state, c.postalCode].filter(Boolean).join(', ');
      const custom = (c.customFields || c.customField || []).filter(f => f && f.value !== undefined && f.value !== '').slice(0, 15).map(f => `${s(f.id, 30)}: ${s(Array.isArray(f.value) ? f.value.join(', ') : f.value, 120)}`);
      return { text: [
        `${name(c)} (id ${c.id})`,
        `Phone: ${s(c.phone, 30) || 'none'} | Email: ${s(c.email, 80) || 'none'}`,
        addr ? `Address: ${s(addr, 200)}` : null,
        c.companyName ? `Company: ${s(c.companyName, 80)}` : null,
        `Source: ${s(c.source, 60) || 'unknown'} | Added: ${when(c.dateAdded)}`,
        c.tags && c.tags.length ? `Tags: ${c.tags.join(', ')}` : null,
        c.dnd ? 'Do Not Disturb: ON (do not contact)' : null,
        custom.length ? `Custom fields: ${custom.join(' ; ')}` : null
      ].filter(Boolean).join('\n') };
    }
    case 'ghl_recent_conversations': {
      const j = await get(cfg, '/conversations/search', {
        locationId: loc, limit: clampInt(input.limit, 10, 1, 25), sort: 'desc', sortBy: 'last_message_date',
        contactId: s(input.contactId, 60), query: s(input.query, 100), status: input.unreadOnly ? 'unread' : ''
      }, V_CONVO);
      const list = j.conversations || [];
      if (!list.length) return { text: 'No matching conversations.' };
      return { text: list.map(c => `${s(c.fullName || c.contactName || c.email || c.phone || 'Unknown', 60)} | conversation ${c.id} | contact ${c.contactId} | ${s(c.lastMessageType, 30).replace('TYPE_', '')} ${s(c.lastMessageDirection, 10)} | ${when(c.lastMessageDate)} | unread ${c.unreadCount || 0} | "${s(c.lastMessageBody, 140)}"`).join('\n') };
    }
    case 'ghl_conversation_messages': {
      const id = s(input.conversationId, 60);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return { text: 'That conversation id is not valid.', error: true };
      const j = await get(cfg, `/conversations/${encodeURIComponent(id)}/messages`, { limit: clampInt(input.limit, 20, 1, 50) }, V_CONVO);
      const list = (j.messages && (j.messages.messages || j.messages)) || [];
      if (!Array.isArray(list) || !list.length) return { text: 'No messages in that conversation.' };
      return { text: list.slice().reverse().map(m => `[${when(m.dateAdded)}] ${m.direction === 'outbound' ? 'Mount Atlanta' : 'Customer'} (${s(m.messageType, 30).replace('TYPE_', '')}): ${s(m.body || (m.meta && m.meta.email && m.meta.email.subject) || (m.attachments && m.attachments.length ? '[attachment]' : '[no text]'), 600)}`).join('\n') };
    }
    case 'ghl_upcoming_appointments': {
      const days = clampInt(input.days, 7, 1, 60);
      const start = Date.now(), end = start + days * 86400000;
      const cals = ((await get(cfg, '/calendars/', { locationId: loc }, V_CONVO)).calendars || []).slice(0, 15);
      if (!cals.length) return { text: 'No calendars found in GoHighLevel.' };
      const results = await Promise.all(cals.map(c => get(cfg, '/calendars/events', { locationId: loc, calendarId: c.id, startTime: start, endTime: end }, V_CONVO)
        .then(j => (j.events || []).map(e => ({ ...e, _cal: c.name }))).catch(() => [])));
      const events = results.flat().filter(e => !/cancel|invalid|noshow/i.test(e.appointmentStatus || e.status || ''))
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      if (!events.length) return { text: `No appointments in the next ${days} day${days > 1 ? 's' : ''}.` };
      return { text: events.slice(0, 40).map(e => `${when(e.startTime)} | ${s(e.title || 'Appointment', 80)} | ${s(e._cal, 40)} | ${s(e.appointmentStatus || e.status, 20)}${e.address ? ' | ' + s(e.address, 120) : ''} | contact ${e.contactId || '?'}`).join('\n') };
    }
    case 'ghl_opportunities': {
      const status = ['open', 'won', 'lost', 'abandoned', 'all'].includes(input.status) ? input.status : 'open';
      const [j, p] = await Promise.all([
        get(cfg, '/opportunities/search', { location_id: loc, status, q: s(input.query, 100), limit: clampInt(input.limit, 20, 1, 50) }, V_CONTACTS),
        get(cfg, '/opportunities/pipelines', { locationId: loc }, V_CONTACTS).catch(() => ({ pipelines: [] }))
      ]);
      const stages = {}, pipes = {};
      for (const pl of p.pipelines || []) { pipes[pl.id] = pl.name; for (const st of pl.stages || []) stages[st.id] = st.name; }
      const list = j.opportunities || [];
      if (!list.length) return { text: `No ${status === 'all' ? '' : status + ' '}opportunities found.` };
      return { text: list.map(o => `${s(o.name, 80)} | ${s(pipes[o.pipelineId] || 'pipeline', 40)} > ${s(stages[o.pipelineStageId] || 'stage', 40)} | ${s(o.status, 12)} | $${Number(o.monetaryValue || 0).toLocaleString('en-US')} | ${o.contact ? name(o.contact) : 'no contact'} | updated ${when(o.updatedAt || o.lastStatusChangeAt)}`).join('\n') };
    }
  }
  return { text: `Unknown GoHighLevel tool ${tool}.`, error: true };
}
