export function mountApp({ document, window }) {
  const root = document.getElementById('app');
  function render() {
    const comparison = window.location.hash === '#karsilastirma';
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    const description = document.createElement('p');
    section.setAttribute('aria-labelledby', 'page-title');
    heading.setAttribute('id', 'page-title');
    heading.textContent = comparison ? 'Karakter görseli karşılaştırması' : 'Karakter testi';
    description.textContent = comparison
      ? 'Görsel karşılaştırma ekranı burada hazırlanacak (T12).'
      : 'Karakter testi ekranı burada hazırlanacak (T11).';
    section.appendChild(heading);
    section.appendChild(description);
    root.textContent = '';
    root.appendChild(section);
  }
  window.addEventListener('hashchange', render);
  render();
  return () => window.removeEventListener('hashchange', render);
}
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  mountApp({ document, window });
}
