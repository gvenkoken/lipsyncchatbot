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

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} eksik veya boş.`);
}

/** Checks manifest data, not filesystem existence; loading remains browser-compatible. */
export function validateManifest(value: unknown): AvatarManifest {
  if (!record(value) || !Array.isArray(value.layers) || value.layers.length === 0) {
    throw new Error('Manifest en az bir katman içermelidir.');
  }
  const names = new Set<string>();
  for (const layer of value.layers) {
    if (!record(layer)) throw new Error('Katman bir nesne olmalıdır.');
    requiredText(layer.name, 'Katman adı');
    if (names.has(layer.name)) throw new Error('Katman adları benzersiz olmalıdır.');
    names.add(layer.name);
    requiredText(layer.pngPath, 'PNG yolu');
    if (!layer.pngPath.endsWith('.png')) throw new Error('Katman yolu bir PNG dosyası olmalıdır.');
    if (!record(layer.anchor) || !Number.isInteger(layer.anchor.x) || !Number.isInteger(layer.anchor.y)) {
      throw new Error('Ankraj x ve y koordinatları tam sayı olmalıdır.');
    }
    if (typeof layer.scale !== 'number' || !Number.isFinite(layer.scale) || layer.scale <= 0) {
      throw new Error('Ölçek sonlu ve sıfırdan büyük olmalıdır.');
    }
    requiredText(layer.sourceFile, 'Kaynak dosyası');
    requiredText(layer.derivationNote, 'Türetme notu');
  }
  return value as unknown as AvatarManifest;
}

export type ManifestFetch = (path: string) => Promise<Pick<Response, 'ok' | 'json'>>;

/** Accepts only local derived manifest paths; no API or remote service is used. */
export async function loadManifest(path: string, fetchManifest: ManifestFetch = fetch): Promise<AvatarManifest> {
  if (!/^assets\/derived\/avatar-[1-4]\/manifest\.json$/.test(path)) {
    throw new Error('Manifest yolu yerel türev varlık dizininde olmalıdır.');
  }
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
