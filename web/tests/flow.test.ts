import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CHOICES, DEFAULT_STATE, EDGES, NODE, NODES, OPTIONS, REALTIME, applyChoice, avatarOption, chatReady, choicesFor, edgePath, isWired, menuGroups, optionsFor, parseState, selection } from '../src/flow/flow.ts';

test('akış: Avatar -> STT -> LLM -> TTS -> Avatar sırası ve kenarlar tutarlı', () => {
  assert.deepEqual(NODES.map(node => node.role), ['avatar', 'stt', 'llm', 'tts', 'avatar']);
  const ids = new Set(NODES.map(node => node.id));
  assert.equal(ids.size, NODES.length);
  for (const edge of EDGES) assert.ok(ids.has(edge.from) && ids.has(edge.to));
  assert.deepEqual(EDGES.map(edge => edge.from), NODES.slice(0, -1).map(node => node.id));
  for (let i = 1; i < NODES.length; i++) assert.ok(NODES[i].x >= NODES[i - 1].x + NODE.width + 24, 'kutular arasında ok için boşluk var');
});

test('avatar seçenekleri sohbet modlarıyla birebir eşleşir', () => {
  assert.deepEqual(OPTIONS.avatar.map(option => option.mode), ['gemini', 'synthesia', 'local'], 'Gemini ilk sırada; Custom menüde yok');
  assert.equal(avatarOption('video').label, 'Custom', 'gizli mod: yalnızca kayıtlı ayarla');
  assert.equal(avatarOption('synthesia').label, 'Synthesia');
  for (const role of ['stt', 'llm', 'tts'] as const) assert.deepEqual(OPTIONS[role].filter(option => option.wired).map(option => option.value), ['openai'], 'custom zincirinde bağlı olan yalnızca OpenAI');
});

test('seçim: custom ve Synthesia zincirinde ara kutular seçilebilir; sesten sese avatarlarda kilitli', () => {
  assert.deepEqual(selection('tts', 'video', { ...DEFAULT_CHOICES, tts: 'elevenlabs' }).option.label, 'ElevenLabs');
  const synthesia = selection('tts', 'synthesia', { ...DEFAULT_CHOICES, tts: 'elevenlabs' });
  assert.equal(synthesia.locked, false); assert.equal(synthesia.option.label, 'ElevenLabs'); assert.equal(synthesia.option.wired, false);
  assert.equal(selection('llm', 'synthesia', DEFAULT_CHOICES).option.wired, false, 'Synthesia + ayrı OpenAI zinciri bağlı değil');
  assert.equal(selection('llm', 'synthesia', DEFAULT_STATE.synthesia).option.label, 'OpenAI Realtime');
  assert.equal(selection('llm', 'synthesia', DEFAULT_STATE.synthesia).option.wired, true);
  const locked = selection('llm', 'gemini', DEFAULT_CHOICES);
  assert.equal(locked.locked, true); assert.equal(locked.option.label, 'Gemini Live');
  const drawn = selection('stt', 'local', DEFAULT_STATE.local);
  assert.deepEqual([drawn.locked, drawn.option.label, drawn.option.wired], [false, 'OpenAI Realtime', true], 'Çizim avatar: kutular açık, Realtime bağlı');
  assert.equal(selection('tts', 'local', { ...DEFAULT_CHOICES, tts: 'elevenlabs' }).option.wired, false);
  assert.equal(selection('llm', 'local', DEFAULT_CHOICES).option.wired, false, 'Çizim avatar + ayrı OpenAI zinciri bağlı değil');
  assert.equal(selection('stt', 'video', { ...DEFAULT_CHOICES, stt: 'yok' }).option.value, 'openai');
});

