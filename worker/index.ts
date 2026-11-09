import { handleApi, json, tooMany } from './routes.ts';
export { PlayerCampaign } from './player.ts';

// The largest real body is a create that imports a legacy save, about 1.5 KB.
const MAX_BODY_BYTES = 16 * 1024;

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

// Rate limits and the body cap live here; the routes themselves are in worker/routes.ts, where the tests can reach them.
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (!(await env.API_LIMIT.limit({ key: ip })).success) return tooMany();
    const text = await readBody(request);
    if (text === null) return json({ error: 'Request body too large.' }, 413);
    return handleApi(request.method, url.pathname, text, {
      player: code => env.PLAYERS.getByName(code),
      mayCreate: async () => (await env.CREATE_LIMIT.limit({ key: ip })).success,
    });
  },
} satisfies ExportedHandler<Env>;
