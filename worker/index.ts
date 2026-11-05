import { isLoadout, isUpgrade } from '../src/game/campaign.ts';
import { normalizeSaveCode } from '../src/game/saveCode.ts';
import type { Result } from './player.ts';
export { PlayerCampaign } from './player.ts';

// The largest real body is a create that imports a legacy save, about 1.5 KB.
const MAX_BODY_BYTES = 16 * 1024;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const reply = (r: Result | { ok: false; status: number; error: string }) => r.ok ? json({ campaign: r.campaign }) : json({ error: r.error }, r.status);
const notFound = () => json({ error: 'Not found.' }, 404);
const tooMany = () => json({ error: 'Too many requests. Try again in a minute.' }, 429);
// Stops reading past MAX_BODY_BYTES, so an oversized body is never buffered or parsed. null means it was too large.
const readBody = async (request: Request): Promise<string | null> => {
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  for (let size = 0; ;) {
    const { done, value } = await reader.read();
    if (done) return new Blob(chunks).text();
    if ((size += value.byteLength) > MAX_BODY_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
};
const body = (text: string): Record<string, unknown> => {
  try {
    const data: unknown = JSON.parse(text);
    if (data && typeof data === 'object') return data as Record<string, unknown>;
  } catch { /* not JSON: every field reads as missing */ }
  return {};
};
const isId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,24}$/.test(v);

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api') return env.ASSETS.fetch(request);
    const { method } = request;
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (!(await env.API_LIMIT.limit({ key: ip })).success) return tooMany();
    const text = await readBody(request);
    if (text === null) return json({ error: 'Request body too large.' }, 413);

    // POST /api/players  { code, legacy?: Campaign }
    // The browser picks and stores the code first, so a retry after a lost reply reaches the same player.
    // Creating is the one request that adds storage, so it has its own, lower limit.
    if (parts.length === 2 && parts[1] === 'players' && method === 'POST') {
      if (!(await env.CREATE_LIMIT.limit({ key: ip })).success) return tooMany();
      const { code: requested, legacy } = body(text);
      const code = typeof requested === 'string' ? normalizeSaveCode(requested) : null;
      if (!code) return json({ error: 'Expected a save code.' }, 400);
      const { campaign } = await env.PLAYERS.getByName(code).init(legacy);
      return json({ code, campaign }, 201);
    }

    if (parts[1] !== 'campaign' || !parts[2]) return notFound();
    const code = normalizeSaveCode(parts[2]);
    if (!code) return json({ error: 'Invalid save code.' }, 400);
    const player = env.PLAYERS.getByName(code);
    const rest = parts.slice(3);

    if (rest.length === 0 && method === 'GET') return reply(await player.get());
    // POST /missions  { contractId, squad: string[] }
    if (rest.length === 1 && rest[0] === 'missions' && method === 'POST') {
      const { contractId, squad } = body(text);
      if (!isId(contractId) || !Array.isArray(squad) || !squad.every(isId)) return json({ error: 'Expected a contractId and a squad.' }, 400);
      const r = await player.startMission(contractId, squad);
      return r.ok ? json({ missionId: r.missionId, campaign: r.campaign }, 201) : json({ error: r.error }, r.status);
    }
    // POST /missions/:id/complete  { stealth: boolean }
    if (rest.length === 3 && rest[0] === 'missions' && rest[2] === 'complete' && method === 'POST') {
      const { stealth } = body(text);
      return reply(await player.completeMission(rest[1], stealth === true));
    }
    if (rest.length === 2 && rest[0] === 'upgrades' && method === 'POST') {
      if (!isUpgrade(rest[1])) return json({ error: 'Unknown upgrade.' }, 400);
      return reply(await player.buy(rest[1]));
    }
    // POST /loadout  { weapon, armor }
    if (rest.length === 1 && rest[0] === 'loadout' && method === 'POST') {
      const { weapon, armor } = body(text), loadout = { weapon, armor };
      if (!isLoadout(loadout)) return json({ error: 'Unknown loadout.' }, 400);
      return reply(await player.equip(loadout));
    }
    if (rest.length === 2 && rest[0] === 'recruits' && method === 'POST') {
      if (!isId(rest[1])) return json({ error: 'Unknown recruit.' }, 400);
      return reply(await player.recruit(rest[1]));
    }
    if (rest.length === 2 && rest[0] === 'roster' && method === 'DELETE') {
      if (!isId(rest[1])) return json({ error: 'Unknown operative.' }, 400);
      return reply(await player.dismiss(rest[1]));
    }
    return notFound();
  },
} satisfies ExportedHandler<Env>;
