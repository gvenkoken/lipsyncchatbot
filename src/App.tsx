import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CircleUserRound, LoaderCircle, MessageCircle, Mic, MicOff, SendHorizontal, Square, MessageSquareText, Volume2, VolumeX, X } from 'lucide-react';
import Avatar, { type AvatarMode } from './avatar/Avatar';
import { SpeechDriver } from './avatar/speech';
import { AudioLipSync } from './avatar/audio';
import { loadSettings, saveSettings, type Settings } from './chat/settings';
import { RealtimeConversation, type RealtimeState } from './chat/realtime';
import { SynthesiaConversation } from './chat/synthesia';
import { GeminiConversation } from './chat/gemini';
import VideoAvatar from './video-avatar/VideoAvatar';
import FlowBoard, { loadChoiceState } from './flow/FlowBoard';
import ProfileMenu from './chat/ProfileMenu';
import { loadProfile, profileQuery, saveProfile, type Profile } from './chat/profile';
import type { Source as KnowledgeSource } from './chat/gemini';
import { chatReady } from './flow/flow';
import type { AvatarPlayer } from './video-avatar/player';
import { AvatarConversation, type AssistantStatus } from './chat/assistant';
import { VoiceInput, type VoiceState } from './chat/voice-input';

type Message = { id: number; text: string; role?: 'user' | 'assistant'; liveId?: string };
// Canlı bağlantı kaynakları: her birinin kendi bağlantı durumu, avatar durumu ve hatası vardır.
type Source = 'local' | 'synthesia' | 'gemini';
const sourceOf = (mode: Settings['mode']): Source => mode === 'synthesia' ? 'synthesia' : mode === 'gemini' ? 'gemini' : 'local';
const modeLabels: Record<AvatarMode, string> = { idle: 'Hazır', thinking: 'Düşünüyor', speaking: 'Konuşuyor', listening: 'Dinliyor' };

