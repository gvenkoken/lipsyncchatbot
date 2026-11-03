export const colors = Object.freeze({ primary: '#6544C4', secondary: '#4E329D', accent: '#F0EBFA', background: '#F7F6F3', surface: '#FFFFFF', text: '#252330', muted: '#696571', border: '#DEDCE4', success: '#26704F', warning: '#805015', neutral: '#FFF5E4', error: '#AF3542', info: '#335E91' });
export const fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const typography = Object.freeze(Object.fromEntries([
  ['display', 40, 48, 600], ['heading', 24, 32, 600], ['title', 18, 26, 600],
  ['body', 15, 24, 400], ['label', 14, 20, 600], ['small', 12, 18, 400],
].map(([name, size, line, weight]) => [name, Object.freeze({ family: fontFamily, size, line, weight })])));
export const spacing = Object.freeze({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, section: 48, hero: 64 });
export const radii = Object.freeze({ sm: 8, md: 12, lg: 20, pill: 999 });
export const shadows = Object.freeze({ card: '0 2px 8px rgba(37, 35, 48, 0.04)', panel: '0 20px 64px rgba(37, 35, 48, 0.16), 0 4px 12px rgba(37, 35, 48, 0.06)', focus: '0 0 0 4px rgba(101, 68, 196, 0.18)' });
export const theme = Object.freeze({ colors, typography, spacing, radii, shadows });
export function applyTheme(document) {
  const set = (name, value) => document.documentElement.style.setProperty(`--lypsync-${name}`, String(value));
  for (const [name, value] of Object.entries(colors)) set(`color-${name}`, value);
  for (const [name, values] of Object.entries(typography)) {
    for (const [key, value] of Object.entries(values)) set(`text-${name}-${key}`, key === 'size' || key === 'line' ? `${value}px` : value);
  }
  for (const [name, value] of Object.entries(spacing)) set(`space-${name}`, `${value}px`);
  for (const [name, value] of Object.entries(radii)) set(`radius-${name}`, `${value}px`);
  for (const [name, value] of Object.entries(shadows)) set(`shadow-${name}`, value);
}
