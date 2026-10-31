import { MIN_MISSION_MS, parseCampaign } from '../game/campaign.ts';
import type { Campaign, Upgrade } from '../game/campaign.ts';
import { generateSaveCode, normalizeSaveCode } from '../game/saveCode.ts';
import type { CampaignSync, Simulation } from '../game/simulation.ts';

const CODE_KEY = 'ndPlayer';
const LEGACY_KEY = 'ndSave';
// A request the server never answers would hold the sync queue, and the Load form with it.
const REQUEST_TIMEOUT_MS = 10_000;
const RESYNC_MS = 5_000;

const storage = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* code shown in HUD instead */ } },
  remove(key: string) { try { localStorage.removeItem(key); } catch { /* nothing to clean */ } },
};

export class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status}).`);
  }
  // No fallback here: a success body that fails to read (a timeout mid-body) must reject, not pass as {}.
  return res.json() as Promise<T>;
}

export const fetchCampaign = (code: string) => api<{ campaign: Campaign }>(`campaign/${code}`).then(r => r.campaign);

// Resolves this browser's save code, creating one (and importing a pre-server save) on first visit.
// The code is stored before the create, so a create whose reply was lost is retried with the same code.
export async function connectPlayer(): Promise<{ code: string; campaign: Campaign }> {
  const stored = normalizeSaveCode(storage.get(CODE_KEY) ?? '');
  if (stored) {
    try {
      const campaign = await fetchCampaign(stored);
      // A create whose reply was lost may still have imported the old save.
      storage.remove(LEGACY_KEY);
      return { code: stored, campaign };
    } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
  }
  const code = stored ?? generateSaveCode();
  storage.set(CODE_KEY, code);
  const legacyText = storage.get(LEGACY_KEY);
  const created = await api<{ code: string; campaign: Campaign }>('players', 'POST', legacyText ? { code, legacy: parseCampaign(legacyText) } : { code });
  storage.remove(LEGACY_KEY);
  return created;
}

export const loadLegacyCampaign = () => parseCampaign(storage.get(LEGACY_KEY));

export const rememberSaveCode = (code: string) => storage.set(CODE_KEY, code);

// Keep actions in order. After a failed request, later actions wait: each one builds on the failed one.
// resync() then replaces all of that unsynced progress with the server's campaign.
export class CampaignClient implements CampaignSync {
  code: string | null = null;
  private sim: Simulation | null = null;
  private generation = 0;
  private missionId: string | null = null;
  private missionRegisteredAt = 0;
  private pending: Array<() => Promise<Campaign | null>> = [];
  private running = false;
  private failed = false;

  attach(sim: Simulation, code: string) {
    this.generation++;
    this.sim = sim; this.code = code; this.missionId = null;
    this.pending = []; this.running = false; this.failed = false;
    sim.setSyncing(false);
  }

  deployed(contractId: string, squad: string[]) {
    const code = this.code; if (!code) return;
    const generation = this.generation;
    this.enqueue(async () => {
      const { missionId, campaign } = await api<{ missionId: string; campaign: Campaign }>(`campaign/${code}/missions`, 'POST', { contractId, squad });
      if (generation === this.generation) { this.missionId = missionId; this.missionRegisteredAt = performance.now(); }
      return campaign;
    });
  }
  completed(stealth: boolean) {
    const code = this.code; if (!code) return;
    this.enqueue(async () => {
      const { generation, missionId } = this;
      if (!missionId) throw new Error('Mission has not been synchronized.');
      // A fast win can beat the server's minimum mission time; hold the claim until it would be accepted.
      const wait = this.missionRegisteredAt + MIN_MISSION_MS - performance.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      if (generation !== this.generation) return null;
      const { campaign } = await api<{ campaign: Campaign }>(`campaign/${code}/missions/${missionId}/complete`, 'POST', { stealth });
      return campaign;
    });
  }
  bought(type: Upgrade) { this.change(`upgrades/${type}`, 'POST'); }
  recruited(id: string) { this.change(`recruits/${id}`, 'POST'); }
  dismissed(id: string) { this.change(`roster/${id}`, 'DELETE'); }
  private change(path: string, method: string) {
    const code = this.code; if (!code) return;
    this.enqueue(async () => (await api<{ campaign: Campaign }>(`campaign/${code}/${path}`, method)).campaign);
  }

  private enqueue(task: () => Promise<Campaign | null>) {
    this.pending.push(task);
    void this.flush(this.generation);
  }

  private async flush(generation: number) {
    if (this.running || this.failed) return;
    this.running = true;
    this.sim?.setSyncing(true);
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
        this.resync(generation);
        break;
      }
    }
    if (generation === this.generation) {
      this.running = false;
      this.sim?.setSyncing(false);
      if (!this.failed) this.sim?.setSaveUnavailable(false);
    }
  }

  // A failed action may or may not have reached the server, so once the server answers again
  // its campaign replaces the unsynced local progress and the queue starts over.
  private resync(generation: number) {
    const code = this.code!;
    setTimeout(async () => {
      if (generation !== this.generation) return;
      try {
        const campaign = await fetchCampaign(code);
        if (generation !== this.generation) return;
        // The dropped actions may include the deploy of the mission now in play, so no claim may use an older mission id.
        this.pending = []; this.failed = false; this.missionId = null;
        this.sim?.applyCampaign(campaign);
        this.sim?.setSaveUnavailable(false);
      } catch {
        if (generation === this.generation) this.resync(generation);
      }
    }, RESYNC_MS);
  }
}
