import test from 'node:test';
import assert from 'node:assert/strict';
import { colors, typography, spacing, radii, shadows, applyTheme } from '../../web/src/theme/index.js';
import { createFakeDOM } from '../helpers/dom.js';

test('tema tasarımdaki palet ve ölçüleri birebir dışa aktarır', () => {
  assert.deepEqual(Object.values(colors), ['#6544C4', '#4E329D', '#F0EBFA', '#F7F6F3', '#FFFFFF', '#252330', '#696571', '#DEDCE4', '#26704F', '#805015', '#FFF5E4', '#AF3542', '#335E91']);
  assert.deepEqual(Object.values(typography).map(({ size, line, weight }) => [size, line, weight]), [[40,48,600],[24,32,600],[18,26,600],[15,24,400],[14,20,600],[12,18,400]]);
  for (const level of Object.values(typography)) assert.equal(level.family, "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
  assert.deepEqual(Object.values(spacing), [4,8,12,16,24,32,48,64]);
  assert.deepEqual(Object.values(radii), [8,12,20,999]);
  assert.deepEqual(shadows, { card: '0 2px 8px rgba(37, 35, 48, 0.04)', panel: '0 20px 64px rgba(37, 35, 48, 0.16), 0 4px 12px rgba(37, 35, 48, 0.06)', focus: '0 0 0 4px rgba(101, 68, 196, 0.18)' });
});
test('applyTheme tüm belirteçleri kök CSS değişkenlerine uygular', () => {
  const { document } = createFakeDOM();
  const properties = new Map();
  document.documentElement = { style: { setProperty: (key, value) => properties.set(key, value) } };
  applyTheme(document);
  for (const [name, value] of Object.entries(colors)) assert.equal(properties.get(`--lypsync-color-${name}`), value);
  for (const [name, values] of Object.entries(typography)) for (const [key, value] of Object.entries(values)) assert.equal(properties.get(`--lypsync-text-${name}-${key}`), key === 'size' || key === 'line' ? `${value}px` : String(value));
  for (const [group, values] of [['space', spacing], ['radius', radii], ['shadow', shadows]]) for (const [name, value] of Object.entries(values)) assert.equal(properties.get(`--lypsync-${group}-${name}`), group === 'shadow' ? value : `${value}px`);
  assert.equal(properties.size, 52);
});
