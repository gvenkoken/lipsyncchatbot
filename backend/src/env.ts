import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** .env dosyasındaki `AD=değer` satırlarını okur; yorumlar ve tırnaklar desteklenir. */
export function parseEnv(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    const quoted = /^(['"])(.*)\1$/.exec(value);
    value = quoted ? quoted[2] : value.replace(/\s+#.*$/, '');
    values[match[1]] = value;
  }
  return values;
}

/** Her çağrıda .env ve .env.local dosyalarını yeniden okur (anahtar değişince yeniden başlatma gerekmez).
 *  Öncelik: süreç ortam değişkenleri > .env.local > .env. Yalnızca verilen öneklerle başlayan değişkenler döner. */
export function loadEnv(dir: string, prefixes: string | string[]): Record<string, string> {
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local']) {
    const file = join(dir, name);
    if (existsSync(file)) Object.assign(merged, parseEnv(readFileSync(file, 'utf8')));
  }
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) merged[key] = value;
  return Object.fromEntries(Object.entries(merged).filter(([key]) => list.some(prefix => key.startsWith(prefix))));
}
