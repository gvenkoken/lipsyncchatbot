import { mouthBetween } from './poses';

// Playback and incoming WebRTC audio use the same twelve mouth poses.
export class AudioLipSync {
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private active?: HTMLMediaElement;
  private streamPlayer?: HTMLAudioElement;
  private node?: AudioNode;
  private raf = 0;
  private generation = 0;
  private onFrame: (frame: number) => void;
  private onState: (speaking: boolean) => void;

  constructor(onFrame: (frame: number) => void, onState: (speaking: boolean) => void) { this.onFrame = onFrame; this.onState = onState; }

  async prepare() {
    this.context ??= new AudioContext();
    if (!this.analyser) { this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.connect(this.context.destination); }
    await this.context.resume();
  }

  async playStream(stream: MediaStream) {
    const previous = this.active;
    this.stop(); previous?.pause();
    const generation = ++this.generation;
    try {
      // Chromium needs a playing media element to pull remote WebRTC audio.
      // Keep that element silent; the analyser graph is the audible output.
      const player = new Audio(); this.streamPlayer = player;
      player.srcObject = stream; player.volume = 0;
      await Promise.all([this.prepare(), player.play()]);
      if (generation !== this.generation) return;
      const source = this.context!.createMediaStreamSource(stream);
      source.connect(this.analyser!); this.node = source;
      const data = new Uint8Array(this.analyser!.fftSize);
      let envelope = 0, last = -1, speaking = false, lastSound = 0;
      const tick = (now: number) => {
        if (generation !== this.generation) return;
        this.analyser!.getByteTimeDomainData(data);
        let power = 0; for (const value of data) power += ((value - 128) / 128) ** 2;
        envelope = envelope * .6 + Math.max(0, Math.sqrt(power / data.length) - .012) * .4;
        const frame = mouthBetween(1, 5, Math.min(1, envelope * 6));
        if (frame !== last) { last = frame; this.onFrame(frame); }
        if (envelope > .006) lastSound = now;
        const next = lastSound > 0 && now - lastSound < 220;
        if (next !== speaking) { speaking = next; this.onState(speaking); }
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    } catch {
      if (generation !== this.generation) return;
      this.stop();
      throw new Error('Yanıt sesi açılamadı. Canlı konuşmayı yeniden başlatın.');
    }
  }

  async play(element: HTMLMediaElement) {
    const previous = this.active;
    this.stop(); previous?.pause();
    const generation = ++this.generation;
    this.active = element;
    try {
      await this.prepare();
      if (generation !== this.generation || element.paused) return;
      let source = this.sources.get(element);
      if (!source) { source = this.context!.createMediaElementSource(element); this.sources.set(element, source); }
      source.connect(this.analyser!); this.node = source;
      const data = new Uint8Array(this.analyser!.fftSize);
      let envelope = 0, last = -1;
      this.onState(true);
      const tick = () => {
        if (generation !== this.generation) return;
        this.analyser!.getByteTimeDomainData(data);
        let power = 0; for (const value of data) power += ((value - 128) / 128) ** 2;
        const amplitude = Math.sqrt(power / data.length);
        envelope = envelope * .6 + Math.max(0, amplitude - .012) * .4;
        const frame = mouthBetween(1, 5, Math.min(1, envelope * 6));
        if (frame !== last) { last = frame; this.onFrame(frame); }
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Native playback remains available when Web Audio analysis is unavailable.
      if (generation === this.generation) this.stop();
    }
  }

  stop(element?: HTMLMediaElement) {
    if (element && element !== this.active) return;
    this.generation++; cancelAnimationFrame(this.raf); this.node?.disconnect(); this.node = undefined;
    if (this.streamPlayer) { this.streamPlayer.pause(); this.streamPlayer.srcObject = null; this.streamPlayer = undefined; }
    this.active = undefined; this.onFrame(1); this.onState(false);
  }

  dispose() { this.stop(); void this.context?.close(); this.context = undefined; this.analyser = undefined; this.sources = new WeakMap(); }
}
