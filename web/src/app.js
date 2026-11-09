import { applyTheme } from './theme/index.js';
import { createComparison } from './comparison/index.js';
import { comparisonStyles } from './comparison/styles.js';
import { loadConfig } from './config/config-loader.js';
import { BrowserSpeech } from './speech/browser-speech.js';
import { disposeVoiceSelector } from './voice/index.js';
import { WidgetConversation } from './widget/conversation.js';
import { FaceRenderer } from './face/index.js';
import { FaceAnimator } from './animation/index.js';
import { LivelinessScheduler } from './liveliness/index.js';
import { createWidget } from './widget/index.js';
import { styles, screenStyles } from './widget/styles.js';

export function mountApp({ document, window, fetch = globalThis.fetch, speech: suppliedSpeech, clock = window, config: suppliedConfig }) {
  const root = document.getElementById('app');
  if (document.documentElement) applyTheme(document);
  const style = document.createElement('style'); style.textContent = styles + screenStyles + comparisonStyles;
  (document.head ?? root).appendChild(style);
  const speech = suppliedSpeech ?? new BrowserSpeech({ synthesis: window.speechSynthesis, Utterance: window.SpeechSynthesisUtterance });
  let disposed = false;
  let widget;
  let detach;
  let renderer;
  let config;
  const ready = (document.createElementNS ? (suppliedConfig ? Promise.resolve(suppliedConfig) : loadConfig(fetch)) : Promise.resolve()).then(value => { config = value; if (!disposed) render(); });
  function render() {
    widget?.dispose(); detach?.(); renderer?.dispose(); widget = undefined; renderer = undefined;
    root.textContent = '';
    const comparison = window.location.hash === '#karsilastirma';
    document.querySelectorAll?.('nav a').forEach(link => {
      if (link.getAttribute('href') === (comparison ? '#karsilastirma' : '#karakter-testi')) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (comparison) {
      root.appendChild(createComparison(document)); return;
    }
    const comparisonLink = document.createElement('a'); comparisonLink.textContent = 'Görsel karşılaştırması'; comparisonLink.setAttribute('href', '#karsilastirma');
    if (!config) { const section = document.createElement('section'); const heading = document.createElement('h2'); const loading = document.createElement('p'); heading.textContent = 'Karakter testi'; loading.textContent = document.createElementNS ? 'Karakter testi (T11) yükleniyor…' : 'Karakter testi (T11) için SVG destekleyen bir tarayıcı gerekiyor.'; section.appendChild(heading); section.appendChild(loading); section.appendChild(comparisonLink); root.appendChild(section); return; }
    const animator = new FaceAnimator({ clock });
    const liveliness = new LivelinessScheduler({ animator, clock: clock.now ? clock : { now: () => window.performance.now() } });
    renderer = new FaceRenderer(config, { document });
    const conversation = new WidgetConversation({ speech, animator, liveliness, loadConfig: () => suppliedConfig ? Promise.resolve(suppliedConfig) : loadConfig(fetch), ...(clock.now ? { clock } : {}) });
    const close = conversation.close.bind(conversation);
    conversation.close = () => { close(); for (const channel of Object.values(animator.state.mouth)) channel.current = channel.target; renderer.render(animator.state); };
    detach = animator.subscribe(state => renderer.render(state));
    widget = createWidget({ document, speech, config, renderer, conversation });
    root.appendChild(widget.element);
    widget.element.children[0].appendChild(comparisonLink);
  }
  window.addEventListener('hashchange', render);
  render();
  const unmount = () => { disposed = true; window.removeEventListener('hashchange', render); widget?.dispose(); detach?.(); renderer?.dispose(); disposeVoiceSelector(speech); if (!suppliedSpeech) speech.dispose(); style.remove?.(); };
  unmount.ready = ready;
  Object.defineProperty(unmount, 'widget', { get: () => widget });
  return unmount;
}
if (typeof document !== 'undefined' && typeof window !== 'undefined') mountApp({ document, window });
