import { readFileSync } from 'node:fs';
import path from 'node:path';
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

const photoConfig = JSON.parse(readFileSync(path.resolve(process.cwd(), 'web/config/lypsync.config.json'), 'utf8'));

test('photo mode never creates whites or pupils and ignores gaze offsets', () => {
  const face = renderer(photoConfig);
  assert.equal(face.photo, true);
  assert.ok(face.eyes.every(eye => !eye.white && !eye.pupil));
  assert.equal(face.group.children.filter(node => node.tagName === 'ELLIPSE').length, 0);
  const nodes = [face.group, ...face.group.children, ...face.eyes.flatMap(eye => [eye.lid, eye.lash])];
  const before = nodes.map(node => [...node.attributes]);
  face.render({ pupil: { x: { current: 1 }, y: { current: -1 } } });
  assert.deepEqual(nodes.map(node => [...node.attributes]), before);
});

test('photo lids follow calibrated eye boxes, soften edges and cover fully on closure', () => {
  const face = renderer(photoConfig);
  const state = new FaceState();
  const defs = face.group.children.find(node => node.tagName === 'DEFS');
  const filter = defs.children[0];
  assert.equal(filter.children[0].tagName, 'FEGAUSSIANBLUR');
  assert.equal(filter.children[0].getAttribute('stdDeviation'), '0.6');
  for (const amount of [0, 0.5, 1]) {
    state.eyelid.current = amount;
    face.render(state);
    face.eyes.forEach((eye, i) => {
      const config = photoConfig.eyes[i];
      const left = config.x - config.width / 2;
      const right = config.x + config.width / 2;
      const top = config.y - config.height / 2;
      const closed = config.y + config.height * 0.35;
      const edge = top + (closed - top) * amount;
      // Almond lid: both edges meet at the eye corners; the lash edge moves from the upper arc to the lower lash line.
      assert.equal(eye.lid.getAttribute('d'), `M ${left} ${config.y} Q ${config.x} ${2 * top - config.y} ${right} ${config.y} Q ${config.x} ${2 * edge - config.y} ${left} ${config.y} Z`);
      assert.equal(eye.lash.getAttribute('d'), `M ${left} ${config.y} Q ${config.x} ${2 * edge - config.y} ${right} ${config.y}`);
      assert.doesNotMatch(eye.lid.getAttribute('d'), /[HV]/);
      assert.equal(eye.lid.getAttribute('fill'), config.lidColor);
      assert.equal(eye.lid.getAttribute('display'), amount === 0 ? 'none' : 'inline');
      assert.equal(eye.lash.getAttribute('display'), amount === 0 ? 'none' : 'inline');
      assert.equal(eye.lash.getAttribute('stroke'), '#3A2A22');
      assert.equal(eye.lash.getAttribute('stroke-width'), '1.5');
      assert.equal(eye.lid.getAttribute('filter'), `url(#${filter.getAttribute('id')})`);
      assert.equal(eye.lash.getAttribute('filter'), eye.lid.getAttribute('filter'));
    });
  }
});

test('photo mouth stays hidden below threshold and uses the specified ellipse dimensions', () => {
  const face = renderer(photoConfig);
  const state = new FaceState();
  for (const width of [0, 0.5, 1]) for (const round of [0, 0.7, 1]) {
    state.mouth.width.current = width;
    state.mouth.round.current = round;
    let previousHeight = 0;
    for (const open of [0, 0.049, 0.05, 0.3, 0.8]) {
      state.mouth.open.current = open;
      face.render(state);
      assert.equal(face.mouthPath.getAttribute('display'), open < 0.05 ? 'none' : 'inline');
      const values = face.mouthPath.getAttribute('d').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
      const expectedWidth = photoConfig.mouth.width * (0.5 + 0.3 * width) * (1 - 0.3 * round);
      const expectedHeight = photoConfig.mouth.width * open * 0.4;
      assert.ok(Math.abs(values[2] * 2 - expectedWidth) < 1e-9);
      assert.ok(Math.abs(values[3] * 2 - expectedHeight) < 1e-9);
      assert.ok(expectedHeight >= previousHeight);
      previousHeight = expectedHeight;
    }
  }
  assert.equal(face.mouthPath.getAttribute('fill'), '#2A1414');
  assert.equal(face.mouthPath.getAttribute('opacity'), '0.85');
  assert.equal(face.mouthPath.getAttribute('stroke'), photoConfig.mouth.lipColor);
  assert.equal(face.mouthPath.getAttribute('stroke-width'), '1.5');
  assert.equal(face.mouthPath.getAttribute('filter'), face.eyes[0].lid.getAttribute('filter'));
});

test('explicit drawn style and omitted style produce identical traditional layers', () => {
  const serialize = node => [node.tagName, [...node.attributes], node.children.map(serialize)];
  assert.deepEqual(serialize(renderer({ face: { style: 'drawn' } }).svg), serialize(renderer().svg));
});

test('configuration updates preserve nodes in photo mode and can switch styles', () => {
  const face = renderer(photoConfig);
  const mouth = face.mouthPath;
  const lid = face.eyes[0].lid;
  const config = structuredClone(photoConfig);
  config.eyes[0].x += 10;
  config.eyes[0].lidColor = '#ABCDEF';
  config.mouth.lipColor = '#123456';
  face.updateConfig(config);
  assert.equal(face.mouthPath, mouth);
  assert.equal(face.eyes[0].lid, lid);
  assert.equal(lid.getAttribute('fill'), '#ABCDEF');
  assert.equal(face.eyes[0].x, config.eyes[0].x);
  assert.equal(mouth.getAttribute('stroke'), '#123456');
  assert.equal(mouth.getAttribute('display'), 'none');
  face.updateConfig({ ...config, face: { style: 'drawn' } });
  assert.ok(face.eyes.every(eye => eye.white && eye.pupil));
  face.updateConfig(config);
  assert.ok(face.eyes.every(eye => !eye.white && !eye.pupil));
});

test('photo mode tries WebGL once and keeps the SVG layers when it is unavailable', async () => {
  const { FaceRenderer: Renderer } = await import('../../web/src/face/index.js');
  const { createFakeDOM, FakeElement } = await import('../helpers/dom.js');
  const { document } = createFakeDOM();
  document.createElementNS = (_, tag) => new FakeElement(tag);
  let contexts = 0;
  const create = document.createElement;
  document.createElement = tag => {
    const node = create(tag);
    if (tag === 'canvas') node.getContext = () => { contexts++; return null; };
    return node;
  };
  const config = { face: { style: 'photo' }, mouth: { x: 236, y: 221, width: 50 }, eyes: [{ x: 203, y: 151, width: 30, height: 9 }, { x: 270, y: 148, width: 32, height: 9 }] };
  const renderer = new Renderer(config, { document });
  assert.equal(contexts, 1);
  assert.equal(renderer.canvas, undefined);
  renderer.updateConfig(config);
  assert.equal(contexts, 1);
  renderer.render({ mouth: { open: { current: 0.6 } } });
  assert.equal(renderer.mouthPath.getAttribute('display'), 'inline');
  assert.equal(renderer.svg.getAttribute('visibility'), null);
});
