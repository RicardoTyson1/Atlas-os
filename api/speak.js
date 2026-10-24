import { authorized, json } from './_atlas.js';

export const config = { runtime: 'edge' };

// Turns Atlas's reply into a natural human voice with ElevenLabs.
// In Spanish mode the dashboard sends lang "es" and, if one is set, a native Spanish voice is used.
export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!authorized(req)) return json({ error: 'Unauthorized' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const spanishVoice = process.env.ELEVENLABS_SPANISH_VOICE_ID;
  const voiceId = body.lang === 'es' && spanishVoice ? spanishVoice : process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) return json({ error: 'Human voice is not set up yet' }, 501);

  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2500) : '';
  if (!text) return json({ error: 'No text to speak' }, 400);

  const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true }
    })
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    console.error('ElevenLabs error', upstream.status, detail.slice(0, 500));
    return json({ error: 'Voice service error', status: upstream.status }, 502);
  }
  return new Response(upstream.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
}
