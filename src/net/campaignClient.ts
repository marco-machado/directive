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

export const loadLegacyCampaign = () => parseCampaign(storage.get(LEGACY_KEY));

export const rememberSaveCode = (code: string) => storage.set(CODE_KEY, code);

// Keep actions in order. A failed request blocks later actions so local progress is
// never replaced by a server state that does not include those actions.
export class CampaignClient implements CampaignSync {
  code: string | null = null;
  private sim: Simulation | null = null;
  private generation = 0;
  private missionId: string | null = null;
  private pending: Array<() => Promise<Campaign | null>> = [];
  private running = false;
  private failed = false;

  attach(sim: Simulation, code: string) {
    this.generation++;
    this.sim = sim; this.code = code; this.missionId = null;
    this.pending = []; this.running = false; this.failed = false;
  }

  deployed() {
    const code = this.code; if (!code) return;
    const generation = this.generation;
    this.enqueue(async () => {
      const { missionId } = await api<{ missionId: string }>(`campaign/${code}/missions`, 'POST');
      if (generation === this.generation) this.missionId = missionId;
      return null;
    });
  }
  completed() {
    const code = this.code; if (!code) return;
    this.enqueue(async () => {
      if (!this.missionId) throw new Error('Mission has not been synchronized.');
      const { campaign } = await api<{ campaign: Campaign }>(`campaign/${code}/missions/${this.missionId}/complete`, 'POST');
      return campaign;
    });
  }
  bought(type: Upgrade) {
    const code = this.code; if (!code) return;
    this.enqueue(async () => (await api<{ campaign: Campaign }>(`campaign/${code}/upgrades/${type}`, 'POST')).campaign);
  }

  private enqueue(task: () => Promise<Campaign | null>) {
    this.pending.push(task);
    void this.flush(this.generation);
  }

  private async flush(generation: number) {
    if (this.running || this.failed) return;
    this.running = true;
    while (generation === this.generation && this.pending.length) {
      try {
        const campaign = await this.pending[0]();
        if (generation !== this.generation) return;
        this.pending.shift();
        // Intermediate replies predate later optimistic local actions.
        if (campaign && this.pending.length === 0) this.sim?.applyCampaign(campaign);
      } catch {
        if (generation !== this.generation) return;
        this.failed = true;
        this.sim?.setSaveUnavailable(true);
        break;
      }
    }
    if (generation === this.generation) {
      this.running = false;
      if (!this.failed) this.sim?.setSaveUnavailable(false);
    }
  }
}
