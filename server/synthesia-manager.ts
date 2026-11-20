import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { SynthesiaConfig } from './synthesia';

export function createSynthesiaManager(root: string) {
  let child: ChildProcess | undefined, ready: Promise<void> | undefined, signature = '';
  const dispose = () => {
    if (child?.connected) child.send({ type: 'stop' });
    const previous = child;
    const timer = setTimeout(() => { previous?.kill(); }, 7000); timer.unref();
    child?.once('exit', () => clearTimeout(timer));
    child = undefined; ready = undefined; signature = '';
  };
  const ensureWorker = (config: SynthesiaConfig) => {
    const nextSignature = JSON.stringify(config);
    if (ready && signature === nextSignature) return ready;
    if (child) dispose(); signature = nextSignature;
    ready = new Promise<void>((resolve, reject) => {
      const worker = spawn(process.execPath, [join(root, 'server', 'synthesia-worker.mjs')], {
        cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        // OpenAI performs turn detection; do not download/warm an unused local EOT model.
        env: { ...process.env, LIVEKIT_AGENTS_PRELOAD_LOCAL_INFERENCE: '0', SYNTHESIA_API_KEY: config.apiKey, SYNTHESIA_AVATAR_DEFAULT_ID: config.defaultAvatarId,
          SYNTHESIA_AVATAR_CUSTOM_ID: config.customAvatarId, LIVEKIT_URL: config.livekitUrl,
          LIVEKIT_API_KEY: config.livekitApiKey, LIVEKIT_API_SECRET: config.livekitApiSecret,
          OPENAI_API_KEY: config.openaiApiKey, OPENAI_REALTIME_MODEL: config.openaiModel },
      });
      child = worker;
      const timeout = setTimeout(() => { if (child === worker) dispose(); reject(new Error('Worker timeout')); }, 20000);
      worker.on('message', message => {
        if ((message as { type?: string }).type === 'ready') { clearTimeout(timeout); resolve(); }
        else if ((message as { type?: string }).type === 'error') { clearTimeout(timeout); if (child === worker) dispose(); reject(new Error('Worker connection failed')); }
      });
      worker.once('error', () => { clearTimeout(timeout); if (child === worker) { ready = undefined; child = undefined; } reject(new Error('Worker failed')); });
      worker.once('exit', () => { clearTimeout(timeout); if (child === worker) { ready = undefined; child = undefined; } reject(new Error('Worker stopped')); });
    });
    return ready;
  };
  return { ensureWorker, dispose };
}
