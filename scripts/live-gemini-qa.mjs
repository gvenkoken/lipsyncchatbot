// Explicit paid Google Cloud integration check. No personal microphone audio is sent.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
if (!process.argv.includes('--allow-api')) throw Error('Use --allow-api for the paid Gemini Live Avatar check.');
const output = fileURLToPath(new URL('../artifacts/', import.meta.url));
const pages = await (await fetch('http://127.0.0.1:9346/json')).json();
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let next = 0; const pending = new Map(), errors = [];
ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text); if (pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(message.error) : p.resolve(message.result); } });
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const js = async expression => { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (expression, timeout = 60000) => { const end = Date.now() + timeout; do { if (await js(expression)) return; const error = await js(`document.querySelector('[role=alert]')?.textContent`); if (error) throw Error(error); await sleep(100); } while (Date.now() < end); throw Error('Timed out: ' + expression); };
const click = async selector => { await until(`!!document.querySelector(${JSON.stringify(selector)})`, 10000); return js(`document.querySelector(${JSON.stringify(selector)}).click()`); };
let report = {};
try {
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable'); await call('Network.setCacheDisabled', { cacheDisabled: true });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'http://127.0.0.1:5176/' }); await until(`!!document.querySelector('.chat-launcher')`, 15000);
  await click('.chat-launcher'); await click('.settings-toggle'); await until(`!!document.querySelector('#setting-mode')`);
  await js(`(()=>{const element=document.querySelector('#setting-mode');element.value='gemini';element.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`!!document.querySelector('video[aria-label="Gemini canlı avatarı"]')`); await click('.settings-toggle');
  await js(`(async()=>{window.__streams=[];window.__sockets=[];const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await get(options);const native=Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype,'enabled');stream.getAudioTracks().forEach(track=>{native.set.call(track,false);Object.defineProperty(track,'enabled',{configurable:true,get(){return native.get.call(this)},set(){native.set.call(this,false)}});});window.__streams.push(stream);return stream;};const Socket=WebSocket;window.WebSocket=class extends Socket{constructor(...args){super(...args);if(String(args[0]).includes('/api/gemini/live'))window.__sockets.push(this);}};const video=document.querySelector('video');const context=new AudioContext();window.__qaAudio=context;await context.resume();const source=context.createMediaElementSource(video),analyser=context.createAnalyser();source.connect(analyser);analyser.connect(context.destination);window.__audioPeak=0;window.__qaAudioTimer=setInterval(()=>{const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);window.__audioPeak=Math.max(window.__audioPeak,...data.map(Math.abs));},20);})()`);
  const started = Date.now(); await click('.record-button'); await until(`document.querySelector('.record-button').dataset.liveState==='connected'`);
  report.connectionMs = Date.now() - started;
  await until(`document.querySelector('video').videoWidth>0&&document.querySelector('video').currentTime>0`);
  await until(`window.__audioPeak>.001`, 20000);
  assert.equal(await js(`window.__streams.every(s=>s.getAudioTracks().every(t=>!t.enabled))`), true);
  report.video = await js(`({width:document.querySelector('video').videoWidth,height:document.querySelector('video').videoHeight,time:document.querySelector('video').currentTime})`);
  report.audioPeak = await js(`window.__audioPeak`);
  await click('.view-toggle'); await until(`document.querySelector('.assistant-message p')?.textContent.length>3`, 20000);
  report.greeting = await js(`document.querySelector('.assistant-message p').textContent`);
  const count = await js(`document.querySelectorAll('.assistant-message').length`);
  await click('input'); await call('Input.insertText', { text: 'Tek kısa cümleyle Türkçe merhaba de.' }); await click('.send-button');
  await until(`document.querySelectorAll('.assistant-message').length>${count}`, 20000);
  report.reply = await js(`Array.from(document.querySelectorAll('.assistant-message p')).at(-1).textContent`);
  assert.equal(await js(`window.__sockets.length===1&&window.__sockets[0].readyState===1`), true);
  await click('.view-toggle'); const shot = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(output + 'live-gemini.png', Buffer.from(shot.data, 'base64'));
  await click('.record-button'); await sleep(500);
  report.released = await js(`({tracksEnded:window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')),socketsClosed:window.__sockets.every(s=>s.readyState===3),idle:document.querySelector('.record-button').dataset.liveState==='idle'})`);
  assert.deepEqual(report.released, { tracksEnded: true, socketsClosed: true, idle: true }); assert.deepEqual(errors, []); report.success = true;
} catch (error) {
  report = { ...report, success: false, error: error.message };
  const shot = await call('Page.captureScreenshot', { format: 'png' }).catch(() => null); if (shot) fs.writeFileSync(output + 'live-gemini-error.png', Buffer.from(shot.data, 'base64')); process.exitCode = 1;
} finally {
  await js(`document.querySelector('.chat-close')?.click();clearInterval(window.__qaAudioTimer);window.__qaAudio?.close()`).catch(() => {}); await sleep(500);
  report.errors = errors; fs.writeFileSync(output + 'live-gemini-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); ws.close();
}
