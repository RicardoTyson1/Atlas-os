import { authorized, json, ATLAS_CODE, MODES } from './_atlas.js';

export const config = { runtime: 'edge' };

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

  const mode = MODES[body.mode] ? body.mode : 'work';
  const now = typeof body.now === 'string' ? body.now.slice(0, 80) : '';
  const system = `${ATLAS_CODE}\n\nRight now: ${now}. ${MODES[mode]}`;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.ATLAS_MODEL || 'claude-sonnet-5-5',
      max_tokens: Number(process.env.ATLAS_MAX_TOKENS || 700),
      system,
      messages: clean,
      stream: true
    })
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    console.error('Anthropic API error', upstream.status, detail.slice(0, 500));
    return json({ error: 'Atlas could not reach Claude', status: upstream.status }, 502);
  }

  // Turn Anthropic's event stream into plain text for the dashboard.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim());
              if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') controller.enqueue(encoder.encode(ev.delta.text));
            } catch { /* ignore keep-alives and partial lines */ }
          }
        }
      } finally {
        controller.close();
      }
    }
  });
  return new Response(stream, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
