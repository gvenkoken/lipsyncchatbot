// Bilgi tabanı araması (RAG): pmi-rag-dummy altındaki Markdown belgelerini yükler, role göre filtreler ve arar.
// Tüm sohbet yolları (Gemini Live, OpenAI Realtime, zincir) aynı servisi kullanır.
// Sıra: rol -> izinli belgeler -> hibrit arama (kelime + varsa anlam vektörü) -> en iyi k belge.
// Yetki filtresi aramadan ÖNCE uygulanır: izinsiz belge puanlanmaz, sonuçlara da modele de hiç ulaşmaz.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

export type Role = 'employee' | 'partner' | 'guest';
export const ROLES: Role[] = ['employee', 'partner', 'guest'];
export const parseRole = (value: unknown): Role => value === 'employee' || value === 'partner' ? value : 'guest';
export type Doc = { id: string; title: string; audiences: string[]; category: string; tags: string[]; path: string; text: string; questions: string[] };
/** score: birleşik sıralama puanı (0..1, en iyi sonuca göre). lexical / semantic: ham kelime puanı ve kosinüs benzerliği. */
export type Hit = { id: string; title: string; category: string; score: number; lexical: number; semantic: number; vector: boolean; text: string };
export type Embedder = (texts: string[]) => Promise<number[][]>;

/** Misafir yalnızca ortak belgeleri görür; çalışan ve iş ortağı kendi belgeleri + ortak belgeleri. */
export const allowed = (doc: Doc, role: Role) => role === 'guest' ? doc.audiences.includes('employee') && doc.audiences.includes('partner') : doc.audiences.includes(role);

// ---------- yükleme ----------
const list = (value: string) => [...value.matchAll(/"([^"]*)"/g)].map(match => match[1]);
/** Frontmatter'lı tek belgeyi çözer. Kimliği ya da kitlesi olmayan dosya belge sayılmaz (README, index, test soruları). */
export function parseDoc(raw: string, path: string): Doc | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) { const pair = /^(\w+):\s*(.*)$/.exec(line); if (pair) meta[pair[1]] = pair[2].trim(); }
  const id = meta.id?.replace(/"/g, ''), audiences = list(meta.audiences ?? '');
  if (!id || !audiences.length) return null;
  // Modele giden metin: her belgede tekrarlanan uyarı ve kapsam notu çıkarılır (bunlar sistem talimatında bir kez söylenir).
  const text = match[2].replace(/^> \*\*DEMO[^\n]*\n/m, '').replace(/\n## Kapsam sınırı[\s\S]*$/, '').replace(/\n{3,}/g, '\n\n').trim();
  const questions = (/## Kullanıcının sorabileceği örnek sorular\s*\n([\s\S]*?)(?=\n## |$)/.exec(text)?.[1] ?? '').split('\n').map(line => line.replace(/^-\s*/, '').trim()).filter(Boolean);
  return { id, title: meta.title?.replace(/"/g, '') ?? id, audiences, category: meta.category?.replace(/"/g, '') ?? '', tags: list(meta.tags ?? ''), path, text, questions };
}
export function loadDocs(root: string): Doc[] {
  const docs: Doc[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir).sort()) { const file = join(dir, name); if (statSync(file).isDirectory()) walk(file); else if (name.endsWith('.md')) { const doc = parseDoc(readFileSync(file, 'utf8'), relative(root, file).replace(/\\/g, '/')); if (doc) docs.push(doc); } } };
  if (existsSync(root)) walk(root);
  return docs;
}

// ---------- kelime araması (BM25, alan ağırlıklı) ----------
const FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
const STOP = new Set(['ve', 'ile', 'icin', 'bir', 'bu', 'su', 'de', 'da', 'mi', 'mu', 'ne', 'nasil', 'nedir', 'nereden', 'ben', 'bana', 'benim', 'olur', 'var', 'yok', 'gibi', 'ya', 'veya', 'ama', 'cok', 'daha', 'en', 'ki', 'misin', 'miyim', 'lazim', 'gerek', 'yapmaliyim', 'yaparim', 'istiyorum', 'the', 'a', 'of']);
/** Türkçe için kaba kök: küçük harf, aksansız, en çok 5 harf (ekleri atar: "faturalarımı" -> "fatur"). */
export const tokens = (text: string) => text.toLocaleLowerCase('tr-TR').replace(/[çğıöşüâîû]/g, char => FOLD[char]).split(/[^a-z0-9]+/).filter(word => word.length > 1 && !STOP.has(word)).map(word => word.slice(0, 5));
const FIELDS: [(doc: Doc) => string, number][] = [[doc => doc.title, 3], [doc => doc.tags.join(' '), 3], [doc => doc.questions.join(' '), 2.5], [doc => doc.category, 1], [doc => doc.text, 1]];
type Indexed = { doc: Doc; tf: Map<string, number>; length: number; vector?: number[] };

