import type { LocalAudioTrack, RemoteTrack, Room } from 'livekit-client';
import type { RealtimeMessage, RealtimeState } from './realtime';
import type { AvatarChoice } from './settings';

export type SynthesiaStatus = { configured: boolean; missing: string[]; avatars: Record<AvatarChoice, { configured: boolean }> };
type Callbacks = {
  onState: (state: RealtimeState) => void;
  onMode: (mode: 'idle' | 'listening' | 'thinking' | 'speaking') => void;
  onMessage: (message: RealtimeMessage) => void;
  onVideo: (stream: MediaStream | null) => void;
  /** fatal: yeniden denemek sonucu değiştirmez (ör. hesap kotası tükendi). */
  onError: (message: string, fatal?: boolean) => void;
};
type Sdk = typeof import('livekit-client');
type Session = { sessionId: string; url: string; token: string; avatarIdentity: string; agentIdentity: string };

export class SynthesiaConversation {
  private callbacks: Callbacks;
  private loadSdk: () => Promise<Sdk>;
  private generation = 0;
  private state: RealtimeState = 'idle';
  private room?: Room;
  private mic?: LocalAudioTrack;
  private tracks = new Set<RemoteTrack>();
  private audioElements = new Set<HTMLMediaElement>();
  private sessionId?: string;
  private timeout?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private agentReady = false;
  private videoReady = false;
  private microphoneReady = false;
  private muted = false;
  private outputMuted = false;
  /** Avatarın sesini kapatır / açar. Sohbet kapalıyken oturum açık kalır ama ses duyulmaz. */
  setOutputMuted(muted: boolean) {
    this.outputMuted = muted;
    for (const element of this.audioElements) element.muted = muted;
    if (!muted) this.resumeAudio();
  }
  /** Mikrofonu kapatır / açar. Bağlantı kurulmadan önce çağrılırsa oturum bu durumda başlar. */
  setMuted(muted: boolean) {
    this.muted = muted;
    const mic = this.mic as (LocalAudioTrack & { mute?: () => Promise<unknown>; unmute?: () => Promise<unknown> }) | undefined;
    void (muted ? mic?.mute?.() : mic?.unmute?.())?.catch(() => {});
  }
  constructor(callbacks: Callbacks, loadSdk: () => Promise<Sdk> = () => import('livekit-client')) { this.callbacks = callbacks; this.loadSdk = loadSdk; }
  private update(state: RealtimeState) { this.state = state; this.callbacks.onState(state); }
  private fail(message: string, fatal = false) { this.stop(); this.callbacks.onError(message, fatal); }
  private ready() {
    if (!this.agentReady || !this.videoReady || !this.microphoneReady || this.state !== 'connecting') return;
    clearTimeout(this.timeout); this.update('connected'); this.callbacks.onMode('listening');
  }
  private hangup(sessionId: string) {
    void fetch('/api/synthesia/hangup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }), keepalive: true }).catch(() => {});
  }
  async start(avatar: AvatarChoice) {
    if (this.state !== 'idle') return;
    const generation = ++this.generation;
    const controller = new AbortController(); this.controller = controller;
    this.update('connecting');
    this.timeout = setTimeout(() => { if (generation === this.generation) this.fail('Synthesia avatarına bağlanılamadı. Yeniden deneyebilirsiniz.'); }, 120000);
    try {
      const response = await fetch('/api/synthesia/status', { signal: controller.signal });
      if (!response.ok) throw new Error('Synthesia servisine ulaşılamadı.');
      const status = await response.json() as SynthesiaStatus;
      if (!status.avatars[avatar]?.configured) throw new Error(avatar === 'custom' ? 'Bizim karakter için Synthesia bağlantısı ve Interactive ID henüz yapılandırılmadı.' : 'Synthesia bağlantısı ve hazır avatar henüz yapılandırılmadı.');
      const sdk = await this.loadSdk(); if (generation !== this.generation) return;
      const mic = await sdk.createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      if (generation !== this.generation) { mic.stop(); return; }
      this.mic = mic;
      // Keep this response readable after cancellation so a late room token is always released.
      const sessionResponse = await fetch('/api/synthesia/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar }) });
      if (!sessionResponse.ok) {
        const problem = await sessionResponse.json().catch(() => ({})) as { error?: string };
        throw new Error(problem.error || 'Synthesia bağlantısı kurulamadı.');
      }
      const session = await sessionResponse.json() as Session;
      if (generation !== this.generation) { this.hangup(session.sessionId); return; }
      this.sessionId = session.sessionId;
      const room = new sdk.Room({ adaptiveStream: false, dynacast: false }); this.room = room;
      room.on(sdk.RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (generation !== this.generation || participant.identity !== session.avatarIdentity) return;
        this.tracks.add(track);
        if (track.kind === sdk.Track.Kind.Video) {
          this.videoReady = true; this.callbacks.onVideo(new MediaStream([track.mediaStreamTrack])); this.ready();
        } else if (track.kind === sdk.Track.Kind.Audio) {
          const element = track.attach(); element.style.display = 'none'; element.muted = this.outputMuted; document.body.append(element); this.audioElements.add(element);
          void element.play().catch(() => { if (generation === this.generation && !this.outputMuted) this.callbacks.onError('Sesi açmak için avatar görüntüsüne tıklayın.'); });
        }
      });
      room.on(sdk.RoomEvent.TrackUnsubscribed, track => {
        if (generation === this.generation && this.tracks.has(track)) this.fail('Synthesia görüntü bağlantısı kesildi. Yeniden başlatabilirsiniz.');
      });
      room.on(sdk.RoomEvent.ParticipantDisconnected, participant => {
        if (generation === this.generation && [session.avatarIdentity, session.agentIdentity].includes(participant.identity)) this.fail('Synthesia bağlantısı sona erdi. Yeniden başlatabilirsiniz.');
      });
      room.on(sdk.RoomEvent.Disconnected, () => { if (generation === this.generation) this.fail('Synthesia bağlantısı kesildi. Yeniden başlatabilirsiniz.'); });
      room.on(sdk.RoomEvent.DataReceived, (data, participant, _kind, topic) => {
        if (generation !== this.generation || topic !== 'pmi.synthesia' || participant?.identity !== session.agentIdentity) return;
        try {
          const event = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
          if (event.type === 'ready') { this.agentReady = true; this.ready(); }
          else if (event.type === 'mode' && ['idle', 'listening', 'thinking', 'speaking'].includes(event.mode as string)) this.callbacks.onMode(event.mode as 'idle' | 'listening' | 'thinking' | 'speaking');
          else if (event.type === 'message' && typeof event.id === 'string' && typeof event.text === 'string' && (event.role === 'user' || event.role === 'assistant')) this.callbacks.onMessage({ id: event.id, text: event.text, role: event.role });
          else if (event.type === 'error' && typeof event.error === 'string') this.fail(event.error, ['quota_exceeded', 'feature_not_in_plan', 'auth', 'unknown_avatar'].includes(event.code as string));
        } catch { /* Ignore malformed peer data. */ }
      });
      await room.connect(session.url, session.token);
      if (generation !== this.generation) { await room.disconnect(); return; }
      await room.localParticipant.publishTrack(mic);
      if (generation !== this.generation) { mic.stop(); await room.disconnect(); return; }
      this.setMuted(this.muted);
      this.microphoneReady = true; this.ready();
      void room.startAudio().catch(() => {});
    } catch (error) {
      if (generation !== this.generation) return;
      const name = error instanceof Error ? error.name : '';
      this.fail(['NotAllowedError', 'PermissionDeniedError'].includes(name) ? 'Mikrofon izni verilmedi. Adres çubuğundan mikrofon iznini açabilirsiniz.' : name === 'NotFoundError' ? 'Kullanılabilir bir mikrofon bulunamadı.' : error instanceof Error ? error.message : 'Synthesia başlatılamadı.');
    }
  }
  sendText(text: string) {
    if (this.state !== 'connected' || !this.room) return undefined;
    const id = `synth_${crypto.randomUUID()}`;
    void this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'text', id, text })), { topic: 'pmi.input', reliable: true, destinationIdentities: ['pmi-agent'] }).catch(() => this.callbacks.onError('Mesaj gönderilemedi. Yeniden deneyin.'));
    this.callbacks.onMode('thinking'); return id;
  }
  interrupt() {
    if (this.state !== 'connected' || !this.room) return;
    void this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'interrupt' })), { topic: 'pmi.input', reliable: true, destinationIdentities: ['pmi-agent'] }).catch(() => {});
  }
  resumeAudio() {
    void this.room?.startAudio().catch(() => {});
    for (const element of this.audioElements) void element.play().catch(() => {});
  }
  stop() {
    this.generation++; clearTimeout(this.timeout); this.controller?.abort(); this.controller = undefined;
    this.mic?.stop(); this.mic = undefined;
    if (this.room) { this.room.removeAllListeners(); void this.room.disconnect().catch(() => {}); this.room = undefined; }
    for (const track of this.tracks) { track.detach().forEach(element => element.remove()); track.mediaStreamTrack.stop(); }
    this.tracks.clear();
    for (const element of this.audioElements) { element.pause(); element.srcObject = null; element.remove(); } this.audioElements.clear();
    if (this.sessionId) this.hangup(this.sessionId); this.sessionId = undefined;
    this.agentReady = false; this.videoReady = false; this.microphoneReady = false;
    this.callbacks.onVideo(null); this.update('idle'); this.callbacks.onMode('idle');
  }
}
