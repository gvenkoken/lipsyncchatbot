// Explicit paid integration test. Test microphone is muted; a short typed prompt is sent.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
if (!process.argv.includes('--allow-api')) throw Error('Use --allow-api for the paid Synthesia integration check.');
const output = fileURLToPath(new URL('../artifacts/', import.meta.url));
const pages = await (await fetch('http://127.0.0.1:9346/json')).json();
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let next = 0; const pending = new Map(), errors = [], responses = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/synthesia/')) responses.push({ path: new URL(message.params.response.url).pathname, status: message.params.response.status });
  if (pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(message.error) : p.resolve(message.result); }
});
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const js = async expression => { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (expression, timeout = 120000) => { const end = Date.now() + timeout; do { if (await js(expression)) return; const error = await js(`document.querySelector('[role=alert]')?.textContent`); if (error) throw Error(error); await sleep(150); } while (Date.now() < end); throw Error('Timed out: ' + expression); };
const click = async selector => { await until(`!!document.querySelector(${JSON.stringify(selector)})`, 10000); return js(`document.querySelector(${JSON.stringify(selector)}).click()`); };
let report = {};
try {
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable'); await call('Network.setCacheDisabled', { cacheDisabled: true });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'http://127.0.0.1:5176/' }); await until(`!!document.querySelector('.chat-launcher')`, 15000);
  await click('.chat-launcher'); await click('.settings-toggle');
  await js(`(()=>{const element=document.querySelector('#setting-mode');element.value='synthesia';element.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`!!document.querySelector('#setting-synthesia-avatar')`);
  await js(`(()=>{const element=document.querySelector('#setting-synthesia-avatar');element.value='default';element.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('.settings-toggle');
  await js(`window.__streams=[];window.__peers=[];const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await get(options);const native=Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype,'enabled');stream.getAudioTracks().forEach(track=>{native.set.call(track,false);Object.defineProperty(track,'enabled',{configurable:true,get(){return native.get.call(this)},set(){native.set.call(this,false)}});});window.__streams.push(stream);return stream;};const Peer=RTCPeerConnection;window.RTCPeerConnection=class extends Peer{constructor(...args){super(...args);window.__peers.push(this);}};`);
  const start = Date.now(); await click('.record-button');
  await until(`document.querySelector('.record-button').dataset.liveState==='connected'`);
  report.connectionMs = Date.now() - start;
  await until(`document.querySelector('video')?.videoWidth>0`);
  assert.equal(await js(`window.__streams.every(s=>s.getAudioTracks().every(t=>!t.enabled))`), true);
  await click('input'); await call('Input.insertText', { text: 'Tek kısa cümleyle Türkçe merhaba de.' }); await click('.send-button');
  await click('.view-toggle'); await until(`document.querySelector('.assistant-message p')?.textContent.length>3`, 45000);
  report.reply = await js(`document.querySelector('.assistant-message p').textContent`);
  await until(`Promise.all(window.__peers.map(async peer=>Array.from((await peer.getStats()).values()).some(stat=>stat.type==='inbound-rtp'&&stat.kind==='audio'&&stat.totalAudioEnergy>0))).then(values=>values.some(Boolean))`, 15000);
  report.audio = await js(`(async()=>{const all=(await Promise.all(window.__peers.map(peer=>peer.getStats()))).flatMap(stats=>Array.from(stats.values()));const audio=all.filter(stat=>stat.type==='inbound-rtp'&&stat.kind==='audio');return {received:audio.some(stat=>stat.totalAudioEnergy>0),bytes:audio.reduce((sum,stat)=>sum+(stat.bytesReceived||0),0),playing:Array.from(document.querySelectorAll('audio')).some(element=>!element.paused&&!element.muted&&element.currentTime>0)};})()`);
  assert.equal(report.audio.received, true); assert.equal(report.audio.playing, true);
  await click('.view-toggle'); await until(`document.querySelector('video')?.currentTime>1`);
  report.video = await js(`({width:document.querySelector('video').videoWidth,height:document.querySelector('video').videoHeight,time:document.querySelector('video').currentTime})`);
  const shot = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(output + 'live-synthesia.png', Buffer.from(shot.data, 'base64'));
  await click('.record-button'); await sleep(1200);
  report.released = await js(`({tracksEnded:window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')),peersClosed:window.__peers.every(p=>p.connectionState==='closed'),idle:document.querySelector('.record-button').dataset.liveState==='idle'})`);
  assert.deepEqual(report.released, { tracksEnded: true, peersClosed: true, idle: true }); assert.deepEqual(errors, []);
  report.success = true;
} catch (error) {
  report = { ...report, success: false, error: error.message };
  const shot = await call('Page.captureScreenshot', { format: 'png' }).catch(() => null); if (shot) fs.writeFileSync(output + 'live-synthesia-error.png', Buffer.from(shot.data, 'base64'));
  process.exitCode = 1;
} finally {
  await js(`document.querySelector('.chat-close')?.click()`).catch(() => {}); await sleep(1200);
  report.responses = responses; report.errors = errors;
  fs.writeFileSync(output + 'live-synthesia-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); ws.close();
}
