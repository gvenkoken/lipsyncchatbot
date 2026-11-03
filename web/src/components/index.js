function element(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.setAttribute('class', className);
  if (text !== undefined) node.textContent = text;
  return node;
}
function append(parent, ...children) { for (const child of children) parent.appendChild(child); }
export function createActionButton(document, { label, variant = 'primary', disabled = false, onClick = () => {} } = {}) {
  if (!['primary', 'secondary', 'icon'].includes(variant)) throw new RangeError('Geçersiz düğme çeşidi');
  const button = element(document, 'button', `button button-${variant}`, label);
  button.setAttribute('type', 'button');
  if (variant === 'icon') button.setAttribute('aria-label', label);
  button.disabled = disabled;
  button.addEventListener('click', () => { if (!button.disabled) onClick(); });
  return button;
}
export function createPanelToggle(document, { expanded = false, panelId, onChange = () => {} } = {}) {
  const button = createActionButton(document, { label: 'Konuşma panelini aç', variant: 'icon', onClick: () => { setExpanded(!expanded); onChange(expanded); } });
  button.setAttribute('class', 'button button-icon launcher');
  if (panelId) button.setAttribute('aria-controls', panelId);
  function setExpanded(value) {
    expanded = Boolean(value);
    button.setAttribute('aria-expanded', expanded);
    button.setAttribute('aria-label', expanded ? 'Konuşma panelini kapat' : 'Konuşma panelini aç');
    button.textContent = expanded ? '×' : '◇';
  }
  setExpanded(expanded);
  return { element: button, setExpanded };
}
export function createCharacterPanel(document, { id = 'character-panel', title = 'Lypsync ile deneyin', onClose = () => {} } = {}) {
  const panel = element(document, 'section', 'panel widget-panel');
  panel.setAttribute('id', id); panel.setAttribute('aria-labelledby', `${id}-title`);
  const header = element(document, 'header', 'panel-header');
  const heading = element(document, 'h2', 'title', title); heading.setAttribute('id', `${id}-title`);
  const closeButton = createActionButton(document, { label: 'Kapat', variant: 'icon', onClick: () => { panel.hidden = true; onClose(); } });
  closeButton.textContent = '×';
  const content = element(document, 'div', 'panel-content');
  append(header, heading, closeButton); append(panel, header, content);
  return { element: panel, content, closeButton, setOpen(open) { panel.hidden = !open; } };
}
export function createCharacterStage(document, { src, alt = 'Lypsync karakteri' } = {}) {
  const stage = element(document, 'figure', 'character-stage');
  const frame = element(document, 'div', 'character-frame');
  if (src) {
    const image = element(document, 'img'); image.setAttribute('src', src); image.setAttribute('alt', alt); append(frame, image);
  } else {
    const empty = element(document, 'div', 'empty');
    const symbol = element(document, 'span', 'asset-symbol', '◇'); symbol.setAttribute('aria-hidden', 'true');
    append(empty, symbol, element(document, 'strong', '', 'Karakter görseli bekleniyor'), element(document, 'p', 'small muted', 'Özgün görsel eklendiğinde karakter burada görünecek.')); append(frame, empty);
  }
  append(stage, frame, element(document, 'figcaption', 'stage-caption', 'Özgün oran · 463 × 539'));
  return stage;
}
export function createTextEntry(document, { id = 'speech-text', value = '', label = 'Seslendirilecek metin', help = 'Yeniden Seslendir seçildiğinde mevcut konuşma kesilir ve yeni metin baştan okunur. Boş metinde işlem yapılmaz.', onChange = () => {} } = {}) {
  const root = element(document, 'div', 'field');
  const caption = element(document, 'label', '', label); caption.setAttribute('for', id);
  const input = element(document, 'textarea'); input.setAttribute('id', id); input.setAttribute('aria-describedby', `${id}-help`); input.value = value;
  const hint = element(document, 'p', 'small muted', help); hint.setAttribute('id', `${id}-help`);
  input.addEventListener('input', () => onChange(input.value)); append(root, caption, input, hint);
  return { element: root, input };
}
export function createRangeControl(document, { id, label, value = 1, suffix = '', lowLabel = '0,5', highLabel = '1,5', onChange = () => {} } = {}) {
  const valid = number => Number.isFinite(number) && number >= 0.5 && number <= 1.5;
  if (!id || !label || !valid(value)) throw new RangeError('Kaydırıcı kimliği, etiketi ve geçerli başlangıç değeri gerekli');
  const root = element(document, 'div', 'field');
  const row = element(document, 'div', 'range-heading');
  const caption = element(document, 'label', '', label); caption.setAttribute('for', id);
  const output = element(document, 'output', 'value'); output.setAttribute('for', id); output.setAttribute('id', `${id}-value`);
  const input = element(document, 'input');
  for (const [key, item] of Object.entries({ type: 'range', id, min: '0.5', max: '1.5', step: '0.1', value, 'aria-describedby': `${id}-value` })) input.setAttribute(key, item);
  input.value = String(value);
  const updateLabel = number => { output.textContent = number.toFixed(1).replace('.', ',') + suffix; };
  updateLabel(value);
  input.addEventListener('input', () => { const next = Number(input.value); if (valid(next)) { updateLabel(next); onChange(next); } });
  const ends = element(document, 'div', 'range-heading small muted'); append(ends, element(document, 'span', '', lowLabel), element(document, 'span', '', highLabel));
  append(row, caption, output); append(root, row, input, ends);
  return { element: root, input, output };
}
export function createNotice(document, { text, variant = 'warning', onClose = () => {} } = {}) {
  if (!['warning', 'error', 'info'].includes(variant)) throw new RangeError('Geçersiz bildirim çeşidi');
  const root = element(document, 'div', `notice ${variant}`); root.setAttribute('role', variant === 'info' ? 'status' : 'alert');
  const symbol = element(document, 'span', 'notice-icon', variant === 'info' ? 'i' : '!'); symbol.setAttribute('aria-hidden', 'true');
  const closeButton = createActionButton(document, { label: 'Kapat', variant: 'icon', onClick: () => { if (!root.hidden) { root.hidden = true; onClose(); } } });
  closeButton.setAttribute('class', 'dismiss'); closeButton.textContent = '×';
  append(root, symbol, element(document, 'p', '', text), closeButton);
  return { element: root, closeButton };
}
export const statusLabels = Object.freeze({ ready: 'Hazır', greeting: 'Selamlama bekleniyor', speaking: 'Konuşuyor', review: 'İnceleme bekleniyor' });
export function createStatus(document, initial = 'ready') {
  const root = element(document, 'span'); root.setAttribute('role', 'status'); root.setAttribute('aria-live', 'polite');
  function setStatus(state) {
    if (!Object.hasOwn(statusLabels, state)) throw new RangeError('Geçersiz durum');
    root.setAttribute('class', `status status-${state}`); root.textContent = statusLabels[state];
  }
  setStatus(initial); return { element: root, setStatus };
}
