import { readFileSync, statSync } from 'node:fs';
import { RAG_PROMPT_FILE } from './paths.ts';

/** rag-prompt.md içindeki bölüm adları; hepsi dosyada bulunmalıdır. */
export const PROMPT_KEYS = ['kimlik', 'kullanici_adli', 'kullanici', 'bilgi_tabani', 'misafir', 'kurallar', 'arac_aciklamasi', 'arac_sorgu_aciklamasi', 'sonuc_var_talimat', 'sonuc_yok', 'sonuc_yok_talimat', 'sonuc_yok_misafir_talimat', 'yazili_soru_notu'] as const;
export type PromptKey = typeof PROMPT_KEYS[number];
export type Prompts = Record<PromptKey, string>;

/** `## ad` başlıklarıyla bölünmüş metni okur; ilk başlıktan önceki açıklama atlanır. Eksik bölüm varsa hata verir. */
export function parsePrompts(raw: string): Prompts {
  const sections: Record<string, string> = {};
  let key: string | null = null;
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^##\s+(\S+)\s*$/.exec(line);
    if (heading) { key = heading[1]; sections[key] = ''; continue; }
    if (key) sections[key] += line + '\n';
  }
  const missing = PROMPT_KEYS.filter(name => !sections[name]?.trim());
  if (missing.length) throw new Error(`rag-prompt.md içinde eksik bölüm: ${missing.join(', ')}`);
  return Object.fromEntries(PROMPT_KEYS.map(name => [name, sections[name].trim()])) as Prompts;
}

/** `{ad}` gibi yer tutucuları doldurur; bilinmeyenler olduğu gibi kalır. */
export const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);

const DEFAULT_FILE = RAG_PROMPT_FILE;
let cache: { file: string; mtime: number; prompts: Prompts } | null = null;

/** Dosyayı değiştiyse yeniden okur. Düzenleme sırasında dosya bozulursa son geçerli sürüm kullanılmaya devam eder. */
export function loadPrompts(file = DEFAULT_FILE): Prompts {
  try {
    const mtime = statSync(file).mtimeMs;
    if (cache?.file !== file || cache.mtime !== mtime) cache = { file, mtime, prompts: parsePrompts(readFileSync(file, 'utf8')) };
  } catch (error) {
    if (cache?.file !== file) throw error;
  }
  return cache.prompts;
}
