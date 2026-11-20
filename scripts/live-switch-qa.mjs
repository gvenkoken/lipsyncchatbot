// Avatar değiştirme sırası: Gemini -> Synthesia -> Gemini. İkinci Gemini açılışında video yeniden gelmeli
// ("Gemini video kuyruğu doldu" hatası buradan çıkıyordu).
// ÜCRETLİDİR: üç kısa gerçek oturum açar.   Önce: npm run dev   Sonra: node scripts/live-switch-qa.mjs --allow-api
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--allow-api')) { console.log('Ücretli oturum açar; çalıştırmak için --allow-api ekleyin.'); process.exit(0); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output = path.join(root, 'artifacts');
const APP = process.env.APP_URL || 'http://127.0.0.1:5176/', PORT = 9350;
fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(output, 'live-switch-profile')}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let pages;
for (let i = 0; i < 60 && !pages; i++) { await sleep(250); pages = await fetch(`http://127.0.0.1:${PORT}/json`).then(r => r.json()).catch(() => undefined); }
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let next = 0; const pending = new Map();
ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } });
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const js = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const until = async (expression, timeout) => { const end = Date.now() + timeout; do { if (await js(expression)) return true; await sleep(100); } while (Date.now() < end); return false; };
const shot = async name => { const r = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(r.data, 'base64')); };
const snapshot = () => js(`(()=>{const b=document.querySelector('.record-button'),v=document.querySelector('.chat-panel video:not([hidden])');return{state:b?.dataset.liveState??null,error:document.querySelector('[role=alert]')?.textContent??null,video:v?{label:v.getAttribute('aria-label'),w:v.videoWidth,t:Math.round(v.currentTime*10)/10,stream:!!v.srcObject}:null}})()`);
const pickAvatar = async index => { await js(`document.querySelector('[data-node="avatar-in"] .flow-box').click()`); await sleep(150); await js(`document.querySelector('[data-node="avatar-in"] .flow-menu [role=option]:nth-child(${index}) button').click()`); };
const waitReady = async (name, videoLabel) => {
  const started = Date.now();
  await until(`document.querySelector('.record-button')?.dataset.liveState==='connecting'`, 6000);
  await until(`document.querySelector('.record-button')?.dataset.liveState!=='connecting'`, 125000);
  const first = await snapshot();
  assert.equal(first.state, 'connected', `${name}: bağlanamadı: ${first.error}`);
  await sleep(15000);                                    // kuyruk hatası birkaç saniye sonra çıkıyordu
  const later = await snapshot();
  assert.equal(later.error, null, `${name}: ${later.error}`); assert.equal(later.state, 'connected', `${name}: oturum düştü`);
  assert.equal(later.video?.label, videoLabel, `${name}: yanlış ya da eksik video`); assert.ok(later.video.w > 0, `${name}: video görüntü vermiyor`);
  return { seconds: Math.round((Date.now() - started - 15000) / 100) / 10, ...later };
};
const report = {};
try {
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.navigate', { url: APP }); await sleep(800);
  await js(`localStorage.clear();localStorage.setItem('pmi-chat.settings.v5',JSON.stringify({mode:'gemini',synthesiaAvatar:'default',voice:true}))`);
  await call('Page.reload'); await sleep(700);
  await until(`!!document.querySelector('.chat-launcher')`, 10000);
  await js(`document.querySelector('.chat-launcher').click()`);       // sohbet açık: kullanıcının yaptığı gibi
  report['1 gemini'] = await waitReady('1. Gemini', 'Gemini canlı avatarı');
  await pickAvatar(2); report['2 synthesia'] = await waitReady('Synthesia', 'Synthesia canlı avatarı');
  await pickAvatar(3); report['3 gemini'] = await waitReady('2. Gemini', 'Gemini canlı avatarı');
  assert.equal(report['3 gemini'].video.stream, false, 'Gemini videosunda Synthesia akışı kalmış');
  await shot('live-switch-gemini-again');
  console.log(JSON.stringify(report, null, 1));
} finally { await call('Page.navigate', { url: 'about:blank' }).catch(() => {}); await sleep(1200); ws.close(); chrome.kill(); }