test('Realtime yalnızca Synthesia zincirinde sunulur ve üç adımı birlikte kapsar', () => {
  assert.equal(optionsFor('tts', 'video').some(option => option.value === REALTIME), false);
  assert.equal(optionsFor('tts', 'synthesia')[0].value, REALTIME);
  const eleven = applyChoice(DEFAULT_STATE, 'synthesia', 'tts', 'elevenlabs');
  assert.deepEqual(eleven.synthesia, { stt: 'openai', llm: 'openai', tts: 'elevenlabs' }, 'Realtime yarım kalmaz');
  assert.deepEqual(eleven.video, DEFAULT_STATE.video, 'custom zinciri etkilenmez');
  assert.deepEqual(applyChoice(eleven, 'synthesia', 'stt', REALTIME).synthesia, DEFAULT_STATE.synthesia);
  assert.equal(applyChoice(DEFAULT_STATE, 'video', 'tts', REALTIME), DEFAULT_STATE, 'custom zincirinde Realtime seçilemez');
  assert.equal(applyChoice(DEFAULT_STATE, 'gemini', 'tts', 'elevenlabs'), DEFAULT_STATE);
  const drawn = applyChoice(DEFAULT_STATE, 'local', 'stt', 'deepgram');
  assert.deepEqual(drawn.local, { stt: 'deepgram', llm: 'openai', tts: 'openai' }); assert.deepEqual(drawn.synthesia, DEFAULT_STATE.synthesia, 'Synthesia zinciri etkilenmez');
  assert.deepEqual(choicesFor('video', applyChoice(DEFAULT_STATE, 'video', 'stt', 'deepgram')), { ...DEFAULT_CHOICES, stt: 'deepgram' });
});

test('sohbet yalnızca bağlı akışlarda açılır', () => {
  assert.equal(chatReady('video', DEFAULT_STATE), true);
  assert.equal(chatReady('video', applyChoice(DEFAULT_STATE, 'video', 'tts', 'elevenlabs')), false);
  assert.equal(chatReady('synthesia', DEFAULT_STATE), true, 'Synthesia + OpenAI Realtime bağlı');
  assert.equal(chatReady('synthesia', applyChoice(DEFAULT_STATE, 'synthesia', 'tts', 'elevenlabs')), false);
  assert.equal(chatReady('synthesia', applyChoice(DEFAULT_STATE, 'synthesia', 'llm', 'openai')), false);
  const custom = applyChoice(DEFAULT_STATE, 'video', 'tts', 'elevenlabs');
  assert.equal(chatReady('gemini', custom), true); assert.equal(chatReady('local', custom), true, 'Çizim avatar + Realtime bağlı');
  assert.equal(chatReady('local', applyChoice(DEFAULT_STATE, 'local', 'tts', 'elevenlabs')), false);
  assert.equal(isWired('avatar', OPTIONS.avatar[1], 'synthesia'), true);
  assert.deepEqual(OPTIONS.stt[0].detail + ' ' + OPTIONS.llm[0].detail + ' ' + OPTIONS.tts[0].detail, 'gpt-transcribe gpt-5.4-mini gpt-4o-mini-tts', 'OpenAI\'nin canlı olmayan modelleri');
});

test('kayıtlı seçimler doğrulanır; ok yolu kutu kenarlarını birleştirir', () => {
  assert.deepEqual(parseState(null), DEFAULT_STATE);
  assert.deepEqual(parseState('bozuk'), DEFAULT_STATE);
  assert.deepEqual(parseState('{"video":{"stt":"azure","llm":"claude","tts":"google"}}'), { ...DEFAULT_STATE, video: { stt: 'azure', llm: 'openai', tts: 'google' } });
  assert.deepEqual(parseState('{"video":{"tts":"realtime"},"synthesia":{"stt":"openai","llm":"realtime","tts":"realtime"}}'), DEFAULT_STATE, 'geçersiz ve yarım Realtime kayıtları atılır');
  assert.deepEqual(parseState('{"synthesia":{"stt":"openai","llm":"gemini","tts":"elevenlabs"}}').synthesia, { stt: 'openai', llm: 'gemini', tts: 'elevenlabs' });
  const path = edgePath(NODES[0], NODES[1]);
  assert.ok(path.d.startsWith(`M ${NODES[0].x + NODE.width} ${NODES[0].y + NODE.height / 2} C`));
  assert.ok(path.d.endsWith(`${NODES[1].x} ${NODES[1].y + NODE.height / 2}`));
  assert.equal(path.labelX, (NODES[0].x + NODE.width + NODES[1].x) / 2);
});

test('menü grupları: STT, LLM ve TTS seçenekleri LiteLLM grubunda; avatar seçenekleri grupsuz', () => {
  for (const role of ['stt', 'llm', 'tts'] as const) for (const mode of ['video', 'synthesia', 'local'] as const) {
    const groups = menuGroups(role, mode);
    assert.equal(groups[0].litellm, true);
    assert.deepEqual(groups.flatMap(group => group.options).map(option => option.value).sort(), optionsFor(role, mode).map(option => option.value).sort(), 'hiçbir seçenek kaybolmaz');
  }
  assert.deepEqual(menuGroups('avatar', 'video').map(group => group.litellm), [false]);
  assert.equal(menuGroups('avatar', 'video')[0].options.length, OPTIONS.avatar.length);
});
