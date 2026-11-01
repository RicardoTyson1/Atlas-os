// OAuth provider settings and access-token refresh. Not exposed as a route.
import { kvGet, kvSet } from './_kv.js';

export const PROVIDERS = {
  google: {
    label: 'Google', what: 'Gmail and Calendar, read-only',
    idVar: 'GOOGLE_CLIENT_ID', secretVar: 'GOOGLE_CLIENT_SECRET',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.readonly'],
    extra: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', login_hint: 'admin@mountatlanta.com' }
  },
  spotify: {
    label: 'Spotify', what: 'see what is playing and control playback',
    idVar: 'SPOTIFY_CLIENT_ID', secretVar: 'SPOTIFY_CLIENT_SECRET', basicAuth: true,
    authUrl: 'https://accounts.spotify.com/authorize', tokenUrl: 'https://accounts.spotify.com/api/token',
    scopes: ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing', 'playlist-read-private', 'playlist-read-collaborative'],
    extra: {}
  }
};

export const providerReady = name => { const p = PROVIDERS[name]; return !!(p && process.env[p.idVar] && process.env[p.secretVar]); };

// True when the app keys are set AND Ricardo has signed in.
export async function providerLinked(name) {
  if (!providerReady(name)) return false;
  try { return !!(await kvGet(`atlas:oauth:${name}`))?.refresh_token; } catch { return false; }
}

// Returns a short-lived access token (cached ~50 min) or throws a plain-English error. Never logs tokens.
export async function accessToken(name) {
  const p = PROVIDERS[name];
  if (!providerReady(name)) throw new Error(`${p.label} is not set up in Vercel yet`);
  const cached = await kvGet(`atlas:oauth:access:${name}`);
  if (cached && cached.token && cached.exp > Date.now() + 60000) return cached.token;
  const saved = await kvGet(`atlas:oauth:${name}`);
  if (!saved || !saved.refresh_token) throw new Error(`${p.label} is not signed in yet. Tap Connect on the dashboard`);
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refresh_token });
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (p.basicAuth) headers.Authorization = 'Basic ' + btoa(`${process.env[p.idVar]}:${process.env[p.secretVar]}`);
  else { body.set('client_id', process.env[p.idVar]); body.set('client_secret', process.env[p.secretVar]); }
  const r = await fetch(p.tokenUrl, { method: 'POST', headers, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    console.error('Token refresh failed', name, r.status, j.error || '');
    throw new Error(`${p.label} sign-in expired. Tap Connect on the dashboard to sign in again`);
  }
  if (j.refresh_token && j.refresh_token !== saved.refresh_token) await kvSet(`atlas:oauth:${name}`, { ...saved, refresh_token: j.refresh_token });
  await kvSet(`atlas:oauth:access:${name}`, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 }, Math.max(60, (Number(j.expires_in) || 3600) - 300));
  return j.access_token;
}
