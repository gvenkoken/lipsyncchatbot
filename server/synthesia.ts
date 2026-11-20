import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AccessToken, RoomServiceClient, RoomAgentDispatch, RoomConfiguration, TrackSource } from 'livekit-server-sdk';

export type SynthesiaConfig = {
  apiKey: string; defaultAvatarId: string; customAvatarId: string;
  livekitUrl: string; livekitApiKey: string; livekitApiSecret: string;
  openaiApiKey: string; openaiModel: string;
};
// LiveKit also documents gallery UUIDs. Synthesia determines whether an ID is eligible.
const validAvatar = (value: string) => /^av_[a-zA-Z0-9_-]+$/.test(value) || /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const validUrl = (value: string) => { try { return new URL(value).protocol === 'wss:'; } catch { return false; } };
export function synthesiaStatus(config: SynthesiaConfig) {
  const missing = [!config.apiKey.trim() && 'SYNTHESIA_API_KEY', !validUrl(config.livekitUrl) && 'LIVEKIT_URL',
    !config.livekitApiKey.trim() && 'LIVEKIT_API_KEY', !config.livekitApiSecret.trim() && 'LIVEKIT_API_SECRET',
    !config.openaiApiKey.trim() && 'OPENAI_API_KEY'].filter((value): value is string => !!value);
  return { configured: missing.length === 0, missing, avatars: {
    default: { configured: missing.length === 0 && validAvatar(config.defaultAvatarId) },
    custom: { configured: missing.length === 0 && validAvatar(config.customAvatarId) },
  } };
}
type Options = {
  getConfig: () => SynthesiaConfig;
  ensureWorker: (config: SynthesiaConfig) => Promise<void>;
  deleteRoom?: (room: string, config: SynthesiaConfig) => Promise<void>;
  sessionLifetimeMs?: number;
};
export function createSynthesiaHandler(options: Options) {
  const sessions = new Map<string, { room: string; config: SynthesiaConfig; timer: ReturnType<typeof setTimeout> }>();
  let starting = false;
  const deleteRoom = options.deleteRoom ?? (async (room, config) => {
    const service = new RoomServiceClient(config.livekitUrl.replace(/^wss:/, 'https:'), config.livekitApiKey, config.livekitApiSecret);
    await service.deleteRoom(room);
  });
  const end = async (id: string) => {
    const session = sessions.get(id); if (!session) return;
    sessions.delete(id); clearTimeout(session.timer);
    try { await deleteRoom(session.room, session.config); } catch { /* Media also closes when the user leaves. */ }
  };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body));
  };
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/api/synthesia/')) { next(); return; }
    const config = options.getConfig();
    if (path === '/api/synthesia/status' && req.method === 'GET') { json(res, 200, synthesiaStatus(config)); return; }
    if (!['/api/synthesia/session', '/api/synthesia/hangup'].includes(path)) { json(res, 404, { error: 'Bulunamadı.' }); return; }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: 'POST gerekli.' }); return; }
    try {
      const origin = new URL(req.headers.origin ?? '');
      if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(origin.hostname) || origin.host !== req.headers.host) throw new Error();
    } catch { json(res, 403, { error: 'Bu bağlantıya izin verilmiyor.' }); return; }
    let ownsStart = false;
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk.toString(); if (Buffer.byteLength(raw) > 4096) { json(res, 413, { error: 'İstek çok büyük.' }); return; } }
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); }
      catch { json(res, 400, { error: 'Geçersiz istek.' }); return; }
      if (path === '/api/synthesia/hangup') {
        if (typeof body.sessionId !== 'string') { json(res, 400, { error: 'Oturum belirtilmedi.' }); return; }
        await end(body.sessionId); res.writeHead(204); res.end(); return;
      }
      if (body.avatar !== 'default' && body.avatar !== 'custom') { json(res, 400, { error: 'Avatar seçimi geçersiz.' }); return; }
      if (!synthesiaStatus(config).avatars[body.avatar].configured) {
        json(res, 503, { code: 'not_configured', error: body.avatar === 'custom' ? 'Bizim karakter için Synthesia bağlantısı ve Interactive ID henüz yapılandırılmadı.' : 'Synthesia bağlantısı ve hazır avatar henüz yapılandırılmadı.' }); return;
      }
      if (starting || sessions.size) { json(res, 409, { error: 'Önce açık Synthesia konuşmasını durdurun.' }); return; }
      starting = true; ownsStart = true;
      await options.ensureWorker(config);
      if (res.destroyed) return;
      const id = randomUUID(), room = `pmi-${randomUUID()}`, identity = `user-${randomUUID()}`;
      const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, { identity, ttl: '2m' });
      token.addGrant({ roomJoin: true, room, canSubscribe: true, canPublish: true, canPublishData: true, canPublishSources: [TrackSource.MICROPHONE], canUpdateOwnMetadata: false });
      token.roomConfig = new RoomConfiguration({ syncStreams: true, emptyTimeout: 60, departureTimeout: 10, maxParticipants: 3,
        agents: [new RoomAgentDispatch({ agentName: 'pmi-synthesia', metadata: JSON.stringify({ avatarId: body.avatar === 'custom' ? config.customAvatarId : config.defaultAvatarId, userIdentity: identity }) })] });
      const jwt = await token.toJwt(); if (res.destroyed) return;
      const timer = setTimeout(() => { void end(id); }, options.sessionLifetimeMs ?? 60 * 60 * 1000); timer.unref();
      sessions.set(id, { room, config, timer });
      json(res, 201, { sessionId: id, url: config.livekitUrl, token: jwt, avatarIdentity: 'synthesia-avatar-agent', agentIdentity: 'pmi-agent' });
    } catch {
      if (!res.destroyed && !res.writableEnded) json(res, 502, { error: 'Synthesia bağlantısı hazırlanamadı. LiveKit anahtarlarını ve sunucu bağlantısını kontrol edin.' });
    } finally { if (ownsStart) starting = false; }
  };
  return { handler, dispose: async () => { await Promise.allSettled([...sessions.keys()].map(end)); } };
}
