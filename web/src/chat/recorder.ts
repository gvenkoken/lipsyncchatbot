export type RecordingState = 'idle' | 'requesting' | 'recording' | 'stopping';
export type Recording = { file: File; durationMs: number };
type RecorderCallbacks = {
  onState: (state: RecordingState) => void;
  onReady: (recording: Recording) => void;
  onError: (message: string) => void;
};

const formats = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

export class LocalRecorder {
  private generation = 0;
  private state: RecordingState = 'idle';
  private stream?: MediaStream;
  private recorder?: MediaRecorder;

  private callbacks: RecorderCallbacks;
  constructor(callbacks: RecorderCallbacks) { this.callbacks = callbacks; }

  private update(state: RecordingState) { this.state = state; this.callbacks.onState(state); }

  async start() {
    if (this.state !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.callbacks.onError('Bu tarayıcı ses kaydını desteklemiyor. Chrome veya Edge ile deneyin.');
      return;
    }
    const generation = ++this.generation;
    this.update('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const mimeType = formats.find(format => MediaRecorder.isTypeSupported(format));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.recorder = recorder;
      const chunks: Blob[] = [];
      let started = 0;
      recorder.ondataavailable = event => { if (event.data.size && generation === this.generation) chunks.push(event.data); };
      recorder.onerror = () => {
        if (generation !== this.generation) return;
        this.cancel(); this.callbacks.onError('Ses kaydı tamamlanamadı. Yeniden deneyin.');
      };
      recorder.onstop = () => {
        if (generation !== this.generation) return;
        const durationMs = Math.max(0, performance.now() - started);
        stream.getTracks().forEach(track => track.stop());
        this.stream = undefined; this.recorder = undefined; this.update('idle');
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (!blob.size) { this.callbacks.onError('Kayıtta ses verisi oluşmadı. Yeniden deneyin.'); return; }
        const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `pmi-kayit-${Date.now()}.${extension}`, { type: blob.type });
        this.callbacks.onReady({ file, durationMs });
      };
      recorder.start(250); started = performance.now(); this.update('recording');
    } catch (error) {
      if (generation !== this.generation) return;
      this.cancel();
      const denied = error instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
      const missing = error instanceof DOMException && error.name === 'NotFoundError';
      this.callbacks.onError(denied ? 'Mikrofon izni verilmedi. Adres çubuğundan mikrofon iznini açabilirsiniz.' : missing ? 'Kullanılabilir bir mikrofon bulunamadı.' : 'Mikrofon açılamadı. Mikrofon bağlantısını kontrol edin.');
    }
  }

  stop() {
    if (this.state === 'requesting') { this.cancel(); return; }
    if (this.recorder?.state === 'recording') { this.update('stopping'); this.recorder.stop(); }
  }

  cancel() {
    this.generation++;
    if (this.recorder) {
      this.recorder.onstop = null; this.recorder.ondataavailable = null; this.recorder.onerror = null;
      if (this.recorder.state !== 'inactive') this.recorder.stop();
      this.recorder = undefined;
    }
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    this.update('idle');
  }
}
