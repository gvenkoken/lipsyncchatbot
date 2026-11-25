// lipsysnc backend: bütün /api uç noktaları ve Gemini Live WebSocket aktarımı.
// Anahtarlar yalnızca burada, backend/.env.local içinden okunur; web projesi bu sunucuya Vite proxy'si üzerinden ulaşır.
import { createServer } from 'node:http';
import { createRealtimeHandler } from './realtime.ts';
import { createSynthesiaHandler } from './synthesia.ts';
import { createSynthesiaManager } from './synthesia-manager.ts';
import { createGeminiHandler } from './gemini.ts';
import { createAvatarHandler, AVATAR_DEFAULTS } from './avatar.ts';
import { createRag } from './rag.ts';
import { loadEnv } from './env.ts';
import { BACKEND_ROOT, RAG_DOCS, RAG_VECTOR_CACHE } from './paths.ts';

const env = (prefixes: string | string[]) => loadEnv(BACKEND_ROOT, prefixes);
const host = process.env.BACKEND_HOST || '127.0.0.1';
const port = Number(process.env.BACKEND_PORT || 5177);

const realtime = createRealtimeHandler({ getConfig: () => {
  const values = env('OPENAI_');
  return { apiKey: values.OPENAI_API_KEY ?? '', model: values.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1' };
} });
const manager = createSynthesiaManager(BACKEND_ROOT);
const synthesia = createSynthesiaHandler({ ensureWorker: manager.ensureWorker, getConfig: () => {
  const values = env(['SYNTHESIA_', 'LIVEKIT_', 'OPENAI_']);
  return { apiKey: values.SYNTHESIA_API_KEY ?? '', defaultAvatarId: values.SYNTHESIA_AVATAR_DEFAULT_ID ?? '', customAvatarId: values.SYNTHESIA_AVATAR_CUSTOM_ID ?? '',
    livekitUrl: values.LIVEKIT_URL ?? '', livekitApiKey: values.LIVEKIT_API_KEY ?? '', livekitApiSecret: values.LIVEKIT_API_SECRET ?? '',
    openaiApiKey: values.OPENAI_API_KEY ?? '', openaiModel: values.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1' };
} });
// Bilgi tabanı: belgeler çalışma alanı kökündeki rag/ klasöründe; vektörler OpenAI ile üretilip backend/.cache altında saklanır.
const rag = createRag({ root: RAG_DOCS, cacheFile: RAG_VECTOR_CACHE, getApiKey: () => env('OPENAI_').OPENAI_API_KEY ?? '' });
void rag.prepare();
const gemini = createGeminiHandler({ rag, getConfig: () => {
  const values = env(['GOOGLE_', 'GEMINI_']);
  return { project: values.GOOGLE_CLOUD_PROJECT ?? '', location: values.GOOGLE_CLOUD_LOCATION || 'us-central1',
    model: values.GEMINI_LIVE_MODEL || 'gemini-3.8-live', avatar: values.GEMINI_AVATAR_NAME || 'Ben', credentialsFile: values.GOOGLE_APPLICATION_CREDENTIALS ?? '' };
} });
const avatar = createAvatarHandler({ getConfig: () => {
  const values = env('OPENAI_');
  return { openaiApiKey: values.OPENAI_API_KEY ?? '', chatModel: values.OPENAI_CHAT_MODEL || AVATAR_DEFAULTS.chatModel,
    ttsModel: values.OPENAI_TTS_MODEL || AVATAR_DEFAULTS.ttsModel, ttsVoice: values.OPENAI_TTS_VOICE || AVATAR_DEFAULTS.ttsVoice, sttModel: values.OPENAI_STT_MODEL || AVATAR_DEFAULTS.sttModel };
} });

const server = createServer((req, res) => {
  const notFound = () => { if (!res.headersSent) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json; charset=utf-8'); } res.end(JSON.stringify({ error: 'not_found' })); };
  void avatar(req, res, () => gemini.handler(req, res, () => { void synthesia.handler(req, res, () => { void realtime(req, res, notFound); }); }));
});
gemini.attach(server);

let released = false;
const shutdown = () => {
  if (released) return; released = true;
  gemini.dispose(); manager.dispose(); void synthesia.dispose();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

server.listen(port, host, () => console.log(`lipsysnc backend: http://${host}:${port}/api`));
