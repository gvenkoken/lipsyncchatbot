export class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(event) {
    const value = typeof event === 'string' ? { type: event } : event;
    for (const listener of this.listeners.get(value.type) || []) listener.call(this, value);
  }
}
export class FakeElement extends FakeEventTarget {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.text = '';
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { this.children.push(child); return child; }
}
export function createFakeDOM(hash = '') {
  const root = new FakeElement('main');
  root.setAttribute('id', 'app');
  const document = {
    createElement: tag => new FakeElement(tag),
    getElementById: id => id === 'app' ? root : null,
  };
  const window = new FakeEventTarget();
  window.location = { hash };
  return { document, window, root };
}
