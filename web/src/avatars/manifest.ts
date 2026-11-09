import { avatarsConfig } from './avatars.config';

export interface AvatarLayer {
  readonly name: string;
  readonly pngPath: string;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly scale: number;
  readonly sourceFile: string;
  readonly derivationNote: string;
}

export interface AvatarManifest {
  readonly layers: readonly AvatarLayer[];
}

const CONFIGURED_SOURCES: readonly string[] = avatarsConfig.avatars.map(avatar => avatar.sourcePath);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
}

/**
 * Checks manifest data without dependencies; sourceFile must be one of the configured
 * owner sources so a derived layer never points at a missing or unapproved file.
 */
export function validateManifest(value: unknown, knownSources: readonly string[] = CONFIGURED_SOURCES): AvatarManifest {
  if (!record(value) || !Array.isArray(value.layers) || value.layers.length === 0) {
    throw new Error('Manifest en az bir katman içermelidir.');
  }
  const names = new Set<string>();
  value.layers.forEach((layer: unknown, index) => {
    const position = `${index + 1}. katman`;
    if (!record(layer)) throw new Error(`${position} bir nesne olmalıdır.`);
    requiredText(layer.name, `${position}: katman adı (name) eksik veya boş.`);
    const where = `${position} ("${layer.name}")`;
    if (names.has(layer.name)) throw new Error(`${where}: katman adları benzersiz olmalıdır.`);
    names.add(layer.name);
    requiredText(layer.pngPath, `${where}: PNG yolu (pngPath) eksik veya boş.`);
    if (!layer.pngPath.endsWith('.png')) throw new Error(`${where}: katman yolu bir PNG dosyası olmalıdır.`);
    const anchor = layer.anchor;
    if (!record(anchor)) throw new Error(`${where}: ankraj (anchor) x ve y koordinatlarıyla tanımlanmalıdır.`);
    for (const axis of ['x', 'y'] as const) {
      if (!Number.isInteger(anchor[axis])) {
        throw new Error(`${where}: ankraj ${axis} koordinatı tam sayı olmalıdır; verilen değer: ${String(anchor[axis])}.`);
      }
    }
    if (typeof layer.scale !== 'number' || !Number.isFinite(layer.scale) || layer.scale <= 0) {
      throw new Error(`${where}: ölçek (scale) sonlu ve sıfırdan büyük olmalıdır.`);
    }
    requiredText(layer.sourceFile, `${where}: kaynak dosyası (sourceFile) eksik veya boş.`);
    if (!knownSources.includes(layer.sourceFile)) {
      throw new Error(`${where}: kaynak dosyası bulunamadı: "${layer.sourceFile}". Yalnız assets/owner altındaki Avatar 1–4 kaynakları kullanılabilir.`);
    }
    requiredText(layer.derivationNote, `${where}: türetme notu (derivationNote) eksik veya boş.`);
  });
  return value as unknown as AvatarManifest;
}

export type ManifestFetch = (path: string) => Promise<Pick<Response, 'ok' | 'json'>>;

/** Accepts only local derived manifest paths; no API or remote service is used. */
export async function loadManifest(path: string, fetchManifest: ManifestFetch = fetch): Promise<AvatarManifest> {
  if (!/^assets\/derived\/avatar-[1-4]\/manifest\.json$/.test(path)) {
    throw new Error('Manifest yolu yerel türev varlık dizininde olmalıdır.');
  }
  // Vite serves the repository's assets/ folder as its public directory.
  const url = `${import.meta.env.BASE_URL}${path.slice('assets/'.length)}`;
  let response: Pick<Response, 'ok' | 'json'>;
  try {
    response = await fetchManifest(url);
  } catch {
    throw new Error('Manifest yüklenemedi.');
  }
  if (!response.ok) throw new Error('Manifest dosyası bulunamadı veya yüklenemedi.');
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('Manifest geçerli JSON içermelidir.');
  }
  return validateManifest(data);
}
