import { readFile, readdir, mkdir, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, cropPng } from './png.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const recipes = [
  ['konusan-avatar-katman-varlik-seti-1.png', [6, 8, 260, 300], [89, 119, 109, 30], [89, 92, 109, 25], [110, 165, 76, 36]],
  ['konusan-avatar-katman-seti-2.png', [15, 10, 220, 345], [65, 117, 110, 30], [65, 92, 110, 25], [91, 164, 76, 36]],
  ['konusan-avatar-turkce-spritesheet-i-3.png', [16, 14, 160, 308], [43, 85, 92, 25], [43, 66, 92, 19], [61, 124, 65, 32]],
  ['yuz-animasyon-sprite-atlasi-4.png', [8, 12, 360, 590], [99, 132, 150, 40], [99, 106, 150, 26], [139, 207, 100, 45]],
];
export async function sourceHashes(root = repositoryRoot) {
  const hashes = {};
  async function visit(directory) {
    for (const entry of (await readdir(path.join(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile()) hashes[relative] = createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex');
      else throw new Error('Owner sources must be regular files or directories');
    }
  }
  await visit('assets/owner');
  return hashes;
}
export function manifests() {
  return recipes.map(([file, base, eyes, brows, mouth], index) => {
    const prefix = `assets/derived/avatar-${index + 1}`;
    const layer = (name, crop, pending = false) => ({
      name, pngPath: `${prefix}/${name}.png`, anchor: { x: crop[0] - base[0], y: crop[1] - base[1] }, scale: 1,
      sourceFile: `assets/owner/${file}`,
      derivationNote: `${pending ? 'türetilecek: hizalanmış poz mevcut değil; nötr yama kullanılır. ' : ''}Sabit nötr kaynaktan kayıpsız kırpım [${crop.join(', ')}]; yeniden ölçekleme yok.`,
    });
    return { layers: [
      { ...layer('base', base), anchor: { x: 0, y: 0 } },
      ...['open', 'half-open', 'closed'].map(pose => layer(`eyes-${pose}`, eyes, pose !== 'open')),
      layer('brows-neutral', brows),
      ...['closed', 'A', 'E', 'I', 'O', 'U', 'consonant'].map(pose => layer(`mouth-${pose}`, mouth, pose !== 'closed')),
    ] };
  });
}
/** Output is always a derived directory; source files are opened read-only. */
export async function derive({ root = repositoryRoot, output = path.join(root, 'assets/derived'), metadataOnly = false } = {}) {
  const destination = path.resolve(output);
  const owner = path.resolve(root, 'assets/owner');
  if (destination === owner || destination.startsWith(owner + path.sep) || owner.startsWith(destination + path.sep)) throw new Error('Output overlaps owner sources');
  // Reject links in output paths so a derived path cannot redirect a write.
  async function safeWrite(file, bytes) {
    for (let current = file; ; current = path.dirname(current)) {
      try {
        if ((await lstat(current)).isSymbolicLink()) throw new Error('Output path contains a symbolic link');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (path.dirname(current) === current) break;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  const before = await sourceHashes(root);
  try {
    const baseline = JSON.parse(await readFile(path.join(root, 'assets/derived/source-hashes.json'), 'utf8'));
    if (JSON.stringify(baseline) !== JSON.stringify(before)) throw new Error('Owner sources differ from approved hash inventory');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const all = manifests();
  for (const [index, manifest] of all.entries()) {
    const directory = path.join(destination, `avatar-${index + 1}`);
    if (!metadataOnly) {
      const image = decodePng(await readFile(path.join(root, manifest.layers[0].sourceFile)));
      const [, base, eyes, brows, mouth] = recipes[index];
      for (const layer of manifest.layers) {
        const rectangle = layer.name === 'base' ? base : layer.name.startsWith('eyes-') ? eyes : layer.name.startsWith('brows-') ? brows : mouth;
        await safeWrite(path.join(directory, path.basename(layer.pngPath)), cropPng(image, rectangle));
      }
    }
    await safeWrite(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  if (JSON.stringify(before) !== JSON.stringify(await sourceHashes(root))) throw new Error('Owner sources changed during derivation');
  await safeWrite(path.join(destination, 'source-hashes.json'), JSON.stringify(before, null, 2) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await derive();
