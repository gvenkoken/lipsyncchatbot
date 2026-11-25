import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CHOICES, DEFAULT_STATE, OPTIONS } from '../src/flow/flow.ts';
import { ASSUMPTIONS, AVATAR_RATES, DEFAULT_USAGE, MINUTE_OPTIONS, RATES, USER_OPTIONS, estimate, formatCount, formatUsd, parseUsage } from '../src/flow/cost.ts';

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('her seçeneğin bir fiyatı var; kullanım seçenekleri istenen değerler', () => {
  for (const role of ['stt', 'llm', 'tts'] as const) for (const option of OPTIONS[role]) assert.ok(RATES[role][option.value]?.perMinute > 0, `${role}/${option.value}`);
  for (const option of OPTIONS.avatar) assert.ok(AVATAR_RATES[option.mode!].length > 0);
  assert.ok(AVATAR_RATES.video.length > 0);
  assert.deepEqual([...MINUTE_OPTIONS], [10, 30, 60, 120]);
  assert.deepEqual(USER_OPTIONS.map(formatCount), ['1k', '5k', '10k', '50k']);
});

test('custom + OpenAI: kalemler varsayımlardan türetilir, toplam = dakika ücreti × kullanıcı × dakika', () => {
  const result = estimate('video', DEFAULT_CHOICES, { minutes: 30, users: 1000 });
  assert.deepEqual(result.parts.map(part => part.key), ['avatar-0', 'stt', 'llm', 'tts']);
  const [avatar, stt, llm, tts] = result.parts;
  assert.equal(avatar.perMinute, 0);
  near(stt.perMinute, .0045 * ASSUMPTIONS.listenShare);
  near(llm.perMinute, 3 * (1200 * .75 + 60 * 4.5) / 1e6);
  near(tts.perMinute, .015 * ASSUMPTIONS.speakShare);
  near(result.perMinute, .0018 + .00351 + .0075);
  assert.equal(result.totalMinutes, 30000);
  near(result.monthly, result.perMinute * 30000); near(result.perUser, result.perMinute * 30);
  near(result.parts.reduce((sum, part) => sum + part.monthly, 0), result.monthly);
});

test('maliyet kullanıcı ve dakika ile doğrusal artar; seçim değişince kalem değişir', () => {
  const base = estimate('video', DEFAULT_CHOICES, { minutes: 10, users: 1000 });
  near(estimate('video', DEFAULT_CHOICES, { minutes: 120, users: 50000 }).monthly, base.monthly * 12 * 50);
  const eleven = estimate('video', { ...DEFAULT_CHOICES, tts: 'elevenlabs' }, { minutes: 10, users: 1000 });
  assert.ok(eleven.monthly > base.monthly); assert.equal(eleven.parts[3].label, 'TTS · ElevenLabs'); assert.equal(eleven.verified, false);
});

test('Synthesia: Realtime ile avatar + tek kalem; ayrı zincirde avatar + seçilen STT/LLM/TTS', () => {
  const realtimeRate = (.4 * 600 * 32 + .5 * 1200 * 64) / 1e6 * 1.5;
  const wired = estimate('synthesia', DEFAULT_STATE.synthesia, DEFAULT_USAGE);
  assert.deepEqual(wired.parts.map(part => part.label), ['Synthesia', 'OpenAI Realtime']);
  assert.equal(wired.parts[0].perMinute, .1); near(wired.parts[1].perMinute, realtimeRate);
  const chain = estimate('synthesia', { ...DEFAULT_CHOICES, tts: 'elevenlabs' }, DEFAULT_USAGE);
  assert.deepEqual(chain.parts.map(part => part.label), ['Synthesia', 'STT · OpenAI', 'LLM · OpenAI', 'TTS · ElevenLabs']);
  near(chain.perMinute, .1 + estimate('video', { ...DEFAULT_CHOICES, tts: 'elevenlabs' }, DEFAULT_USAGE).perMinute);
  const local = estimate('local', DEFAULT_STATE.local, DEFAULT_USAGE);
  assert.deepEqual(local.parts.map(part => part.label), ['Avatar', 'OpenAI Realtime']); near(local.perMinute, realtimeRate);
  near(estimate('local', DEFAULT_CHOICES, DEFAULT_USAGE).perMinute, estimate('video', DEFAULT_CHOICES, DEFAULT_USAGE).perMinute);
  const gemini = estimate('gemini', DEFAULT_CHOICES, DEFAULT_USAGE);
  assert.deepEqual(gemini.parts.map(part => part.label), ['Gemini Live (ses)', 'Gemini avatar görüntüsü']);
  near(gemini.parts[0].perMinute, .4 * .005 + .5 * .018); near(gemini.parts[1].perMinute, .5 * 6192 * 60 / 1e6);
  assert.equal(gemini.verified, false, 'avatar görüntü ücreti üçüncü taraf kaynaktan');
});

test('kayıtlı kullanım doğrulanır; tutar biçimi', () => {
  assert.deepEqual(parseUsage(null), DEFAULT_USAGE);
  assert.deepEqual(parseUsage('{"minutes":120,"users":50000}'), { minutes: 120, users: 50000 });
  assert.deepEqual(parseUsage('{"minutes":45,"users":-1}'), DEFAULT_USAGE);
  assert.deepEqual(parseUsage('bozuk'), DEFAULT_USAGE);
  assert.equal(formatUsd(76860), '$76.860,00'); assert.equal(formatUsd(384.3), '$384,30'); assert.equal(formatUsd(12.81), '$12,81'); assert.equal(formatUsd(.01281), '$0,013'); assert.equal(formatUsd(.0018), '$0,0018');
});
