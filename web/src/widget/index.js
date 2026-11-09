import * as ui from '../components/index.js';
import { turkishVoices, voiceId } from '../voice/index.js';

/** The voice list: automatic (best Turkish voice) first, then the Turkish voices, best first. */
function createVoiceControl(document, { speech, onChange }) {
  const root = document.createElement('div'); root.setAttribute('class', 'field');
  const caption = document.createElement('label'); caption.setAttribute('for', 'speech-voice'); caption.textContent = 'Ses';
  const select = document.createElement('select'); select.setAttribute('id', 'speech-voice'); select.setAttribute('aria-describedby', 'speech-voice-help');
  const hint = document.createElement('p'); hint.setAttribute('class', 'small muted'); hint.setAttribute('id', 'speech-voice-help');
  hint.textContent = 'Otomatik seçim en doğal Türkçe sesi kullanır. Çevrim içi sesler internet bağlantısı ister.';
  let chosen = '';
  const option = (value, text) => { const item = document.createElement('option'); item.setAttribute('value', value); item.value = value; item.textContent = text; return item; };
  const refresh = () => {
    const voices = turkishVoices(speech.getVoices());
    select.textContent = '';
    select.appendChild(option('', 'Otomatik (en doğal Türkçe ses)'));
    for (const voice of voices) select.appendChild(option(voiceId(voice), `${voice.name || voiceId(voice)}${voice.localService === false ? ' · çevrim içi' : ''}`));
    if (!voices.some(voice => voiceId(voice) === chosen)) chosen = '';
    select.value = chosen;
  };
  select.addEventListener('change', () => { chosen = select.value; onChange(chosen); });
  refresh();
  root.appendChild(caption); root.appendChild(select); root.appendChild(hint);
  return { element: root, select, refresh, dispose: speech.onVoicesChanged(refresh) };
}

