// Video avatar modunun gerçek tarayıcıda uçtan uca kontrolü ve gecikme ölçümü.
// Önce: npm run dev   Sonra: node scripts/avatar-browser-qa.mjs --allow-api [--runs 3]
// --allow-api: gerçek OpenAI sohbet, TTS ve STT çağrıları yapar; ücretlidir.
// Modeller arası karşılaştırma: .env.local içinde OPENAI_CHAT_MODEL'i değiştirip betiği yeniden çalıştırın.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), output = path.join(root, 'artifacts');
const allowApi = process.argv.includes('--allow-api'), runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 3;
const APP = 'http://127.0.0.1:5176/?nolive', PORT = 9347;
fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Sahte mikrofon: kalibrasyon cümlelerinden biri ("Bunu biraz daha açabilir misiniz?").
const micFile = path.join(root, 'viseme_analysis/out_v2/calib/s04.wav');
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(fs.existsSync(micFile) ? [`--use-file-for-fake-audio-capture=${micFile}%noloop`] : []),
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(output, 'avatar-qa-profile')}`, '--window-size=1440,960', 'about:blank'], { stdio: 'ignore' });
let pages;
for (let i = 0; i < 60 && !pages; i++) { await sleep(250); pages = await fetch(`http://127.0.0.1:${PORT}/json`).then(r => r.json()).catch(() => undefined); }
const ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let next = 0; const pending = new Map(), errors = [], failed = [];
ws.addEventListener('message', event => {
  const m = JSON.parse(event.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) failed.push(`${m.params.response.status} ${m.params.response.url}`);
  if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
});
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const js = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const until = async (expression, timeout = 20000) => { const end = Date.now() + timeout; do { if (await js(expression)) return; await sleep(40); } while (Date.now() < end); throw Error('Zaman aşımı: ' + expression); };
const shot = async name => { const r = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(r.data, 'base64')); };
const type = async text => { await js(`document.querySelector('.input-wrap input').focus()`); await call('Input.insertText', { text }); };
const enter = async () => { for (const kind of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type: kind, key: 'Enter', code: 'Enter', text: kind === 'keyDown' ? '\r' : undefined, windowsVirtualKeyCode: 13 }); };
const state = () => js(`({state:document.querySelector('.video-avatar-canvas')?.dataset.state,viseme:document.querySelector('.video-avatar-canvas')?.dataset.viseme})`);
const checks = [], report = { checks };
// Taklit LLM: gerçek akış gibi ~35 ms aralıkla kelime kelime gelir.
const mockChat = reply => js(`(()=>{const native=window.__nativeFetch??=window.fetch;window.fetch=(input,init)=>{if(String(input).endsWith('/api/avatar/status'))return native(input,init).then(r=>r.json()).then(j=>Response.json({...j,chat:true,model:'taklit'}));if(!String(input).endsWith('/api/avatar/chat'))return native(input,init);
  const words=${JSON.stringify(reply)}.split(/(?<= )/),encoder=new TextEncoder();let timer;
  const stream=new ReadableStream({start(controller){const send=o=>controller.enqueue(encoder.encode('data: '+JSON.stringify(o)+'\\n\\n'));let i=0;send({type:'start',model:'taklit'});
    timer=setInterval(()=>{if(i<words.length)send({type:'delta',text:words[i++]});else{send({type:'done',model:'taklit',stop_reason:'end_turn'});clearInterval(timer);controller.close();}},35);
    init?.signal?.addEventListener('abort',()=>{clearInterval(timer);try{controller.error(new DOMException('aborted','AbortError'))}catch{}});}});
  return new Promise(resolve=>setTimeout(()=>resolve(new Response(stream,{status:200,headers:{'Content-Type':'text/event-stream'}})),400));};})()`);
