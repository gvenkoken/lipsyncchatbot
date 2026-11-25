// Bağımlılıksız canvas oynatıcısı: taban -> ağız parçası -> göz. Senkron AudioContext saatine kilitlidir.
import { buildTrack, levelAt, loudnessEnvelope, sampleTrack, type Cue, type Timing, type Viseme } from './visemes.ts';

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';
type Sprite = { dest: number[]; dest1: number[]; rect: Record<string, number[]> };
export type RigManifest = {
  version: number; logical: { width: number; height: number };
  atlases: Record<string, { file: string; width: number; height: number }>;
  sprites: Record<string, Sprite>; base: string; visemes: Record<string, string[]>; blink: string[]; blink_fps: number;
  anchors: { pivot: number[]; mouth: number[]; eyes: number[] };
};
type Segment = { source: AudioBufferSourceNode; start: number; end: number; track: Cue[]; envelope: { values: Float32Array; hop: number }; done: () => void };

export const RIG_PATH = '/viseme-rig/';
const OVERSCAN = 1.03;        // baş hareketinde kenar boşluğu görünmesin
const BLINK_SPEED = 1.35;     // kaynak 25 fps; biraz hızlı oynat
const noise = (t: number, a: number, b: number, c: number) => Math.sin(t * .83 + a) * .5 + Math.sin(t * .31 + b) * .35 + Math.sin(t * 1.9 + c) * .15;

export class AvatarPlayer {
  static async load(path = RIG_PATH, pixelRatio = globalThis.devicePixelRatio || 1, displaySize = 300) {
    const response = await fetch(path + 'manifest.json');
    if (!response.ok) throw new Error('Avatar varlıkları bulunamadı.');
    const manifest = await response.json() as RigManifest;
    // Yüksek DPI'da 2x atlas; 1x ekranda küçük dosya yeterli.
    const scale = pixelRatio * displaySize > manifest.logical.width * 1.25 && manifest.atlases['2'] ? '2' : '1';
    const atlas = new Image(); atlas.src = path + manifest.atlases[scale].file; await atlas.decode();
    return new AvatarPlayer(manifest, atlas, scale);
  }

  readonly manifest: RigManifest;
  readonly scale: string;
  private atlas: CanvasImageSource;
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;
  private context?: AudioContext;
  private segments: Segment[] = [];
  private raf = 0;
  private baseState: Exclude<AvatarState, 'speaking'> = 'idle';
  private current: AvatarState = 'idle';
  private nextBlink = 0; private blinkStart = -1;
  private amplitude = 0; private level = 0; private tilt = 0;
  private phases = Array.from({ length: 9 }, () => Math.random() * 6.283);
  private reduced = false;
  private lastViseme = '';
  /** Durum değişince çağrılır (speaking dahil). */
  onState?: (state: AvatarState) => void;
  /** Her sözcede ağız ilk kez hareket ettiğinde (performance.now) çağrılır – gecikme ölçümü için. */
  onMouthStart?: (at: number) => void;
  private mouthPending = false;

  constructor(manifest: RigManifest, atlas: CanvasImageSource, scale: string) { this.manifest = manifest; this.atlas = atlas; this.scale = scale; }

  /** İlk kullanıcı etkileşiminde çağırın: tarayıcı ses politikası. */
  async prepareAudio() {
    this.context ??= new AudioContext({ latencyHint: 'interactive' });
    if (this.context.state !== 'running') await this.context.resume();
    return this.context;
  }
  get audio() { return this.context; }

