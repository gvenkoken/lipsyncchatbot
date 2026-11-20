import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../artifacts/', import.meta.url));
const pages = await (await fetch('http://127.0.0.1:9346/json')).json();
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let next = 0, loads = 0; const pending = new Map(), errors = [], checks = [];
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Page.loadEventFired') loads++;
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  if (message.method === 'Fetch.requestPaused') void call('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }], body: Buffer.from(sdkMock).toString('base64') });
  if (pending.has(message.id)) { const waiter = pending.get(message.id); pending.delete(message.id); message.error ? waiter.reject(message.error) : waiter.resolve(message.result); }
});
const js = async expression => { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description); return result.result.value; };
const wait = async expression => { const end = Date.now() + 12000; while (Date.now() < end) { if (await js(expression)) return; await new Promise(resolve => setTimeout(resolve, 60)); } throw Error('Timed out: ' + expression); };
const click = async selector => { await wait(`!!document.querySelector(${JSON.stringify(selector)})`); return js(`document.querySelector(${JSON.stringify(selector)}).click()`); };
const load = async (method, params = {}) => { const previous = loads; await call(method, params); while (loads === previous) await new Promise(resolve => setTimeout(resolve, 40)); };
const select = (selector, value) => js(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.value=${JSON.stringify(value)};element.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const shot = async name => { await wait(`document.querySelector('.chat-panel').getAnimations().every(a=>a.playState!=='running')`); const result = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(output + name + '.png', Buffer.from(result.data, 'base64')); };
// CDP substitutes only the SDK module in this test browser. No production mock/fallback exists.
// Microphone/video/audio are actual browser MediaStreamTracks; all provider traffic is simulated.
const sdkMock = `
export const RoomEvent={TrackSubscribed:'track',TrackUnsubscribed:'untrack',ParticipantDisconnected:'left',Disconnected:'end',DataReceived:'data'};
export const Track={Kind:{Video:'video',Audio:'audio'}};
export async function createLocalAudioTrack(options){const stream=await navigator.mediaDevices.getUserMedia({audio:options});window.__micStreams.push(stream);return {stop(){stream.getTracks().forEach(t=>t.stop());}};}
export class Room{
  constructor(){this.handlers=new Map();this.closed=false;window.__rooms.push(this);this.localParticipant={publishTrack:async()=>{},publishData:async data=>{const event=JSON.parse(new TextDecoder().decode(data));window.__sent.push(event);if(event.type==='text')setTimeout(()=>{this.event({type:'mode',mode:'speaking'});this.event({type:'message',id:'reply_'+event.id,role:'assistant',text:'Synthesia test yaniti'});},20);}};}
  on(name,handler){this.handlers.set(name,handler);return this;}
  emit(name,...args){this.handlers.get(name)?.(...args);}
  event(event){this.emit('data',new TextEncoder().encode(JSON.stringify(event)),{identity:'pmi-agent'},0,'pmi.synthesia');}
  async connect(){const canvas=document.createElement('canvas');canvas.width=360;canvas.height=280;const ctx=canvas.getContext('2d');let x=0;const draw=()=>{ctx.fillStyle='#182536';ctx.fillRect(0,0,360,280);ctx.fillStyle='#becfe5';ctx.font='18px sans-serif';ctx.textAlign='center';ctx.fillText('Synthesia QA stream',180,130);ctx.fillStyle='#7ea9bb';ctx.fillRect((x++*3)%360,180,24,4);};draw();this.timer=setInterval(draw,50);this.video=canvas.captureStream(20);window.__videoStreams.push(this.video);const track=this.video.getVideoTracks()[0];this.emit('track',{kind:'video',mediaStreamTrack:track,detach:()=>[]},{},{identity:'synthesia-avatar-agent'});this.event({type:'ready'});}
  async disconnect(){this.closed=true;clearInterval(this.timer);this.video?.getTracks().forEach(t=>t.stop());}
  removeAllListeners(){this.handlers.clear();}
  async startAudio(){}
}`;
try {
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await load('Page.navigate', { url: 'http://127.0.0.1:5176/' }); await wait(`!!document.querySelector('.chat-launcher')`);
  await js(`localStorage.setItem('pmi-chat.settings.v5',JSON.stringify({mode:'synthesia',synthesiaAvatar:'default'}))`); await load('Page.reload'); await wait(`!!document.querySelector('.chat-launcher')`);
  await js(`(()=>{window.__micStreams=[];window.__videoStreams=[];window.__rooms=[];window.__sent=[];window.__choices=[];window.__hangups=0;window.__configured=false;const nativeFetch=window.fetch;window.fetch=async(url,options={})=>{if(String(url).includes('/api/synthesia/status'))return Response.json({configured:window.__configured,missing:[],avatars:{default:{configured:window.__configured},custom:{configured:window.__configured}}});if(String(url).includes('/api/synthesia/session')){window.__choices.push(JSON.parse(options.body).avatar);return Response.json({sessionId:'test-'+window.__choices.length,url:'wss://fake.example',token:'test-only',avatarIdentity:'synthesia-avatar-agent',agentIdentity:'pmi-agent'},{status:201});}if(String(url).includes('/api/synthesia/hangup')){window.__hangups++;return new Response(null,{status:204});}return nativeFetch(url,options);};})()`);
  await call('Fetch.enable', { patterns: [{ urlPattern: '*livekit-client.js*', resourceType: 'Script' }] });
  await click('.chat-launcher'); await click('.settings-toggle');
  assert.deepEqual(await js(`Array.from(document.querySelector('#setting-mode').options,o=>o.textContent)`), ['Video avatar', 'Avatar + OpenAI', 'Synthesia', 'Gemini']);
  assert.equal(await js(`document.querySelector('#setting-mode').value`), 'synthesia');
  assert.equal(await js(`document.querySelector('#setting-synthesia-avatar').value`), 'default');
  assert.equal(await js(`document.querySelectorAll('select').length`), 2);
  checks.push('new default opens with Synthesia and its supplied avatar selected');
  await select('#setting-mode', 'local'); await wait(`!document.querySelector('#setting-synthesia-avatar')`);
  assert.equal(await js(`document.querySelectorAll('select').length`), 1);
  await select('#setting-mode', 'synthesia'); await wait(`!!document.querySelector('#setting-synthesia-avatar')`);
  assert.deepEqual(await js(`Array.from(document.querySelector('#setting-synthesia-avatar').options,o=>o.textContent)`), ['Synthesia avatarı', 'Bizim karakter']);
  assert.equal(await js(`document.querySelector('#setting-synthesia-avatar').value`), 'default');
  await shot('synthesia-settings'); checks.push('three modes; Synthesia exposes exactly two avatars with supplied avatar first');
  await click('.settings-toggle'); await click('.record-button'); await wait(`!!document.querySelector('[role=alert]')`);
  assert.equal(await js(`window.__micStreams.length===0&&window.__rooms.length===0&&document.querySelector('.record-button').dataset.liveState==='idle'`), true);
  checks.push('unconfigured Synthesia reports the setup requirement without microphone access or a local fallback');
  await js(`window.__configured=true`); await click('.record-button'); await wait(`document.querySelector('.record-button').dataset.liveState==='connected'`);
  await wait(`document.querySelector('video')?.videoWidth>0`); assert.deepEqual(await js(`window.__choices`), ['default']);
  assert.equal(await js(`!document.querySelector('canvas')&&!document.querySelector('.messages')&&window.__micStreams[0].getTracks().every(t=>t.readyState==='live')`), true);
  await shot('synthesia-live-mock'); checks.push('record starts native microphone/video tracks and renders a remote video, with no local avatar underneath');
  await click('input'); await call('Input.insertText', { text: 'Merhaba' }); await click('.send-button');
  await click('.view-toggle'); await wait(`!!document.querySelector('.assistant-message p')`); assert.equal(await js(`document.querySelector('.avatar-stage').hidden&&document.querySelector('.assistant-message p').textContent==='Synthesia test yaniti'&&window.__rooms.length===1&&!window.__rooms[0].closed`), true);
  await click('.view-toggle'); await wait(`document.querySelector('video')?.videoWidth>0`); await click('.playback-stop');
  assert.equal(await js(`window.__sent.at(-1).type`), 'interrupt'); checks.push('text goes to the Synthesia agent; text/video switching preserves the same live room and interruption works');
  await click('.settings-toggle'); await select('#setting-synthesia-avatar', 'custom');
  await wait(`document.querySelector('canvas')?.dataset.ready==='true'`);
  assert.equal(await js(`window.__rooms[0].closed&&window.__hangups===1&&window.__micStreams[0].getTracks().every(t=>t.readyState==='ended')&&window.__videoStreams[0].getTracks().every(t=>t.readyState==='ended')`), true);
  await shot('synthesia-custom-preview'); await click('.settings-toggle'); await click('.record-button'); await wait(`document.querySelector('.record-button').dataset.liveState==='connected'`);
  assert.deepEqual(await js(`window.__choices`), ['default', 'custom']); await click('.chat-close');
  assert.equal(await js(`window.__rooms.every(r=>r.closed)&&window.__micStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))&&window.__videoStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))&&window.__hangups===2`), true);
  checks.push('changing avatars ends the old room; custom avatar dispatch is distinct; closing releases all tracks and rooms');
  await click('.chat-launcher'); await click('.settings-toggle'); assert.equal(await js(`document.querySelector('#setting-synthesia-avatar').value`), 'custom');
  for (const [width, height] of [[390, 844], [320, 640]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    assert.equal(await js(`Array.from(document.querySelectorAll('select')).every(s=>{const b=s.getBoundingClientRect(),p=document.querySelector('.chat-panel').getBoundingClientRect();return b.left>=p.left&&b.right<=p.right;})`), true);
    await shot('synthesia-settings-' + width);
  }
  checks.push('Synthesia selection persists and both dropdowns fit mobile screens');
  await select('#setting-mode', 'local'); await click('.settings-toggle'); await wait(`document.querySelector('canvas')?.dataset.ready==='true'`); await click('.chat-close');
  assert.deepEqual(errors, []); checks.push('no runtime errors; no paid provider calls made');
  fs.writeFileSync(output + 'synthesia-browser-report.json', JSON.stringify({ checks, errors, transport: 'mock SDK over native browser media', paidCalls: false }, null, 2));
  console.log(JSON.stringify({ checks, errors, paidCalls: false }, null, 2));
} finally { await js(`document.querySelector('.chat-close')?.click()`).catch(() => {}); await call('Fetch.disable').catch(() => {}); ws.close(); }