try {
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false });
  await call('Page.navigate', { url: APP }); await until(`!!document.querySelector('.chat-launcher')`);
  await js(`localStorage.setItem('pmi-chat.settings.v5',JSON.stringify({mode:'video',synthesiaAvatar:'default',voice:true}))`); await call('Page.reload'); await sleep(700); await until(`!!document.querySelector('.chat-launcher')`);
  // --- tembel yükleme: kutu açılmadan avatar varlıkları istenmez ---
  const before = await js(`performance.getEntriesByType('resource').filter(e=>e.name.includes('/viseme-rig/')||e.name.includes('/api/avatar/')).length`);
  assert.equal(before, 0); checks.push('sayfa ilk açılışta avatar varlıklarını ve API durumunu istemez (lazy)');
  await js(`document.querySelector('.chat-launcher').click()`); await until(`document.querySelector('.video-avatar-canvas')?.dataset.ready==='true'`);
  await until(`document.querySelector('.chat-panel:not([hidden])').getAnimations().every(a=>a.playState!=='running')`); await sleep(400);
  const layout = await js(`(()=>{const b=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};const c=document.querySelector('.video-avatar-canvas');
    return{panel:b('.chat-panel'),stage:b('.avatar-stage'),canvas:b('.video-avatar-canvas'),messages:b('.messages'),composer:b('.chat-composer'),backing:c.width,atlas:performance.getEntriesByType('resource').filter(e=>e.name.includes('atlas')).map(e=>e.name.split('/').pop()+' '+Math.round(e.transferSize/1024)+'KB')}})()`);
  report.layout = layout;
  assert.equal(layout.canvas.w, 300); assert.equal(layout.canvas.h, 300); assert.equal(layout.backing, 600); assert.ok(layout.atlas.some(name => name.includes('2x')));
  assert.ok(layout.messages.y >= layout.stage.y + layout.stage.h - 1 && layout.composer.y >= layout.messages.y + layout.messages.h - 1);
  checks.push('kutu açılınca üstte 300 px avatar, altında mesaj listesi ve giriş alanı; 2x ekranda 2x atlas');
  // tuval gerçekten çiziliyor mu (siyah değil) ve göz kırpma / baş hareketi kareleri değiştiriyor mu
  const pixels = () => js(`(()=>{const c=document.querySelector('.video-avatar-canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let lit=0,sum=0;for(let i=0;i<d.length;i+=16){if(d[i]+d[i+1]+d[i+2]>90)lit++;sum=(sum+d[i]*7+d[i+1]*3+d[i+2])%1000003}return{lit:lit/(d.length/16),sum}})()`);
  const first = await pixels(); await sleep(700); const second = await pixels();
  assert.ok(first.lit > .25, 'avatar çizildi'); assert.notEqual(first.sum, second.sum); checks.push('avatar çiziliyor ve boştayken canlı (kareler değişiyor)');
  await shot('avatar-video-idle');
  const status = await js(`fetch('/api/avatar/status').then(r=>r.json())`); report.status = status;
  // --- demo modu (.env eksikken): kutu çalışır, avatar gömülü cümleyi söyler ---
  if (!status.chat) {
    await type('Merhaba'); await enter();
    await until(`document.querySelector('.video-avatar-canvas').dataset.state==='speaking'`, 8000);
    const seen = new Set(); for (let i = 0; i < 60; i++) { const s = await state(); if (s.state !== 'speaking') break; seen.add(s.viseme); await sleep(50); }
    await until(`document.querySelector('.video-avatar-canvas').dataset.state==='idle'`, 10000);
    assert.equal(await js(`document.querySelector('.assistant-message p').textContent`), 'Merhaba, size nasıl yardımcı olabilirim?'); assert.ok(seen.size >= 4, [...seen].join(','));
    assert.equal(await js(`document.querySelector('.avatar-status').textContent.trim()`), 'Demo modu');
    checks.push(`anahtar yokken demo modu çalışır: gömülü cümle seslendirildi, ${seen.size} farklı ağız şekli görüldü (${[...seen].join(', ')})`);
  }
  if (!allowApi) { checks.push('ücretli çağrılar atlandı (--allow-api verilmedi)'); }
  else if (!status.tts) { checks.push('OPENAI_API_KEY yok: TTS/STT kontrolleri atlandı'); }
  else {
    const mocked = !status.chat;
    const reply = 'Tabii, hemen yardımcı olayım. İstanbul bugün parçalı bulutlu ve sıcaklık on sekiz derece civarında. Dışarı çıkacaksanız yanınıza ince bir ceket almanızı öneririm.';
    if (mocked) { // durum da taklit edilir; kutu yeniden açılınca uygulama sohbeti yapılandırılmış görür
      await mockChat(reply); await js(`document.querySelector('.chat-close').click()`); await js(`document.querySelector('.chat-launcher').click()`);
      await until(`document.querySelector('.video-avatar-canvas')?.dataset.ready==='true'`); await sleep(600);
    }
    // --- tam akış + gecikme ölçümü ---
    const turns = [];
    for (let run = 0; run < runs; run++) {
      await js(`window.__avatarMetrics=[]`); const count = await js(`document.querySelectorAll('.assistant-message').length`);
      await type(run === 0 ? 'İstanbul\'da bugün hava nasıl, ne giymeliyim?' : run === 1 ? 'Peki yarın için ne önerirsin?' : 'Teşekkürler, başka bir önerin var mı?'); await enter();
      await until(`document.querySelector('.video-avatar-canvas').dataset.state==='speaking'`, 30000);
      const seen = new Set(); let captured = false;
      for (;;) { const s = await state(); if (s.state !== 'speaking') break; seen.add(s.viseme); if (!captured && seen.size > 3 && s.viseme !== 'SIL') { captured = true; if (run === 0) await shot('avatar-video-speaking'); } await sleep(45); }
      await until(`window.__avatarMetrics.some(m=>m.done)`, 60000);
      const metrics = await js(`window.__avatarMetrics.at(-1)`), text = await js(`[...document.querySelectorAll('.assistant-message p')].at(-1).textContent`);
      assert.equal(await js(`document.querySelectorAll('.assistant-message').length`), count + 1); assert.ok(text.length > 10); assert.ok(seen.size >= 5, [...seen].join(','));
      turns.push({ ...metrics, llm: mocked ? 'taklit' : 'gerçek', visemes: [...seen], chars: text.length });
    }
    report.turns = turns;
    const median = key => { const values = turns.map(turn => turn[key]).filter(Number.isFinite).sort((a, b) => a - b); return values[values.length >> 1]; };
    report.latency_ms_median = { model: turns[0].model, llm: mocked ? 'taklit' : 'gerçek', first_token: median('firstToken'), first_sentence: median('firstSentence'), tts_done: median('ttsDone'), mouth_start: median('mouthStart'), tts_only: median('ttsDone') - median('firstSentence'), align_and_start: median('mouthStart') - median('ttsDone') };
    checks.push(`tam akış ${runs} kez: yanıt cümlelere bölündü, gerçek TTS ile seslendirildi, ağız hareket etti; metin balonda göründü`);
    // --- söz kesme: yazmaya başlayınca avatar susar ---
    await type('Uzun bir cevap ver lütfen.'); await enter();
    await until(`document.querySelector('.video-avatar-canvas').dataset.state==='speaking'`, 30000); await sleep(600);
    await type('D'); const cut = Date.now(); await until(`document.querySelector('.video-avatar-canvas').dataset.state!=='speaking'`, 1500); report.interrupt_ms = Date.now() - cut;
    await sleep(1500); assert.notEqual((await state()).state, 'speaking'); checks.push(`söz kesme: yazmaya başlayınca ${report.interrupt_ms} ms içinde sustu, kuyruk temizlendi`);
    await js(`(()=>{const i=document.querySelector('.input-wrap input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    // --- ses kapalı: yalnızca metin, avatar idle ---
    await js(`document.querySelector('.voice-toggle').click()`); const ttsBefore = await js(`performance.getEntriesByType('resource').filter(e=>e.name.endsWith('/api/avatar/tts')).length`);
    const messages = await js(`document.querySelectorAll('.assistant-message').length`);
    await type('Ses kapalıyken yanıt ver.'); await enter(); let spoke = false;
    await until(`document.querySelectorAll('.assistant-message').length===${messages + 1}`, 30000);
    for (let i = 0; i < 40; i++) { if ((await state()).state === 'speaking') spoke = true; await sleep(50); }
    assert.equal(spoke, false); assert.equal(await js(`performance.getEntriesByType('resource').filter(e=>e.name.endsWith('/api/avatar/tts')).length`), ttsBefore);
    await js(`document.querySelector('.voice-toggle').click()`); checks.push('ses kapalıyken yalnızca metin gösterilir, TTS çağrılmaz, avatar idle kalır');
    // --- mikrofon: bas-konuş + gerçek STT ---
    if (fs.existsSync(micFile)) {
      const users = await js(`document.querySelectorAll('.message:not(.assistant-message)').length`);
      const pointer = kind => js(`document.querySelector('.record-button').dispatchEvent(new PointerEvent('${kind}',{bubbles:true,pointerId:1,isPrimary:true}))`);
      await pointer('pointerdown'); await until(`document.querySelector('.record-button').dataset.voiceState==='recording'`, 8000);
      assert.equal((await state()).state, 'listening'); await shot('avatar-video-listening'); await sleep(3300); await pointer('pointerup');
      await until(`document.querySelectorAll('.message:not(.assistant-message)').length===${users + 1}`, 30000);
      report.stt_text = await js(`[...document.querySelectorAll('.message:not(.assistant-message) p')].at(-1).textContent`);
      assert.match(report.stt_text.toLocaleLowerCase('tr-TR'), /açabilir|biraz|bunu/); checks.push(`mikrofon: kayıt sırasında "listening", gerçek STT metni: "${report.stt_text}"`);
      await until(`document.querySelector('.video-avatar-canvas').dataset.state==='speaking'`, 30000); await js(`document.querySelector('.playback-stop')?.click()`); await sleep(300);
    }
  }
  // --- mobil: dar ekranda avatar küçülür, kutu taşmaz ---
  report.mobile = {};
  for (const [width, height] of [[390, 844], [320, 568]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true }); await sleep(350);
    const m = await js(`(()=>{const p=document.querySelector('.chat-panel:not([hidden])').getBoundingClientRect(),c=document.querySelector('.video-avatar-canvas').getBoundingClientRect(),l=document.querySelector('.messages').getBoundingClientRect();return{panelFits:p.left>=0&&p.top>=0&&p.right<=innerWidth&&p.bottom<=innerHeight,canvas:Math.round(c.width),messages:Math.round(l.height),noScroll:document.documentElement.scrollWidth<=innerWidth}})()`);
    report.mobile[`${width}x${height}`] = m; assert.ok(m.panelFits && m.noScroll && m.canvas < 300 && m.canvas >= 150 && m.messages >= 80, JSON.stringify(m)); await shot(`avatar-video-${width}x${height}`);
  }
  checks.push('mobil: 390 ve 320 px genişlikte kutu sığar, avatar küçülür, mesaj listesi görünür kalır');
  assert.deepEqual(errors, []); assert.deepEqual(failed, []); checks.push('tarayıcıda çalışma zamanı hatası ve başarısız ağ isteği yok');
  fs.writeFileSync(path.join(output, 'avatar-video-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await shot('avatar-video-failure').catch(() => {}); console.error(JSON.stringify({ ...report, errors, failed }, null, 2)); throw error;
} finally { ws.close(); chrome.kill(); }
