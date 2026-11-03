import { createStatus, createNotice, createActionButton } from '../components/index.js';

export function createComparison(document) {
  const el = (tag, text = '', className = '') => {
    const node = document.createElement(tag); node.textContent = text;
    node.setAttribute('class', className); return node;
  };
  const add = (parent, ...children) => { children.forEach(child => parent.appendChild(child)); return parent; };
  const back = () => { const a = el('a', '← Karakter testine dön', 'button button-secondary'); a.setAttribute('href', '#karakter-testi'); return a; };
  const root = el('section', '', 'comparison stack');
  root.setAttribute('aria-label', 'Karakter görseli karşılaştırması');
  const routeHeading = el('h2', 'Karakter görseli karşılaştırması');
  routeHeading.hidden = true;
  const taskReference = el('p', 'T12');
  taskReference.hidden = true;
  add(root, routeHeading, taskReference);
  add(root, add(el('div', '', 'row between'), back(), createStatus(document, 'review').element),
    add(el('div', '', 'stack-tight'), el('p', 'KARAKTER GÖRSELİ · İNCELEME', 'eyebrow'), el('h1', 'Aynı karakter, yalnızca\niki bölge farklı.', 'display'), el('p', 'Özgün görselle türevi karşılaştırın. Yalnızca ağız ve göz bölgeleri cilt rengiyle doldurulmalı; karakterin geri kalanı korunmalıdır.', 'lead muted')),
    createNotice(document, { variant: 'info', text: 'Karşılaştırma ve onay beklemede; türev henüz gövde katmanı olarak seçilmedi.' }).element);
  const heading = el('h2', 'Yan yana karşılaştırma', 'comparison-heading');
  const card = add(el('section', '', 'card stack'), add(el('header', '', 'row between'), add(el('div', '', 'stack-tight'), heading, el('p', 'Eşit görüntüleme alanı · Özgün oran korunur', 'small muted')), el('span', '463 × 539 piksel', 'value')));
  const grid = el('div', '', 'comparison-grid');
  const loaded = [false, false]; const images = []; let update = () => {};
  ['Özgün', 'Türev'].forEach((label, index) => {
    const image = el('img');
    const message = el('p', 'Doğal boyut: yükleniyor…', 'small muted');
    const fallback = el('div', '', 'empty'); fallback.hidden = true;
    image.setAttribute('alt', `${label} karakter görseli`);
    image.setAttribute('width', '463'); image.setAttribute('height', '539');
    image.addEventListener('load', () => {
      loaded[index] = true; image.hidden = false; fallback.hidden = true;
      message.textContent = `Doğal boyut: ${image.naturalWidth} × ${image.naturalHeight} piksel${image.naturalWidth !== 463 || image.naturalHeight !== 539 ? ' · Boyut farklı' : ''}`; update();
    });
    image.addEventListener('error', () => {
      loaded[index] = false; image.hidden = true; fallback.hidden = false;
      fallback.textContent = index ? 'Türev görsel henüz yok' : 'Özgün görsel yüklenemedi';
      message.textContent = 'Doğal boyut: bilinmiyor'; update();
    });
    image.setAttribute('src', index ? '/assets/generated/akilay2-face-base.png' : '/assets/owner/akilay2-removebg-preview-1.png');
    images.push(image);
    add(grid, add(el('figure', '', 'stack-tight'), el('h3', `${label} görsel`, 'title'), add(el('div', '', 'comparison-frame'), image, fallback), message,
      el('p', 'Saydam arka plan: damalı zeminde elle kontrol edilmeli; henüz doğrulanmadı.', 'small muted'),
      el('strong', index ? 'İzin verilen fark: ağız ve göz dolguları' : 'Korunacak kaynak', 'small'),
      el('p', index ? 'Boyut ve şeffaf arka plan dahil diğer bütün görsel özellikler korunmalı.' : 'Özgün dosya değiştirilmez, üzerine yazılmaz ve yeniden adlandırılmaz.', 'small muted')));
  });
  add(root, add(card, grid, el('p', 'Damalı zemin, şeffaflık incelemesi için görüntüleme yüzeyidir.', 'small muted')));
  let overlay = false;
  const mode = createActionButton(document, { label: 'Üst üste karşılaştırma', variant: 'secondary', onClick: () => {
    overlay = !overlay; grid.setAttribute('class', overlay ? 'comparison-grid comparison-overlay' : 'comparison-grid');
    heading.textContent = overlay ? 'Üst üste karşılaştırma' : 'Yan yana karşılaştırma';
    mode.setAttribute('aria-pressed', String(overlay)); update();
  } }); mode.setAttribute('aria-pressed', 'false');
  const input = el('input'); input.value = '50';
  for (const [key, value] of Object.entries({ id: 'overlay-opacity', type: 'range', min: '0', max: '100', step: '1', value: '50' })) input.setAttribute(key, value);
  const label = el('label', 'Türevin görünürlüğü'); label.setAttribute('for', 'overlay-opacity');
  const output = el('output', '%50', 'value'); output.setAttribute('for', 'overlay-opacity');
  update = () => {
    input.disabled = !overlay || !loaded.every(Boolean);
    const value = Number(input.value);
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      images[1].setAttribute('style', `opacity:${overlay ? value / 100 : 1}`); output.textContent = `%${value}`;
    }
  }; input.addEventListener('input', update); update();
  add(root, add(el('section', '', 'card stack'), mode, el('p', 'İki görsel aynı konumda gösterilir. Türevin görünürlüğünü değiştirerek yüz hatlarını ve dış sınırları inceleyin.', 'muted'), add(el('div', '', 'field'), label, output, input), el('p', 'İki görsel yüklenip üst üste kipi seçilene kadar bu kontrol kullanılamaz.', 'small muted'), el('h3', 'Nereye bakmalı?', 'title'), el('p', 'Yüzün dış çizgisi, saç, kıyafet ve gövde sınırları örtüşmeli. Ağız ve göz dışındaki alanlarda fark görünmemeli.', 'muted')));
  const guide = add(el('article', '', 'card stack-tight'), el('p', 'İNCELEME REHBERİ', 'eyebrow'), el('h2', 'Korunması gerekenler', 'comparison-heading'));
  const list = el('ul', '', 'guide');
  for (const [title, detail] of [['Yalnızca ağız ve gözler', 'Dolgu, çevredeki cilt rengiyle uyumlu; iz ve lekesiz olmalı.'], ['Karakterin bütünlüğü', 'Yüz hatları, renkler, oranlar ve çizim tarzı aynı kalmalı.'], ['Boyut ve şeffaflık', 'Her iki dosya 463 × 539 piksel olmalı; şeffaf arka plan korunmalı.']]) {
    const check = el('input'); check.setAttribute('type', 'checkbox');
    add(list, add(el('li'), add(el('label', '', 'row'), check, add(el('span'), el('strong', title, 'title'), el('p', detail, 'small muted')))));
  }
  add(guide, list);
  add(root, add(el('section', '', 'comparison-guide'), guide, add(el('aside', '', 'card soft stack'), el('p', 'SONRAKİ ADIM', 'eyebrow'), el('h2', 'Önce inceleme, sonra kullanım.', 'comparison-heading'), el('p', 'Türev ancak sizin karşılaştırmalı incelemeniz ve açık onayınızdan sonra gövde katmanı olarak kullanılabilir.', 'muted'), el('strong', 'Henüz karar verilmedi'), el('p', 'Bu görünüm bir onay kaydı oluşturmaz ve herhangi bir dosyayı değiştirmez. Uygun bulunmayan türev yeniden hazırlanır.', 'small muted'), back())), el('footer', 'Lypsync · Karakter incelemesi — Özgün dosya korunur. Kullanım kararı size aittir.', 'small muted'));
  return root;
}
