import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../artifacts/', import.meta.url));
const pages = await (await fetch('http://127.0.0.1:9346/json')).json();
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let next = 0, loads = 0; const pending = new Map(), errors = [], checks = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Page.loadEventFired') loads++;
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  if (pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); message.error ? p.reject(message.error) : p.resolve(message.result); }
});
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const js = async expression => { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description); return result.result.value; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (expression, checkError = false) => { const end = Date.now() + 15000; while (Date.now() < end) { if (await js(expression)) return; if (checkError) { const error = await js(`document.querySelector('[role=alert]')?.textContent`); if (error) throw Error(error); } await sleep(60); } throw Error('Timed out: ' + expression); };
const click = async selector => { await until(`!!document.querySelector(${JSON.stringify(selector)})`); return js(`document.querySelector(${JSON.stringify(selector)}).click()`); };
const select = (selector, value) => js(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.value=${JSON.stringify(value)};element.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const load = async (method, params = {}) => { const previous = loads; await call(method, params); while (loads === previous) await sleep(40); };
const shot = async name => { const result = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(output + name + '.png', Buffer.from(result.data, 'base64')); };
try {
  await call('Page.enable'); await call('Runtime.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await load('Page.navigate', { url: 'http://127.0.0.1:5176/' }); await until(`!!document.querySelector('.chat-launcher')`);
  await js(`localStorage.setItem('pmi-chat.settings.v5',JSON.stringify({mode:'synthesia',synthesiaAvatar:'default'}))`); await load('Page.reload'); await until(`!!document.querySelector('.chat-launcher')`);
  // Produce native h264/AAC fMP4 locally. The provider socket is simulated; the decoder, microphone and PCM worklet are real.
  await js(`(async()=>{
    window.__fixture=[];const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');let frame=0;
    const draw=()=>{ctx.fillStyle='#183743';ctx.fillRect(0,0,320,240);ctx.fillStyle='#e5eff6';ctx.font='18px sans-serif';ctx.textAlign='center';ctx.fillText('Gemini QA video',160,112);ctx.fillStyle='#7ecebe';ctx.fillRect((frame++*3)%300,160,20,5);};draw();const timer=setInterval(draw,40);const stream=canvas.captureStream(25);
    const audio=new AudioContext();await audio.resume();const tone=audio.createOscillator(),gain=audio.createGain(),destination=audio.createMediaStreamDestination();gain.gain.value=.01;tone.connect(gain);gain.connect(destination);tone.start();destination.stream.getTracks().forEach(track=>stream.addTrack(track));
    const mime='video/mp4;codecs=avc1.42E01E,mp4a.40.2';if(!MediaRecorder.isTypeSupported(mime))throw Error('Native MP4 recorder unavailable');
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:120000});const blobs=[];recorder.ondataavailable=e=>{if(e.data.size)blobs.push(e.data);};const done=new Promise(resolve=>recorder.onstop=resolve);recorder.start(200);await new Promise(resolve=>setTimeout(resolve,3500));recorder.stop();await done;window.__fixture=await Promise.all(blobs.map(blob=>blob.arrayBuffer()));clearInterval(timer);stream.getTracks().forEach(track=>track.stop());tone.stop();await audio.close();
    window.__configured=false;window.__gSockets=[];window.__gStreams=[];window.__gSent=[];window.__gUrls=[];window.__gRevoked=[];
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=value=>{const url=create(value);window.__gUrls.push(url);return url;};URL.revokeObjectURL=url=>{window.__gRevoked.push(url);return revoke(url);};
    const nativeFetch=fetch;window.fetch=async(url,options)=>String(url).includes('/api/gemini/status')?Response.json({configured:window.__configured,missing:window.__configured?[]:['GOOGLE_CLOUD_PROJECT','GOOGLE_CLOUD_AUTH'],model:'gemini-3.8-live',avatar:'Ben'}):nativeFetch(url,options);
    window.__nativeMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await window.__nativeMedia(options);window.__gStreams.push(stream);return stream;};
    const NativeSocket=WebSocket;window.WebSocket=class{
      static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
      constructor(url,...args){if(!String(url).includes('/api/gemini/live'))return new NativeSocket(url,...args);this.readyState=0;this.bufferedAmount=0;this.binaryType='';window.__gSockets.push(this);setTimeout(()=>{if(this.readyState===3)return;this.readyState=1;this.onopen?.({});this.emit({type:'ready'});let index=0;this.timer=setInterval(()=>{if(this.readyState!==1)return;if(index<window.__fixture.length)this.onmessage?.({data:window.__fixture[index++].slice(0)});else{clearInterval(this.timer);this.emit({type:'turn_complete'});}},120);},20);}
      emit(value){this.onmessage?.({data:JSON.stringify(value)});}
      send(value){if(value instanceof ArrayBuffer){window.__gSent.push({type:'pcm',bytes:value.byteLength});return;}const message=JSON.parse(value);window.__gSent.push(message);if(message.type==='text')setTimeout(()=>{this.emit({type:'message',id:'gemini_test_reply',role:'assistant',text:'Gemini test yaniti'});},20);}
      close(){this.readyState=3;clearInterval(this.timer);this.onclose?.({code:1000});}
    };
  })()`);
  await click('.chat-launcher'); await click('.settings-toggle'); assert.equal(await js(`document.querySelector('#setting-mode').value`), 'synthesia');
  await select('#setting-mode', 'gemini'); await until(`document.querySelector('.settings-note').textContent.includes('Google Cloud')`); await shot('gemini-settings');
  assert.equal(await js(`document.querySelectorAll('select').length`), 1); await click('.settings-toggle');
  await click('.record-button'); await until(`!!document.querySelector('[role=alert]')`);
  assert.equal(await js(`window.__gStreams.length===0&&window.__gSockets.length===0&&document.querySelector('.record-button').dataset.liveState==='idle'`), true);
  checks.push('Gemini is a third option; Synthesia stays default; missing Cloud configuration never requests microphone');
  await js(`window.__configured=true`); await click('.record-button'); await until(`document.querySelector('.record-button').dataset.liveState==='connected'`, true);
  await until(`document.querySelector('video').videoWidth===320&&document.querySelector('video').currentTime>0`, true);
  await until(`window.__gSent.filter(message=>message.type==='pcm').length>5`, true);
  assert.equal(await js(`window.__gSent.filter(message=>message.type==='pcm').every(message=>message.bytes===640)&&window.__gStreams.every(stream=>stream.getVideoTracks().length===0)`), true);
  await shot('gemini-live-mock'); checks.push('native h264/AAC fMP4 decodes and plays; native microphone/worklet sends 16kHz PCM without camera capture');
  await click('input'); await call('Input.insertText', { text: 'Merhaba Gemini' }); await click('.send-button'); await click('.view-toggle'); await until(`!!document.querySelector('.assistant-message')`);
  const before = await js(`document.querySelector('video').currentTime`); await sleep(250);
  assert.equal(await js(`document.querySelector('.avatar-stage').hidden&&document.querySelector('.assistant-message p').textContent==='Gemini test yaniti'&&window.__gSockets.length===1&&window.__gSockets[0].readyState===1&&!document.querySelector('video').paused`), true);
  assert.ok(await js(`document.querySelector('video').currentTime`) >= before); await click('.view-toggle');
  checks.push('typed text reaches Gemini and text/video switching preserves the same live socket and player');
  await click('.record-button'); await until(`document.querySelector('.record-button').dataset.liveState==='idle'`);
  assert.equal(await js(`window.__gSockets.every(socket=>socket.readyState===3)&&window.__gStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))&&window.__gUrls.every(url=>window.__gRevoked.includes(url))`), true);
  checks.push('stopping closes provider socket, microphone, and every media object URL');
  await js(`navigator.mediaDevices.getUserMedia=async options=>{const stream=await window.__nativeMedia(options);window.__gStreams.push(stream);window.__late=stream;return new Promise(resolve=>window.__resolveMedia=()=>resolve(stream));};`);
  await click('.record-button'); await until(`typeof window.__resolveMedia==='function'`); await click('.record-button'); await js(`window.__resolveMedia()`); await until(`window.__late.getTracks().every(track=>track.readyState==='ended')`);
  assert.equal(await js(`window.__gSockets.length`), 1); checks.push('canceling pending microphone permission releases its late stream without connecting');
  await click('.settings-toggle');
  for (const [width, height] of [[390, 844], [320, 640]]) { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true }); assert.equal(await js(`(()=>{const s=document.querySelector('select').getBoundingClientRect(),p=document.querySelector('.chat-panel').getBoundingClientRect();return s.left>=p.left&&s.right<=p.right&&p.bottom<=innerHeight;})()`), true); await shot('gemini-settings-' + width); }
  await select('#setting-mode', 'synthesia'); await click('.settings-toggle'); await click('.chat-close');
  assert.deepEqual(errors, []); checks.push('Gemini settings fit mobile screens and all checks run without paid provider calls');
  const report = { checks, errors, paidCalls: false, nativeMedia: 'MediaRecorder H264/AAC -> Gemini MSE player; microphone -> PCM AudioWorklet' };
  fs.writeFileSync(output + 'gemini-browser-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await js(`document.querySelector('.chat-close')?.click()`).catch(() => {}); ws.close(); }