export function createIndex(docs: Doc[]) {
  const items: Indexed[] = docs.map(doc => {
    const tf = new Map<string, number>(); let length = 0;
    for (const [field, weight] of FIELDS) for (const token of tokens(field(doc))) { tf.set(token, (tf.get(token) ?? 0) + weight); length += weight; }
    return { doc, tf, length };
  });
  const average = items.reduce((sum, item) => sum + item.length, 0) / Math.max(1, items.length);
  const df = new Map<string, number>();
  for (const item of items) for (const token of item.tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
  const lexical = (item: Indexed, query: string[]) => {
    let score = 0;
    for (const token of query) {
      const tf = item.tf.get(token); if (!tf) continue;
      const idf = Math.log(1 + (items.length - df.get(token)! + .5) / (df.get(token)! + .5));
      score += idf * tf * 2.2 / (tf + 1.2 * (.25 + .75 * item.length / average));
    }
    return score;
  };
  const cosine = (a: number[], b: number[]) => { let dot = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return dot / (Math.sqrt(x * y) || 1); };
  return {
    docs, size: items.length,
    /** Belge vektörlerini ekler (id -> vektör). Verilmezse arama yalnızca kelimeyle çalışır. */
    setVectors(vectors: Map<string, number[]>) { for (const item of items) item.vector = vectors.get(item.doc.id); },
    hasVectors: () => items.some(item => item.vector),
    /** role göre izinli belgelerde arar. queryVector verilirse kelime ve anlam puanı eşit ağırlıkla birleşir. */
    search(query: string, role: Role, k = 3, queryVector?: number[]): Hit[] {
      const pool = items.filter(item => allowed(item.doc, role));           // yetki filtresi: aramadan önce
      const words = tokens(query);
      const scored = pool.map(item => ({ item, lexical: lexical(item, words), semantic: queryVector && item.vector ? cosine(queryVector, item.vector) : 0 }));
      const top = Math.max(...scored.map(entry => entry.lexical), 1e-9), semanticTop = Math.max(...scored.map(entry => entry.semantic), 1e-9);
      const useSemantic = !!queryVector && scored.some(entry => entry.semantic > 0);
      return scored.map(entry => ({ entry, score: useSemantic ? .5 * entry.lexical / top + .5 * entry.semantic / semanticTop : entry.lexical / top }))
        .filter(result => useSemantic ? result.score > .35 : result.entry.lexical > 0)
        .sort((a, b) => b.score - a.score).slice(0, k)
        .map(({ entry, score }) => ({ id: entry.item.doc.id, title: entry.item.doc.title, category: entry.item.doc.category, score: Math.round(score * 1000) / 1000, lexical: Math.round(entry.lexical * 100) / 100, semantic: Math.round(entry.semantic * 1000) / 1000, vector: useSemantic, text: entry.item.doc.text }));
    },
  };
}
export type Index = ReturnType<typeof createIndex>;

// ---------- anlam vektörleri (isteğe bağlı, OpenAI) ----------
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export function openaiEmbedder(apiKey: string, request: typeof fetch = fetch): Embedder {
  return async texts => {
    const response = await request('https://api.openai.com/v1/embeddings', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }) });
    if (!response.ok) throw new Error(`embedding ${response.status}`);
    const body = await response.json() as { data: { index: number; embedding: number[] }[] };
    return body.data.sort((a, b) => a.index - b.index).map(item => item.embedding);
  };
}
const embedText = (doc: Doc) => `${doc.title}\n${doc.tags.join(', ')}\n${doc.questions.join('\n')}\n${doc.text}`.slice(0, 6000);

/** Arama servisi: belgeleri bir kez yükler; vektörleri diskte önbelleğe alır (belge içeriği değişince yenilenir).
 *  Anahtar yoksa ya da vektör servisi hata verirse sessizce kelime aramasına düşer. */
