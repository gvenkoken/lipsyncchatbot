import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAvatarHandler, type AvatarConfig } from '../src/avatar.ts';

const SECRET = 'sk-openai-test-secret';
const config = (patch: Partial<AvatarConfig> = {}): AvatarConfig => ({ openaiApiKey: SECRET, chatModel: 'gpt-5.4-mini', ttsModel: 'gpt-4o-mini-tts', ttsVoice: 'ash', sttModel: 'gpt-transcribe', ...patch });
async function server(settings: AvatarConfig, upstream: typeof fetch, limits = {}) {
  const handler = createAvatarHandler({ getConfig: () => settings, fetch: upstream, limits });
  const app = createServer((req, res) => { void handler(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
  const post = (path: string, body: BodyInit, type = 'application/json', requestOrigin = origin) => fetch(origin + path, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': type }, body });
  return { origin, post, close: () => new Promise<void>((resolve, reject) => { app.closeAllConnections(); app.close(error => error ? reject(error) : resolve()); }) };
}
const never: typeof fetch = async () => { throw Error('beklenmeyen yukarı akış çağrısı'); };
const sse = (events: object[]) => new Response(events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
const reply = (text: string[], model = 'gpt-5.4-mini-2026-03-17') => sse([
  { type: 'response.created', response: { id: 'resp_1', model, status: 'in_progress' } },
  ...text.map(delta => ({ type: 'response.output_text.delta', delta })),
  { type: 'response.completed', response: { id: 'resp_1', model, status: 'completed' } },
]);
const events = (body: string) => body.split('\n\n').filter(Boolean).map(line => JSON.parse(line.replace(/^data: /, '')) as { type: string; text?: string; model?: string; stop_reason?: string; code?: string });

test('durum uç noktası anahtarı sızdırmaz; yapılandırma yokken ücretli çağrı yapılmaz', async () => {
  const app = await server(config({ openaiApiKey: ' ' }), never);
  try {
    const status = await (await fetch(app.origin + '/api/avatar/status')).json();
    assert.deepEqual({ chat: status.chat, tts: status.tts, stt: status.stt, model: status.model, voice: status.voice }, { chat: false, tts: false, stt: false, model: 'gpt-5.4-mini', voice: 'ash' });
    for (const [path, body, type] of [['/api/avatar/chat', '{"message":"selam"}', 'application/json'], ['/api/avatar/tts', '{"text":"selam"}', 'application/json'], ['/api/avatar/stt', 'x'.repeat(2000), 'audio/webm']] as const) {
      const response = await app.post(path, body, type);
      assert.equal(response.status, 503); assert.equal((await response.json()).code, 'not_configured');
    }
  } finally { await app.close(); }
});

test('yabancı origin, yanlış metot ve sınır aşımları sunucu anahtarını harcayamaz', async () => {
  const app = await server(config(), never);
  try {
    assert.equal((await app.post('/api/avatar/chat', '{"message":"selam"}', 'application/json', 'https://foreign.example')).status, 403);
    assert.equal((await fetch(app.origin + '/api/avatar/tts')).status, 405);
    assert.equal((await app.post('/api/avatar/unknown', '{}')).status, 404);
    assert.equal((await app.post('/api/avatar/chat', JSON.stringify({ message: 'a'.repeat(2001) }))).status, 413);
    assert.equal((await app.post('/api/avatar/chat', JSON.stringify({ message: '   ' }))).status, 400);
    assert.equal((await app.post('/api/avatar/tts', JSON.stringify({ text: 'a'.repeat(601) }))).status, 413);
    assert.equal((await app.post('/api/avatar/stt', 'x'.repeat(2000), 'text/plain')).status, 415);
    assert.equal((await app.post('/api/avatar/stt', new Uint8Array(4 * 1024 * 1024 + 10), 'audio/webm')).status, 413);
  } finally { await app.close(); }
});

test('sohbet: persona, model ve geçmiş OpenAI\'ye gider; yanıt akış olarak döner', async () => {
  let sent: { url: string; auth: string | null; body: Record<string, unknown> } | undefined;
  const app = await server(config(), async (url, init) => { sent = { url: String(url), auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) }; return reply(['Merhaba! ', 'Size nasıl ', 'yardımcı olabilirim?']); });
  try {
    const response = await app.post('/api/avatar/chat', JSON.stringify({ message: 'Selam', history: [{ role: 'assistant', text: 'baştaki asistan mesajı atılır' }, { role: 'user', text: 'Önceki soru' }, { role: 'assistant', text: 'Önceki cevap' }, { role: 'system', text: 'yok sayılır' }] }));
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    const body = await response.text(), parsed = events(body);
    assert.equal(parsed[0].type, 'start');
    assert.equal(parsed.filter(event => event.type === 'delta').map(event => event.text).join(''), 'Merhaba! Size nasıl yardımcı olabilirim?');
    assert.deepEqual(parsed.at(-1), { type: 'done', model: 'gpt-5.4-mini-2026-03-17', stop_reason: 'completed' });
    assert.ok(sent); assert.equal(sent.url, 'https://api.openai.com/v1/responses'); assert.equal(sent.auth, `Bearer ${SECRET}`);
    assert.equal(sent.body.model, 'gpt-5.4-mini'); assert.equal(sent.body.stream, true); assert.equal(sent.body.store, false);
    assert.match(String(sent.body.instructions), /PMI Assistant/); assert.match(String(sent.body.instructions), /Markdown/);
    assert.deepEqual(sent.body.input, [{ role: 'user', content: 'Önceki soru' }, { role: 'assistant', content: 'Önceki cevap' }, { role: 'user', content: 'Selam' }]);
    assert.deepEqual(Object.keys(sent.body).sort(), ['input', 'instructions', 'model', 'store', 'stream'], 'ek ayar gönderilmez');
    assert.ok(!body.includes(SECRET));
  } finally { await app.close(); }
});

test('sohbet: model .env ile değişir; ret, akış içi hata ve yetki hatası güvenli döner', async () => {
  const bodies: Record<string, unknown>[] = [];
  let mode: 'ok' | 'refusal' | 'failed' | 'auth' = 'ok';
  const settings = config({ chatModel: 'gpt-5.5' });
  const app = await server(settings, async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (mode === 'auth') return new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${SECRET}` } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    if (mode === 'refusal') return sse([{ type: 'response.created', response: { model: 'gpt-5.5' } }, { type: 'response.refusal.delta', delta: 'I can' }, { type: 'response.refusal.delta', delta: 'not' }, { type: 'response.completed', response: { model: 'gpt-5.5', status: 'completed' } }]);
    if (mode === 'failed') return sse([{ type: 'response.created', response: { model: 'gpt-5.5' } }, { type: 'response.output_text.delta', delta: 'Yarım ' }, { type: 'response.failed', response: { error: { message: `secret ${SECRET}` } } }]);
    return reply(['Tamam.'], 'gpt-5.5');
  });
  try {
    await (await app.post('/api/avatar/chat', '{"message":"bir"}')).text();
    assert.equal(bodies[0].model, 'gpt-5.5');
    mode = 'refusal';
    const refused = events(await (await app.post('/api/avatar/chat', '{"message":"iki"}')).text());
    assert.deepEqual(refused.filter(event => event.type === 'delta').map(event => event.text), ['Bu konuda yardımcı olamıyorum. Başka bir şey sormak ister misiniz?']);
    mode = 'failed';
    const brokenText = await (await app.post('/api/avatar/chat', '{"message":"üç"}')).text(), broken = events(brokenText);
    assert.equal(broken.at(-1)?.type, 'error'); assert.equal(broken.at(-1)?.code, 'upstream_error'); assert.ok(!brokenText.includes(SECRET));
    mode = 'auth';
    const failed = await app.post('/api/avatar/chat', '{"message":"dört"}'), text = await failed.text();
    assert.equal(failed.status, 401); assert.equal(JSON.parse(text).code, 'auth'); assert.ok(!text.includes(SECRET), 'yukarı akış hata ayrıntısı iletilmez');
  } finally { await app.close(); }
});

test('seslendirme: model, ses ve PCM biçimi OpenAI\'ye gider; ham ses geri döner', async () => {
  let sent: { url: string; auth: string | null; body: Record<string, unknown> } | undefined;
  const pcm = new Uint8Array(4800).map((_, index) => index % 251);
  const app = await server(config({ ttsVoice: 'cedar' }), async (url, init) => { sent = { url: String(url), auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) }; return new Response(pcm, { status: 200 }); });
  try {
    const response = await app.post('/api/avatar/tts', JSON.stringify({ text: 'Merhaba, nasılsınız?' }));
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-sample-rate'), '24000');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pcm);
    assert.deepEqual({ ...sent!.body, instructions: undefined }, { model: 'gpt-4o-mini-tts', voice: 'cedar', input: 'Merhaba, nasılsınız?', instructions: undefined, response_format: 'pcm' });
    assert.match(String(sent!.body.instructions), /İstanbul Türkçesi/); assert.equal(sent!.url, 'https://api.openai.com/v1/audio/speech'); assert.equal(sent!.auth, `Bearer ${SECRET}`);
  } finally { await app.close(); }
});

test('konuşma tanıma: gpt-transcribe ve Türkçe ile gönderilir; hız sınırı uygulanır', async () => {
  const forms: FormData[] = [];
  const app = await server(config(), async (url, init) => { assert.equal(String(url), 'https://api.openai.com/v1/audio/transcriptions'); forms.push(init?.body as FormData); return Response.json({ text: '  Bugün hava nasıl?  ' }); }, { sttPerMinute: 2 });
  try {
    const audio = new Uint8Array(3000).fill(7);
    const response = await app.post('/api/avatar/stt', audio, 'audio/webm;codecs=opus');
    assert.deepEqual(await response.json(), { text: 'Bugün hava nasıl?' });
    assert.equal(forms[0].get('model'), 'gpt-transcribe'); assert.equal(forms[0].get('language'), 'tr');
    const file = forms[0].get('file') as File; assert.equal(file.name, 'kayit.webm'); assert.equal(file.size, 3000);
    assert.equal((await app.post('/api/avatar/stt', audio, 'audio/webm')).status, 200);
    const limited = await app.post('/api/avatar/stt', audio, 'audio/webm');
    assert.equal(limited.status, 429); assert.equal((await limited.json()).code, 'rate_limit'); assert.equal(forms.length, 2);
  } finally { await app.close(); }
});
