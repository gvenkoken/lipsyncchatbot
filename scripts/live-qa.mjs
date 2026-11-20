// Explicit integration test: creates one billed OpenAI voice session.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
if (!process.argv.includes('--allow-api')) throw Error('Use --allow-api to run the billed OpenAI integration check.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = await (await fetch('http://127.0.0.1:9346/json')).json();
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let next = 0; const pending = new Map(), errors = [], sessionResponses = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/realtime/')) sessionResponses.push({ url: new URL(message.params.response.url).pathname, status: message.params.response.status });
  if (pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(message.error) : p.resolve(message.result); }
});
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const js = async expression => { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (expression, timeout = 30000) => { const end = Date.now() + timeout; do { if (await js(expression)) return; const problem = await js(`document.querySelector('[role=alert]')?.textContent`); if (problem) throw Error(problem); await sleep(80); } while (Date.now() < end); throw Error('Timeout: ' + expression); };
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
let report;
try {
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'http://127.0.0.1:5176/' }); await until(`!!document.querySelector('.chat-launcher')`);
  await click('.chat-launcher'); await click('.settings-toggle');
  await until(`!!document.querySelector('#setting-mode')`);
  await js(`(()=>{const element=document.querySelector('#setting-mode');element.value='local';element.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('.settings-toggle'); await until(`document.querySelector('canvas')?.dataset.ready==='true'`);
  await js(`window.__liveStreams=[];window.__livePeers=[];window.__liveFrames=new Set();window.__liveMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const stream=await window.__liveMedia(c);stream.getAudioTracks().forEach(track=>track.enabled=false);window.__liveStreams.push(stream);return stream;};window.__NativePeer=RTCPeerConnection;window.RTCPeerConnection=class extends window.__NativePeer{constructor(...args){super(...args);window.__livePeers.push(this);}};window.__liveObserver=new MutationObserver(()=>window.__liveFrames.add(Number(document.querySelector('canvas')?.dataset.frame)));window.__liveObserver.observe(document.querySelector('canvas'),{attributes:true,attributeFilter:['data-frame']});`);
  const start = Date.now(); await click('.record-button');
  await until(`document.querySelector('.record-button').dataset.liveState==='connected'`);
  const connectionMs = Date.now() - start;
  assert.equal(await js(`window.__liveStreams.every(stream=>stream.getAudioTracks().every(track=>!track.enabled))`), true);
  await click('input'); await call('Input.insertText', { text: 'Tek kısa cümleyle Türkçe merhaba de.' });
  await click('.send-button');
  await until(`Array.from(window.__liveFrames).some(frame=>frame>1)`, 20000);
  await until(`document.querySelector('canvas').dataset.mode==='listening'`, 20000);
  assert.equal(await js(`!document.querySelector('.messages')&&!document.querySelector('.avatar-stage').hidden`),true);
  const avatarScreenshot = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(root, 'artifacts/live-openai-avatar.png'), Buffer.from(avatarScreenshot.data, 'base64'));
  await click('.view-toggle');
  await until(`document.querySelector('.assistant-message p')?.textContent.length>5`, 45000);
  assert.equal(await js(`document.querySelector('.avatar-stage').hidden&&window.__livePeers[0].connectionState==='connected'`),true);
  report = await js(`({title:document.querySelector('h1').textContent,reply:document.querySelector('.assistant-message p').textContent,frames:Array.from(window.__liveFrames).sort((a,b)=>a-b),peerStates:window.__livePeers.map(peer=>peer.connectionState),microphoneMuted:window.__liveStreams.every(stream=>stream.getAudioTracks().every(track=>!track.enabled))})`);
  assert.equal(report.title, 'PMI Assistant'); assert.ok(report.frames.some(frame => frame > 1)); assert.ok(report.peerStates.includes('connected'));
  const screenshot = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(root, 'artifacts/live-openai.png'), Buffer.from(screenshot.data, 'base64'));
  await click('.view-toggle');
  await click('.record-button'); await sleep(1200);
  const released = await js(`({tracksEnded:window.__liveStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')),peersClosed:window.__livePeers.every(peer=>peer.connectionState==='closed'),panelOpen:!!document.querySelector('.chat-panel'),microphoneIdle:document.querySelector('.record-button').dataset.liveState==='idle'})`);
  assert.deepEqual(released, { tracksEnded: true, peersClosed: true, panelOpen: true, microphoneIdle: true });
  await click('.chat-close');
  assert.equal(await js(`!document.querySelector('.chat-launcher').hidden`),true);
  assert.ok(sessionResponses.some(response => response.url.endsWith('/session') && response.status === 201));
  assert.ok(sessionResponses.some(response => response.url.endsWith('/hangup') && response.status === 204)); assert.deepEqual(errors, []);
  report = { ...report, connectionMs, released, sessionResponses, errors };
  fs.writeFileSync(path.join(root, 'artifacts/live-openai-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await js(`document.querySelector('.chat-close')?.click();window.__liveObserver?.disconnect()`).catch(() => {});
  await sleep(700); ws.close();
}
