import { isUpgrade } from '../src/game/campaign.ts';
import { generateSaveCode, normalizeSaveCode } from '../src/game/saveCode.ts';
import type { Result } from './player.ts';
export { PlayerCampaign } from './player.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const reply = (r: Result | { ok: false; status: number; error: string }) => r.ok ? json({ campaign: r.campaign }) : json({ error: r.error }, r.status);
const notFound = () => json({ error: 'Not found.' }, 404);

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api') return env.ASSETS.fetch(request);
    const { method } = request;

    // POST /api/players  { legacy?: Campaign }
    if (parts.length === 2 && parts[1] === 'players' && method === 'POST') {
      const body = await request.json().catch(() => ({})) as { legacy?: unknown };
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = generateSaveCode();
        const r = await env.PLAYERS.getByName(code).init(body?.legacy);
        if (r.ok) return json({ code, campaign: r.campaign }, 201);
      }
      return json({ error: 'Could not allocate a save code.' }, 503);
    }

    if (parts[1] !== 'campaign' || !parts[2]) return notFound();
    const code = normalizeSaveCode(parts[2]);
    if (!code) return json({ error: 'Invalid save code.' }, 400);
    const player = env.PLAYERS.getByName(code);
    const rest = parts.slice(3);

    if (rest.length === 0 && method === 'GET') return reply(await player.get());
    if (rest.length === 1 && rest[0] === 'missions' && method === 'POST') {
      const r = await player.startMission();
      return r.ok ? json({ missionId: r.missionId }, 201) : json({ error: r.error }, r.status);
    }
    if (rest.length === 3 && rest[0] === 'missions' && rest[2] === 'complete' && method === 'POST') return reply(await player.completeMission(rest[1]));
    if (rest.length === 2 && rest[0] === 'upgrades' && method === 'POST') {
      if (!isUpgrade(rest[1])) return json({ error: 'Unknown upgrade.' }, 400);
      return reply(await player.buy(rest[1]));
    }
    return notFound();
  },
} satisfies ExportedHandler<Env>;
