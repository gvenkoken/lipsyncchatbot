import { fileURLToPath } from 'node:url';
import { AgentServer, ServerOptions, initializeLogger } from '@livekit/agents';

// Credentials and the native RTC runtime stay in this server-side child.
initializeLogger({ pretty: false, level: 'error' });
const worker = new AgentServer(new ServerOptions({
  agent: fileURLToPath(new URL('./synthesia-agent.ts', import.meta.url)),
  agentName: 'pmi-synthesia', production: false, host: '127.0.0.1', port: 0,
  wsURL: process.env.LIVEKIT_URL, apiKey: process.env.LIVEKIT_API_KEY, apiSecret: process.env.LIVEKIT_API_SECRET,
  numIdleProcesses: 0, maxRetry: 1, logLevel: 'error',
  requestFunc: async job => { await job.accept('PMI Assistant', 'pmi-agent'); },
}));
worker.event.on('worker_registered', () => process.send?.({ type: 'ready' }));
let closing = false;
const close = async () => {
  if (closing) return; closing = true;
  const deadline = setTimeout(() => process.exit(0), 6000); deadline.unref();
  await worker.close().catch(() => {}); process.exit(0);
};
process.on('message', message => { if (message?.type === 'stop') void close(); });
process.on('disconnect', () => { void close(); });
process.on('SIGTERM', () => { void close(); });
process.on('SIGINT', () => { void close(); });
worker.run().catch(() => { process.send?.({ type: 'error' }); void close(); });
