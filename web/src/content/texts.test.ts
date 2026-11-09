import { describe, expect, it, vi } from 'vitest';
import { FIXED_TEST_SENTENCES, RANDOM_TURKISH_TEXTS, selectRandomTurkishText } from './texts';

describe('fixed test sentences', () => {
  it('keeps exactly four sentences in approved order', () => {
    expect(FIXED_TEST_SENTENCES).toEqual([
      'Merhaba, bugün size yardımcı olmaktan mutluluk duyarım.',
      'Ölçülü ve güler yüzlü bir üslupla sorularınızı yanıtlıyorum.',
      'Biraz düşünüp size en uygun çözümü bulacağım.',
      'Mavi gökyüzü, sıcak bir yaz sabahında pırıl pırıl parlıyordu.',
    ]);
    expect(Object.isFrozen(FIXED_TEST_SENTENCES)).toBe(true);
  });
});

describe('random Turkish texts', () => {
  it('contains nonempty text and selects deterministically using injected Random', () => {
    expect(RANDOM_TURKISH_TEXTS.length).toBeGreaterThan(0);
    expect(RANDOM_TURKISH_TEXTS.every(text => text.trim().length > 0)).toBe(true);
    RANDOM_TURKISH_TEXTS.forEach((text, index) => {
      const random = vi.fn(() => (index + 0.5) / RANDOM_TURKISH_TEXTS.length);
      expect(selectRandomTurkishText(random)).toBe(text);
      expect(random).toHaveBeenCalledTimes(1);
    });
    expect(selectRandomTurkishText(() => 0)).toBe(RANDOM_TURKISH_TEXTS[0]);
    expect(selectRandomTurkishText(() => 0.999999)).toBe(RANDOM_TURKISH_TEXTS.at(-1));
  });

  it('returns the same text for the same injected sequence', () => {
    const sequence = () => { const values = [0.1, 0.7]; return () => values.shift()!; };
    const first = sequence();
    const second = sequence();
    expect([selectRandomTurkishText(first), selectRandomTurkishText(first)])
      .toEqual([selectRandomTurkishText(second), selectRandomTurkishText(second)]);
  });

  it.each([-0.1, 1, Infinity, NaN])('rejects out of range Random result %s', value => {
    expect(() => selectRandomTurkishText(() => value)).toThrow('Rastgele sayı');
  });
});
