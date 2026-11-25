// Native Gemini avatar output is fragmented MP4 with its audio muxed in.
// Inspect the initialization fragment instead of assuming a codec profile.
export function mp4Info(bytes: Uint8Array) {
  const text = new TextDecoder('latin1').decode(bytes);
  const avc = text.indexOf('avcC');
  if (avc < 0 || avc + 7 >= bytes.length) return null;
  const profile = [bytes[avc + 5], bytes[avc + 6], bytes[avc + 7]].map(value => value!.toString(16).padStart(2, '0')).join('').toUpperCase();
  const audio = text.includes('mp4a') ? ', mp4a.40.2' : text.includes('Opus') || text.includes('opus') ? ', opus' : '';
  let end = 0, offset = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset), type = text.slice(offset + 4, offset + 8);
    if (size < 8 || offset + size > bytes.length) break;
    offset += size; if (type === 'moov') { end = offset; break; }
  }
  if (!end) return null;
  return { mime: `video/mp4; codecs="avc1.${profile}${audio}"`, init: bytes.slice(0, end) };
}

export class GeminiPlayer {
  private video: HTMLVideoElement;
  private onVideo: (visible: boolean) => void;
  private onError: (message: string, recoverable?: boolean) => void;
  private media?: MediaSource;
  private buffer?: SourceBuffer;
  private url?: string;
  private queue: Uint8Array[] = [];
  private queuedBytes = 0;
  private mime?: string;
  private init?: Uint8Array;
  private generation = 0;
  private playPending = false;
  private muted = false;
  /** Sesi kapatır / açar; kapalıyken video kullanıcı etkileşimi olmadan da oynar. */
  setMuted(muted: boolean) { this.muted = muted; this.video.muted = muted; if (!muted) this.resume(); }
  constructor(video: HTMLVideoElement, onVideo: (visible: boolean) => void, onError: (message: string, recoverable?: boolean) => void) {
    this.video = video; this.onVideo = onVideo; this.onError = onError;
    video.onloadeddata = () => { this.onVideo(true); this.resume(); };
    video.onerror = () => this.onError('Gemini video akışı oynatılamadı. Tarayıcı desteğini ve bağlantıyı kontrol edin.');
  }
  append(bytes: Uint8Array) {
    if (this.queuedBytes + bytes.byteLength > 8 * 1024 * 1024) { this.onError('Gemini video kuyruğu doldu. Görüşmeyi yeniden başlatın.'); return; }
    this.queue.push(bytes); this.queuedBytes += bytes.byteLength;
    if (!this.media) {
      const all = new Uint8Array(this.queuedBytes); let offset = 0;
      for (const chunk of this.queue) { all.set(chunk, offset); offset += chunk.length; }
      const info = mp4Info(all);
      if (!info) return;
      this.mime = info.mime; this.init = info.init; this.open();
    }
    this.pump();
  }
  private open() {
    if (!this.mime || !MediaSource.isTypeSupported(this.mime)) { this.onError('Bu tarayıcı Gemini avatarının video/ses biçimini desteklemiyor. Chrome veya Edge ile deneyin.'); return; }
    const generation = this.generation;
    const media = new MediaSource(); this.media = media;
    // srcObject, src'den önceliklidir: öğede başka bir akış kalmışsa MediaSource hiç açılmaz.
    this.url = URL.createObjectURL(media); this.video.srcObject = null; this.video.src = this.url; this.video.muted = this.muted;
    media.addEventListener('sourceopen', () => {
      if (generation !== this.generation) return;
      try {
        const buffer = media.addSourceBuffer(this.mime!); this.buffer = buffer; buffer.mode = 'sequence';
        buffer.onupdateend = () => this.pump();
        buffer.onerror = () => this.onError('Gemini video parçaları okunamadı. Görüşmeyi yeniden başlatın.');
        this.pump();
      } catch { this.onError('Gemini video oynatıcısı başlatılamadı.'); }
    }, { once: true });
  }
  private pump() {
    const buffer = this.buffer;
    if (!buffer || buffer.updating || this.media?.readyState !== 'open') return;
    try {
      // Video duraklamışsa (sohbet kapalıyken tarayıcı görünmeyen videoyu durdurur) oynatma konumu ilerlemez:
      // eski parçalar silinmez, tampon dolar ve açılışta bayat görüntü oynar. Konumu canlı uca taşı.
      if (this.video.paused && buffer.buffered.length) {
        const end = buffer.buffered.end(buffer.buffered.length - 1);
        if (end - this.video.currentTime > 3) this.video.currentTime = end - .3;
      }
      const cut = this.video.currentTime - 15;
      if (cut > 0 && buffer.buffered.length && buffer.buffered.start(0) < cut - 1) { buffer.remove(0, cut); return; }
      const next = this.queue[0];
      if (next) { buffer.appendBuffer(new Uint8Array(next).buffer); this.queue.shift(); this.queuedBytes -= next.length; }
      if (this.video.buffered.length) {
        const start = this.video.buffered.start(0);
        if (this.video.currentTime < start) this.video.currentTime = start;
        this.resume();
      }
    } catch { this.onError('Gemini video tamponu güncellenemedi. Görüşmeyi yeniden başlatın.'); }
  }
  resume() {
    if (!this.video.src || this.playPending || !this.video.paused) return;
    const generation = this.generation; this.playPending = true;
    void this.video.play().catch(error => {
      if (generation === this.generation && !this.muted && (error as Error).name === 'NotAllowedError') this.onError('Gemini sesini açmak için avatar görüntüsüne tıklayın.', true);
    }).finally(() => { if (generation === this.generation) this.playPending = false; });
  }
  remainingSeconds() { const ranges = this.video.buffered; return ranges.length ? Math.max(0, ranges.end(ranges.length - 1) - this.video.currentTime) : 0; }
  flush() {
    const init = this.init, mime = this.mime; this.release(); this.onVideo(false);
    if (init && mime) { this.init = init; this.mime = mime; this.queue = [init]; this.queuedBytes = init.length; this.open(); }
  }
  private release() {
    this.generation++; this.playPending = false;
    if (this.buffer) { this.buffer.onupdateend = null; this.buffer.onerror = null; }
    this.buffer = undefined; this.media = undefined; this.queue = []; this.queuedBytes = 0;
    this.video.pause(); this.video.removeAttribute('src'); this.video.load();
    if (this.url) URL.revokeObjectURL(this.url); this.url = undefined;
  }
  dispose() { this.video.onloadeddata = null; this.video.onerror = null; this.release(); this.init = undefined; this.mime = undefined; this.onVideo(false); }
}