  attach(canvas: HTMLCanvasElement) {
    this.detach();
    this.canvas = canvas; this.ctx = canvas.getContext('2d') ?? undefined;
    const query = matchMedia('(prefers-reduced-motion: reduce)'); this.reduced = query.matches;
    const resize = () => {
      const size = Math.max(1, Math.round(canvas.clientWidth * (globalThis.devicePixelRatio || 1)));
      if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    const visibility = () => { cancelAnimationFrame(this.raf); if (!document.hidden) this.raf = requestAnimationFrame(this.frame); };
    const motion = () => { this.reduced = query.matches; };
    document.addEventListener('visibilitychange', visibility); query.addEventListener('change', motion);
    this.cleanup = () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); query.removeEventListener('change', motion); };
    this.nextBlink = performance.now() + 1500;
    this.raf = requestAnimationFrame(this.frame);
  }
  private cleanup?: () => void;
  detach() { cancelAnimationFrame(this.raf); this.cleanup?.(); this.cleanup = undefined; this.canvas = undefined; this.ctx = undefined; }

  setState(state: Exclude<AvatarState, 'speaking'>) { this.baseState = state; }
  get state() { return this.current; }
  get speaking() { return this.segments.length > 0; }

  /** Sesi çalar ve ağzı zamanlamaya göre oynatır. Çalan bir ses varsa arkasına boşluksuz eklenir. Bitince çözülür.
   *  onStart: bu sesin duyulmaya başladığı anda çağrılır (metni sesle eşzamanlı göstermek için). */
  async play(buffer: AudioBuffer, timings: Timing[], onStart?: () => void): Promise<void> {
    const context = await this.prepareAudio();
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    const tail = this.segments.at(-1)?.end ?? 0;
    const start = Math.max(context.currentTime + .03, tail);
    const envelope = loudnessEnvelope(buffer.getChannelData(0), buffer.sampleRate);
    return new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const segment: Segment = { source, start, end: start + buffer.duration, track: buildTrack(timings), envelope, done: () => { clearTimeout(timer); resolve(); } };
      source.onended = () => { this.segments = this.segments.filter(item => item !== segment); resolve(); };
      if (!this.segments.length) this.mouthPending = true;
      this.segments.push(segment);
      source.start(start);
      if (onStart) timer = setTimeout(onStart, Math.max(0, (start - context.currentTime) * 1000));
    });
  }

  /** Söz kesme: çalan ve kuyruktaki her şeyi durdurur. */
  stop() {
    const pending = this.segments; this.segments = []; this.mouthPending = false;
    for (const segment of pending) { segment.source.onended = null; try { segment.source.stop(); } catch { /* henüz başlamamış olabilir */ } segment.source.disconnect(); segment.done(); }
  }

  dispose() { this.stop(); this.detach(); void this.context?.close(); this.context = undefined; }

  private draw(name: string, alpha: number) {
    const sprite = this.manifest.sprites[name]; if (!sprite || alpha <= 0) return;
    const [sx, sy, sw, sh] = sprite.rect[this.scale], [dx, dy, dw, dh] = this.scale === '1' ? sprite.dest1 : sprite.dest;
    this.ctx!.globalAlpha = Math.min(1, alpha);
    this.ctx!.drawImage(this.atlas, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const ctx = this.ctx, canvas = this.canvas; if (!ctx || !canvas) return;
    const seconds = now / 1000, logical = this.manifest.logical.width;
    // --- ses saati: duyulan an = currentTime - çıkış gecikmesi ---
    let layers = [{ viseme: 'SIL' as Viseme, variant: 0, weight: 1 }], level = 0, active = false;
    if (this.context && this.segments.length) {
      const heard = this.context.currentTime - Math.min(.25, (this.context.outputLatency || this.context.baseLatency || 0));
      const segment = this.segments.find(item => heard < item.end) ?? this.segments.at(-1)!;
      const local = heard - segment.start;
      active = true;
      if (local >= -.1) { level = levelAt(segment.envelope, local); layers = sampleTrack(segment.track, local, level); }
    }
    const state: AvatarState = active ? 'speaking' : this.baseState;
    if (state !== this.current) { this.current = state; canvas.dataset.state = state; this.onState?.(state); }
    const top = layers[0];
    if (top.viseme !== this.lastViseme) {
      this.lastViseme = top.viseme; canvas.dataset.viseme = top.viseme;
      if (this.mouthPending && top.viseme !== 'SIL') { this.mouthPending = false; this.onMouthStart?.(performance.now()); }
    }
    // --- canlılık: hafif baş hareketi (konuşurken artar) ---
    const target = this.reduced ? 0 : state === 'speaking' ? 1 : state === 'listening' ? .35 : state === 'thinking' ? .3 : .45;
    this.amplitude += (target - this.amplitude) * .04; this.level += (level - this.level) * .12;
    this.tilt += ((state === 'thinking' && !this.reduced ? 1 : 0) - this.tilt) * .05;
    const [p0, p1, p2, p3, p4, p5, p6, p7, p8] = this.phases, a = this.amplitude;
    const dx = noise(seconds, p0, p1, p2) * 1.6 * a, dy = noise(seconds * 1.13, p3, p4, p5) * 1.2 * a + this.level * .9 * a;
    const rotation = (noise(seconds * .9, p6, p7, p8) * .5 * a + this.tilt * 1.1) * Math.PI / 180;
    const zoom = OVERSCAN + (state === 'listening' && !this.reduced ? .012 : 0);
    const k = canvas.width / logical, [px, py] = this.manifest.anchors.pivot;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    // Öteleme + boyun çevresinde dönme + üst-orta çevresinde hafif büyütme (alt kenarda boşluk açılmasın).
    ctx.translate(px + dx, py + dy); ctx.rotate(rotation); ctx.translate(-px, -py);
    ctx.translate(logical / 2, logical * .375); ctx.scale(zoom, zoom); ctx.translate(-logical / 2, -logical * .375);
    ctx.imageSmoothingQuality = 'high';
    this.draw(this.manifest.base, 1);
    // Ağız: ağırlıklı karışım. Taban = SIL (ağız kapalı); sırayla w_k / kümülatif alfa ile çizilir.
    let cumulative = 0;
    for (const layer of [...layers].sort((x, y) => (x.viseme === 'SIL' ? -1 : 0) - (y.viseme === 'SIL' ? -1 : 0))) {
      cumulative += layer.weight;
      if (layer.viseme === 'SIL') continue;
      const names = this.manifest.visemes[layer.viseme] ?? [];
      if (names.length) this.draw(names[layer.variant % names.length], layer.weight / cumulative);
    }
    // Göz: 2–6 saniyede bir rastgele kırpma.
    if (!this.reduced) {
      if (this.blinkStart < 0 && now >= this.nextBlink) this.blinkStart = now;
      if (this.blinkStart >= 0) {
        const frames = this.manifest.blink, position = (now - this.blinkStart) / 1000 * this.manifest.blink_fps * BLINK_SPEED, index = Math.floor(position);
        if (index >= frames.length) { this.blinkStart = -1; this.nextBlink = now + 2000 + Math.random() * 4000; }
        else this.draw(frames[index], index === 0 ? position : index === frames.length - 1 ? 1 - (position - index) : 1);
      }
    }
    ctx.globalAlpha = 1;
  };
}
