import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences } from '../../web/src/speech/index.js';

test('sentences retain order, punctuation and whitespace', () => {
  for (const [text, expected] of [
    ['Merhaba.', ['Merhaba.']],
    ['Bir. İki? Üç! Dört. Beş.  ', ['Bir. ', 'İki? ', 'Üç! ', 'Dört. ', 'Beş.  ']],
    ['Dr. Deniz geldi.  ', ['Dr. ', 'Deniz geldi.  ']],
    ['  Merhaba', ['  Merhaba']],
  ]) {
    const parts = splitSentences(text);
    assert.deepEqual(parts, expected);
    assert.equal(parts.join(''), text);
    assert.ok(parts.every(part => part.trim()));
  }
  assert.deepEqual(splitSentences('   '), []);
  assert.deepEqual(splitSentences(''), []);
});
