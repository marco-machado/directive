import { isUpgrade } from '../src/game/campaign.ts';
import { normalizeSaveCode } from '../src/game/saveCode.ts';
import type { Result } from './player.ts';
export { PlayerCampaign } from './player.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const reply = (r: Result | { ok: false; status: number; error: string }) => r.ok ? json({ campaign: r.campaign }) : json({ error: r.error }, r.status);
const notFound = () => json({ error: 'Not found.' }, 404);
const body = async (request: Request): Promise<Record<string, unknown>> => {
  const data: unknown = await request.json().catch(() => null);
  return data && typeof data === 'object' ? data as Record<string, unknown> : {};
};
const isId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,24}$/.test(v);

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api') return env.ASSETS.fetch(request);
    const { method } = request;

    // POST /api/players  { code, legacy?: Campaign }
    // The browser picks and stores the code first, so a retry after a lost reply reaches the same player.
    if (parts.length === 2 && parts[1] === 'players' && method === 'POST') {
      const { code: requested, legacy } = await body(request);
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
      const { contractId, squad } = await body(request);
      if (!isId(contractId) || !Array.isArray(squad) || !squad.every(isId)) return json({ error: 'Expected a contractId and a squad.' }, 400);
      const r = await player.startMission(contractId, squad);
      return r.ok ? json({ missionId: r.missionId, campaign: r.campaign }, 201) : json({ error: r.error }, r.status);
    }
    // POST /missions/:id/complete  { stealth: boolean }
    if (rest.length === 3 && rest[0] === 'missions' && rest[2] === 'complete' && method === 'POST') {
      const { stealth } = await body(request);
      return reply(await player.completeMission(rest[1], stealth === true));
    }
    if (rest.length === 2 && rest[0] === 'upgrades' && method === 'POST') {
      if (!isUpgrade(rest[1])) return json({ error: 'Unknown upgrade.' }, 400);
      return reply(await player.buy(rest[1]));
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
