import { authorized, json, storageConfig } from './_atlas.js';
import { vaultConfig } from './_vault.js';
import { ghlConfig } from './_ghl.js';
import { providerReady, providerLinked } from './_oauthcfg.js';
import { healthStatus } from './_health.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (!authorized(req)) return json({ ok: false }, 401);
  const db = !!storageConfig();
  const [google, spotify, healthLatest] = db ? await Promise.all([providerLinked('google'), providerLinked('spotify'), healthStatus()]) : [false, false, null];
  return json({
    ok: true,
    storage: !!storageConfig(),
    brain: !!process.env.ANTHROPIC_API_KEY,
    tts: !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID),
    vault: !!vaultConfig(),
    ghl: !!ghlConfig(),
    google, googleReady: providerReady('google'),
    spotify, spotifyReady: providerReady('spotify'),
    health: !!healthLatest, healthLatest,
    spanishVoice: !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_SPANISH_VOICE_ID)
  });
}
