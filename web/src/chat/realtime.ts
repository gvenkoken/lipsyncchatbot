export type RealtimeState = 'idle' | 'connecting' | 'connected';
export type RealtimeMessage = { id: string; role: 'user' | 'assistant'; text: string; append?: boolean };
type Callbacks = {
  onState: (state: RealtimeState) => void;
  onMode: (mode: 'idle' | 'listening' | 'thinking' | 'speaking') => void;
  onMessage: (message: RealtimeMessage) => void;
  onAudio: (stream: MediaStream | null) => void;
  onError: (message: string) => void;
};

export class RealtimeConversation {
  private callbacks: Callbacks;
  private generation = 0;
  private state: RealtimeState = 'idle';
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private stream?: MediaStream;
  private controller?: AbortController;
  private timeout?: ReturnType<typeof setTimeout>;
  private disconnectTimeout?: ReturnType<typeof setTimeout>;
  private callId?: string;
  private sessionReady = false;
  private responding = false;
  private playing = false;
  constructor(callbacks: Callbacks) { this.callbacks = callbacks; }

  private update(state: RealtimeState) { this.state = state; this.callbacks.onState(state); }
  private fail(message: string) { this.stop(); this.callbacks.onError(message); }
  private ready() {
    if (!this.sessionReady || this.channel?.readyState !== 'open' || this.state !== 'connecting') return;
    clearTimeout(this.timeout); this.update('connected'); this.callbacks.onMode('listening');
  }
  private send(event: object) { if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(event)); }
  private hangup(callId: string) {
    void fetch('/api/realtime/hangup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callId }), keepalive: true }).catch(() => {});
  }

  async start() {
    if (this.state !== 'idle') return;
    if (typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices?.getUserMedia) { this.callbacks.onError('Bu tarayıcı canlı konuşmayı desteklemiyor. Chrome veya Edge ile deneyin.'); return; }
    const generation = ++this.generation;
    const controller = new AbortController(); this.controller = controller;
    this.update('connecting');
    this.timeout = setTimeout(() => { if (generation === this.generation) this.fail('Canlı bağlantı zaman aşımına uğradı. Yeniden deneyin.'); }, 30000);
    try {
      const statusResponse = await fetch('/api/realtime/status', { signal: controller.signal });
      if (!statusResponse.ok) throw new Error('Canlı konuşma servisine ulaşılamadı.');
      const status = await statusResponse.json() as { configured?: boolean };
      if (!status.configured) throw new Error('Canlı konuşma henüz yapılandırılmadı.');
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const peer = new RTCPeerConnection(); this.peer = peer;
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      peer.ontrack = event => {
        if (generation !== this.generation) return;
        this.callbacks.onAudio(event.streams[0] ?? new MediaStream([event.track]));
      };
      peer.onconnectionstatechange = () => {
        if (generation !== this.generation) return;
        clearTimeout(this.disconnectTimeout);
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') this.fail('Canlı bağlantı kesildi. Yeniden başlatabilirsiniz.');
        else if (peer.connectionState === 'disconnected') this.disconnectTimeout = setTimeout(() => { if (generation === this.generation) this.fail('Canlı bağlantı kesildi. Yeniden başlatabilirsiniz.'); }, 8000);
      };
      const channel = peer.createDataChannel('oai-events'); this.channel = channel;
      channel.onopen = () => { if (generation === this.generation) this.ready(); };
      channel.onclose = () => { if (generation === this.generation) this.fail('Canlı bağlantı sona erdi. Yeniden başlatabilirsiniz.'); };
      channel.onmessage = event => { if (generation === this.generation) this.event(event.data); };
      const offer = await peer.createOffer();
      if (generation !== this.generation) return;
      await peer.setLocalDescription(offer);
      const response = await fetch('/api/realtime/session', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp, signal: controller.signal });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(problem.error || 'OpenAI bağlantısı kurulamadı.');
      }
      const callId = response.headers.get('X-PMI-Call-Id') ?? undefined;
      if (generation !== this.generation) { if (callId) this.hangup(callId); return; }
      this.callId = callId;
      const sdp = await response.text();
      if (generation !== this.generation) return;
      await peer.setRemoteDescription({ type: 'answer', sdp });
    } catch (error) {
      if (generation !== this.generation) return;
      const denied = error instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
      this.fail(denied ? 'Mikrofon izni verilmedi. Adres çubuğundan mikrofon iznini açabilirsiniz.' : error instanceof DOMException && error.name === 'NotFoundError' ? 'Kullanılabilir bir mikrofon bulunamadı.' : error instanceof Error ? error.message : 'Canlı konuşma başlatılamadı.');
    }
  }

  private event(raw: string) {
    let event: Record<string, unknown>;
    try { event = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    const type = event.type;
    if (type === 'session.created' || type === 'session.updated') { this.sessionReady = true; this.ready(); }
    else if (type === 'input_audio_buffer.speech_started') this.callbacks.onMode('listening');
    else if (type === 'input_audio_buffer.speech_stopped' || type === 'response.created') { if (type === 'response.created') this.responding = true; this.callbacks.onMode('thinking'); }
    else if (type === 'output_audio_buffer.started') { this.playing = true; this.callbacks.onMode('speaking'); }
    else if (type === 'output_audio_buffer.stopped' || type === 'output_audio_buffer.cleared') { this.playing = false; this.callbacks.onMode('listening'); }
    else if (type === 'conversation.item.input_audio_transcription.completed' && typeof event.transcript === 'string' && typeof event.item_id === 'string') this.callbacks.onMessage({ id: event.item_id, role: 'user', text: event.transcript });
    else if (['response.output_audio_transcript.delta', 'response.output_text.delta'].includes(String(type)) && typeof event.delta === 'string' && typeof event.item_id === 'string') this.callbacks.onMessage({ id: event.item_id, role: 'assistant', text: event.delta, append: true });
    else if (['response.output_audio_transcript.done', 'response.output_text.done'].includes(String(type)) && typeof event.item_id === 'string') {
      const text = event.transcript ?? event.text;
      if (typeof text === 'string') this.callbacks.onMessage({ id: event.item_id, role: 'assistant', text });
    } else if (type === 'response.done') {
      this.responding = false;
      if (!this.playing) this.callbacks.onMode('listening');
      const response = event.response as { status?: string } | undefined;
      if (response?.status === 'failed') this.callbacks.onError('OpenAI yanıtı tamamlanamadı. Kullanım limitinizi kontrol edip yeniden deneyin.');
    } else if (type === 'error') {
      const error = event.error as { code?: string } | undefined;
      if (error?.code === 'response_cancel_not_active') return;
      this.callbacks.onError('OpenAI isteği tamamlanamadı. Yeniden deneyin.');
    }
  }

  sendText(text: string) {
    if (this.state !== 'connected' || this.channel?.readyState !== 'open') return undefined;
    this.interrupt();
    const id = `item_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
    this.send({ type: 'conversation.item.create', item: { id, type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    this.send({ type: 'response.create' }); this.callbacks.onMode('thinking');
    return id;
  }
  mute(muted: boolean) { this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted; }); }
  interrupt() {
    if (this.responding) this.send({ type: 'response.cancel' });
    if (this.playing) this.send({ type: 'output_audio_buffer.clear' });
    this.responding = false; this.playing = false;
    if (this.state === 'connected') this.callbacks.onMode('listening');
  }
  stop() {
    this.generation++; clearTimeout(this.timeout); clearTimeout(this.disconnectTimeout);
    this.controller?.abort(); this.controller = undefined;
    if (this.channel) { this.channel.onmessage = null; this.channel.onopen = null; this.channel.onclose = null; this.channel.close(); this.channel = undefined; }
    if (this.peer) { this.peer.ontrack = null; this.peer.onconnectionstatechange = null; this.peer.getReceivers().forEach(receiver => receiver.track?.stop()); this.peer.close(); this.peer = undefined; }
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    if (this.callId) this.hangup(this.callId); this.callId = undefined;
    this.sessionReady = false; this.responding = false; this.playing = false;
    this.update('idle'); this.callbacks.onAudio(null); this.callbacks.onMode('idle');
  }
}
