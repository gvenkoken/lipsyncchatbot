import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SentenceSplitter, speakable } from '../src/chat/assistant.ts';
import { VadTracker, VAD } from '../src/chat/voice-input.ts';

test('akan metin cümlelere bölünür; ondalık sayı bölünmez, çok kısa cümle sonrakine eklenir', () => {
  const splitter = new SentenceSplitter(), out: string[] = [];
  for (const word of 'Tabii, hemen yardımcı olayım. İstanbul bugün 18.5 derece. Evet! Peki ya yarın? Son cümle noktasız'.split(/(?<= )/)) out.push(...splitter.push(word));
  assert.deepEqual(out, ['Tabii, hemen yardımcı olayım.', 'İstanbul bugün 18.5 derece.', 'Evet! Peki ya yarın?']);
  assert.deepEqual(splitter.flush(), ['Son cümle noktasız']); assert.deepEqual(splitter.flush(), []);
});

test('seslendirilmeyecek biçimlendirme ayıklanır', () => {
  assert.equal(speakable('**Merhaba** 😀 [site](http://x.y) `kod`\n# başlık'), 'Merhaba site kod başlık');
  assert.equal(speakable('```js\nlet a\n```'), '');
});

test('VAD: konuşmadan sonra sessizlikte biter, hiç ses yoksa boş döner, kısa tıkırtıyı konuşma saymaz', () => {
  const run = (levels: [number, number][]) => { const tracker = new VadTracker(); let result = 'continue'; for (const [rms, ms] of levels) for (let t = 0; t < ms && result === 'continue'; t += 20) result = tracker.update(rms, 20); return { result, spoke: tracker.spoke }; };
  assert.deepEqual(run([[.001, 400], [.08, 1500], [.001, VAD.endSilenceMs + 40]]), { result: 'stop', spoke: true });
  assert.deepEqual(run([[.001, 400], [.08, 1500], [.001, 600], [.08, 500], [.001, 500]]), { result: 'continue', spoke: true });
  assert.deepEqual(run([[.001, VAD.noSpeechMs + 40]]), { result: 'empty', spoke: false });
  assert.deepEqual(run([[.001, 300], [.2, 100], [.001, VAD.noSpeechMs]]), { result: 'empty', spoke: false });
});
