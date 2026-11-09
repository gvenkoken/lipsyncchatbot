/** Returns a value in [0, 1); callers can inject a seeded or fake generator. */
export type Random = () => number;

export const RANDOM_TURKISH_TEXTS = Object.freeze([
  'Bugün gökyüzünde yavaşça ilerleyen bulutları izliyorum.',
  'Küçük bir mola verip yeni fikirler üzerine düşünelim.',
  'Birlikte çalışırken her ayrıntıyı dikkatle inceliyoruz.',
]);

/** Call when the panel opens; the chosen text stays in session memory. */
export function selectRandomTurkishText(random: Random): string {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('Rastgele sayı sıfır dahil, bir hariç aralığında olmalıdır.');
  }
  return RANDOM_TURKISH_TEXTS[Math.floor(value * RANDOM_TURKISH_TEXTS.length)];
}
