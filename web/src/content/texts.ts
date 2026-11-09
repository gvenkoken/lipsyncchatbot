/** Returns a value in [0, 1); callers can inject a seeded or fake generator. */
export type Random = () => number;

/** The four fixed sentences every avatar is tried with, in approved order. */
export const FIXED_TEST_SENTENCES = Object.freeze([
  'Merhaba, bugün size yardımcı olmaktan mutluluk duyarım.',
  'Ölçülü ve güler yüzlü bir üslupla sorularınızı yanıtlıyorum.',
  'Biraz düşünüp size en uygun çözümü bulacağım.',
  'Mavi gökyüzü, sıcak bir yaz sabahında pırıl pırıl parlıyordu.',
] as const);

export const RANDOM_TURKISH_TEXTS = Object.freeze([
  'Bugün gökyüzünde yavaşça ilerleyen bulutları izliyorum.',
  'Küçük bir mola verip yeni fikirler üzerine düşünelim.',
  'Birlikte çalışırken her ayrıntıyı dikkatle inceliyoruz.',
  'Şehrin çarşısında taze simit ve çay kokusu yayılıyordu.',
  'Öğleden sonra bahçedeki ağaçların gölgesinde kitap okuduk.',
]);

/** Call when the panel opens; the chosen text stays in session memory. */
export function selectRandomTurkishText(random: Random): string {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('Rastgele sayı sıfır dahil, bir hariç aralığında olmalıdır.');
  }
  return RANDOM_TURKISH_TEXTS[Math.floor(value * RANDOM_TURKISH_TEXTS.length)];
}
