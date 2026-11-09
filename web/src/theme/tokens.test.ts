import { describe, expect, it } from 'vitest';
import { colors, typography, spacing, radii, shadows } from './tokens';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.resolve(process.cwd(), 'src/theme/tokens.css'), 'utf8');

describe('Sakin odak tasarım değerleri', () => {
  it('onaylı renk paletini korur', () => {
    expect(colors).toEqual({ primary: '#6544C4', 'primary-soft': '#F0EBFC', background: '#F6F5F2', surface: '#FFFFFF', text: '#25232D', muted: '#6C6877', border: '#DEDCE4', stage: '#ECEAE5', success: '#267047', warning: '#875B13', 'warning-soft': '#FFF5DE', error: '#B13D45', 'error-soft': '#FFF0F1', info: '#315F91', 'info-soft': '#EDF4FC' });
  });
  it('tipografi, boşluk, yarıçap ve gölgeleri korur', () => {
    expect(Object.values(typography).map(({ size, line, weight }) => [size, line, weight])).toEqual([[32, 40, 600], [20, 28, 600], [15, 24, 400], [14, 20, 600], [12, 18, 500], [12, 20, 400]]);
    for (const key of ['display', 'heading', 'body', 'label', 'caption'] as const) expect(typography[key].family).toBe("system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
    expect(typography.mono.family).toBe('ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
    expect(spacing).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, section: 48 });
    expect(radii).toEqual({ sm: 8, md: 12, lg: 20, pill: 999 });
    expect(shadows).toEqual({ card: '0 2px 8px rgba(37, 35, 45, 0.04)', panel: '0 16px 48px rgba(37, 35, 45, 0.14)', focus: '0 0 0 3px rgba(101, 68, 196, 0.22)' });
  });
  it('CSS ve TypeScript aynı değerleri dışa aktarır', () => {
    const declarations = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
    for (const [prefix, values, suffix] of [['color', colors, ''], ['space', spacing, 'px'], ['radius', radii, 'px'], ['shadow', shadows, '']] as const) {
      for (const [key, value] of Object.entries(values)) expect(declarations[`${prefix}-${key}`]).toBe(`${value}${suffix}`);
    }
    for (const [key, value] of Object.entries(typography)) {
      for (const prop of ['size', 'line', 'weight'] as const) expect(declarations[`text-${key}-${prop}`]).toBe(`${value[prop]}${prop === 'weight' ? '' : 'px'}`);
      const family = declarations[`font-${key}`];
      expect(family === 'var(--font-display)' ? declarations['font-display'] : family).toBe(value.family);
    }
  });
});
