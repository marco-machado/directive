import { isLoadout, isUpgrade, MAX_COUNTERMEASURES, missionReport } from '../src/game/campaign.ts';
import { normalizeSaveCode } from '../src/game/saveCode.ts';
import type { CampaignStore, Result } from './store.ts';

// What the routes need from the Worker: one player's campaign by save code, and whether this caller may create one more.
type PlayerApi = Pick<CampaignStore, 'init' | 'get' | 'startMission' | 'completeMission' | 'buy' | 'equip' | 'recruit' | 'dismiss'>;
type Api = { player(code: string): PlayerApi; mayCreate(): Promise<boolean> };

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
export const tooMany = () => json({ error: 'Too many requests. Try again in a minute.' }, 429);
const reply = (r: Result) => r.ok ? json({ campaign: r.campaign }) : json({ error: r.error }, r.status);
const notFound = () => json({ error: 'Not found.' }, 404);
const fields = (text: string): Record<string, unknown> => {
  try {
    const data: unknown = JSON.parse(text);
    if (data && typeof data === 'object') return data as Record<string, unknown>;
  } catch { /* not JSON: every field reads as missing */ }
  return {};
};
const isId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,24}$/.test(v);
const isLevel = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_COUNTERMEASURES;

// Every /api route: checks the request's shape, then hands it to the player's campaign. `text` is the request body.
export async function handleApi(method: string, pathname: string, text: string, api: Api): Promise<Response> {
  const parts = pathname.split('/').filter(Boolean);

  // POST /api/players  { code, legacy?: Campaign }
  // The browser picks and stores the code first, so a retry after a lost reply reaches the same player.
  // Creating is the one request that adds storage, so it has its own, lower limit.
  if (parts.length === 2 && parts[1] === 'players' && method === 'POST') {
    if (!await api.mayCreate()) return tooMany();
    const { code: requested, legacy } = fields(text);
    const code = typeof requested === 'string' ? normalizeSaveCode(requested) : null;
    if (!code) return json({ error: 'Expected a save code.' }, 400);
    const { campaign } = await api.player(code).init(legacy);
    return json({ code, campaign }, 201);
  }

  if (parts[1] !== 'campaign' || !parts[2]) return notFound();
  const code = normalizeSaveCode(parts[2]);
  if (!code) return json({ error: 'Invalid save code.' }, 400);
  const player = api.player(code);
  const rest = parts.slice(3);

  if (rest.length === 0 && method === 'GET') return reply(await player.get());
  // POST /missions  { contractId, squad: string[], countermeasures?: 0–3 }  (an older client sends no level: 0)
  if (rest.length === 1 && rest[0] === 'missions' && method === 'POST') {
    const { contractId, squad, countermeasures = 0 } = fields(text);
    if (!isId(contractId) || !Array.isArray(squad) || !squad.every(isId)) return json({ error: 'Expected a contractId and a squad.' }, 400);
    if (!isLevel(countermeasures)) return json({ error: 'Unknown countermeasures level.' }, 400);
    const r = await player.startMission(contractId, squad, countermeasures);
    return r.ok ? json({ missionId: r.missionId, campaign: r.campaign }, 201) : json({ error: r.error }, r.status);
  }
  // POST /missions/:id/complete  { stealth: boolean, badges?: Badge[], results?: { caches?, prisoners?, tagged? }, kills?: number }
  if (rest.length === 3 && rest[0] === 'missions' && rest[2] === 'complete' && method === 'POST') {
    const { stealth, badges, results, kills } = fields(text), report = missionReport(stealth, badges, results, kills);
    if (!report) return json({ error: 'Unknown badge, result or kill count.' }, 400);
    return reply(await player.completeMission(rest[1], report));
  }
  if (rest.length === 2 && rest[0] === 'upgrades' && method === 'POST') {
    if (!isUpgrade(rest[1])) return json({ error: 'Unknown upgrade.' }, 400);
    return reply(await player.buy(rest[1]));
  }
  // POST /loadout  { weapon, armor }
  if (rest.length === 1 && rest[0] === 'loadout' && method === 'POST') {
    const { weapon, armor } = fields(text), loadout = { weapon, armor };
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
}
