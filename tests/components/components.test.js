import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createFakeDOM } from '../helpers/dom.js';
import { createActionButton, createPanelToggle, createCharacterPanel, createCharacterStage, createTextEntry, createRangeControl, createNotice, createStatus } from '../../web/src/components/index.js';

test('hız ve ton verilen başlangıçla ve sayısal geri çağrıyla çalışır', () => {
  const { document } = createFakeDOM();
  for (const [id, label, value, suffix] of [['rate', 'Hız', 1.2, '×'], ['pitch', 'Ton', 0.8, '']]) {
    const changes = [];
    const control = createRangeControl(document, { id, label, value, suffix, onChange: next => changes.push(next) });
    for (const [key, expected] of Object.entries({ type: 'range', min: '0.5', max: '1.5', step: '0.1', value: String(value) })) assert.equal(control.input.getAttribute(key), expected);
    assert.equal(control.input.value, String(value));
    assert.equal(control.output.textContent, value.toFixed(1).replace('.', ',') + suffix);
    assert.equal(control.element.children[0].children[0].getAttribute('for'), id);
    control.input.value = '1.4'; control.input.dispatch('input');
    assert.equal(control.output.textContent, '1,4' + suffix); assert.deepEqual(changes, [1.4]);
  }
  assert.equal(createRangeControl(document, { id: 'default', label: 'Hız' }).input.value, '1');
  assert.throws(() => createRangeControl(document, { id: 'bad', label: 'Ton', value: Infinity }), RangeError);
});
test('bildirim metni işaretleme olarak yorumlanmaz, Kapat gizler ve bildirir', () => {
  const { document } = createFakeDOM();
  for (const variant of ['warning', 'error', 'info']) {
    let closed = 0;
    const text = '<img src=x onerror=alert(1)>';
    const notice = createNotice(document, { text, variant, onClose: () => closed++ });
    assert.equal(notice.element.children[1].textContent, text);
    assert.deepEqual(notice.element.children[1].children, []);
    assert.equal(notice.closeButton.getAttribute('aria-label'), 'Kapat');
    assert.equal(notice.element.getAttribute('role'), variant === 'info' ? 'status' : 'alert');
    notice.closeButton.dispatch('click'); assert.equal(notice.element.hidden, true); assert.equal(closed, 1);
  }
});
test('panel açma ikonu açık durumu ve erişilebilir adı günceller', () => {
  const { document } = createFakeDOM();
  const changes = [];
  const toggle = createPanelToggle(document, { panelId: 'panel', onChange: value => changes.push(value) });
  assert.equal(toggle.element.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.element.getAttribute('aria-controls'), 'panel');
  toggle.element.dispatch('click'); assert.equal(toggle.element.getAttribute('aria-expanded'), 'true');
  assert.match(toggle.element.getAttribute('aria-label'), /kapat/);
  toggle.element.dispatch('click'); assert.equal(toggle.element.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(changes, [true, false]);
  toggle.setExpanded(true); assert.equal(toggle.element.getAttribute('aria-expanded'), 'true');
});
test('durum etiketi dört metni gösterebilir', () => {
  const { document } = createFakeDOM();
  const status = createStatus(document);
  for (const [state, label] of [['ready','Hazır'],['greeting','Selamlama bekleniyor'],['speaking','Konuşuyor'],['review','İnceleme bekleniyor']]) {
    status.setStatus(state); assert.equal(status.element.textContent, label);
  }
  assert.equal(status.element.getAttribute('role'), 'status');
  assert.throws(() => status.setStatus('approved'), RangeError);
});
test('düğme çeşitleri ve devre dışı davranış, panel kapatma', () => {
  const { document } = createFakeDOM();
  let calls = 0;
  for (const variant of ['primary', 'secondary', 'icon']) {
    const button = createActionButton(document, { label: 'Seslendir', variant, disabled: true, onClick: () => calls++ });
    assert.equal(button.getAttribute('type'), 'button');
    button.dispatch('click'); assert.equal(calls, 0);
  }
  const panel = createCharacterPanel(document, { onClose: () => calls++ });
  assert.match(panel.element.getAttribute('class'), /widget-panel/);
  panel.closeButton.dispatch('click'); assert.equal(panel.element.hidden, true); assert.equal(calls, 1);
  panel.setOpen(true); assert.equal(panel.element.hidden, false);
});
test('metin alanı etiket ve yardımla bağlıdır, kullanıcı girdisini iletir', () => {
  const { document } = createFakeDOM();
  let received;
  const field = createTextEntry(document, { id: 'text', onChange: value => { received = value; } });
  assert.equal(field.element.children[0].getAttribute('for'), 'text');
  assert.equal(field.input.getAttribute('aria-describedby'), field.element.children[2].getAttribute('id'));
  field.input.value = '<b>Merhaba</b>'; field.input.dispatch('input'); assert.equal(received, '<b>Merhaba</b>');
});
test('sahne eksik görseli açıklar ve sağlanan özgün görseli kullanabilir', () => {
  const { document } = createFakeDOM();
  assert.match(createCharacterStage(document).textContent, /Karakter görseli bekleniyor/);
  const stage = createCharacterStage(document, { src: '/assets/owner/akilay2-removebg-preview-1.png', alt: 'Özgün karakter' });
  const image = stage.children[0].children[0];
  assert.equal(image.tagName, 'IMG'); assert.equal(image.getAttribute('alt'), 'Özgün karakter');
  assert.equal(image.getAttribute('src'), '/assets/owner/akilay2-removebg-preview-1.png');
});
test('bileşen kaynakları güvenli metin işlemesini korur', () => {
  const directory = path.resolve(process.cwd(), 'web/src/components');
  function inspect(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) inspect(file);
      else assert.equal(readFileSync(file, 'utf8').includes('inner' + 'HTML'), false, file);
    }
  }
  inspect(directory);
});
