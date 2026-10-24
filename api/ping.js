import { authorized, json, storageConfig } from './_atlas.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (!authorized(req)) return json({ ok: false }, 401);
  return json({ ok: true, storage: !!storageConfig(), brain: !!process.env.ANTHROPIC_API_KEY });
}
