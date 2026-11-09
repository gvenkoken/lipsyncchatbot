import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences, MAX_PART_LENGTH } from '../../web/src/speech/index.js';

const check = (text, expected) => {
  const parts = splitSentences(text);
  assert.deepEqual(parts, expected);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every(part => part.trim()));
};

test('sentences retain order, punctuation and whitespace', () => {
  for (const [text, expected] of [
    ['Merhaba.', ['Merhaba.']],
    ['Bir. İki? Üç! Dört. Beş.  ', ['Bir. ', 'İki? ', 'Üç! ', 'Dört. ', 'Beş.  ']],
    ['  Merhaba', ['  Merhaba']],
    ['"Geldim." dedi. Sonra gitti.', ['"Geldim." dedi. ', 'Sonra gitti.']],
    ['Gerçekten mi?! Evet.', ['Gerçekten mi?! ', 'Evet.']],
  ]) check(text, expected);
  assert.deepEqual(splitSentences('   '), []);
  assert.deepEqual(splitSentences(''), []);
});

test('abbreviations, initials, decimals and ordinals do not end a sentence', () => {
  check('Dr. Deniz geldi.  ', ['Dr. Deniz geldi.  ']);
  check('Prof. Dr. Ayşe Kaya ve A. Yılmaz geldi. Sonra gitti.', ['Prof. Dr. Ayşe Kaya ve A. Yılmaz geldi. ', 'Sonra gitti.']);
  check('Fiyat 3.5 lira oldu. Tamam.', ['Fiyat 3.5 lira oldu. ', 'Tamam.']);
  check('Sonra 15. yüzyıl geldi. Bitti.', ['Sonra 15. yüzyıl geldi. ', 'Bitti.']);
  check('Elma, armut vb. meyveler. Bitti.', ['Elma, armut vb. meyveler. ', 'Bitti.']);
  check('Bekle... sonra gel. Tamam.', ['Bekle... sonra gel. ', 'Tamam.']);
  check('Bekle… Geldi.', ['Bekle… ', 'Geldi.']);
});

test('long sentences are cut at a comma, else at a space, never above the limit', () => {
  const long = 'Bu çok uzun bir cümle, içinde virgüller var ve devam ediyor, '.repeat(8) + 'bitti.';
  const parts = splitSentences(long);
  assert.equal(parts.join(''), long);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.length <= MAX_PART_LENGTH));
  assert.ok(parts.slice(0, -1).every(part => /,\s+$/u.test(part)));
  const words = 'kelime '.repeat(80).trim();
  const pieces = splitSentences(words);
  assert.equal(pieces.join(''), words);
  assert.ok(pieces.every(part => part.length <= MAX_PART_LENGTH && /^\S/u.test(part)));
  const solid = 'a'.repeat(450);
  assert.deepEqual(splitSentences(solid).map(part => part.length), [200, 200, 50]);
});
