import test from 'node:test';
import assert from 'node:assert/strict';
import { gridTriangles, lidMesh, mouthMeshes, MOUTH_PATCH } from '../../web/src/face/photo-mesh.js';

const mouth = { x: 236, y: 221, width: 50 };
const eye = { x: 203, y: 151, width: 30, height: 9 };
const points = flat => Array.from({ length: flat.length / 2 }, (_, i) => [flat[i * 2], flat[i * 2 + 1]]);
const close = (a, b) => Math.abs(a - b) < 1e-9;
const border = mesh => points(mesh.dst).map((point, i) => ({ point, src: points(mesh.src)[i], col: i % (mesh.cols + 1), row: Math.floor(i / (mesh.cols + 1)) }));

test('a closed mouth leaves the photo exactly as it is', () => {
  const mesh = mouthMeshes(mouth, { open: 0, width: 0.5, round: 0 });
  assert.equal(mesh.active, false);
  for (const half of [mesh.upper, mesh.lower]) assert.deepEqual(half.dst, half.src);
  assert.equal(mesh.interior.pos.length, 0);
});

test('an open mouth parts the lips at the centre only; the patch border never moves', () => {
  const mesh = mouthMeshes(mouth, { open: 1, width: 0.8, round: 0 });
  assert.equal(mesh.active, true);
  const cols = MOUTH_PATCH.cols;
  const upperLine = border(mesh.upper).filter(p => p.row === MOUTH_PATCH.upperRows);
  const lowerLine = border(mesh.lower).filter(p => p.row === 0);
  const centre = cols / 2;
  const gap = lowerLine[centre].point[1] - upperLine[centre].point[1];
  assert.ok(gap > 0.2 * mouth.width && gap < 0.3 * mouth.width, String(gap));
  // Beyond the corners the lips stay together.
  for (const col of [0, 1, 2, 3, cols - 3, cols - 2, cols - 1, cols]) {
    assert.ok(close(lowerLine[col].point[1], upperLine[col].point[1]), String(col));
    assert.ok(close(lowerLine[col].point[0], upperLine[col].point[0]), String(col));
  }
  for (const half of [mesh.upper, mesh.lower]) {
    for (const { point, src, col, row } of border(half)) {
      const outer = col === 0 || col === half.cols || (half === mesh.upper ? row === 0 : row === half.rows);
      if (outer) assert.ok(close(point[0], src[0]) && close(point[1], src[1]), `${col},${row}`);
    }
  }
  // The opening is drawn between the moved lip lines, with v 0 at the upper and 1 at the lower lip.
  assert.ok(mesh.interior.pos.length > 0);
  assert.deepEqual(new Set(points(mesh.interior.uv).map(([, v]) => v)), new Set([0, 1]));
  assert.ok(points(mesh.interior.uv).every(([u]) => Math.abs(u) <= 1.2));
});

test('rounded lips make a narrower opening than spread lips', () => {
  const span = state => {
    const pos = points(mouthMeshes(mouth, state).interior.pos);
    return Math.max(...pos.map(([x]) => x)) - Math.min(...pos.map(([x]) => x));
  };
  assert.ok(span({ open: 0.6, width: 0.4, round: 1 }) < span({ open: 0.6, width: 1, round: 0 }));
});

test('the lid slides down to the lower lash line; corners and top row stay put', () => {
  const open = lidMesh(eye, 0);
  assert.deepEqual(open.dst, open.src);
  const closed = lidMesh(eye, 1);
  const rows = border(closed);
  const centre = rows.find(p => p.row === closed.rows && p.col === closed.cols / 2);
  assert.ok(centre.point[1] > eye.y + eye.height * 0.4 && centre.point[1] <= eye.y + eye.height / 2, String(centre.point[1]));
  // It samples just above the lid edge, never the eye white below it.
  assert.ok(centre.src[1] < eye.y - eye.height / 2);
  for (const p of rows) {
    if (p.row === 0 || p.col === 0 || p.col === closed.cols) assert.ok(close(p.point[1], p.src[1]), `${p.col},${p.row}`);
  }
  // A half blink is between the two.
  const half = border(lidMesh(eye, 0.5)).find(p => p.row === closed.rows && p.col === closed.cols / 2);
  assert.ok(half.point[1] > centre.src[1] && half.point[1] < centre.point[1]);
  assert.deepEqual(lidMesh(eye, 5).dst, closed.dst);
});

test('grid triangles cover every cell twice with matching source points', () => {
  const mesh = lidMesh(eye, 0.3);
  const { src, dst } = gridTriangles(mesh);
  assert.equal(dst.length, mesh.cols * mesh.rows * 6 * 2);
  assert.equal(src.length, dst.length);
});
