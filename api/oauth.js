// Sign-in flow for Google (Gmail + Calendar, read-only) and Spotify.
// 1. The dashboard calls GET /api/oauth?provider=google|spotify with the Atlas passcode header and gets a sign-in URL.
// 2. Ricardo signs in on Google/Spotify himself. They send him back to /api/oauth?code=...&state=...
// 3. Atlas swaps the code for a refresh token and keeps it in Atlas storage. Tokens are never shown, logged or returned.
// POST /api/oauth?provider=...&disconnect=1 (with passcode) forgets a connection.
import { authorized, json, storageConfig } from './_atlas.js';
import { kvSet, kvTake, kvDel } from './_kv.js';
import { PROVIDERS, providerReady } from './_oauthcfg.js';

export const config = { runtime: 'edge' };

const page = (title, msg, ok) => new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px -apple-system,system-ui,sans-serif;background:#050b18;color:#dbe9ff;display:grid;place-items:center;min-height:90vh;text-align:center;padding:20px"><div><h2 style="color:${ok ? '#5CC8FF' : '#ff8a8a'}">${title}</h2><p>${msg}</p><p><a href="/" style="color:#ffc85a">Back to Atlas</a></p></div>`, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

export default async function handler(req) {
  const url = new URL(req.url);
  const redirect = `${url.origin}/api/oauth`;
  if (!storageConfig()) return json({ error: 'Atlas storage (Upstash) is not connected.' }, 500);

  // Callback from Google or Spotify.
  if (url.searchParams.has('state')) {
    if (url.searchParams.get('error')) return page('Not connected', 'Sign-in was cancelled. Nothing was saved.', false);
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    const provider = /^[A-Za-z0-9_-]{20,80}$/.test(state) ? await kvTake(`atlas:oauth:state:${state}`) : null;
    const p = provider && PROVIDERS[provider];
    if (!p || !code) return page('Not connected', 'That sign-in link expired or was already used. Start again from Atlas.', false);
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect });
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    if (p.basicAuth) headers.Authorization = 'Basic ' + btoa(`${process.env[p.idVar]}:${process.env[p.secretVar]}`);
    else { body.set('client_id', process.env[p.idVar]); body.set('client_secret', process.env[p.secretVar]); }
    const r = await fetch(p.tokenUrl, { method: 'POST', headers, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.refresh_token) {
      console.error('OAuth exchange failed', provider, r.status, j.error || '');
      return page('Not connected', `${p.label} did not return a lasting sign-in. Try again from Atlas.`, false);
    }
    await kvSet(`atlas:oauth:${provider}`, { refresh_token: j.refresh_token, scope: j.scope || '', at: Date.now() });
    await kvDel(`atlas:oauth:access:${provider}`);
    return page(`${p.label} connected`, `Atlas can now use ${p.label} (${p.what}). You can close this tab.`, true);
  }

  if (!authorized(req)) return json({ error: 'Unauthorized' }, 401);
  const provider = url.searchParams.get('provider');
  const p = PROVIDERS[provider];
  if (!p) return json({ error: 'Unknown provider' }, 400);

  if (req.method === 'POST' && url.searchParams.has('disconnect')) {
    await kvDel(`atlas:oauth:${provider}`); await kvDel(`atlas:oauth:access:${provider}`);
    return json({ ok: true });
  }
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (!providerReady(provider)) return json({ error: `${p.idVar} and ${p.secretVar} are not set in Vercel yet.` }, 400);

  const state = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  await kvSet(`atlas:oauth:state:${state}`, provider, 600);
  const q = new URLSearchParams({ client_id: process.env[p.idVar], response_type: 'code', redirect_uri: redirect, scope: p.scopes.join(' '), state, ...p.extra });
  return json({ url: `${p.authUrl}?${q}`, redirect });
}