export function createRag(options: { root: string; cacheFile?: string; getApiKey?: () => string; embedder?: Embedder }) {
  let index: Index | undefined, vectors: Promise<void> | undefined, embedder: Embedder | undefined;
  const ensure = () => index ??= createIndex(loadDocs(options.root));
  const prepare = () => vectors ??= (async () => {
    const current = ensure(), key = options.getApiKey?.().trim() ?? '';
    embedder = options.embedder ?? (key ? openaiEmbedder(key) : undefined);
    if (!embedder || !current.size) return;
    const hash = createHash('sha256').update(EMBEDDING_MODEL + current.docs.map(doc => doc.id + embedText(doc)).join('\u0000')).digest('hex');
    try {
      if (options.cacheFile && existsSync(options.cacheFile)) {
        const cached = JSON.parse(readFileSync(options.cacheFile, 'utf8')) as { hash: string; vectors: Record<string, number[]> };
        if (cached.hash === hash) { current.setVectors(new Map(Object.entries(cached.vectors))); return; }
      }
      const result = await embedder(current.docs.map(embedText));
      const map = new Map(current.docs.map((doc, i) => [doc.id, result[i]]));
      current.setVectors(map);
      if (options.cacheFile) { mkdirSync(join(options.cacheFile, '..'), { recursive: true }); writeFileSync(options.cacheFile, JSON.stringify({ hash, vectors: Object.fromEntries(map) })); }
    } catch { embedder = undefined; }     // vektör yoksa kelime araması yeterli sonuç verir
  })();
  return {
    prepare,
    async search(query: string, role: Role, k = 3): Promise<Hit[]> {
      await prepare();
      const current = ensure();
      let queryVector: number[] | undefined;
      if (embedder && current.hasVectors()) { try { [queryVector] = await embedder([query.slice(0, 2000)]); } catch { /* kelime aramasıyla devam */ } }
      return current.search(query, role, k, queryVector);
    },
    stats: () => { const current = ensure(); return { documents: current.size, vectors: current.hasVectors() }; },
  };
}
export type Rag = ReturnType<typeof createRag>;

/** İlgililik eşikleri (gerçek vektörlerle ölçüldü, Kasım 2026): doğru belgede kosinüs 0,41–0,62, ilgisiz sorularda en çok 0,38.
 *  Vektör yokken (yedek yol) ham kelime puanı kullanılır. Bu puan ilgili ve ilgisiz soruyu güvenilir ayıramaz
 *  (doğru belge 3,5'e kadar düşüyor, ilgisiz soru 6'ya çıkabiliyor); eşik yalnızca açıkça alakasız sonuçları eler. */
export const RELEVANCE = { semantic: .4, semanticLexical: 2, support: .3, lexicalOnly: 3.5, lexicalSupport: 2.5 };
const confident = (hit: Hit) => hit.vector ? hit.semantic >= RELEVANCE.semantic && hit.lexical >= RELEVANCE.semanticLexical : hit.lexical >= RELEVANCE.lexicalOnly;
const supporting = (hit: Hit) => hit.vector ? hit.semantic >= RELEVANCE.support : hit.lexical >= RELEVANCE.lexicalSupport;
/** Arama sonucundan modele gidecek belgeleri ve ekranda gösterilecek kaynakları seçer.
 *  En iyi sonuç yeterince ilgili değilse hiçbir belge verilmez: model "bilmiyorum" der, ekranda kaynak görünmez. */
export function selectHits(hits: Hit[]): { context: Hit[]; sources: Hit[] } {
  if (!hits.length || !confident(hits[0])) return { context: [], sources: [] };
  return { context: hits.filter((hit, index) => index === 0 || confident(hit) || supporting(hit)), sources: hits.filter(confident).slice(0, 2) };
}

/** Modele verilen araç yanıtı: belge metinleri + nasıl kullanılacağı. Sonuç yoksa bunu açıkça söyler. */
export function toolResult(hits: Hit[], role: Role) {
  if (!hits.length) return { sonuc: 'Bu rol için bilgi tabanında ilgili belge bulunamadı.', talimat: role === 'guest' ? 'Kullanıcı giriş yapmadı. Çalışan ya da iş ortağı belgeleri için sağ üstten giriş yapması gerektiğini söyle; bilgi uydurma.' : 'Bu konuda bilgin olmadığını ya da bu rolün erişimi olmadığını söyle; bilgi uydurma, başka rolün belgelerinden söz etme.' };
  return { belgeler: hits.map(hit => ({ kimlik: hit.id, baslik: hit.title, icerik: hit.text })), talimat: 'Yalnızca bu belgelere dayanarak kısa ve sesli okunacak biçimde yanıtla. Belge kimliğini ve başlığını sesli söyleme; ekranda ayrıca gösteriliyor. Belgede olmayan ayrıntıyı uydurma.' };
}
