import { DurableObject } from 'cloudflare:workers';
import type { Loadout, MissionReport, Upgrade } from '../src/game/campaign.ts';
import type { Rng } from '../src/game/rng.ts';
import { CampaignStore } from './store.ts';

const random: Rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

// One instance per save code: a CampaignStore (worker/store.ts) over this object's storage.
export class PlayerCampaign extends DurableObject<Env> {
  private readonly store = new CampaignStore(this.ctx.storage, random);
  init(legacy?: unknown) { return this.store.init(legacy); }
  get() { return this.store.get(); }
  startMission(contractId: string, squad: string[], countermeasures: number) { return this.store.startMission(contractId, squad, countermeasures); }
  completeMission(missionId: string, report: MissionReport) { return this.store.completeMission(missionId, report); }
  buy(type: Upgrade) { return this.store.buy(type); }
  equip(loadout: Loadout) { return this.store.equip(loadout); }
  recruit(id: string) { return this.store.recruit(id); }
  dismiss(id: string) { return this.store.dismiss(id); }
  async alarm() { await this.store.expire(); }
}
