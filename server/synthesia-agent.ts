import { defineAgent, voice } from '@livekit/agents';
import { RoomEvent } from '@livekit/rtc-node';
import * as openai from '@livekit/agents-plugin-openai';
import * as synthesia from '@livekit/agents-plugin-synthesia';

export default defineAgent({
  entry: async ctx => {
    const metadata = JSON.parse(ctx.job.metadata || '{}') as { avatarId?: string; userIdentity?: string };
    const allowed = [process.env.SYNTHESIA_AVATAR_DEFAULT_ID, process.env.SYNTHESIA_AVATAR_CUSTOM_ID].filter(Boolean);
    if (!metadata.avatarId || !allowed.includes(metadata.avatarId) || !metadata.userIdentity) { ctx.shutdown('invalid selection'); return; }
    await ctx.connect();
    const user = await ctx.waitForParticipant(metadata.userIdentity);
    const publish = (event: object) => ctx.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify(event)), { topic: 'pmi.synthesia', reliable: true, destination_identities: [user.identity] }).catch(() => {});
    const session = new voice.AgentSession({ llm: new openai.realtime.RealtimeModel({
      model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1', voice: 'marin',
      inputAudioTranscription: { model: 'gpt-4o-mini-transcribe', language: 'tr' },
      inputAudioNoiseReduction: { type: 'near_field' },
      turnDetection: { type: 'server_vad', threshold: .5, prefix_padding_ms: 300, silence_duration_ms: 650 },
    }) });
    const avatar = new synthesia.AvatarSession(new synthesia.AvatarConfig({ avatarIds: [metadata.avatarId] }), { joinTimeout: 60000 });
    ctx.addShutdownCallback(async () => { await session.close().catch(() => {}); await avatar.aclose().catch(() => {}); });
    const typed: { id: string; text: string }[] = [];
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => { void publish({ type: 'mode', mode: event.newState }); });
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, event => {
      const item = event.item;
      if (item.type !== 'message' || !['user', 'assistant'].includes(item.role) || !item.textContent) return;
      const pending = item.role === 'user' ? typed.findIndex(entry => entry.text === item.textContent) : -1;
      const id = pending >= 0 ? typed.splice(pending, 1)[0]!.id : item.id;
      void publish({ type: 'message', id, role: item.role, text: item.textContent });
    });
    session.on(voice.AgentSessionEventTypes.Error, () => { void publish({ type: 'error', error: 'Sesli yanıt tamamlanamadı. Bağlantıyı yeniden başlatabilirsiniz.' }); });
    session.on(voice.AgentSessionEventTypes.Close, () => { void avatar.aclose(); ctx.shutdown('session closed'); });
    ctx.room.on(RoomEvent.ParticipantDisconnected, participant => {
      if (participant.identity === user.identity || participant.identity === 'synthesia-avatar-agent') ctx.shutdown('participant left');
    });
    try {
      // Synthesia must own the output before the voice session starts.
      await avatar.start(session, ctx.room);
      await session.start({ room: ctx.room, agent: new voice.Agent({
        instructions: 'Sen PMI Assistant adlı sesli bir asistansın. Varsayılan olarak Türkçe, kısa, doğal ve yardımcı yanıtlar ver. Kullanıcı sözünü bitirmeden yanıt verme.',
      }), inputOptions: { participantIdentity: user.identity, textEnabled: false, videoEnabled: false, closeOnDisconnect: true, deleteRoomOnClose: true },
        outputOptions: { transcriptionEnabled: false }, record: false });
      ctx.room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (topic !== 'pmi.input' || participant?.identity !== user.identity || payload.byteLength > 10000) return;
        try {
          const event = JSON.parse(new TextDecoder().decode(payload)) as { type?: string; id?: string; text?: string };
          if (event.type === 'interrupt') { session.interrupt(); return; }
          if (event.type !== 'text' || typeof event.text !== 'string' || !event.text.trim() || event.text.length > 2000 || typeof event.id !== 'string') return;
          typed.push({ id: event.id, text: event.text }); if (typed.length > 20) typed.shift();
          session.interrupt(); session.generateReply({ userInput: event.text });
        } catch { /* Ignore malformed peer data. */ }
      });
      await publish({ type: 'ready' });
    } catch (error) {
      const type = (error as { type?: string }).type;
      await publish({ type: 'error', code: type || 'avatar_start_failed', error: type === synthesia.ErrorType.UNKNOWN_AVATAR ? 'Seçilen avatar canlı görüşme için kullanılamıyor. Studio’dan Copy Interactive ID değerini alın.' : type === synthesia.ErrorType.AUTH ? 'Synthesia anahtarının Interactive Avatars (write) yetkisini kontrol edin.' : type === synthesia.ErrorType.FEATURE_NOT_IN_PLAN ? 'Synthesia hesabında Interactive Avatars erişimi bulunmuyor.' : type === synthesia.ErrorType.QUOTA_EXCEEDED ? 'Synthesia hesabının oturum kotası tükendi. Kota yenilenene veya plan yükseltilene kadar bu avatar açılamaz; başka bir avatar seçebilirsiniz.' : type === synthesia.ErrorType.CONCURRENCY_LIMIT ? 'Synthesia hesabında aynı anda açılabilecek oturum sınırı doldu. Açık diğer oturumları kapatıp yeniden deneyin.' : 'Synthesia avatarı başlatılamadı. Anahtar, avatar erişimi ve kullanım limitlerini kontrol edin.' });
      ctx.shutdown('avatar failed');
    }
  },
});
