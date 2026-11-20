// Canlı modlarda yanıt gecikmesi: yazılı soru gönderildikten avatarın konuşmaya başlamasına kadar geçen süre.
// ÜCRETLİDİR: her mod için kısa gerçek oturum açar.   node scripts/live-latency-qa.mjs --allow-api [gemini] [local] [synthesia]
// APP_URL ile başka bir sunucu hedeflenebilir (aynı anda tek oturum sınırı yüzünden gerekebilir).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--allow-api')) { console.log('Ücretli oturum açar; çalıştırmak için --allow-api ekleyin.'); process.exit(0); }
const modes = ['gemini', 'local', 'synthesia'].filter(mode => process.argv.includes(mode)); if (!modes.length) modes.push('gemini', 'local');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output = path.join(root, 'artifacts');
const APP = process.env.APP_URL || 'http://127.0.0.1:5176/', PORT = 9353;
const QUESTIONS = ['Bugün hava nasıl olur sence?', 'Bana kısa bir öneri verir misin?', 'Teşekkürler, başka ne yapabilirsin?'];
fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(output, 'live-latency-profile')}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let pages;
for (let i = 0; i < 60 && !pages; i++) { await sleep(250); pages = await fetch(`http://127.0.0.1:${PORT}/json`).then(r => r.json()).catch(() => undefined); }
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let next = 0; const pending = new Map();
ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } });
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const js = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const until = async (expression, timeout) => { const end = Date.now() + timeout; do { if (await js(expression)) return true; await sleep(25); } while (Date.now() < end); return false; };
const status = () => js(`document.querySelector('.chat-panel:not([hidden]) .avatar-status')?.textContent??''`);
const quiet = async () => { let calm = 0; for (let i = 0; i < 400 && calm < 12; i++) { calm = (await status()).includes('Konuşuyor') ? 0 : calm + 1; await sleep(250); } };
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const report = {};
try {
  await call('Runtime.enable'); await call('Page.enable');
  for (const mode of modes) {
    await call('Page.navigate', { url: 'about:blank' }); await sleep(300); await call('Page.navigate', { url: APP }); await sleep(800);
    await js(`localStorage.clear();localStorage.setItem('pmi-chat.settings.v5',JSON.stringify({mode:'${mode}',synthesiaAvatar:'default',voice:true}))`);
    await call('Page.reload'); await sleep(900); await until(`!!document.querySelector('.chat-launcher')`, 10000);
    await js(`document.querySelector('.chat-launcher').click()`); await sleep(400);
    if (mode === 'local') await js(`document.querySelector('.record-button').click()`);      // Çizim avatar mikrofonla bağlanır
    const connected = await until(`document.querySelector('.record-button')?.dataset.liveState==='connected'`, 125000);
    if (!connected) { report[mode] = { error: await js(`document.querySelector('[role=alert]')?.textContent??'bağlanamadı'`) }; continue; }
    await sleep(1500); await quiet();                                                          // selamlama bitsin
    const runs = [];
    for (const question of QUESTIONS) {
      await js(`document.querySelector('.input-wrap input').focus()`); await call('Input.insertText', { text: question });
      const sent = Date.now();
      for (const kind of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type: kind, key: 'Enter', code: 'Enter', text: kind === 'keyDown' ? '\r' : undefined, windowsVirtualKeyCode: 13 });
      const spoke = await until(`(document.querySelector('.chat-panel:not([hidden]) .avatar-status')?.textContent??'').includes('Konuşuyor')`, 30000);
      runs.push(spoke ? Math.round((Date.now() - sent) / 10) / 100 : null);
      await sleep(1000); await quiet();
    }
    report[mode] = { runs, median: median(runs.filter(value => value !== null)), error: await js(`document.querySelector('[role=alert]')?.textContent??null`) };
  }
  fs.writeFileSync(path.join(output, 'live-latency-report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
} finally { await call('Page.navigate', { url: 'about:blank' }).catch(() => {}); await sleep(1200); ws.close(); chrome.kill(); }
