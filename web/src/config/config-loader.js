// Coordinates use the original 463 × 539 image's pixel space.
const defaults = {
  greeting: { text: 'Merhaba! Ben Akilay.', delayMs: 1500 },
  speech: { lang: 'tr-TR', rate: 1, pitch: 1 },
  body: { src: 'assets/owner/akilay2-removebg-preview-1.png', width: 463, height: 539 },
  face: { style: 'drawn' },
  mouth: { x: 236, y: 221, width: 50, lipColor: '#985D50' },
  eyes: [
    { x: 201, y: 150, width: 30, height: 14, irisColor: '#45382F', lidColor: '#C8937A' },
    { x: 270, y: 149, width: 30, height: 14, irisColor: '#45382F', lidColor: '#C8937A' }
  ]
};

const number = (min, max = Infinity) => value =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const text = value => typeof value === 'string' && value.trim().length > 0;
const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const eyeSchema = { x: number(0), y: number(0), width: number(Number.MIN_VALUE), height: number(Number.MIN_VALUE), irisColor: color, lidColor: color };
const schema = {
  face: { style: value => value === 'photo' || value === 'drawn' },
  greeting: { text, delayMs: number(0) },
  speech: { lang: text, rate: number(0.5, 1.5), pitch: number(0.5, 1.5) },
  body: { src: text, width: number(Number.MIN_VALUE), height: number(Number.MIN_VALUE) },
  mouth: { x: number(0), y: number(0), width: number(Number.MIN_VALUE), lipColor: color }
};

/** A fresh result and a single Turkish warning per load, including partial input. */
export async function loadConfig(fetchFn = globalThis.fetch, logger = console) {
  let invalid = false;
  let input;
  try {
    const response = await fetchFn('/config/lypsync.config.json', { method: 'GET', cache: 'no-store' });
    if (!response.ok) throw new Error('Ayar dosyası okunamadı');
    input = await response.json();
  } catch {
    invalid = true;
  }
  if (!record(input)) {
    input = {};
    invalid = true;
  }
  function fields(source, fallback, rules) {
    const result = {};
    for (const [key, valid] of Object.entries(rules)) {
      if (record(source) && valid(source[key])) result[key] = source[key];
      else {
        invalid = true;
        result[key] = fallback[key];
      }
    }
    return result;
  }
  const result = {};
  for (const [key, rules] of Object.entries(schema)) {
    result[key] = fields(input[key], defaults[key], rules);
  }
  if (!Array.isArray(input.eyes) || input.eyes.length !== defaults.eyes.length) invalid = true;
  result.eyes = defaults.eyes.map((eye, index) =>
    fields(Array.isArray(input.eyes) ? input.eyes[index] : undefined, eye, eyeSchema));
  if (invalid) logger.warn('Ayar dosyasında eksik veya geçersiz alanlar var; varsayılan değerler kullanıldı.');
  return result;
}
