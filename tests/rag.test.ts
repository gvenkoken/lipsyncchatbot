import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { allowed, createIndex, createRag, loadDocs, parseDoc, parseRole, selectHits, tokens, toolResult, type Hit, type Role } from '../server/rag.ts';

const ROOT = join(import.meta.dirname, '..', 'pmi-rag-dummy');
const docs = loadDocs(ROOT), index = createIndex(docs);
const top = (query: string, role: Role, k = 3) => index.search(query, role, k).map(hit => hit.id);

test('belgeler yüklenir: 42 belge; README, index ve test soruları belge sayılmaz', () => {
  assert.equal(docs.length, 42);
  assert.deepEqual([docs.filter(doc => doc.id.startsWith('SHR')).length, docs.filter(doc => doc.id.startsWith('EMP')).length, docs.filter(doc => doc.id.startsWith('PAR')).length], [5, 21, 16]);
  const vpn = docs.find(doc => doc.id === 'EMP-IT-001')!;
  assert.equal(vpn.title, 'VPN bağlantı sorunlarını giderme'); assert.deepEqual(vpn.audiences, ['employee']); assert.ok(vpn.tags.includes('vpn'));
  assert.deepEqual(vpn.questions, ['VPN açılmıyor', 'VPN bağlantısı kopuyor', 'Evden ağa bağlanamıyorum']);
  assert.ok(!vpn.text.includes('DEMO / SENTETİK') && !vpn.text.includes('Kapsam sınırı') && vpn.text.includes('DemoDesk'));
  assert.equal(parseDoc('# başlıksız', 'x.md'), null);
});

test('rol ve yetki: misafir yalnızca ortak belgeleri görür', () => {
  assert.deepEqual([parseRole('employee'), parseRole('partner'), parseRole('admin'), parseRole(undefined)], ['employee', 'partner', 'guest', 'guest']);
  const count = (role: Role) => docs.filter(doc => allowed(doc, role)).length;
  assert.deepEqual([count('employee'), count('partner'), count('guest')], [26, 21, 5]);
  assert.deepEqual(tokens('Faturalarımı görüntüleyebilir miyim?'), ['fatur', 'gorun']);
});

// 00_test_questions.md: beklenen belge ilk 3 sonuç içinde olmalı (Recall@3), yalnızca kelime aramasıyla.
const EMPLOYEE: [string, string][] = [['VPN bağlanmıyor, ne yapmalıyım?', 'EMP-IT-001'], ['Beklenmedik MFA kodu geldi.', 'EMP-IT-002'], ['Yıllık iznim kaç gün kaldı?', 'EMP-HR-002'], ['Masraf beyanını nereden yaparım?', 'EMP-OPS-001'],
  ['Yeni çalışanım, ilk hafta ne yapmalıyım?', 'EMP-HR-001'], ['Laptopumu kaybettim.', 'EMP-IT-004'], ['Tedarikçiden hediye geldi, ne yapmalıyım?', 'EMP-SEC-004'], ['Kişisel veriyi chate yükleyebilir miyim?', 'EMP-SEC-003']];
const PARTNER: [string, string][] = [['Bayi portalına giremiyorum.', 'PAR-IT-001'], ['Bayi portalında dosya yükleyemiyorum.', 'PAR-IT-002'], ['Yeni kullanıcıya yetki vermek istiyorum.', 'PAR-ONB-002'], ['Fatura uyuşmazlığını nasıl bildiririm?', 'PAR-FIN-001'],
  ['Ödeme durumumu söyler misin?', 'PAR-FIN-002'], ['API entegrasyon anahtarımı göndersem olur mu?', 'PAR-OPS-003'], ['Hasarlı teslimat geldi.', 'PAR-QA-002'], ['Üründe kalite sorunu gözlemledim.', 'PAR-QA-001']];

test('test soruları: beklenen belge ilk üç sonuçta (çalışan ve iş ortağı)', () => {
  const misses: string[] = [];
  for (const [role, cases] of [['employee', EMPLOYEE], ['partner', PARTNER]] as const) for (const [question, expected] of cases) if (!top(question, role).includes(expected)) misses.push(`${role}: ${question} -> ${top(question, role).join(', ')} (beklenen ${expected})`);
  assert.deepEqual(misses, []);
});

test('yetki sızıntısı yok: hiçbir soruda başka rolün belgesi dönmez', () => {
  const all = [...EMPLOYEE, ...PARTNER].map(([question]) => question).concat(['Çalışanların yan hakları nelerdir?', 'Bir bayinin ödeme durumunu göster.', 'Başka bayinin faturalarını göster.']);
  for (const question of all) {
    for (const id of top(question, 'partner', 10)) assert.ok(!id.startsWith('EMP'), `partner <- ${id}: ${question}`);
    for (const id of top(question, 'employee', 10)) assert.ok(!id.startsWith('PAR'), `employee <- ${id}: ${question}`);
    for (const id of top(question, 'guest', 10)) assert.ok(id.startsWith('SHR'), `guest <- ${id}: ${question}`);
  }
  assert.ok(!top('Çalışanların yan hakları nelerdir?', 'partner', 10).includes('EMP-HR-003'));
  assert.ok(top('Çalışanların yan hakları nelerdir?', 'employee').includes('EMP-HR-003'));
});

