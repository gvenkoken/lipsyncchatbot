// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateManifest } from '../../src/avatars/manifest';
import { avatarsConfig } from '../../src/avatars/avatars.config';
// The standalone tool uses native Node modules and does not need a TS build.
// @ts-expect-error Standalone JavaScript tool has no declaration bundle.
import { derive, sourceHashes } from '../../../tools/derive-assets/index.mjs';
// @ts-expect-error Standalone PNG codec has no declaration bundle.
import { decodePng } from '../../../tools/derive-assets/png.mjs';

const root = path.resolve(process.cwd(), '..');
const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
let temporary: string;
let output: string;
beforeAll(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'avatar-integrity-'));
  output = path.join(temporary, 'derived');
  await derive({ root, output });
}, 30000);
afterAll(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

describe('source integrity and derived layers', () => {
  it('preserves every owner file and matches the committed SHA-256 inventory', async () => {
    const expected = await readJson(path.join(root, 'assets/derived/source-hashes.json'));
    expect(await sourceHashes(root)).toEqual(expected);
    expect(await readJson(path.join(output, 'source-hashes.json'))).toEqual(expected);
  });

  it.each(avatarsConfig.avatars)('validates geometry and provenance for $label', async avatar => {
    const folder = `avatar-${avatar.id}`;
    const manifest = validateManifest(await readJson(path.join(output, folder, 'manifest.json')));
    expect(manifest).toEqual(await readJson(path.join(root, avatar.manifestPath)));
    expect(manifest.layers.map(layer => layer.name)).toEqual([
      'base', 'eyes-open', 'eyes-half-open', 'eyes-closed', 'brows-neutral',
      'mouth-closed', 'mouth-A', 'mouth-E', 'mouth-I', 'mouth-O', 'mouth-U', 'mouth-consonant',
    ]);
    const base = decodePng(await readFile(path.join(output, folder, 'base.png')));
    const channels = new Map<string, unknown>();
    for (const layer of manifest.layers) {
      expect(layer.pngPath).toBe(`assets/derived/${folder}/${layer.name}.png`);
      expect(layer.sourceFile).toBe(avatar.sourcePath);
      expect(layer.derivationNote.trim().length).toBeGreaterThan(0);
      expect(layer.scale).toBe(1);
      expect(Number.isInteger(layer.anchor.x) && Number.isInteger(layer.anchor.y)).toBe(true);
      const png = decodePng(await readFile(path.join(output, folder, `${layer.name}.png`)));
      expect(layer.anchor.x).toBeGreaterThanOrEqual(0);
      expect(layer.anchor.y).toBeGreaterThanOrEqual(0);
      expect(layer.anchor.x + png.width * layer.scale).toBeLessThanOrEqual(base.width);
      expect(layer.anchor.y + png.height * layer.scale).toBeLessThanOrEqual(base.height);
      const channel = layer.name.split('-')[0];
      const geometry = { width: png.width, height: png.height, anchor: layer.anchor };
      if (channels.has(channel)) expect(geometry).toEqual(channels.get(channel));
      else channels.set(channel, geometry);
      // All provisional poses retain the exact neutral pixels: no face drift,
      // color change or crop edge is introduced while artwork is pending.
      if (layer.name !== 'base') {
        const stride = png.width * png.channels;
        for (let row = 0; row < png.height; row++) {
          const start = ((row + layer.anchor.y) * base.width + layer.anchor.x) * base.channels;
          expect(png.pixels.subarray(row * stride, (row + 1) * stride)).toEqual(base.pixels.subarray(start, start + stride));
        }
      }
    }
    expect((await readdir(path.join(output, folder))).sort()).toEqual(['manifest.json', ...manifest.layers.map(layer => `${layer.name}.png`)].sort());
  });

  it('rejects output overlapping owner sources before writing', async () => {
    await expect(derive({ root, output: path.join(root, 'assets/owner') })).rejects.toThrow('overlaps');
  });
});
