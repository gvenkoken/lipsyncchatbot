import { GeminiPlayer } from './gemini-player.ts';
import type { RealtimeMessage, RealtimeState } from './realtime';

export type GeminiStatus = { configured: boolean; missing: string[]; model: string; avatar: string };
export type Source = { id: string; title: string };
type Callbacks = { onSources?: (sources: Source[]) => void;
  onState: (state: RealtimeState) => void; onMode: (mode: 'idle' | 'listening' | 'thinking' | 'speaking') => void;
  onMessage: (message: RealtimeMessage) => void; onVideo: (visible: boolean) => void; onError: (message: string) => void;
  getVideo: () => HTMLVideoElement | null;
};
export class GeminiConversation {
  private callbacks: Callbacks;
  private generation = 0;
  private state: RealtimeState = 'idle';
  private socket?: WebSocket;
  private controller?: AbortController;
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private worklet?: AudioWorkletNode;
  private silent?: GainNode;
  private player?: GeminiPlayer;
  private timeout?: ReturnType<typeof setTimeout>;
  private drain?: ReturnType<typeof setTimeout>;
  private serverReady = false;
  private videoReady = false;
  private suppressed = false;
  private muted = false;
  /** Mikrofonu kapatır / açar: kapalıyken ses sunucuya gönderilmez. */
  setMuted(muted: boolean) { this.muted = muted; if (!muted) void this.context?.resume().catch(() => {}); }
  private outputMuted = false;
  /** Avatarın sesini kapatır / açar. Sohbet kapalıyken oturum açık kalır ama ses duyulmaz. */
  setOutputMuted(muted: boolean) { this.outputMuted = muted; this.player?.setMuted(muted); }
  constructor(callbacks: Callbacks) { this.callbacks = callbacks; }
  private update(state: RealtimeState) { this.state = state; this.callbacks.onState(state); }
  private fail(message: string) { this.stop(); this.callbacks.onError(message); }
  private ready() {
    if (this.state !== 'connecting' || !this.serverReady || !this.videoReady) return;
    clearTimeout(this.timeout); this.update('connected');
  }
  async start(query = '') {
    if (this.state !== 'idle') return;
    const video = this.callbacks.getVideo();
    if (!video || typeof MediaSource === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') { this.callbacks.onError('Bu tarayıcı Gemini canlı avatarını desteklemiyor. Chrome veya Edge ile deneyin.'); return; }
    const generation = ++this.generation, controller = new AbortController(); this.controller = controller;
    this.update('connecting');
    this.timeout = setTimeout(() => { if (generation === this.generation) this.fail('Gemini avatarına bağlanılamadı. Live Avatar erişimini kontrol edin.'); }, 60000);
    try {
      // Unlock audio during the click. Microphone permission follows the configuration check.
      const context = new AudioContext({ sampleRate: 16000 }); this.context = context;
      void context.resume().catch(() => {});
      const response = await fetch('/api/gemini/status', { signal: controller.signal });
      if (!response.ok) throw new Error('Gemini servisine ulaşılamadı.');
      const status = await response.json() as GeminiStatus;
      if (!status.configured) throw new Error('Gemini için Google Cloud projesi ve yerel kimlik doğrulaması henüz yapılandırılmadı.');
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      await context.audioWorklet.addModule('/gemini-pcm-worklet.js');
      if (generation !== this.generation) return;
      this.player = new GeminiPlayer(video, visible => {
        if (generation !== this.generation) return;
        this.videoReady = visible; this.callbacks.onVideo(visible); this.ready();
      }, (message, recoverable) => { if (generation !== this.generation) return; if (recoverable) this.callbacks.onError(message); else this.fail(message); });
      this.player.setMuted(this.outputMuted);
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/gemini/live${query}`); this.socket = socket; socket.binaryType = 'arraybuffer';
      socket.onmessage = event => {
        if (generation !== this.generation) return;
        if (event.data instanceof ArrayBuffer) {
          if (!this.suppressed) { clearTimeout(this.drain); this.callbacks.onMode('speaking'); this.player?.append(new Uint8Array(event.data)); }
          return;
        }
        try {
          const message = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (message.type === 'ready') { this.serverReady = true; this.callbacks.onMode('thinking'); this.ready(); }
          else if (message.type === 'message' && typeof message.id === 'string' && typeof message.text === 'string' && (message.role === 'user' || message.role === 'assistant')) this.callbacks.onMessage({ id: message.id, role: message.role, text: message.text });
          else if (message.type === 'sources' && Array.isArray(message.sources)) this.callbacks.onSources?.((message.sources as { id?: unknown; title?: unknown }[]).filter(item => typeof item?.id === 'string' && typeof item?.title === 'string') as Source[]);
          else if (message.type === 'interrupted') { clearTimeout(this.drain); this.suppressed = false; this.player?.flush(); this.callbacks.onMode('listening'); }
          else if (message.type === 'turn_complete') {
            this.suppressed = false; clearTimeout(this.drain);
            this.drain = setTimeout(() => { if (generation === this.generation) this.callbacks.onMode('listening'); }, Math.min(20000, (this.player?.remainingSeconds() ?? 0) * 1000));
          } else if (message.type === 'mode' && message.mode === 'thinking') this.callbacks.onMode('thinking');
          else if (message.type === 'error' && typeof message.error === 'string') this.fail(message.error);
        } catch { this.fail('Gemini yanıtı okunamadı.'); }
      };
      socket.onerror = () => { if (generation === this.generation) this.fail('Gemini ses/video bağlantısı kurulamadı.'); };
      socket.onclose = () => { if (generation === this.generation) this.fail('Gemini bağlantısı sona erdi. Yeniden başlatabilirsiniz.'); };
      const source = context.createMediaStreamSource(stream); this.source = source;
      const worklet = new AudioWorkletNode(context, 'gemini-pcm'); this.worklet = worklet;
      worklet.port.onmessage = event => {
        if (generation !== this.generation || !this.serverReady || this.muted || socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 256 * 1024) { this.fail('Mikrofon bağlantısı yavaşladı. Yeniden başlatın.'); return; }
        socket.send(event.data as ArrayBuffer);
      };
      const silent = context.createGain(); silent.gain.value = 0; this.silent = silent;
      source.connect(worklet); worklet.connect(silent); silent.connect(context.destination);
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(error instanceof Error && error.name === 'NotAllowedError' ? 'Mikrofon izni verilmedi. Adres çubuğundan mikrofon iznini açabilirsiniz.' : error instanceof Error ? error.message : 'Gemini görüşmesi başlatılamadı.');
    }
  }
  sendText(text: string) {
    if (this.state !== 'connected' || this.socket?.readyState !== WebSocket.OPEN) return undefined;
    const id = `gemini_${crypto.randomUUID()}`;
    this.suppressed = false; this.socket.send(JSON.stringify({ type: 'text', id, text })); this.callbacks.onMode('thinking'); return id;
  }
  interrupt() {
    if (this.state !== 'connected') return;
    // Speech barge-in is handled by Google's VAD. The UI stop control silences the current playout.
    this.suppressed = true; clearTimeout(this.drain); this.player?.flush(); this.callbacks.onMode('listening');
  }
  resumeAudio() { this.player?.resume(); }
  stop() {
    this.generation++; clearTimeout(this.timeout); clearTimeout(this.drain); this.controller?.abort(); this.controller = undefined;
    if (this.socket) { this.socket.onopen = null; this.socket.onclose = null; this.socket.onerror = null; this.socket.onmessage = null; this.socket.close(); this.socket = undefined; }
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    this.source?.disconnect(); this.source = undefined;
    if (this.worklet) { this.worklet.port.onmessage = null; this.worklet.disconnect(); this.worklet = undefined; }
    this.silent?.disconnect(); this.silent = undefined;
    if (this.context) { void this.context.close().catch(() => {}); this.context = undefined; }
    this.player?.dispose(); this.player = undefined;
    this.serverReady = false; this.videoReady = false; this.suppressed = false;
    this.callbacks.onVideo(false); this.update('idle'); this.callbacks.onMode('idle');
  }
}
