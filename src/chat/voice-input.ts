// Mikrofon: bas-konuş ve basit VAD ile otomatik bitiş. Kayıt webm/opus olarak döner.
export type VoiceState = 'idle' | 'requesting' | 'recording' | 'processing';
type Callbacks = { onState: (state: VoiceState) => void; onAudio: (audio: Blob) => void; onError: (message: string) => void };

const FORMATS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
export const VAD = { startLevel: .018, endSilenceMs: 1100, noSpeechMs: 6000, maxMs: 25000, minSpeechMs: 250 };

/** Saf VAD durumu: her ölçümde RMS verilir; 'stop' dönünce kayıt bitirilir. */
export class VadTracker {
  private speechMs = 0; private silenceMs = 0; private heard = false; private elapsed = 0;
  update(rms: number, deltaMs: number): 'continue' | 'stop' | 'empty' {
    this.elapsed += deltaMs;
    if (rms >= VAD.startLevel) { this.speechMs += deltaMs; this.silenceMs = 0; if (this.speechMs >= VAD.minSpeechMs) this.heard = true; }
    else { this.silenceMs += deltaMs; if (!this.heard && this.silenceMs > 300) this.speechMs = 0; }
    if (!this.heard && this.elapsed >= VAD.noSpeechMs) return 'empty';
    if (this.elapsed >= VAD.maxMs) return 'stop';
    return this.heard && this.silenceMs >= VAD.endSilenceMs ? 'stop' : 'continue';
  }
  get spoke() { return this.heard; }
}

export class VoiceInput {
  private callbacks: Callbacks;
  private generation = 0;
  private state: VoiceState = 'idle';
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private raf = 0;
  private source?: MediaStreamAudioSourceNode;
  /** Bas-konuş sırasında (düğme basılıyken) VAD otomatik bitirmez. */
  holding = false;
  constructor(callbacks: Callbacks) { this.callbacks = callbacks; }
  private update(state: VoiceState) { this.state = state; this.callbacks.onState(state); }
  get current() { return this.state; }

  async start(context?: AudioContext) {
    if (this.state !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { this.callbacks.onError('Bu tarayıcı ses kaydını desteklemiyor.'); return; }
    const generation = ++this.generation;
    this.update('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const mimeType = FORMATS.find(format => MediaRecorder.isTypeSupported(format));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined); this.recorder = recorder;
      const chunks: Blob[] = [], tracker = new VadTracker();
      recorder.ondataavailable = event => { if (event.data.size && generation === this.generation) chunks.push(event.data); };
      recorder.onstop = () => {
        if (generation !== this.generation) return;
        this.release();
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (!blob.size || (context && !tracker.spoke)) { this.update('idle'); if (!tracker.spoke) this.callbacks.onError('Ses algılanmadı. Mikrofona yakın konuşup yeniden deneyin.'); return; }
        this.update('processing'); this.callbacks.onAudio(blob);
      };
      recorder.start(250); this.update('recording');
      if (context) { // VAD: analiz için AudioContext gerekir; yoksa yalnızca elle bitirilir
        const analyser = context.createAnalyser(); analyser.fftSize = 1024;
        this.source = context.createMediaStreamSource(stream); this.source.connect(analyser);
        const data = new Float32Array(analyser.fftSize); let last = performance.now();
        const tick = (now: number) => {
          if (generation !== this.generation || recorder.state !== 'recording') return;
          analyser.getFloatTimeDomainData(data);
          let sum = 0; for (const value of data) sum += value * value;
          const verdict = tracker.update(Math.sqrt(sum / data.length), now - last); last = now;
          if (verdict !== 'continue' && !this.holding) { recorder.stop(); return; }
          this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.cancel();
      const name = error instanceof DOMException ? error.name : '';
      this.callbacks.onError(['NotAllowedError', 'PermissionDeniedError'].includes(name) ? 'Mikrofon izni verilmedi. Adres çubuğundan mikrofon iznini açabilirsiniz.' : name === 'NotFoundError' ? 'Kullanılabilir bir mikrofon bulunamadı.' : 'Mikrofon açılamadı.');
    }
  }

  /** Kaydı bitirip sesi gönderir. */
  stop() { if (this.state === 'requesting') this.cancel(); else if (this.recorder?.state === 'recording') this.recorder.stop(); }
  /** İşlem bitti (yazıya çevrildi ya da hata). */
  done() { if (this.state === 'processing') this.update('idle'); }
  private release() { cancelAnimationFrame(this.raf); this.source?.disconnect(); this.source = undefined; this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined; this.recorder = undefined; }
  cancel() {
    this.generation++;
    if (this.recorder) { this.recorder.onstop = null; this.recorder.ondataavailable = null; if (this.recorder.state !== 'inactive') this.recorder.stop(); }
    this.release(); this.holding = false;
    if (this.state !== 'idle') this.update('idle');
  }
}
