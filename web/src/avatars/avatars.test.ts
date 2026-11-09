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

  it('keeps avatar.png only in referenceImage', () => {
    expect(avatarsConfig.referenceImage).toBe('assets/owner/avatar.png');
    expect(existsSync(path.resolve(process.cwd(), '..', avatarsConfig.referenceImage))).toBe(true);
    expect(JSON.stringify(avatarsConfig.avatars)).not.toContain('avatar.png');
  });

  it('selectableAvatars returns only the four configured entries and never avatar.png', () => {
    const options = selectableAvatars();
    expect(options).toEqual(avatarsConfig.avatars);
    expect(options.map(option => option.id)).toEqual([1, 2, 3, 4]);
    expect(options.map(option => option.sourcePath)).not.toContain(avatarsConfig.referenceImage);
    expect(options.some(option => Object.values(option).some(value => String(value).includes('avatar.png')))).toBe(false);
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

  it.each(['x', 'y'] as const)('rejects a fractional %s anchor with a clear Turkish message', coordinate => {
    const data = manifest();
    data.layers[0].anchor[coordinate] = 1.5;
    expect(() => validateManifest(data))
      .toThrow(`1. katman ("face"): ankraj ${coordinate} koordinatı tam sayı olmalıdır; verilen değer: 1.5.`);
  });

  it('rejects a non-numeric anchor coordinate', () => {
    const data: { layers: { anchor: Record<string, unknown> }[] } = manifest();
    data.layers[0].anchor.y = '20';
    expect(() => validateManifest(data)).toThrow('ankraj y koordinatı tam sayı olmalıdır');
  });

  it.each([
    ['sourceFile', '1. katman ("face"): kaynak dosyası (sourceFile) eksik veya boş.'],
    ['derivationNote', '1. katman ("face"): türetme notu (derivationNote) eksik veya boş.'],
  ] as const)('rejects missing %s with a clear Turkish message', (field, message) => {
    const data: { layers: Record<string, unknown>[] } = manifest();
    delete data.layers[0][field];
    expect(() => validateManifest(data)).toThrow(message);
    data.layers[0][field] = '  ';
    expect(() => validateManifest(data)).toThrow(message);
  });

  it.each(['assets/owner/olmayan.png', avatarsConfig.referenceImage])('rejects unknown source file %s', sourceFile => {
    const data = manifest();
    data.layers[0].sourceFile = sourceFile;
    expect(() => validateManifest(data)).toThrow(`1. katman ("face"): kaynak dosyası bulunamadı: "${sourceFile}".`);
  });

  it('accepts every configured avatar source', () => {
    for (const avatar of avatarsConfig.avatars) {
      const data = manifest();
      data.layers[0].sourceFile = avatar.sourcePath;
      expect(validateManifest(data)).toBe(data);
    }
  });

  it.each([null, {}, { layers: [] }])('rejects invalid manifest structure', data => {
    expect(() => validateManifest(data)).toThrow('Manifest en az bir katman içermelidir.');
  });

  it.each([0, -1, Infinity, NaN])('rejects invalid scale %s', scale => {
    const data = manifest();
    data.layers[0].scale = scale;
    expect(() => validateManifest(data)).toThrow('ölçek (scale) sonlu ve sıfırdan büyük olmalıdır');
  });

  it('rejects duplicate layer names', () => {
    const data = manifest();
    data.layers.push({ ...data.layers[0] });
    expect(() => validateManifest(data)).toThrow('2. katman ("face"): katman adları benzersiz olmalıdır.');
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
