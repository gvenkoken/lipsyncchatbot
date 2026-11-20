// Gemini + bilgi tabanı (RAG) uçtan uca: demo giriş, role göre yanıt, kaynak altyazısı.
// ÜCRETLİDİR: gerçek Gemini oturumu açar.   node scripts/live-rag-qa.mjs --allow-api
// APP_URL ile başka bir sunucu hedeflenebilir (aynı anda tek Gemini oturumu sınırı yüzünden gerekebilir).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--allow-api')) { console.log('Ücretli oturum açar; çalıştırmak için --allow-api ekleyin.'); process.exit(0); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output = path.join(root, 'artifacts');
const APP = process.env.APP_URL || 'http://127.0.0.1:5176/', PORT = 9354;
fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(output, 'live-rag-profile')}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let pages;
for (let i = 0; i < 60 && !pages; i++) { await sleep(250); pages = await fetch(`http://127.0.0.1:${PORT}/json`).then(r => r.json()).catch(() => undefined); }
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let next = 0; const pending = new Map();
ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } });
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const js = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const until = async (expression, timeout) => { const end = Date.now() + timeout; do { if (await js(expression)) return true; await sleep(60); } while (Date.now() < end); return false; };
const shot = async name => { const r = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(r.data, 'base64')); };
const status = () => js(`document.querySelector('.chat-panel:not([hidden]) .avatar-status')?.textContent??''`);
const quiet = async () => { let calm = 0; for (let i = 0; i < 480 && calm < 12; i++) { calm = /Konuşuyor|Düşünüyor/.test(await status()) ? 0 : calm + 1; await sleep(250); } };
const connected = () => until(`document.querySelector('.record-button')?.dataset.liveState==='connected'`, 125000);
const messages = () => js(`(()=>{const hidden=!document.querySelector('.messages');if(hidden)document.querySelector('.view-toggle').click();return new Promise(r=>setTimeout(()=>{const list=[...document.querySelectorAll('.message')].map(m=>(m.dataset.role==='assistant'?'A: ':'K: ')+m.textContent);if(hidden)document.querySelector('.view-toggle').click();r(list)},150))})()`);
// Soru yazar; kaynak altyazısını (görünürse) ve asistanın son yanıtını döndürür.
const ask = async (question, shotName) => {
  const before = (await messages()).length;
  await js(`document.querySelector('.input-wrap input').focus()`); await call('Input.insertText', { text: question });
  const sent = Date.now();
  for (const kind of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type: kind, key: 'Enter', code: 'Enter', text: kind === 'keyDown' ? '\r' : undefined, windowsVirtualKeyCode: 13 });
  const shown = await until(`!!document.querySelector('.avatar-sources')`, 25000);
  const sources = shown ? await js(`[...document.querySelectorAll('.avatar-sources em')].map(e=>e.dataset.source+' '+e.textContent)`) : [];
  const sourceSeconds = shown ? Math.round((Date.now() - sent) / 100) / 10 : null;
  if (shown && shotName) { await sleep(400); await shot(shotName); }
  await sleep(1500); await quiet();
  const all = await messages();
  return { question, sources, sourceSeconds, answer: all.slice(before).filter(line => line.startsWith('A: ')).join(' ').slice(3), subtitleGone: shown ? await until(`!document.querySelector('.avatar-sources')`, 9000) : null };
};
const login = async (name, role) => {
  await js(`document.querySelector('.profile-toggle').click()`); await until(`!!document.querySelector('.profile-panel')`, 3000);
  await js(`(()=>{const e=document.querySelector('.profile-panel input[aria-label="Adınız"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'${name}');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await js(`document.querySelector('.profile-panel input[value="${role}"]').click()`); await js(`document.querySelector('.profile-submit').click()`);
  await until(`document.querySelector('.profile-toggle strong')?.textContent==='${name}'`, 3000);
};
const report = {};
try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.navigate', { url: APP }); await sleep(900);
  // ?nolive yok: Gemini sayfa açılınca bağlanır. Synthesia'nın arka planda bağlanması bu testi etkilemez.
  await js(`localStorage.clear();localStorage.setItem('pmi-chat.settings.v5',JSON.stringify({mode:'gemini',synthesiaAvatar:'default',voice:true}))`);
  await call('Page.reload'); await sleep(900); await until(`!!document.querySelector('.chat-launcher')`, 10000);
  assert.equal(await js(`document.querySelector('.profile-toggle strong').textContent`), 'Giriş yap');
  await login('Deniz', 'employee');
  assert.equal(await js(`document.querySelector('.profile-toggle small').textContent`), 'Çalışan');
  assert.equal(await connected(), true, 'çalışan girişiyle Gemini bağlanamadı: ' + await js(`document.querySelector('[role=alert]')?.textContent`));
  await js(`document.querySelector('.chat-launcher').click()`); await sleep(1500); await quiet();
  report.greeting = (await messages()).filter(line => line.startsWith('A: ')).join(' ');
  report.employee = [await ask('VPN bağlanmıyor, ne yapmalıyım?', 'live-rag-subtitle'), await ask('Bir bayinin ödeme durumunu nasıl görürüm?'), await ask('Yıllık iznim kaç gün kaldı?')];
  await login('Deniz', 'partner'); await sleep(800);
  assert.equal(await connected(), true, 'iş ortağı girişiyle Gemini bağlanamadı');
  await sleep(1500); await quiet();
  report.partner = [await ask('Bayi portalına giremiyorum.'), await ask('Çalışanların yan hakları nelerdir?')];
  fs.writeFileSync(path.join(output, 'live-rag-report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
} finally { await call('Page.navigate', { url: 'about:blank' }).catch(() => {}); await sleep(1200); ws.close(); chrome.kill(); }
