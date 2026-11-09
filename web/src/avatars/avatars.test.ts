import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { avatarsConfig, selectableAvatars } from './avatars.config';
import { loadManifest, validateManifest } from './manifest';

describe('avatar configuration', () => {
  it('keeps exactly four ordered sources that exist on disk', () => {
    expect(avatarsConfig.avatars.map(({ id, label }) => [id, label])).toEqual([
      [1, 'Avatar 1'], [2, 'Avatar 2'], [3, 'Avatar 3'], [4, 'Avatar 4'],
    ]);
    for (const avatar of avatarsConfig.avatars) {
      expect(avatar.sourcePath.startsWith('assets/owner/')).toBe(true);
      expect(existsSync(path.resolve(process.cwd(), '..', avatar.sourcePath))).toBe(true);
      expect(avatar.manifestPath).toBe(`assets/derived/avatar-${avatar.id}/manifest.json`);
    }
  });

  it('exposes only configured options and keeps the reference separate', () => {
    expect(selectableAvatars()).toBe(avatarsConfig.avatars);
    expect(selectableAvatars()).toHaveLength(4);
    expect(selectableAvatars().some(avatar => avatar.sourcePath.endsWith('/avatar.png'))).toBe(false);
    expect(avatarsConfig.referenceImage).toBe('assets/owner/avatar.png');
  });
});

function manifest() {
  return { layers: [{ name: 'face', pngPath: 'assets/derived/avatar-1/face.png',
    anchor: { x: 10, y: 20 }, scale: 1,
    sourceFile: avatarsConfig.avatars[0].sourcePath, derivationNote: 'Kaynak görselden kesildi.' }] };
}

describe('manifest validation', () => {
  it('accepts valid layers without changing anchors', () => {
    const data = manifest();
    expect(validateManifest(data)).toBe(data);
  });

  it.each(['x', 'y'] as const)('rejects fractional %s anchors', coordinate => {
    const data = manifest();
    data.layers[0].anchor[coordinate] = 1.5;
    expect(() => validateManifest(data)).toThrow('Ankraj x ve y koordinatları tam sayı olmalıdır.');
  });

  it.each([
    ['sourceFile', 'Kaynak dosyası'], ['derivationNote', 'Türetme notu'],
  ] as const)('rejects missing %s', (field, message) => {
    const data: { layers: Record<string, unknown>[] } = manifest();
    delete data.layers[0][field];
    expect(() => validateManifest(data)).toThrow(message);
    data.layers[0][field] = '  ';
    expect(() => validateManifest(data)).toThrow(message);
  });

  it.each([null, {}, { layers: [] }])('rejects invalid manifest structure', data => {
    expect(() => validateManifest(data)).toThrow('Manifest en az bir katman içermelidir.');
  });

  it.each([0, -1, Infinity, NaN])('rejects invalid scale %s', scale => {
    const data = manifest();
    data.layers[0].scale = scale;
    expect(() => validateManifest(data)).toThrow('Ölçek');
  });
});

describe('static manifest loading', () => {
  it('loads the configured same-origin static path and validates its JSON', async () => {
    const data = manifest();
    const fetchManifest = vi.fn().mockResolvedValue({ ok: true, json: async () => data });
    expect(await loadManifest(avatarsConfig.avatars[0].manifestPath, fetchManifest)).toEqual(data);
    expect(fetchManifest).toHaveBeenCalledTimes(1);
    expect(fetchManifest).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}derived/avatar-1/manifest.json`);
  });

  it('rejects remote or traversal paths before loading', async () => {
    const fetchManifest = vi.fn();
    for (const path of ['https://example.org/manifest.json', 'assets/derived/../manifest.json']) {
      await expect(loadManifest(path, fetchManifest)).rejects.toThrow('yerel türev');
    }
    expect(fetchManifest).not.toHaveBeenCalled();
  });

  it('reports transport, HTTP, JSON and validation errors', async () => {
    await expect(loadManifest(avatarsConfig.avatars[0].manifestPath, async () => { throw new Error(); })).rejects.toThrow('Manifest yüklenemedi.');
    await expect(loadManifest(avatarsConfig.avatars[0].manifestPath, async () => ({ ok: false, json: async () => null }))).rejects.toThrow('bulunamadı');
    await expect(loadManifest(avatarsConfig.avatars[0].manifestPath, async () => ({ ok: true, json: async () => { throw new Error(); } }))).rejects.toThrow('geçerli JSON');
    await expect(loadManifest(avatarsConfig.avatars[0].manifestPath, async () => ({ ok: true, json: async () => ({ layers: [] }) }))).rejects.toThrow('en az bir katman');
  });
});