export default function App() {
  const [open, setOpen] = useState(false);
  const [textView, setTextView] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  // Sohbetin modu ve açılıp açılamayacağı sayfadaki akış panosundan gelir.
  const [ready, setReady] = useState(() => chatReady(loadSettings().mode, loadChoiceState()));
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [frame, setFrame] = useState(1);
  const [mode, setMode] = useState<AvatarMode>('idle');
  const [error, setError] = useState('');
  // Synthesia ve Gemini birlikte açık tutulur; arayüz yalnızca seçili olanın durumunu gösterir.
  const [liveStates, setLiveStates] = useState<Record<Source, RealtimeState>>({ local: 'idle', synthesia: 'idle', gemini: 'idle' });
  const liveStatesRef = useRef<Record<Source, RealtimeState>>({ local: 'idle', synthesia: 'idle', gemini: 'idle' });
  const liveModes = useRef<Record<Source, AvatarMode>>({ local: 'idle', synthesia: 'idle', gemini: 'idle' });
  const liveErrors = useRef<Record<Source, string>>({ local: '', synthesia: '', gemini: '' });
  const activeSource = useRef<Source>(sourceOf(settings.mode));
  const [micMuted, setMicMuted] = useState(true);
  // Demo giriş (ad + rol): asistanın hitabını ve bilgi tabanı erişimini belirler.
  const [profile, setProfile] = useState<Profile | null>(loadProfile);
  const profileRef = useRef(profile);
  // Yanıtın dayandığı belgeler avatarın üstünde altyazı gibi görünür ve kendiliğinden kaybolur.
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const sourcesTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showSources = (next: KnowledgeSource[]) => { clearTimeout(sourcesTimer.current); setSources(next); if (next.length) sourcesTimer.current = setTimeout(() => setSources([]), 7000); };
  const [geminiHasVideo, setGeminiHasVideo] = useState(false);
  const geminiVideoElement = useRef<HTMLVideoElement>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const videoElement = useRef<HTMLVideoElement>(null);
  // Seçili kaynağın anlık bağlantı durumu (geri çağrılarda güncel değeri okumak için).
  const [liveStatus] = useState(() => ({ get current(): RealtimeState { return liveStatesRef.current[activeSource.current]; } }));
  const [report] = useState(() => (source: Source) => ({
    onState: (state: RealtimeState) => { liveStatesRef.current[source] = state; setLiveStates(current => ({ ...current, [source]: state })); },
    onMode: (next: AvatarMode) => { liveModes.current[source] = next; if (activeSource.current === source) setMode(next); },
    // fatal: kendiliğinden yeniden bağlanma durur (kota tükendiyse her deneme boşa gider). Düğmeyle elle denenebilir.
    onError: (message: string, fatal?: boolean) => { liveErrors.current[source] = message; if (fatal && source !== 'local') liveRetries.current[source] = 3; if (activeSource.current === source) setError(message); },
    active: () => activeSource.current === source,
  }));
  const [driver] = useState(() => new SpeechDriver());
  const [audio] = useState(() => new AudioLipSync(setFrame, speaking => setMode(speaking ? 'speaking' : liveStatus.current === 'connected' ? 'listening' : 'idle')));
  const nextMessage = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const panel = useRef<HTMLElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const restoreLauncherFocus = useRef(false);
  const inputElement = useRef<HTMLInputElement>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const [conversation] = useState(() => new RealtimeConversation({
    onState: report('local').onState,
    onMode: report('local').onMode,
    onAudio: stream => { if (stream) void audio.playStream(stream).catch(reason => setError((reason as Error).message)); else audio.stop(); },
    onError: setError,
    onMessage: message => setMessages(current => {
      const index = current.findIndex(item => item.liveId === message.id);
      if (index < 0) return [...current, { id: ++nextMessage.current, liveId: message.id, role: message.role, text: message.text }];
      return current.map((item, i) => i === index ? { ...item, text: message.append ? item.text + message.text : message.text } : item);
    }),
  }));
  const [synthesia] = useState(() => new SynthesiaConversation({
    onState: report('synthesia').onState,
    onMode: report('synthesia').onMode, onVideo: setVideoStream, onError: report('synthesia').onError,
    onMessage: message => report('synthesia').active() && setMessages(current => {
      const index = current.findIndex(item => item.liveId === message.id);
      if (index < 0) return [...current, { id: ++nextMessage.current, liveId: message.id, role: message.role, text: message.text }];
      return current.map((item, i) => i === index ? { ...item, text: message.text } : item);
    }),
  }));

  const [gemini] = useState(() => new GeminiConversation({
    onState: report('gemini').onState,
    onMode: report('gemini').onMode, onVideo: setGeminiHasVideo, onError: report('gemini').onError, getVideo: () => geminiVideoElement.current,
    onSources: next => { if (report('gemini').active()) showSources(next); },
    onMessage: message => report('gemini').active() && setMessages(current => {
      const index = current.findIndex(item => item.liveId === message.id);
      if (index < 0) return [...current, { id: ++nextMessage.current, liveId: message.id, role: message.role, text: message.text }];
      return current.map((item, i) => i === index ? { ...item, text: message.text } : item);
    }),
  }));
  // --- Video avatar ---
  const video = settings.mode === 'video';
  const player = useRef<AvatarPlayer | undefined>(undefined);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [videoSpeaking, setVideoSpeaking] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus | null>(null);
  const press = useRef({ at: 0, started: false });
  const [assistant] = useState(() => new AvatarConversation({
    onBusy: setAssistantBusy, onError: setError,
    onMetrics: metrics => { ((window as unknown as { __avatarMetrics?: unknown[] }).__avatarMetrics ??= []).push(metrics); },
    onMessage: message => setMessages(current => {
      const index = current.findIndex(item => item.liveId === message.id);
      if (index < 0) return [...current, { id: ++nextMessage.current, liveId: message.id, role: message.role, text: message.text }];
      return current.map((item, i) => i === index ? { ...item, text: message.append ? item.text + message.text : message.text } : item);
    }),
  }));
  const [voiceInput] = useState(() => new VoiceInput({
    onState: setVoiceState, onError: setError,
    onAudio: audio => { void assistant.transcribe(audio).then(text => { if (text) void assistant.send(text); else setError('Söylediğiniz anlaşılamadı. Yeniden deneyin.'); }).catch(reason => setError((reason as Error).message)).finally(() => voiceInput.done()); },
  }));
  const stopAssistant = () => { voiceInput.cancel(); assistant.interrupt(); };
  const videoState = voiceState === 'recording' || voiceState === 'requesting' ? 'listening' : assistantBusy || voiceState === 'processing' ? 'thinking' : 'idle';
  const activeConversation = settings.mode === 'gemini' ? gemini : settings.mode === 'synthesia' ? synthesia : conversation;
  const stopSpeech = () => { clearTimeout(timer.current); driver.stop(); audio.stop(); setFrame(1); setMode('idle'); };
  const liveState = liveStates[sourceOf(settings.mode)];
  // Arka plana alınan canlı avatar: Synthesia'da süren yanıt kesilir. Gemini'de kesme komutu video akışını sıfırlayıp
  // görüntüyü kaybettirdiği için gönderilmez; sesi zaten kapatılır.
  const quiet = () => { if (settings.mode === 'synthesia' && liveStatesRef.current.synthesia === 'connected') synthesia.interrupt(); };
  // Sohbet kapanınca canlı avatar (Synthesia / Gemini) oturumları açık kalır: mikrofon ve ses kapanır, avatar hazır bekler.
  const close = () => {
    if (autoLive) { quiet(); setMicMuted(true); }
    else { conversation.stop(); stopSpeech(); }
    stopAssistant(); setTextView(false); restoreLauncherFocus.current = true; setOpen(false);
  };
  const openChat = () => { if (ready) setOpen(true); };
  // Avatar değişince Synthesia ve Gemini oturumları kapanmaz; yalnızca bırakılan susturulur, seçilen öne gelir.
  const changeSettings = (next: Settings) => {
    quiet(); conversation.stop(); stopSpeech(); stopAssistant();
    const source = sourceOf(next.mode); activeSource.current = source;
    setError(liveErrors.current[source]); setMode(next.mode === 'synthesia' || next.mode === 'gemini' ? liveModes.current[source] : 'idle');
    setMicMuted(true); showSources([]); setSettings(next);
  };

  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { if (!ready && open) close(); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { assistant.voice = settings.voice; if (!settings.voice) player.current?.stop(); }, [assistant, settings.voice]);
  useEffect(() => {
    // Yapılandırma durumu kutu ilk açıldığında sorulur; sayfanın ilk açılışını etkilemez.
    if (!open || !video) return;
    let cancelled = false;
    void assistant.status(true).then(status => { if (!cancelled) setAssistantStatus(status); });
    return () => { cancelled = true; };
  }, [open, video, assistant]);
  useEffect(() => { if (videoElement.current) videoElement.current.srcObject = videoStream; }, [videoStream, open]);
  useEffect(() => {
    if (open) inputElement.current?.focus();
    else if (!open && restoreLauncherFocus.current) { launcher.current?.focus(); restoreLauncherFocus.current = false; }
  }, [open]);
  useEffect(() => {
    if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight;
  }, [messages, textView]);
  useEffect(() => () => {
    conversation.stop(); synthesia.stop(); gemini.stop(); clearTimeout(timer.current); driver.stop(); audio.dispose(); voiceInput.cancel(); assistant.interrupt();
  }, [driver, audio, conversation, synthesia, gemini, voiceInput, assistant]);
  useEffect(() => {
    const release = () => { conversation.stop(); synthesia.stop(); gemini.stop(); driver.stop(); audio.stop(); voiceInput.cancel(); assistant.interrupt(); };
    window.addEventListener('pagehide', release);
    return () => window.removeEventListener('pagehide', release);
  }, [conversation, synthesia, gemini, driver, audio, voiceInput, assistant]);

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (liveState === 'connecting' || !input.trim()) return;
    const text = input.trim();
    if (video) {
      // İlk kullanıcı etkileşimi: tarayıcı ses politikası gereği AudioContext burada başlatılır.
      if (settings.voice) void player.current?.prepareAudio().catch(() => {});
      voiceInput.cancel(); setError(''); setInput(''); inputElement.current?.focus();
      void assistant.send(text); return;
    }
    if (liveState === 'connected') {
      const liveId = activeConversation.sendText(text);
      if (!liveId) { setError('Canlı bağlantı hazır değil. Yeniden başlatın.'); return; }
      setError(''); setMessages(current => [...current, { id: ++nextMessage.current, role: 'user', liveId, text }]);
      setInput(''); inputElement.current?.focus(); return;
    }
    if (settings.mode !== 'local') { setError(`${settings.mode === 'gemini' ? 'Gemini' : 'Synthesia'} ile konuşmak için önce mikrofon düğmesiyle bağlantıyı başlatın.`); return; }
    setError(''); stopSpeech();
    setMessages(current => [...current, { id: ++nextMessage.current, text }]);
    setInput('');
    setMode('thinking');
    timer.current = setTimeout(() => {
      driver.speak(text, '', 1, setFrame, (state, message) => {
        if (state === 'error') { setMode('idle'); setError(message ?? 'Seslendirme başlatılamadı.'); }
        else if (state === 'ended') setMode('idle');
        else setMode(state);
      });
    }, 350);
    inputElement.current?.focus();
  };
  // Synthesia ve Gemini, hangisi seçili olursa olsun sayfa açılınca birlikte bağlanır ve açık tutulur; avatar
  // değiştirmek ya da sohbeti açmak bekletmez. Seçili olmayanın ve kapalı sohbetin sesi ve mikrofonu kapalıdır.
  // Oturum koparsa yeniden kurulur (art arda en çok 3 deneme).
  const autoLive = settings.mode === 'synthesia' || settings.mode === 'gemini';
  const startLive = (source: 'synthesia' | 'gemini') => {
    if (liveStatesRef.current[source] !== 'idle') return;
    liveErrors.current[source] = '';
    if (source === 'synthesia') { synthesia.setMuted(true); synthesia.setOutputMuted(true); void synthesia.start(settings.synthesiaAvatar); }
    else { gemini.setMuted(true); gemini.setOutputMuted(true); void gemini.start(profileQuery(profileRef.current)); }
    applyAudio();
  };
  const applyAudio = () => {
    for (const [source, session] of [['synthesia', synthesia], ['gemini', gemini]] as const) {
      const front = open && activeSource.current === source;
      session.setOutputMuted(!front); session.setMuted(!front || micMuted);
    }
  };
  useEffect(applyAudio, [open, settings.mode, micMuted]); // eslint-disable-line react-hooks/exhaustive-deps
  // Ücretsiz testler için: adres ?nolive ile açılırsa canlı oturumlar kendiliğinden kurulmaz.
  const [keepLive] = useState(() => !new URLSearchParams(location.search).has('nolive'));
  const liveRetries = useRef({ synthesia: 0, gemini: 0 });
  const changeProfile = (next: Profile | null) => {
    profileRef.current = next; setProfile(next); saveProfile(next); showSources([]);
    // Ad ve rol oturum açılırken gönderilir: Gemini oturumu yeni kimlikle baştan kurulur (keepAlive yeniden bağlar).
    liveRetries.current.gemini = 0; gemini.stop();
  };
  const keepAlive = (source: 'synthesia' | 'gemini', state: RealtimeState) => {
    if (state === 'connected') { liveRetries.current[source] = 0; liveErrors.current[source] = ''; if (activeSource.current === source) setError(''); return; }
    if (!keepLive || state !== 'idle' || liveRetries.current[source] >= 3) return;
    const timer = setTimeout(() => startLive(source), liveRetries.current[source] ? 2500 : 0);
    liveRetries.current[source]++;
    return () => clearTimeout(timer);
  };
  useEffect(() => keepAlive('synthesia', liveStates.synthesia), [liveStates.synthesia]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => keepAlive('gemini', liveStates.gemini), [liveStates.gemini]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = () => {
    setError('');
    if (autoLive) {
      // Bağlıyken düğme mikrofonu açıp kapatır. Bağlantı kopmuşsa yeniden kurar.
      const source = settings.mode === 'synthesia' ? 'synthesia' : 'gemini';
      if (liveStatus.current === 'connected') setMicMuted(!micMuted);
      else if (liveStatus.current === 'idle') { liveRetries.current[source] = 1; setMicMuted(false); startLive(source); }
      return;
    }
    if (liveStatus.current !== 'idle') { activeConversation.stop(); return; }
    stopSpeech();
    // Resume Web Audio during the click, before microphone/network awaits.
    void audio.prepare().catch(() => setError('Tarayıcıda ses açılamadı. Sayfayı yenileyip tekrar deneyin.'));
    void conversation.start();
  };
  const stopOutput = () => { if (video) assistant.interrupt(); else if (liveStatus.current === 'connected') activeConversation.interrupt(); else stopSpeech(); };
  // Video modunda mikrofon: basılı tut = bas-konuş; kısa dokunuş = başlat, sessizlikte kendiliğinden biter (VAD).
  const beginVoice = (holding: boolean) => {
    setError(''); assistant.interrupt(); // söz kesme: kullanıcı konuşmaya başlayınca avatar susar
    voiceInput.holding = holding;
    void (player.current ? player.current.prepareAudio().catch(() => undefined) : Promise.resolve(undefined)).then(context => voiceInput.start(context));
  };
  const micDown = () => { if (!video) return; press.current = { at: performance.now(), started: voiceInput.current === 'idle' }; if (press.current.started) beginVoice(true); };
  const micUp = () => {
    if (!video || !press.current.at) return;
    const held = performance.now() - press.current.at, started = press.current.started; press.current = { at: 0, started: false };
    voiceInput.holding = false;
    if (!started || held >= 350) voiceInput.stop();
  };
  const micClick = (keyboard: boolean) => { if (!video) { live(); return; } if (!keyboard) return; if (voiceInput.current === 'idle') beginVoice(false); else voiceInput.stop(); };
  const typing = (value: string) => { if (video && value && assistant.active) assistant.interrupt(); setInput(value); };
  const liveMuted = autoLive && liveState === 'connected' && micMuted;
  const shownMode: AvatarMode = video ? (videoSpeaking ? 'speaking' : videoState) : liveMuted && mode === 'listening' ? 'idle' : mode;
  const recording = voiceState === 'recording' || voiceState === 'requesting';
  const connecting = liveState === 'connecting';
  const connected = liveState === 'connected';

  return <main className="blank-page" aria-label="PMI Assistant demo sayfası">
    <ProfileMenu profile={profile} onChange={changeProfile} />
    <FlowBoard mode={settings.mode} onMode={mode => changeSettings({ ...settings, mode })} onReady={setReady} />
    {<section ref={panel} id="pmi-chat" hidden={!open} className={`chat-panel ${textView ? 'text-view' : 'avatar-view'}${video ? ' video-mode' : ''}`} role="dialog" aria-modal="false" aria-labelledby="chat-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
    }}>
      <header className="chat-header">
        <h1 id="chat-title">PMI Assistant</h1>
        <div className="chat-header-actions">
          {video && <button type="button" className={`icon-button voice-toggle ${settings.voice ? '' : 'selected'}`} title={settings.voice ? 'Sesi kapat' : 'Sesi aç'} aria-label={settings.voice ? 'Sesi kapat' : 'Sesi aç'} aria-pressed={!settings.voice} onClick={() => { if (settings.voice) assistant.interrupt(); setSettings({ ...settings, voice: !settings.voice }); }}>{settings.voice ? <Volume2 size={20} strokeWidth={1.7} /> : <VolumeX size={20} strokeWidth={1.7} />}</button>}
          <button type="button" className={`icon-button view-toggle ${textView ? 'selected' : ''}`} title={textView ? 'Avatarı göster' : 'Metinleri göster'} aria-label={textView ? 'Avatarı göster' : 'Metinleri göster'} aria-pressed={textView} aria-controls="chat-content" onClick={() => setTextView(!textView)}><MessageSquareText size={20} strokeWidth={1.7} /></button>
          <button type="button" className="icon-button chat-close" aria-label="Sohbeti kapat" onClick={close}><X size={20} strokeWidth={1.7} /></button>
        </div>
      </header>
      <div id="chat-content" className="chat-content">
        <div className="avatar-stage" hidden={textView}>
          {video ? open && <VideoAvatar state={videoState} onReady={value => { player.current = value; assistant.player = value; }} onState={state => setVideoSpeaking(state === 'speaking')} /> : settings.mode === 'local' ? <Avatar frame={frame} mode={mode} /> : null}
          <video key="gemini-video" ref={geminiVideoElement} className="synthesia-video" hidden={settings.mode !== 'gemini' || !geminiHasVideo} autoPlay playsInline aria-label="Gemini canlı avatarı" onClick={() => gemini.resumeAudio()} />
          {settings.mode === 'gemini' && !geminiHasVideo && <div className="synthesia-placeholder"><CircleUserRound size={52} strokeWidth={1} aria-hidden="true" /><div><strong>Gemini avatarı</strong><span>{connecting ? 'Canlı avatar hazırlanıyor…' : 'Avatar bağlanamadı; mikrofon düğmesiyle yeniden deneyin'}</span></div></div>}
          <video key="synthesia-video" ref={videoElement} className="synthesia-video" hidden={settings.mode !== 'synthesia' || !videoStream} autoPlay muted playsInline aria-label="Synthesia canlı avatarı" onClick={() => synthesia.resumeAudio()} />
          {settings.mode === 'synthesia' && !videoStream && <div className="synthesia-placeholder">
            {settings.synthesiaAvatar === 'custom' ? <Avatar frame={1} mode="idle" /> : <CircleUserRound size={52} strokeWidth={1} aria-hidden="true" />}
            <div className={settings.synthesiaAvatar === 'custom' ? 'synthesia-preview-label' : ''}><strong>{settings.synthesiaAvatar === 'custom' ? 'Bizim karakter' : 'Synthesia avatarı'}</strong><span>{connecting ? 'Canlı avatar hazırlanıyor…' : 'Avatar bağlanamadı; mikrofon düğmesiyle yeniden deneyin'}</span></div>
          </div>}
          {sources.length > 0 && <p className="avatar-sources" role="status" aria-live="polite"><span>Kaynak</span>{sources.map(source => <em key={source.id} data-source={source.id}>{source.title}</em>)}</p>}
          <div className={`avatar-status ${shownMode}`} role="status"><span className="status-dot" />{connecting ? 'Bağlanıyor…' : video && assistantStatus && !assistantStatus.chat && shownMode === 'idle' ? 'Demo modu' : modeLabels[shownMode]}{shownMode === 'speaking' && <button className="playback-stop" aria-label="Seslendirmeyi durdur" onClick={stopOutput}><Square size={10} fill="currentColor" /></button>}</div>
        </div>
        {(textView || video) && <div ref={messageList} className="messages" role="log" aria-label="Sohbet mesajları" aria-live="polite">{messages.map(message => <article className={`message ${message.role === 'assistant' ? 'assistant-message' : ''}`} key={message.id} data-message-id={message.id} data-role={message.role ?? 'user'}><p>{message.text}</p></article>)}</div>}
      </div>
      <footer className="chat-composer">
        {error && <p className="error" role="alert">{error}</p>}
        <form className="composer-row" onSubmit={send}>
          <div className="input-wrap"><input ref={inputElement} value={input} onChange={event => typing(event.target.value)} placeholder={connecting ? 'Bağlanıyor…' : 'Mesajınızı yazın…'} aria-label="Mesajınız" maxLength={2000} disabled={connecting} autoComplete="off" /><button className="send-button" type="submit" aria-label="Mesajı gönder" disabled={connecting || !input.trim()}><SendHorizontal size={19} strokeWidth={1.7} /></button></div>
          {video
            ? <button className={`record-button ${recording ? 'active' : ''}`} type="button" title="Basılı tutun ya da dokunup konuşun" aria-label={recording ? 'Kaydı bitir ve gönder' : 'Sesli mesaj: basılı tutun ya da dokunun'} aria-pressed={recording} aria-busy={voiceState === 'processing'} data-voice-state={voiceState} disabled={voiceState === 'processing' || (!!assistantStatus && !assistantStatus.stt)} onPointerDown={micDown} onPointerUp={micUp} onPointerCancel={micUp} onPointerLeave={() => { if (press.current.at) micUp(); }} onContextMenu={event => event.preventDefault()} onClick={event => micClick(event.detail === 0)}>{voiceState === 'processing' ? <LoaderCircle size={19} className="spin" /> : recording ? <Square size={16} fill="currentColor" /> : <Mic size={20} strokeWidth={1.7} />}</button>
            : autoLive
              ? <button className={`record-button ${connecting || (connected && !micMuted) ? 'active' : ''}`} type="button" title={connected ? (micMuted ? 'Mikrofonu aç' : 'Mikrofonu kapat') : undefined} aria-label={connecting ? 'Avatar hazırlanıyor' : connected ? (micMuted ? 'Mikrofonu aç' : 'Mikrofonu kapat') : 'Yeniden bağlan'} aria-pressed={connected && !micMuted} aria-busy={connecting} disabled={connecting} data-live-state={liveState} data-mic={connected ? (micMuted ? 'muted' : 'live') : undefined} onClick={live}>{connecting ? <LoaderCircle size={19} className="spin" /> : connected && micMuted ? <MicOff size={20} strokeWidth={1.7} /> : <Mic size={20} strokeWidth={1.7} />}</button>
              : <button className={`record-button ${connected || connecting ? 'active' : ''}`} type="button" aria-label={connecting ? 'Bağlantıyı iptal et' : connected ? 'Canlı konuşmayı durdur' : 'Canlı konuşmayı başlat'} aria-pressed={connected || connecting} aria-busy={connecting} data-live-state={liveState} onClick={live}>{connecting ? <LoaderCircle size={19} className="spin" /> : connected ? <Square size={16} fill="currentColor" /> : <Mic size={20} strokeWidth={1.7} />}</button>}
        </form>
      </footer>
    </section>}
    <button ref={launcher} className="chat-launcher" type="button" hidden={open} disabled={!ready} title={ready ? undefined : 'Sayfada seçili akış henüz bağlı değil'} aria-label={ready ? 'Sohbeti aç' : 'Sohbet kapalı: seçili akış henüz bağlı değil'} aria-expanded={open} aria-controls="pmi-chat" onClick={openChat}><MessageCircle size={28} strokeWidth={1.8} /></button>
  </main>;
}
