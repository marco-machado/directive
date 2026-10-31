import { Simulation } from './game/simulation.ts';
import { CampaignClient, connectPlayer, loadLegacyCampaign } from './net/campaignClient.ts';

export const client = new CampaignClient();
export const sim = new Simulation(loadLegacyCampaign(), client);
// Module scope so StrictMode's double effects never create two players.
export const connection = connectPlayer().then(({ code, campaign }) => { client.attach(sim, code); sim.applyCampaign(campaign); return code; });
