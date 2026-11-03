import test from 'node:test';
import assert from 'node:assert/strict';
import { createComparison } from '../../web/src/comparison/index.js';
import { mountApp } from '../../web/src/app.js';
import { createFakeDOM } from '../helpers/dom.js';

const all = node => [node, ...node.children.flatMap(all)];
const setup = () => {
  const dom = createFakeDOM();
  const view = createComparison(dom.document);
  return { ...dom, view, nodes: all(view) };
};

test('statik görseller, etiketler ve doğal boyut uyarıları', () => {
  const { view, nodes } = setup();
  const images = nodes.filter(n => n.tagName === 'IMG');
  assert.deepEqual(images.map(n => n.getAttribute('src')), ['/assets/owner/akilay2-removebg-preview-1.png', '/assets/generated/akilay2-face-base.png']);
  assert.deepEqual(images.map(n => n.getAttribute('alt')), ['Özgün karakter görseli', 'Türev karakter görseli']);
  for (const image of images) {
    assert.equal(image.getAttribute('width'), '463'); assert.equal(image.getAttribute('height'), '539');
    image.naturalWidth = 463; image.naturalHeight = 539; image.dispatch('load');
  }
  assert.match(view.textContent, /Doğal boyut: 463 × 539/);
  assert.doesNotMatch(view.textContent, /Boyut farklı/);
  images[0].naturalWidth = 400; images[0].dispatch('load');
  assert.match(view.textContent, /Boyut farklı/);
  images[1].dispatch('error');
  assert.match(view.textContent, /Türev görsel henüz yok/);
  assert.equal(images[1].hidden, true);
});

test('üst üste kipi ve saydamlık yalnızca yüklenen görsellerle etkinleşir', () => {
  const { nodes } = setup();
  const images = nodes.filter(n => n.tagName === 'IMG');
  const range = nodes.find(n => n.getAttribute('type') === 'range');
  const mode = nodes.find(n => n.getAttribute('aria-pressed') === 'false');
  const grid = nodes.find(n => n.getAttribute('class') === 'comparison-grid');
  assert.equal(range.disabled, true);
  mode.dispatch('click'); assert.equal(grid.getAttribute('class'), 'comparison-grid comparison-overlay');
  assert.equal(range.disabled, true);
  images.forEach(image => { image.naturalWidth = 463; image.naturalHeight = 539; image.dispatch('load'); });
  assert.equal(range.disabled, false);
  range.value = '25'; range.dispatch('input');
  assert.equal(images[1].getAttribute('style'), 'opacity:0.25');
  mode.dispatch('click'); assert.equal(grid.getAttribute('class'), 'comparison-grid');
  assert.equal(images[1].getAttribute('style'), 'opacity:1');
  assert.equal(range.disabled, true);
});

test('inceleme durumu kalıcıdır; onay ve ağ yazma işlemi yoktur', () => {
  const { nodes, view } = setup();
  const status = nodes.find(n => n.getAttribute('class') === 'status status-review');
  assert.equal(status.textContent, 'İnceleme bekleniyor');
  assert.equal(nodes.filter(n => n.getAttribute('type') === 'checkbox').length, 3);
  assert.equal(nodes.some(n => n.tagName === 'FORM'), false);
  assert.equal(nodes.some(n => n.tagName === 'BUTTON' && /onay|kaydet/i.test(n.textContent)), false);
  nodes.find(n => n.getAttribute('aria-pressed') === 'false').dispatch('click');
  assert.equal(status.textContent, 'İnceleme bekleniyor');
  assert.match(view.textContent, /onay kaydı oluşturmaz/);
});

test('hash gezinmesi karşılaştırmayı açar ve geri bağlantısı test ekranına döner', () => {
  const dom = createFakeDOM(); const calls = [];
  const unmount = mountApp({ ...dom, fetch: (...args) => { calls.push(args); throw new Error('Beklenmeyen ağ çağrısı'); } });
  // The fake DOM models the browser default action for anchor clicks.
  const click = link => {
    link.addEventListener('click', () => { dom.window.location.hash = link.getAttribute('href'); dom.window.dispatch('hashchange'); });
    link.dispatch('click');
  };
  click(all(dom.root).find(n => n.getAttribute('href') === '#karsilastirma'));
  assert.equal(dom.root.children[0].children[0].textContent, 'Karakter görseli karşılaştırması');
  assert.match(dom.root.textContent, /T12/);
  assert.match(dom.root.textContent, /Aynı karakter/);
  click(all(dom.root).find(n => n.getAttribute('href') === '#karakter-testi'));
  assert.match(dom.root.textContent, /Karakter testi/);
  assert.deepEqual(calls, []); unmount();
});
