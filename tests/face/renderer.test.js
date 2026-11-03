import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceRenderer } from '../../web/src/face/index.js';
import { FaceState } from '../../web/src/animation/index.js';
import { createFakeDOM } from '../helpers/dom.js';

function renderer(config = {}) {
  const { document } = createFakeDOM();
  // The shared fake supplies elements; this adapter records SVG namespace use.
  document.createElementNS = (namespace, tag) => {
    assert.equal(namespace, 'http://www.w3.org/2000/svg');
    return document.createElement(tag);
  };
  return new FaceRenderer(config, { document });
}

test('original coordinates, asset, accessible label and paint order', () => {
  const face = renderer();
  assert.equal(face.svg.getAttribute('viewBox'), '0 0 463 539');
  assert.equal(face.svg.getAttribute('aria-label'), 'Akilay karakteri');
  assert.deepEqual(face.group.children.map(node => node.tagName), ['IMAGE', 'ELLIPSE', 'ELLIPSE', 'ELLIPSE', 'ELLIPSE', 'PATH', 'PATH', 'PATH']);
  assert.equal(face.group.children[0].getAttribute('href'), 'assets/owner/akilay2-removebg-preview-1.png');
  assert.equal(face.group.children[0].getAttribute('width'), '463');
  assert.equal(face.group.children[0].getAttribute('height'), '539');
  assert.deepEqual(face.group.children.slice(1, 7), [...face.eyes.map(e => e.white), ...face.eyes.map(e => e.pupil), ...face.eyes.map(e => e.lid)]);
});

test('config alone controls geometry and colors', () => {
  const config = { body: { width: 600, height: 700 }, mouth: { x: 300, y: 250, width: 80, lipColor: '#123456' }, eyes: [{ x: 210, y: 160, width: 40, height: 20, irisColor: '#ABCDEF' }] };
  const first = renderer(config);
  const second = renderer({ ...config, mouth: { ...config.mouth, x: 320 }, eyes: [{ ...config.eyes[0], x: 230 }] });
  assert.equal(first.svg.getAttribute('viewBox'), '0 0 600 700');
  assert.equal(first.eyes[0].white.getAttribute('cx'), '210');
  assert.equal(second.eyes[0].white.getAttribute('cx'), '230');
  assert.equal(first.eyes[0].white.getAttribute('cy'), '160');
  assert.equal(first.eyes[0].white.getAttribute('rx'), '20');
  assert.equal(first.eyes[0].white.getAttribute('ry'), '10');
  assert.equal(first.eyes[0].pupil.getAttribute('fill'), '#ABCDEF');
  assert.equal(first.mouthPath.getAttribute('fill'), '#123456');
  assert.match(first.mouthPath.getAttribute('d'), /^M 260 250/);
  assert.match(second.mouthPath.getAttribute('d'), /^M 280 250/);
});

test('mouth interpolates continuously and uses current width and round', () => {
  const face = renderer();
  const state = new FaceState();
  const paths = [0, 0.5, 1].map(open => {
    state.mouth.open.current = open;
    face.render(state);
    return face.mouthPath.getAttribute('d');
  });
  assert.equal(new Set(paths).size, 3);
  assert.equal(paths[0], 'M 205 223 Q 232 223 259 223 Q 232 223 205 223 Z');
  for (const path of paths) assert.doesNotMatch(path, /NaN|Infinity/);
  const numbers = paths.map(path => path.match(/-?\d+(?:\.\d+)?/g).map(Number));
  numbers[1].forEach((value, index) => assert.ok(Math.abs(value - (numbers[0][index] + numbers[2][index]) / 2) < 1e-9));
  state.mouth.width.current = 1;
  state.mouth.round.current = 1;
  face.render(state);
  assert.notEqual(face.mouthPath.getAttribute('d'), paths[2]);
});

test('eyelid, pupil, head tilt and breath update without rebuilding SVG', () => {
  const face = renderer();
  const children = [...face.group.children];
  const state = new FaceState();
  state.eyelid.current = 1;
  state.pupil.x.current = 1;
  state.pupil.y.current = -1;
  state.headTilt.current = 3;
  state.breath.current = 1;
  face.render(state);
  assert.equal(face.eyes[0].pupil.getAttribute('cx'), '205');
  assert.equal(face.eyes[0].pupil.getAttribute('cy'), '147.6');
  assert.equal(face.eyes[0].pupil.getAttribute('ry'), '0');
  assert.equal(face.eyes[0].lid.getAttribute('d'), 'M 180.5 142 H 215.5 V 158 H 180.5 Z');
  assert.equal(face.group.getAttribute('transform'), 'translate(0 2) rotate(3 231.5 269.5)');
  assert.deepEqual(face.group.children, children);
});

test('invalid geometry, colors, sources and state never reach SVG attributes', () => {
  const face = renderer({ body: { width: Infinity, height: '539', src: 'javascript:alert(1)' }, mouth: { x: '<script>', width: -1, lipColor: 'red;"onload' }, eyes: [{ x: NaN, height: 0, irisColor: 'red;"onload' }] });
  assert.equal(face.svg.getAttribute('viewBox'), '0 0 463 539');
  assert.equal(face.mouthPath.getAttribute('fill'), '#985D50');
  assert.equal(face.eyes[0].pupil.getAttribute('fill'), '#45382F');
  assert.equal(face.eyes[0].white.getAttribute('cx'), '198');
  face.render({ mouth: { open: { current: NaN }, width: { current: Infinity }, round: { current: 'script' } }, headTilt: { current: Infinity } });
  for (const node of [face.svg, face.group, ...face.group.children]) {
    for (const value of node.attributes.values()) assert.doesNotMatch(value, /NaN|Infinity|script|onload/);
  }
});
