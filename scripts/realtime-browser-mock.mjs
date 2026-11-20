// Runs in the browser through Runtime.evaluate. Never contacts OpenAI.
export function installRealtimeMock() {
  window.__streams = []; window.__peers = []; window.__sessionPosts = 0; window.__hangups = 0;
  window.__nativeFetch = window.fetch.bind(window);
  window.__nativeMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  window.__NativePeer = RTCPeerConnection;
  navigator.mediaDevices.getUserMedia = async options => { const stream = await window.__nativeMedia(options); window.__streams.push(stream); return stream; };
  window.fetch = async (input, options) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === '/api/realtime/status') return Response.json({ configured: true });
    if (url === '/api/realtime/session') { window.__sessionPosts++; return new Response('answer', { status: 201, headers: { 'X-PMI-Call-Id': 'rtc_browser_mock' } }); }
    if (url === '/api/realtime/hangup') { window.__hangups++; return new Response(null, { status: 204 }); }
    return window.__nativeFetch(input, options);
  };
  window.RTCPeerConnection = class {
    connectionState = 'new';
    ontrack = null; onconnectionstatechange = null;
    channel = { readyState: 'connecting', onopen: null, onclose: null, onmessage: null, sent: [], send: data => {
      const event = JSON.parse(data); this.channel.sent.push(event);
      if (event.type === 'response.create') {
        this.emit({ type: 'response.created' });
        this.emit({ type: 'response.output_audio_transcript.delta', item_id: 'assistant_reply', delta: 'Merhaba, ' });
        this.emit({ type: 'response.output_audio_transcript.done', item_id: 'assistant_reply', transcript: 'Merhaba, bu bir test yanıtı.' });
        this.emit({ type: 'response.done', response: { status: 'completed' } });
      }
    }, close: () => { this.channel.readyState = 'closed'; } };
    constructor() { window.__peers.push(this); }
    addTrack() {}
    createDataChannel() { return this.channel; }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\nm=audio' }; }
    async setLocalDescription() {}
    async setRemoteDescription() { this.connectionState = 'connected'; this.channel.readyState = 'open'; this.channel.onopen?.(); this.emit({ type: 'session.created' }); }
    getReceivers() { return []; }
    close() { this.connectionState = 'closed'; }
    emit(event) { this.channel.onmessage?.({ data: JSON.stringify(event) }); }
  };
}