export function createWidget({ document, conversation, speech, config, renderer }) {
  const node = (tag, cls, text) => { const n = document.createElement(tag); n.setAttribute('class', cls); if (text !== undefined) n.textContent = text; return n; };
  const add = (parent, ...children) => children.forEach(child => parent.appendChild(child));
  const element = node('section', 'workspace');
  const intro = node('div', 'stack');
  const hero = node('section', 'hero stack');
  add(hero, node('p', 'eyebrow', 'BİR METİN, BİR İFADE'), node('h1', 'display', 'Kelimelere\nhareket katın.'), node('p', 'lead muted', 'Bir cümle yazın. Konuşmayı dinleyin; dudakların, bakışların ve küçük duraklamaların ne kadar doğal hissettirdiğini izleyin.'), node('p', 'small muted', '● Tarayıcı sesiyle seslendirme     Masaüstü Chrome ve Safari için'));
  const guide = node('section', 'card stack'); add(guide, node('h2', 'title', 'Küçük bir denemeyle başlayın'));
  const list = node('ol', 'guide');
  [['Paneli açın', `Sağ alttaki yuvarlak ikon paneli açar ve kapatır. Açılıştan ${config.greeting.delayMs / 1000} saniye sonra “${config.greeting.text}” selamlaması başlar.`], ['Metninizi seslendirin', 'Kısa bir cümleyle başlayın, ardından noktalı uzun bir paragraf deneyin. Hız ve tonu değiştirerek tekrar dinleyin.'], ['Hareketleri gözlemleyin', 'Konuşmanın başında ve sonunda ağız uyumuna bakın. Doğal göz kırpmayı değerlendirmek için karakteri 1–2 dakika izleyin.']].forEach(([title, text], index) => {
    const row = node('li', 'row'); const copy = node('div', 'stack-tight'); add(copy, node('h3', 'title', title), node('p', 'muted', text)); add(row, node('span', 'value', `0${index + 1}`), copy); add(list, row);
  });
  add(guide, list);
  const sample = node('section', 'stack');
  add(sample, node('p', 'eyebrow', 'DENEME FİKRİ'), node('h2', 'title', 'Farklı sesler, farklı ağız şekilleri'), node('blockquote', 'card soft', '“Pembe bir balon buldum. Onu büyük, yuvarlak bir kutunun üzerine koydum.”'), node('p', 'small muted', 'Kararsız kaldığınız cümleyi iki veya üç kez tekrarlayın; ses ile ağız arasında fark edilir bir kayma olup olmadığına bakın.'));
  const info = node('section', 'card stack-tight'); info.setAttribute('id', 'gorsel-bilgisi'); add(info, node('h2', 'title', 'Karakter görseli'), node('p', 'small muted', 'Özgün karakter dosyası kullanılıyor. Karakter alanı 463 × 539 oranını korur.')); add(intro, hero, guide, sample, info);
  let open = false;
  let opened = Promise.resolve();
  const status = ui.createStatus(document);
  const close = () => { open = false; panel.setOpen(false); toggle.setExpanded(false); conversation.close(); renderer.render(); status.setStatus('ready'); };
  const panel = ui.createCharacterPanel(document, { onClose: close });
  const toggle = ui.createPanelToggle(document, { panelId: 'character-panel', onChange: expanded => {
    speech.unlock(); if (!expanded) return close();
    open = true; panel.setOpen(true); status.setStatus('greeting');
    const opening = conversation.open();
    const sessionId = conversation.sessionId;
    opened = opening.then(() => {
      if (open && conversation.sessionId === sessionId) renderer.updateConfig(conversation.config);
    });
  } });
  panel.setOpen(false);
  const stage = ui.createCharacterStage(document);
  const frame = stage.children[0]; frame.textContent = ''; frame.appendChild(renderer.svg); if (renderer.canvas) frame.appendChild(renderer.canvas);
  renderer.group.children[0].addEventListener('error', () => { frame.textContent = ''; frame.appendChild(node('p', 'small muted', 'Karakter görseli yüklenemedi. Özgün dosya bulunamadı.')); });
  const header = panel.element.children[0];
  const heading = header.children[0];
  const headingGroup = node('div', 'stack-tight');
  add(headingGroup, node('p', 'eyebrow', 'KONUŞMA ALANI'), heading);
  header.textContent = ''; add(header, headingGroup, panel.closeButton);
  panel.element.textContent = ''; add(panel.element, header, stage, panel.content);
  panel.content.setAttribute('class', 'panel-content stack');
  const row = node('div', 'row between'); add(row, node('h3', 'title', 'Seslendirme'), status.element);
  const warning = ui.createNotice(document, { text: 'Türkçe ses bulunamadı, varsayılan ses kullanılıyor.' }); warning.element.hidden = true;
  const entry = ui.createTextEntry(document, { value: 'Merhaba! Bugün birlikte küçük bir konuşma deneyi yapalım.', onChange: value => { action.disabled = !value.trim(); } });
  const ranges = node('fieldset', 'stack'); add(ranges, node('legend', '', 'Ses ayarları'));
  const controls = node('div', 'ranges');
  const rate = ui.createRangeControl(document, { id: 'speech-rate', label: 'Hız', value: config.speech.rate, suffix: '×', lowLabel: '0,5 · Yavaş', highLabel: '1,5 · Hızlı', onChange: value => conversation.setRate(value) });
  const pitch = ui.createRangeControl(document, { id: 'speech-pitch', label: 'Ton', value: config.speech.pitch, lowLabel: '0,5 · Kalın', highLabel: '1,5 · İnce', onChange: value => conversation.setPitch(value) });
  const voice = createVoiceControl(document, { speech, onChange: id => conversation.setVoice(id) });
  add(controls, rate.element, pitch.element); add(ranges, voice.element, controls);
  const action = ui.createActionButton(document, { label: 'Seslendir', onClick: () => { if (open && entry.input.value.trim()) conversation.say(entry.input.value); } }); action.setAttribute('class', 'button button-primary full');
  const details = node('details', 'small muted'); add(details, node('summary', '', 'Ses ve selamlama hakkında'), node('p', '', 'Türkçe ses sonradan yüklenirse sonraki konuşmada kullanılır. Selamlama metni, bekleme süresi ve başlangıç ses ayarları ayar dosyasından gelir.'));
  add(panel.content, row, warning.element, entry.element, ranges, node('p', 'small muted', 'Ayarlar sonraki seslendirmeye uygulanır ve kaydedilmez.'), action, node('p', 'small muted', 'Paneli kapatmak konuşmayı durdurur. Yeniden açıldığında selamlama tekrarlanır.'), details);
  const cleanups = [
    voice.dispose,
    conversation.on('voice-warning', () => { warning.element.hidden = false; }),
    conversation.on('state-change', ({ state }) => {
      status.setStatus(state === 'Speaking' ? 'speaking' : state === 'Waiting' ? 'greeting' : 'ready');
    })
  ];
  add(element, intro, panel.element, toggle.element);
  return { get opened() { return opened; }, element, toggle: toggle.element, panel, status, warning, entry, action, rate, pitch, voice, dispose() { cleanups.forEach(fn => fn()); close(); } };
}
