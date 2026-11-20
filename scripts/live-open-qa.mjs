// Canlı avatarların (Synthesia / Gemini) sayfa açılınca hazırlandığını, sohbet kapatılıp açılınca bağlı kaldığını
// gerçek servislerle doğrular ve süreleri ölçer.
// ÜCRETLİDİR: her mod için ~1 dakikalık gerçek oturum açar.   Önce: npm run dev   Sonra: node scripts/live-open-qa.mjs --allow-api [synthesia] [gemini]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--allow-api')) { console.log('Ücretli oturum açar; çalıştırmak için --allow-api ekleyin.'); process.exit(0); }
const modes = ['synthesia', 'gemini'].filter(mode => process.argv.includes(mode)); if (!modes.length) modes.push('synthesia', 'gemini');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output = path.join(root, 'artifacts');
const APP = process.env.APP_URL || 'http://127.0.0.1:5176/', PORT = 9349;
fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Not: --autoplay-policy verilmez; sayfa açılışında kullanıcı etkileşimi olmadan hazırlanma gerçek koşulda sınanır.
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(output, 'live-open-profile')}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
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
const js = async (expression, userGesture = false) => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const until = async (expression, timeout) => { const end = Date.now() + timeout; do { if (await js(expression)) return true; await sleep(100); } while (Date.now() < end); return false; };
const shot = async name => { const r = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(r.data, 'base64')); };
const snapshot = () => js(`(()=>{const b=document.querySelector('.record-button'),p=document.querySelector('.chat-panel'),v=document.querySelector('.chat-panel video:not([hidden])');return{panel:p?(p.hidden?'gizli':'açık'):'yok',state:b?.dataset.liveState??null,mic:b?.dataset.mic??null,status:document.querySelector('.avatar-status')?.textContent??null,error:document.querySelector('[role=alert]')?.textContent??null,video:v?{w:v.videoWidth,t:Math.round(v.currentTime*10)/10,paused:v.paused,muted:v.muted}:null}})()`);
const report = {};
try {
  await call('Runtime.enable'); await call('Page.enable');
  for (const mode of modes) {
    await call('Page.navigate', { url: 'about:blank' }); await sleep(300);
    await call('Page.navigate', { url: APP }); await sleep(800);
    await js(`localStorage.clear();localStorage.setItem('pmi-chat.settings.v5',JSON.stringify({mode:'${mode}',synthesiaAvatar:'default',voice:true}))`);
    const started = Date.now();
    await call('Page.reload'); await sleep(600);
    // Sohbete dokunulmadan: sayfa açılınca bağlantı başlamalı ve tamamlanmalı.
    if (!await until(`['connecting','connected'].includes(document.querySelector('.record-button')?.dataset.liveState)`, 8000)) assert.fail(mode + ': sayfa açılınca hazırlanmadı: ' + JSON.stringify(await snapshot()) + ' ' + await js(`localStorage.getItem('pmi-chat.settings.v5')+' '+localStorage.getItem('pmi-flow.choices.v2')+' launcher='+document.querySelector('.chat-launcher')?.disabled`));
    await until(`document.querySelector('.record-button')?.dataset.liveState!=='connecting'`, 125000);
    const result = { readySeconds: Math.round((Date.now() - started) / 100) / 10, closedReady: await snapshot(), opens: [] };
    assert.equal(result.closedReady.state, 'connected', mode + ': bağlanamadı: ' + result.closedReady.error);
    assert.equal(result.closedReady.panel, 'gizli');
    for (let i = 0; i < 3; i++) {
      // kapalıyken beklet ve durumu izle (kuyruk / kopma sorunları burada çıkar)
      for (let s = 0; s < (i ? 12 : 3); s++) { await sleep(1000); const now = await snapshot(); (result.timeline ??= []).push(`${i}.${s} ${now.state} ${now.status} ${now.error ?? ''}`.trim()); }
      const before = await snapshot(); const t0 = Date.now();
      await js(`document.querySelector('.chat-launcher').click()`, true);
      await until(`!document.querySelector('.chat-panel').hidden`, 3000);
      const opened = await snapshot();
      result.opens.push({ beforeOpen: before.state, ms: Date.now() - t0, ...opened });
      if (opened.state !== 'connected') { console.log(JSON.stringify(result, null, 1)); }
      assert.equal(opened.state, 'connected', `${mode}: ${i + 1}. açılışta yeniden hazırlanıyor ya da kopmuş: ${opened.error ?? before.error}`);
      assert.equal(opened.error, null);
      await sleep(2500); const playing = await snapshot(); result.opens.at(-1).videoAfter = playing.video;
      if (i === 0) await shot(`live-open-${mode}`);
      await js(`document.querySelector('.chat-close').click()`, true); await sleep(400);
      assert.equal((await snapshot()).panel, 'gizli');
    }
    // Başka avatara geçince oturum kapanır.
    await js(`localStorage.setItem('pmi-chat.settings.v5',JSON.stringify({mode:'video',synthesiaAvatar:'default',voice:true}))`);
    report[mode] = result;
  }
  await call('Page.navigate', { url: 'about:blank' });
  report.runtimeErrors = errors;
  console.log(JSON.stringify(report, null, 1));
} finally { await call('Page.navigate', { url: 'about:blank' }).catch(() => {}); await sleep(1200); ws.close(); chrome.kill(); }
