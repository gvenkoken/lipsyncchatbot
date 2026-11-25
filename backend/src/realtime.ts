import type { IncomingMessage, ServerResponse } from 'node:http';

export type RealtimeConfig = { apiKey: string; model: string };
type Options = { getConfig: () => RealtimeConfig; fetch?: typeof fetch };
const endpoint = 'https://api.openai.com/v1/realtime/calls';

export function createRealtimeHandler(options: Options) {
  const request = options.fetch ?? fetch;
  const calls = new Map<string, { apiKey: string; expiry: ReturnType<typeof setTimeout> }>();
  const hangup = async (id: string, apiKey: string) => {
    try { await request(`${endpoint}/${encodeURIComponent(id)}/hangup`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000) }); }
    catch { /* Closing the peer connection also disconnects its media. */ }
  };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const read = async (req: IncomingMessage, limit: number) => {
    let body = '';
    for await (const chunk of req) {
      body += chunk.toString();
      if (Buffer.byteLength(body) > limit) throw new Error('BODY_TOO_LARGE');
    }
    return body;
  };

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/api/realtime/')) { next(); return; }
    res.setHeader('Cache-Control', 'no-store');
    const config = options.getConfig();
    if (path === '/api/realtime/status' && req.method === 'GET') {
      json(res, 200, { configured: !!config.apiKey.trim(), model: config.model }); return;
    }
    if (!['/api/realtime/session', '/api/realtime/hangup'].includes(path)) { json(res, 404, { error: 'Bulunamadı.' }); return; }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: 'POST gerekli.' }); return; }
    // This demo runs only on loopback. Session creation must come from this page.
    let sameOrigin = false;
    try {
      const origin = new URL(req.headers.origin ?? '');
      sameOrigin = origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname) && origin.host === req.headers.host;
    } catch { /* Missing or invalid origins are rejected. */ }
    if (!sameOrigin) { json(res, 403, { error: 'Bu bağlantıya izin verilmiyor.' }); return; }
    try {
      if (path === '/api/realtime/hangup') {
        const body = JSON.parse(await read(req, 4096)) as { callId?: string };
        if (typeof body.callId !== 'string') { json(res, 400, { error: 'Oturum belirtilmedi.' }); return; }
        const call = calls.get(body.callId);
        if (call) {
          calls.delete(body.callId); clearTimeout(call.expiry);
          await hangup(body.callId, call.apiKey);
        }
        res.writeHead(204); res.end(); return;
      }
      if (!config.apiKey.trim()) { json(res, 503, { error: 'Canlı konuşma henüz yapılandırılmadı.', code: 'not_configured' }); return; }
      const sdp = await read(req, 65536);
      if (!sdp.startsWith('v=0') || !sdp.includes('m=audio')) { json(res, 400, { error: 'Ses bağlantısı oluşturulamadı.' }); return; }
      const body = new FormData();
      body.set('sdp', sdp);
      body.set('session', JSON.stringify({
        type: 'realtime', model: config.model, output_modalities: ['audio'],
        instructions: 'Sen PMI Assistant adlı sesli bir asistansın. Kullanıcıyla varsayılan olarak Türkçe, doğal ve kısa cümlelerle konuş. Yardımcı ve açık ol. Kullanıcı sözünü bitirmeden yanıt verme. Kullanıcı başka bir dil isterse o dili kullan.',
        audio: {
          input: {
            noise_reduction: { type: 'near_field' },
            transcription: { model: 'gpt-4o-mini-transcribe', language: 'tr' },
            turn_detection: { type: 'server_vad', threshold: .5, prefix_padding_ms: 300, silence_duration_ms: 650, create_response: true, interrupt_response: true },
          },
          output: { voice: 'marin' },
        },
      }));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const abort = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', abort);
      try {
        const upstream = await request(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}` }, body, signal: controller.signal });
        if (!upstream.ok) {
          // Never forward upstream diagnostics that might contain credentials.
          const status = upstream.status;
          json(res, status, { code: status === 429 ? 'rate_limit' : 'openai_error', error: status === 429 ? 'OpenAI kullanım limiti doldu. API bakiyesini ve limitleri kontrol edin.' : status === 401 || status === 403 ? 'OpenAI erişimi doğrulanamadı. API anahtarını ve model yetkisini kontrol edin.' : 'OpenAI ses bağlantısı kurulamadı. Yeniden deneyin.' });
          return;
        }
        const answer = await upstream.text();
        const location = upstream.headers.get('Location') ?? '';
        const callId = location.split('/').at(-1)?.split('?')[0];
        if (callId && /^[a-zA-Z0-9_-]+$/.test(callId)) {
          if (res.destroyed) { await hangup(callId, config.apiKey); return; }
          const expiry = setTimeout(() => { calls.delete(callId); void hangup(callId, config.apiKey); }, 60 * 60 * 1000);
          expiry.unref(); calls.set(callId, { apiKey: config.apiKey, expiry });
          res.setHeader('X-PMI-Call-Id', callId);
        }
        if (!res.destroyed) { res.writeHead(201, { 'Content-Type': 'application/sdp', 'Cache-Control': 'no-store' }); res.end(answer); }
      } finally { clearTimeout(timeout); res.off('close', abort); }
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      json(res, error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : 502, { error: 'Ses bağlantısı tamamlanamadı. Yeniden deneyin.' });
    }
  };
}
