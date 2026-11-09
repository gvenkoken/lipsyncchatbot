import { describe, expect, it, vi } from 'vitest';
import { RANDOM_TURKISH_TEXTS, selectRandomTurkishText } from './texts';

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

  it.each([-0.1, 1, Infinity, NaN])('rejects out of range Random result %s', value => {
    expect(() => selectRandomTurkishText(() => value)).toThrow('Rastgele sayı');
  });
});
