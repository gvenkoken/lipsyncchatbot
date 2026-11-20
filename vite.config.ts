import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createRealtimeHandler } from './server/realtime';
import { createSynthesiaHandler } from './server/synthesia';
import { createSynthesiaManager } from './server/synthesia-manager';
import { createGeminiHandler } from './server/gemini';
import { createAvatarHandler, AVATAR_DEFAULTS } from './server/avatar';
import { createRag } from './server/rag';
import { join } from 'node:path';

export default defineConfig(({ mode }) => {
  const handler = createRealtimeHandler({ getConfig: () => {
    // Read only on the server; never use a VITE_ prefix for the API key.
    const env = loadEnv(mode, process.cwd(), 'OPENAI_');
    return { apiKey: env.OPENAI_API_KEY ?? '', model: env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1' };
  } });
  const manager = createSynthesiaManager(process.cwd());
  const synthesia = createSynthesiaHandler({ ensureWorker: manager.ensureWorker, getConfig: () => {
    const env = loadEnv(mode, process.cwd(), ['SYNTHESIA_', 'LIVEKIT_', 'OPENAI_']);
    return { apiKey: env.SYNTHESIA_API_KEY ?? '', defaultAvatarId: env.SYNTHESIA_AVATAR_DEFAULT_ID ?? '', customAvatarId: env.SYNTHESIA_AVATAR_CUSTOM_ID ?? '',
      livekitUrl: env.LIVEKIT_URL ?? '', livekitApiKey: env.LIVEKIT_API_KEY ?? '', livekitApiSecret: env.LIVEKIT_API_SECRET ?? '',
      openaiApiKey: env.OPENAI_API_KEY ?? '', openaiModel: env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1' };
  } });
  // Bilgi tabanı: belgeler sunucuda kalır; vektörler OpenAI ile üretilip artifacts altında önbelleğe alınır.
  const rag = createRag({ root: join(process.cwd(), 'pmi-rag-dummy'), cacheFile: join(process.cwd(), 'artifacts', 'rag-vectors.json'), getApiKey: () => loadEnv(mode, process.cwd(), 'OPENAI_').OPENAI_API_KEY ?? '' });
  void rag.prepare();
  const gemini = createGeminiHandler({ rag, getConfig: () => {
    const env = loadEnv(mode, process.cwd(), ['GOOGLE_', 'GEMINI_']);
    return { project: env.GOOGLE_CLOUD_PROJECT ?? '', location: env.GOOGLE_CLOUD_LOCATION || 'us-central1',
      model: env.GEMINI_LIVE_MODEL || 'gemini-3.8-live', avatar: env.GEMINI_AVATAR_NAME || 'Ben', credentialsFile: env.GOOGLE_APPLICATION_CREDENTIALS ?? '' };
  } });
  const avatar = createAvatarHandler({ getConfig: () => {
    // Sunucuda okunur; hiçbir anahtar VITE_ önekiyle tanımlanmaz.
    const env = loadEnv(mode, process.cwd(), 'OPENAI_');
    return { openaiApiKey: env.OPENAI_API_KEY ?? '', chatModel: env.OPENAI_CHAT_MODEL || AVATAR_DEFAULTS.chatModel,
      ttsModel: env.OPENAI_TTS_MODEL || AVATAR_DEFAULTS.ttsModel, ttsVoice: env.OPENAI_TTS_VOICE || AVATAR_DEFAULTS.ttsVoice, sttModel: env.OPENAI_STT_MODEL || AVATAR_DEFAULTS.sttModel };
  } });
  let released = false;
  const release = () => { if (released) return; released = true; gemini.dispose(); manager.dispose(); void synthesia.dispose(); };
  const realtime: Plugin = {
    name: 'pmi-realtime-local-relay',
    configureServer(server) {
      server.middlewares.use((req, res, next) => { void avatar(req, res, () => gemini.handler(req, res, () => { void synthesia.handler(req, res, () => { void handler(req, res, next); }); })); });
      if (server.httpServer) gemini.attach(server.httpServer);
      server.httpServer?.once('close', release);
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => { void avatar(req, res, () => gemini.handler(req, res, () => { void synthesia.handler(req, res, () => { void handler(req, res, next); }); })); });
      gemini.attach(server.httpServer);
      server.httpServer.once('close', release);
    },
    closeBundle: release,
  };
  return { plugins: [react(), realtime], server: { watch: { ignored: ['**/artifacts/**'] } } };
});
