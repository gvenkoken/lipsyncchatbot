// Çevrimdışı önizleme için kare başına ağız katmanlarını üretir (tarayıcıdaki mantığın aynısı).
// Kullanım: node scripts/avatar-render-frames.mjs s00 s02 ...   ->  viseme_analysis/out_v2/render/<id>.json
// Görüntüye çevirme: viseme_analysis/scripts/c03_render.py
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignSamples, tokenize, DEFAULT_ALIGN } from '../src/video-avatar/align.ts';
import { buildTrack, sampleTrack, loudnessEnvelope, levelAt } from '../src/video-avatar/visemes.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'viseme_analysis/out_v2/calib'), out = path.join(root, 'viseme_analysis/out_v2/render');
fs.mkdirSync(out, { recursive: true });
const dataset = JSON.parse(fs.readFileSync(path.join(dir, 'dataset.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/viseme-rig/manifest.json'), 'utf8'));
const FPS = 30;
const ids = process.argv.slice(2);
for (const item of dataset.items.filter(entry => ids.includes(entry.id))) {
  const bytes = fs.readFileSync(path.join(dir, item.wav)), pcm = new Int16Array(bytes.buffer, bytes.byteOffset + 44, (bytes.length - 44) >> 1);
  const samples = Float32Array.from(pcm, value => value / 32768), sampleRate = bytes.readUInt32LE(24);
  const aligned = alignSamples(samples, sampleRate, item.text).timings;
  // Referans: Whisper kelime aralıkları içinde harfler eşit ağırlıkla dağıtılır.
  const words = tokenize(item.text, DEFAULT_ALIGN), reference = [];
  if (words.length === item.words.length) words.forEach((word, index) => {
    const { start, end } = item.words[index], total = word.units.reduce((sum, unit) => sum + unit.weight, 0) || 1;
    let cursor = start;
    for (const unit of word.units) { const length = (end - start) * unit.weight / total; reference.push({ char: unit.char, start: cursor, end: cursor + length }); cursor += length; }
    reference.push({ char: ' ', start: end, end: item.words[index + 1]?.start ?? end });
  });
  const envelope = loudnessEnvelope(samples, sampleRate);
  const frames = source => { const track = buildTrack(source); return Array.from({ length: Math.ceil(item.duration * FPS) }, (_, frame) => {
    const time = (frame + .5) / FPS;
    return sampleTrack(track, time, levelAt(envelope, time)).filter(layer => layer.viseme !== 'SIL' && layer.weight > .005)
      .map(layer => ({ sprite: manifest.visemes[layer.viseme][layer.variant % manifest.visemes[layer.viseme].length], weight: +layer.weight.toFixed(3) }));
  }); };
  fs.writeFileSync(path.join(out, item.id + '.json'), JSON.stringify({ id: item.id, text: item.text, wav: item.wav, fps: FPS, align: frames(aligned), reference: frames(reference) }));
  console.log(item.id, item.text);
}
