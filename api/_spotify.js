// Spotify: see what's playing and control playback. Not exposed as a route.
import { accessToken } from './_oauthcfg.js';

const API = 'https://api.spotify.com/v1';
const s = (v, max = 200) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);

async function sp(method, path, params, body) {
  const token = await accessToken('spotify');
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return null;
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const reason = j.error?.reason || '';
    if (reason === 'NO_ACTIVE_DEVICE' || r.status === 404) throw new Error('No Spotify device is active. Open Spotify on your phone or Mac and press play once, then try again');
    if (reason === 'PREMIUM_REQUIRED' || r.status === 403) throw new Error('Spotify only allows playback control on Premium accounts');
    if (r.status === 401) throw new Error('Spotify sign-in was rejected; reconnect Spotify on the dashboard');
    throw new Error(`Spotify returned ${r.status}`);
  }
  return r.json().catch(() => null);
}

const track = t => t ? `${s(t.name, 80)} by ${(t.artists || []).map(a => a.name).join(', ') || s(t.show?.name, 60)}` : 'nothing';

export const SPOTIFY_TOOLS = [
  {
    name: 'spotify_now_playing',
    description: 'Spotify: what is playing right now, on which device, and volume.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'spotify_control',
    description: 'Spotify playback control: play (resume), pause, next, previous, volume {level 0-100}, shuffle {on true/false}.',
    input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'next', 'previous', 'volume', 'shuffle'] }, level: { type: 'integer' }, on: { type: 'boolean' } }, required: ['action'] }
  },
  {
    name: 'spotify_play',
    description: 'Spotify: find and play a playlist, album, artist or song, e.g. "workout hip hop", "Drake", "my Discover Weekly". Searches his own playlists first.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, type: { type: 'string', enum: ['playlist', 'album', 'artist', 'track'], description: 'Default playlist.' } }, required: ['query'] }
  }
];

export const SPOTIFY_GUIDE = `Spotify: CONNECTED. With spotify_now_playing, spotify_control and spotify_play you can see and control his music on whatever device Spotify is active on (controls need Spotify Premium). Pick music that fits his mood and the moment (driving, working, winding down with family). Keep confirmations to a few words.`;

export async function runSpotify(tool, input) {
  input = input || {};
  if (tool === 'spotify_now_playing') {
    const p = await sp('GET', '/me/player', { additional_types: 'track,episode' });
    if (!p) return { text: 'Nothing is playing and no Spotify device is active.' };
    return { text: `${p.is_playing ? 'Playing' : 'Paused'}: ${track(p.item)} | device ${s(p.device?.name, 40)} (${s(p.device?.type, 20)}) | volume ${p.device?.volume_percent ?? '?'}% | shuffle ${p.shuffle_state ? 'on' : 'off'}` };
  }
  if (tool === 'spotify_control') {
    const a = input.action;
    if (a === 'play') await sp('PUT', '/me/player/play');
    else if (a === 'pause') await sp('PUT', '/me/player/pause');
    else if (a === 'next') await sp('POST', '/me/player/next');
    else if (a === 'previous') await sp('POST', '/me/player/previous');
    else if (a === 'volume') { const v = Math.min(100, Math.max(0, Math.round(Number(input.level)))); if (!Number.isFinite(v)) return { text: 'Which volume, 0 to 100?', error: true }; await sp('PUT', '/me/player/volume', { volume_percent: v }); }
    else if (a === 'shuffle') await sp('PUT', '/me/player/shuffle', { state: input.on === false ? 'false' : 'true' });
    else return { text: 'Unknown Spotify action.', error: true };
    return { text: `Done: ${a}${a === 'volume' ? ' ' + input.level + '%' : ''}.` };
  }
  if (tool === 'spotify_play') {
    const query = s(input.query, 100);
    if (!query) return { text: 'What should I play?', error: true };
    const type = ['playlist', 'album', 'artist', 'track'].includes(input.type) ? input.type : 'playlist';
    let pick = null;
    if (type === 'playlist') {
      const mine = (await sp('GET', '/me/playlists', { limit: 50 }))?.items || [];
      const ql = query.toLowerCase().replace(/^my /, '');
      pick = mine.find(p => p && p.name.toLowerCase() === ql) || mine.find(p => p && p.name.toLowerCase().includes(ql));
    }
    if (!pick) {
      const res = await sp('GET', '/search', { q: query, type, limit: 1, market: 'from_token' });
      pick = res?.[type + 's']?.items?.filter(Boolean)[0];
    }
    if (!pick) return { text: `Couldn't find "${query}" on Spotify.` };
    await sp('PUT', '/me/player/play', null, type === 'track' ? { uris: [pick.uri] } : { context_uri: pick.uri });
    return { text: `Playing ${type} "${s(pick.name, 80)}"${pick.artists ? ' by ' + pick.artists.map(a => a.name).join(', ') : ''}.` };
  }
  return { text: `Unknown Spotify tool ${tool}.`, error: true };
}
