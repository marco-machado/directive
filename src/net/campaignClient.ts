import { parseCampaign } from '../game/campaign.ts';
import type { Campaign, Upgrade } from '../game/campaign.ts';
import { normalizeSaveCode } from '../game/saveCode.ts';
import type { CampaignSync, Simulation } from '../game/simulation.ts';

const CODE_KEY = 'ndPlayer';
const LEGACY_KEY = 'ndSave';

const storage = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* code shown in HUD instead */ } },
  remove(key: string) { try { localStorage.removeItem(key); } catch { /* nothing to clean */ } },
};

export class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status}).`);
  return data;
}

export const fetchCampaign = (code: string) => api<{ campaign: Campaign }>(`campaign/${code}`).then(r => r.campaign);

// Resolves this browser's save code, creating one (and importing a pre-server save) on first visit.
export async function connectPlayer(): Promise<{ code: string; campaign: Campaign }> {
  const stored = normalizeSaveCode(storage.get(CODE_KEY) ?? '');
  if (stored) {
    try { return { code: stored, campaign: await fetchCampaign(stored) }; }
    catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
  }
  const legacyText = storage.get(LEGACY_KEY);
  const created = await api<{ code: string; campaign: Campaign }>('players', 'POST', legacyText ? { legacy: parseCampaign(legacyText) } : {});
  storage.set(CODE_KEY, created.code);
  storage.remove(LEGACY_KEY);
  return created;
}

export const rememberSaveCode = (code: string) => storage.set(CODE_KEY, code);

// Sends simulation events to the player's Durable Object in order; each server reply replaces the local campaign.
export class CampaignClient implements CampaignSync {
  code: string | null = null;
  private sim: Simulation | null = null;
  private missionId: Promise<string | null> = Promise.resolve(null);
  private queue: Promise<unknown> = Promise.resolve();

  attach(sim: Simulation, code: string) { this.sim = sim; this.code = code; this.missionId = Promise.resolve(null); }

  deployed() {
    const code = this.code; if (!code) return;
    this.missionId = this.enqueue(() => api<{ missionId: string }>(`campaign/${code}/missions`, 'POST').then(r => r.missionId));
  }
  completed() {
    const code = this.code; if (!code) return;
    const mission = this.missionId;
    this.enqueue(async () => {
      const id = await mission; if (!id) return null;
      return this.apply(api<{ campaign: Campaign }>(`campaign/${code}/missions/${id}/complete`, 'POST'));
    });
  }
  bought(type: Upgrade) {
    const code = this.code; if (!code) return;
    this.enqueue(() => this.apply(api<{ campaign: Campaign }>(`campaign/${code}/upgrades/${type}`, 'POST')));
  }

  private async apply(request: Promise<{ campaign: Campaign }>) {
    const { campaign } = await request;
    this.sim?.applyCampaign(campaign);
    return campaign;
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T | null> {
    const run = this.queue.then(task).then(
      value => { this.sim?.setSaveUnavailable(false); return value; },
      async error => {
        // A rejected action means local state drifted; resync to the server's copy.
        const resynced = error instanceof ApiError && error.status === 409 && this.code
          ? await fetchCampaign(this.code).then(c => { this.sim?.applyCampaign(c); return true; }, () => false)
          : false;
        this.sim?.setSaveUnavailable(!resynced);
        return null;
      });
    this.queue = run;
    return run;
  }
}
