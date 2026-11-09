import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSpeechText } from '../../web/src/speech/index.js';

test('emoji and markdown marks are dropped and spaces collapse', () => {
  assert.equal(prepareSpeechText('Merhaba 😀👍🏽 **dünya**   nasılsın?'), 'Merhaba dünya nasılsın?');
  assert.equal(prepareSpeechText('👨‍👩‍👧 Aile'), 'Aile');
  assert.equal(prepareSpeechText('  # Başlık  '), 'Başlık');
  assert.equal(prepareSpeechText('3.5 lira, %20 indirim'), '3.5 lira, %20 indirim');
  assert.equal(prepareSpeechText(' \n 😀 \n'), '');
  assert.throws(() => prepareSpeechText(null), TypeError);
});

test('each line is read as its own sentence and bullets are not read', () => {
  assert.equal(prepareSpeechText('Yapılacaklar:\n- süt al\n• ekmek al\n\nTamam.'), 'Yapılacaklar: süt al. ekmek al. Tamam.');
  assert.equal(prepareSpeechText('Bir.\r\nİki'), 'Bir. İki');
  assert.equal(prepareSpeechText('Soru mu?\nEvet'), 'Soru mu? Evet');
  assert.equal(prepareSpeechText('Son satır'), 'Son satır');
});
