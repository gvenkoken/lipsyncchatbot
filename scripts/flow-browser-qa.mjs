// Akış panosunun gerçek tarayıcıda kontrolü. Önce: npm run dev   Sonra: node scripts/flow-browser-qa.mjs
// Ücretli çağrı yapmaz (?nolive: canlı oturumlar kurulmaz). Ekran görüntüleri artifacts/flow-*.png olarak yazılır.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output = path.join(root, 'artifacts');
const APP = 'http://127.0.0.1:5176/?nolive', PORT = 9348, SETTINGS = 'pmi-chat.settings.v5';
fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(output, 'flow-qa-profile')}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let pages;
for (let i = 0; i < 60 && !pages; i++) { await sleep(250); pages = await fetch(`http://127.0.0.1:${PORT}/json`).then(r => r.json()).catch(() => undefined); }
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let next = 0; const pending = new Map(), errors = [];
ws.addEventListener('message', event => {
  const m = JSON.parse(event.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
});
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const js = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const until = async (expression, timeout = 15000) => { const end = Date.now() + timeout; do { if (await js(expression)) return; await sleep(40); } while (Date.now() < end); throw Error('Zaman aşımı: ' + expression); };
const shot = async name => { const r = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(r.data, 'base64')); };
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
const label = id => js(`document.querySelector('[data-node="${id}"] .flow-box strong').textContent`);
const labels = () => Promise.all(['avatar-in', 'stt', 'llm', 'tts', 'avatar-out'].map(label));
const pick = async (node, index) => { await click(`[data-node="${node}"] .flow-box`); await until(`!!document.querySelector('[data-node="${node}"] .flow-menu')`); await click(`[data-node="${node}"] .flow-menu [role=option]:nth-child(${index}) button`); };
const launcher = () => js(`document.querySelector('.chat-launcher').disabled?'pasif':'açık'`);
const mode = () => js(`JSON.parse(localStorage.getItem('${SETTINGS}')).mode`);
const choose = (name, value) => js(`(()=>{const e=document.querySelector('select[aria-label="${name}"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'${value}');e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const cost = () => js(`Number(document.querySelector('[data-cost-monthly]').dataset.costMonthly)`);
const reload = async () => { await call('Page.reload'); await sleep(700); await until(`!!document.querySelector('.flow-board')`); };
// Gecikme kartlarında: alt bölümde üst üste binen öğe yok, "–" sütununun ortasında.
const latencyLayout = () => js(`[...document.querySelectorAll('.compare-card')].map(c=>{const f=c.querySelector('footer').getBoundingClientRect(),inside=r=>r.left>=f.left-1&&r.right<=f.right+1&&r.width>0;
  const els=[...c.querySelectorAll('.compare-caption em,.compare-rows dt,.compare-rows dd')].map(e=>e.getBoundingClientRect());
  const rows=[...c.querySelectorAll('.compare-rows>div')].map(d=>{const a=d.querySelector('dt'),b=d.querySelector('dd'),range=document.createRange();range.selectNodeContents(b);const text=range.getBoundingClientRect(),cell=b.getBoundingClientRect();
    return a.getBoundingClientRect().right<=text.left+1&&(!d.classList.contains('missing')||Math.abs((text.left+text.right)/2-(cell.left+cell.right)/2)<1.5)});
  const rowRects=[...c.querySelectorAll('.compare-rows>div')].map(d=>d.getBoundingClientRect());
  return els.every(inside)&&rows.every(Boolean)&&rowRects[0].bottom<=rowRects[1].top+.5})`);
// Öğenin üzerine gelir, açılan tooltip'in metnini döndürür; tooltip ekranın içinde olmalı.
const hoverTip = async selector => {
  const box = await js(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y }); await sleep(250);
  const tip = await js(`(()=>{const t=document.querySelector('.compare-tooltip');if(!t)return null;const r=t.getBoundingClientRect();return{text:t.innerText.replace(/\\s+/g,' '),inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,bg:getComputedStyle(t).backgroundColor}})()`);
  assert.ok(tip, 'tooltip açılmadı: ' + selector); assert.equal(tip.inside, true, 'tooltip ekran dışına taşıyor'); assert.equal(tip.bg, 'rgb(28, 34, 48)');
  return tip.text;
};
const checks = [];
try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.navigate', { url: APP }); await until(`!!document.querySelector('.flow-board')`);
  await js(`localStorage.clear()`); await reload();

  // --- pano ---
  assert.deepEqual(await js(`[...document.querySelectorAll('.flow-node .flow-head span')].map(e=>e.textContent)`), ['Avatar (web)', 'STT', 'LLM', 'TTS', 'Avatar (web)']);
  assert.equal(await js(`document.querySelectorAll('.flow-edges g path').length`), 4);
  assert.deepEqual(await labels(), ['Gemini', 'Gemini Live', 'Gemini Live', 'Gemini Live', 'Gemini']);
  assert.equal(await js(`document.querySelectorAll('.flow-node.locked .flow-box:disabled').length`), 3);
  assert.equal(await js(`[...document.querySelectorAll('.flow-title,.flow-ready')].filter(e=>e.offsetParent!==null).length+(document.body.innerText.includes('Sohbet akışı')||document.body.innerText.includes('Sohbet bu akışla')?1:0)`), 0);
  await shot('flow-board'); checks.push('beş kutu, dört ok; varsayılan Gemini (ara kutular kilitli); sayfada başlık ve durum yazısı yok');

  await click('[data-node="avatar-in"] .flow-box'); await until(`!!document.querySelector('[data-node="avatar-in"] .flow-menu')`);
  assert.deepEqual(await js(`[...document.querySelectorAll('[data-node="avatar-in"] .flow-menu [role=option] strong')].map(e=>e.textContent)`), ['Gemini', 'Synthesia', 'Çizim avatar']);
  await click('[data-node="avatar-in"] .flow-menu [role=option]:nth-child(2) button');
  assert.deepEqual(await labels(), ['Synthesia', 'OpenAI Realtime', 'OpenAI Realtime', 'OpenAI Realtime', 'Synthesia']);
  assert.equal(await mode(), 'synthesia'); assert.equal(await launcher(), 'açık');
  checks.push('avatar menüsünde Custom yok, Gemini ilk sırada; Synthesia seçilince sohbet modu değişir');

  await click('[data-node="tts"] .flow-box'); await until(`!!document.querySelector('[data-node="tts"] .flow-menu')`);
  const geometry = await js(`(()=>{const b=document.querySelector('[data-node="tts"] .flow-box').getBoundingClientRect(),m=document.querySelector('[data-node="tts"] .flow-menu').getBoundingClientRect(),l=document.querySelector('[data-node="tts"] .flow-group-label').getBoundingClientRect();return{gap:Math.round(m.top-b.bottom),dw:Math.round(m.width-b.width),dx:Math.round(m.left-b.left),label:document.querySelector('[data-node="tts"] .flow-group-label').textContent,leftOf:l.right<=m.left+2}})()`);
  assert.deepEqual(geometry, { gap: 0, dw: 0, dx: 0, label: 'LiteLLM', leftOf: true });
  assert.deepEqual(await js(`[...document.querySelectorAll('[data-node="tts"] .flow-menu [role=option]')].slice(0,2).map(e=>e.querySelector('strong').textContent+' / '+e.querySelector('small').textContent)`), ['OpenAI Realtime / Sesten sese', 'OpenAI / gpt-4o-mini-tts · bağlı değil']);
  await shot('flow-menu'); checks.push('menü kutunun altında bitişik açılır; LiteLLM etiketi solda; OpenAI\'nin canlı olmayan modeli listede');
  await click('[data-node="tts"] .flow-menu [role=option]:nth-child(2) button');
  assert.deepEqual(await labels(), ['Synthesia', 'OpenAI', 'OpenAI', 'OpenAI', 'Synthesia']);
  assert.deepEqual(await js(`[...document.querySelectorAll('.flow-detail')].slice(1,4).map(e=>e.firstChild.textContent)`), ['gpt-transcribe', 'gpt-5.4-mini', 'gpt-4o-mini-tts']);
  assert.equal(await js(`document.querySelectorAll('.flow-detail em').length`), 3); assert.equal(await launcher(), 'pasif');
  await sleep(350); assert.equal(await js(`getComputedStyle(document.querySelector('.chat-launcher')).backgroundColor`), 'rgb(195, 200, 209)');
  await click('.chat-launcher'); await sleep(200); assert.equal(await js(`!!document.querySelector('.chat-panel:not([hidden])')`), false);
  await reload(); assert.deepEqual(await labels(), ['Synthesia', 'OpenAI', 'OpenAI', 'OpenAI', 'Synthesia']); assert.equal(await launcher(), 'pasif');
  await shot('flow-chat-disabled'); checks.push('bağlı olmayan seçim işaretlenir, yenilemede korunur; sohbet düğmesi gri, pasif ve açılmaz');

  await pick('stt', 1); assert.deepEqual(await labels(), ['Synthesia', 'OpenAI Realtime', 'OpenAI Realtime', 'OpenAI Realtime', 'Synthesia']); assert.equal(await launcher(), 'açık');
  await click('.chat-launcher'); await until(`!!document.querySelector('.chat-panel:not([hidden])')`);
  assert.equal(await js(`!document.querySelector('.settings-toggle')&&!document.querySelector('#setting-mode')`), true);
  await shot('flow-with-chat');
  await pick('tts', 3); await until(`!document.querySelector('.chat-panel:not([hidden])')`); assert.equal(await launcher(), 'pasif');
  await pick('tts', 1); assert.equal(await launcher(), 'açık');
  checks.push('sohbette ayar düğmesi yok; açıkken bağlı olmayan seçime geçilince sohbet kapanır');

  await click('[data-node="stt"] .flow-box'); await until(`!!document.querySelector('.flow-menu')`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(`!document.querySelector('.flow-menu')`); checks.push('Escape menüyü kapatır');

  await pick('avatar-out', 3);
  assert.deepEqual(await labels(), ['Çizim avatar', 'OpenAI Realtime', 'OpenAI Realtime', 'OpenAI Realtime', 'Çizim avatar']); assert.equal(await mode(), 'local'); assert.equal(await launcher(), 'açık');
  await pick('llm', 2); assert.equal(await launcher(), 'pasif'); await pick('llm', 1); assert.equal(await launcher(), 'açık');
  checks.push('Çizim avatarda kutular açık: Realtime bağlı, ayrı zincir "bağlı değil"');

  // --- maliyet alanı ---
  const dock = await js(`(()=>{const r=document.querySelector('.cost-dock').getBoundingClientRect();return{center:Math.round(r.left+r.width/2-innerWidth/2),bottom:Math.round(innerHeight-r.bottom),fixed:getComputedStyle(document.querySelector('.cost-dock')).position}})()`);
  assert.deepEqual(dock, { center: 0, bottom: 24, fixed: 'fixed' });
  await choose('Kişi başı aylık dakika', 10); await choose('Kullanıcı sayısı', 1000); const base = await cost();
  await choose('Kişi başı aylık dakika', 120); await choose('Kullanıcı sayısı', 50000); assert.ok(Math.abs(await cost() - base * 600) < .5);
  await pick('avatar-in', 1); assert.ok(await cost() > base * 600, 'Gemini avatar görüntüsü dahil');
  await click('.cost-toggle'); assert.equal(await js(`document.querySelectorAll('.cost-details tbody tr').length`), 2); await shot('flow-cost'); await click('.cost-toggle');
  checks.push('maliyet alanı alt ortada sabit; dakika, kullanıcı ve avatar seçimiyle yeniden hesaplanır');

  // --- kıyaslama panelleri ---
  await choose('Kişi başı aylık dakika', 30); await choose('Kullanıcı sayısı', 1000);
  assert.deepEqual(await js(`[...document.querySelectorAll('.compare-tools button')].map(b=>b.dataset.metric)`), ['tokens', 'latency', 'price']);
  const tools = await js(`(()=>{const r=document.querySelector('.compare-tools').getBoundingClientRect();return r.left<40&&r.top<40&&r.height>r.width})()`); assert.equal(tools, true);
  for (const [metric, title, values] of [['tokens', 'Token tüketimi', 1], ['latency', 'Gecikme', 2], ['price', 'Toplam fiyat', 1]]) {
    await click(`.compare-tools button[data-metric="${metric}"]`); await until(`document.querySelector('.compare-panel')?.dataset.metric==='${metric}'`);
    const view = await js(`(()=>{const p=document.querySelector('.compare-panel').getBoundingClientRect(),cards=[...document.querySelectorAll('.compare-card')],node=document.querySelector('[data-node="stt"] .flow-box').getBoundingClientRect();
      const tops=k=>cards.map(c=>Math.round(c.querySelector(k).getBoundingClientRect().top));
      return{title:document.querySelector('.compare-head h2').textContent,count:cards.length,below:p.top>=node.bottom,dockHidden:!document.querySelector('.cost-dock'),tall:p.bottom>=innerHeight-40&&p.bottom<=innerHeight,fitsPage:document.documentElement.scrollHeight<=innerHeight,valueTops:new Set(tops('[data-compare-value]')).size,dividerTops:new Set(tops('footer')).size,values:cards[0].querySelectorAll('[data-compare-value]').length,
        lists:cards.every(c=>c.querySelectorAll('.pros li').length>=2&&c.querySelectorAll('.cons li').length>=2),order:cards.every(c=>c.querySelector('.compare-notes').getBoundingClientRect().bottom<=c.querySelector('footer').getBoundingClientRect().top+1),clipped:cards.some(c=>{const n=c.querySelector('.compare-notes');return n.scrollHeight>n.clientHeight+1})}})()`);
    assert.deepEqual(view, { title, count: 3, below: true, dockHidden: true, tall: true, fitsPage: true, valueTops: 1, dividerTops: 1, values, lists: true, order: true, clipped: false }, metric);
    await shot(`flow-compare-${metric}`);
    if (metric === 'latency') {
      assert.deepEqual(await js(`[...document.querySelectorAll('.compare-card')].map(c=>[...c.querySelectorAll('.compare-rows>div')].map(d=>d.querySelector('dt').textContent+'='+d.querySelector('dd').textContent).join(' | '))`),
        ['Ortalama süre=2,3 sn | Ölçüm=–', 'Ortalama süre=1,1 sn | Ölçüm=–', 'Ortalama süre=1,1 sn | Ölçüm=0,9 sn']);
      assert.equal(await js(`document.querySelectorAll('.compare-card[data-candidate] footer ul').length`), 0, 'açıklama satırları tooltip\'e taşındı');
      assert.deepEqual(await latencyLayout(), Array(3).fill(true));
      assert.match(await hoverTip('.compare-card .compare-rows .missing'), /^Ölçülmedi.*güvenilir sonuç alınamadı.*Avatarın hazırlanması/);
      assert.match(await hoverTip('.compare-card .compare-rows>div:first-child'), /^İnternette yayımlanan süre.*Aralık: 1,6–3,0 sn/);
      await shot('flow-compare-latency-tooltip'); await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    }
  }
  checks.push('üç kıyaslama simgesi sol üstte dikey; panel açıkken maliyet alanı gizlenir ve panel sayfanın altına kadar uzar; kartlarda artılar, eksiler, ayraç ve aynı hizada değer');
  checks.push('gecikmede "Ortalama süre" ve "Ölçüm" iki satır; üst üste binme yok (5 kartta da), "–" ortalı; açıklamalar ekranda kalan koyu tooltip\'te');

  assert.deepEqual(await js(`[...document.querySelectorAll('.compare-card')].map(c=>c.dataset.candidate)`), ['gemini-live', 'synthesia-realtime', 'drawn-realtime']);
  assert.deepEqual(await js(`[...document.querySelectorAll('.compare-card footer strong')].map(e=>e.textContent)`), ['$5.902,80', '$5.073,60', '$2.073,60']);
  assert.deepEqual(await js(`[...document.querySelectorAll('.compare-card.best')].map(c=>c.dataset.candidate)`), ['drawn-realtime']);
  await choose('Kullanıcı sayısı', 5000); assert.equal(await js(`document.querySelector('.compare-card footer strong').textContent`), '$29.514,00'); await choose('Kullanıcı sayısı', 1000);
  await choose('Kıyaslamaya ekle', 'drawn-openai'); await choose('Kıyaslamaya ekle', 'synthesia-openai');
  assert.equal(await js(`document.querySelectorAll('.compare-card').length`), 5);
  assert.deepEqual(await js(`[...document.querySelectorAll('.compare-card.best')].map(c=>c.dataset.candidate)`), ['drawn-openai']);
  const five = await js(`(()=>{const cards=[...document.querySelectorAll('.compare-card')];return{valueTops:new Set(cards.map(c=>Math.round(c.querySelector('footer strong').getBoundingClientRect().top))).size,fits:document.documentElement.scrollHeight<=innerHeight,inside:cards.every(c=>c.getBoundingClientRect().right<=innerWidth),clipped:cards.some(c=>{const n=c.querySelector('.compare-notes');return n.scrollHeight>n.clientHeight+1})}})()`);
  assert.deepEqual(five, { valueTops: 1, fits: true, inside: true, clipped: false }); await shot('flow-compare-five');
  await click('.compare-tools button[data-metric="latency"]'); await until(`document.querySelector('.compare-panel')?.dataset.metric==='latency'`);
  assert.deepEqual(await latencyLayout(), Array(5).fill(true), '5 kartta gecikme değerleri üst üste binmez');
  assert.match(await hoverTip('.compare-card:last-child .compare-rows>div:last-child'), /^Bizim ölçümümüz/, 'sağ kenardaki tooltip ekranda kalır');
  await shot('flow-compare-latency-five'); await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  await click('.compare-tools button[data-metric="price"]'); await until(`document.querySelector('.compare-panel')?.dataset.metric==='price'`);
  for (let i = 0; i < 4; i++) await click('.compare-card header button');
  assert.equal(await js(`document.querySelectorAll('.compare-card').length`), 1); assert.equal(await js(`!!document.querySelector('.compare-hint')&&!document.querySelector('.compare-card.best')`), true);
  await shot('flow-compare-one'); await click('.compare-card header button');
  assert.equal(await js(`document.querySelectorAll('.compare-card').length`), 0); assert.equal(await js(`!!document.querySelector('.compare-hint')`), true);
  await choose('Kıyaslamaya ekle', 'gemini-live'); await choose('Kıyaslamaya ekle', 'drawn-openai');
  await reload(); await click('.compare-tools button[data-metric="price"]'); assert.deepEqual(await js(`[...document.querySelectorAll('.compare-card')].map(c=>c.dataset.candidate)`), ['gemini-live', 'drawn-openai']);
  await click('.compare-tools button[data-metric="price"]'); assert.equal(await js(`!document.querySelector('.compare-panel')&&!!document.querySelector('.cost-dock')`), true);
  checks.push('kıyaslanacaklar listeden eklenir (5 aday yan yana, kaydırmasız sığar), hepsi tek tek çıkarılabilir, seçim korunur; panel kapanınca maliyet alanı geri gelir');

  // --- mobil ---
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(200); assert.equal(await js(`document.documentElement.scrollWidth<=window.innerWidth`), true);
  await shot('flow-mobile'); checks.push('mobilde sayfa yatay taşmaz');
  assert.deepEqual(errors, []); checks.push('çalışma zamanı hatası yok');
  await js(`localStorage.clear()`);
  console.log(JSON.stringify(checks, null, 1));
} finally { ws.close(); chrome.kill(); }