test('araç yanıtı: belgeler ve talimat; sonuç yoksa uydurmama talimatı', () => {
  const hits = index.search('VPN bağlanmıyor', 'employee', 2);
  const result = toolResult(hits, 'employee') as { belgeler: { kimlik: string; icerik: string }[]; talimat: string };
  assert.equal(result.belgeler[0].kimlik, 'EMP-IT-001'); assert.match(result.belgeler[0].icerik, /DemoDesk/); assert.match(result.talimat, /sesli söyleme/);
  assert.match(JSON.stringify(toolResult([], 'guest')), /giriş yap/);
  assert.match(JSON.stringify(toolResult([], 'partner')), /uydurma/);
  assert.deepEqual(index.search('zxqv hiçbir şeyle eşleşmez', 'employee'), []);
});

test('servis: vektörler bir kez üretilip önbelleğe yazılır; vektör servisi çökerse kelime aramasına düşer', async () => {
  const cacheFile = join(mkdtempSync(join(tmpdir(), 'rag-')), 'vectors.json');
  let calls = 0;
  // Sahte vektör: belgede "vpn" geçiyorsa birinci eksen, geçmiyorsa ikinci.
  const embedder = async (texts: string[]) => { calls++; return texts.map(text => /vpn/i.test(text) ? [1, 0] : [0, 1]); };
  const rag = createRag({ root: ROOT, cacheFile, embedder });
  assert.equal((await rag.search('VPN açılmıyor', 'employee'))[0].id, 'EMP-IT-001');
  assert.deepEqual(rag.stats(), { documents: 42, vectors: true });
  assert.equal(calls, 2, 'belgeler için bir, soru için bir çağrı');
  assert.equal(Object.keys(JSON.parse(readFileSync(cacheFile, 'utf8')).vectors).length, 42);
  const cached = createRag({ root: ROOT, cacheFile, embedder });
  await cached.search('VPN', 'employee'); assert.equal(calls, 3, 'önbellekten: yalnızca soru için çağrı');
  for (const hit of await cached.search('VPN bağlanmıyor', 'partner', 10)) assert.ok(!hit.id.startsWith('EMP'), 'vektör aramasında da yetki filtresi');
  const broken = createRag({ root: ROOT, embedder: async () => { throw new Error('servis yok'); } });
  assert.equal((await broken.search('VPN bağlanmıyor', 'employee'))[0].id, 'EMP-IT-001');
  assert.deepEqual(broken.stats(), { documents: 42, vectors: false });
});

test('seçim: ilgisiz sonuçlar modele ve ekrana gitmez; test sorularında beklenen belge korunur', () => {
  const misses: string[] = [];
  for (const [role, cases] of [['employee', EMPLOYEE], ['partner', PARTNER]] as const) for (const [question, expected] of cases) {
    const { context, sources } = selectHits(index.search(question, role, 3));
    if (!context.some(hit => hit.id === expected)) misses.push(`${role}: ${question} -> ${context.map(hit => hit.id + ' ' + hit.lexical).join(', ')}`);
    assert.ok(sources.length <= 2 && sources.every(source => context.includes(source)));
  }
  assert.deepEqual(misses, []);
  // Vektörsüz yedek yolda eşik yalnızca açıkça alakasız sonuçları eler.
  for (const [role, question] of [['guest', 'VPN bağlanmıyor'], ['employee', 'Bugün hava nasıl?']] as const)
    assert.deepEqual(selectHits(index.search(question, role, 3)), { context: [], sources: [] }, `${role}: ${question}`);
  assert.deepEqual(selectHits([]), { context: [], sources: [] });
  // vektörlü aramada eşik: kosinüs 0,4 ve üstü kaynak olur; 0,3–0,4 yalnızca destek belgesidir; en iyi sonuç zayıfsa hiçbiri
  const hit = (id: string, semantic: number, lexical: number): Hit => ({ id, title: id, category: '', score: 0, lexical, semantic, vector: true, text: '' });
  const picked = selectHits([hit('A', .6, 8), hit('B', .33, 0), hit('C', .2, 1)]);
  assert.deepEqual([picked.context.map(item => item.id), picked.sources.map(item => item.id)], [['A', 'B'], ['A']]);
  assert.deepEqual(selectHits([hit('A', .38, 6), hit('B', .45, 3)]).context, [], 'en iyi sonuç eşiğin altındaysa bilgi verilmez');
});
