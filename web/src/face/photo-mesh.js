// Geometry for animating the photo itself: the face is not painted over, its
// pixels are moved. All coordinates are in the body image's pixel space.
// A grid has (cols + 1) × (rows + 1) points stored as flat [x, y, ...] arrays:
// src is where a point samples the photo, dst is where it is drawn.

const smooth = (edge0, edge1, value) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

/** Mouth patch around the lips, in mouth widths from the lip line's centre. */
export const MOUTH_PATCH = Object.freeze({ side: 1.5, top: 0.42, bottom: 1.3, cols: 30, upperRows: 6, lowerRows: 18 });
/** Jaw drop and upper lip lift at full openness, in mouth widths. */
export const MOUTH_MOTION = Object.freeze({ jaw: 0.2, lip: 0.05, wide: 0.24, round: 0.16 });

function grid(cols, rows, point) {
  const src = [];
  const dst = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const [sx, sy, dx, dy] = point(col / cols, row / rows);
      src.push(sx, sy);
      dst.push(dx, dy);
    }
  }
  return { cols, rows, src, dst };
}

/**
 * Upper and lower halves of the mouth patch, split along the lip line, and
 * the opening between them. The patch border never moves, so the halves join
 * the untouched photo seamlessly; beyond the mouth corners the two lip lines
 * stay together. open, width and round are the smoothed FaceState values.
 */
export function mouthMeshes(mouth, { open = 0, width = 0.5, round = 0 } = {}) {
  const { x: cx, y: lipY } = mouth;
  const mw = mouth.width;
  const half = mw / 2;
  const left = cx - MOUTH_PATCH.side * mw;
  const right = cx + MOUTH_PATCH.side * mw;
  const top = lipY - MOUTH_PATCH.top * mw;
  const bottom = lipY + MOUTH_PATCH.bottom * mw;
  const corner = ((width - 0.5) * MOUTH_MOTION.wide - round * MOUTH_MOTION.round) * mw;
  // The inner opening is narrower than the lips and tapers into the corners.
  const gapHalf = 0.88 * Math.max(0.3 * half, half + corner);
  const jaw = Math.max(0, open) * MOUTH_MOTION.jaw * mw * (1 - 0.25 * round);
  const lift = Math.max(0, open) * MOUTH_MOTION.lip * mw;

  const lens = x => { const s = Math.abs(x - cx) / gapHalf; return s >= 1 ? 0 : 1 - s * s; };
  const broad = x => { const s = Math.abs(x - cx) / (1.4 * half); return s >= 1 ? 0 : 1 - s * s; };
  const jawWidth = x => 1 - smooth(0.55 * mw, 1.4 * mw, Math.abs(x - cx));
  const sideways = (x, y) => {
    const s = Math.abs(x - cx) / half;
    const bump = s <= 1 ? s : Math.max(0, 1 - (s - 1) / 0.7);
    return Math.sign(x - cx) * corner * bump * (1 - smooth(0, MOUTH_PATCH.top * mw, Math.abs(y - lipY)));
  };
  const upper = grid(MOUTH_PATCH.cols, MOUTH_PATCH.upperRows, (u, v) => {
    const x = lerp(left, right, u);
    const y = lerp(top, lipY, v);
    const profile = lerp(lens(x), broad(x), smooth(lipY, lipY - 0.25 * mw, y));
    return [x, y, x + sideways(x, y), y - lift * profile * smooth(top, lipY, y)];
  });
  const lower = grid(MOUTH_PATCH.cols, MOUTH_PATCH.lowerRows, (u, v) => {
    const x = lerp(left, right, u);
    const y = lerp(lipY, bottom, v);
    const profile = lerp(lens(x), jawWidth(x), smooth(lipY, lipY + 0.45 * mw, y));
    return [x, y, x + sideways(x, y), y + jaw * profile * (1 - smooth(lipY + 0.85 * mw, bottom, y))];
  });

  // The opening: triangles between the moved upper and lower lip lines.
  // uv: u runs -1…1 across the opening, v 0 at the upper lip and 1 at the lower lip.
  const interior = { pos: [], uv: [] };
  const upperLine = MOUTH_PATCH.upperRows * (MOUTH_PATCH.cols + 1);
  const at = (mesh, base, col) => [mesh.dst[(base + col) * 2], mesh.dst[(base + col) * 2 + 1]];
  for (let col = 0; col < MOUTH_PATCH.cols; col++) {
    const [a, b] = [col, col + 1].map(c => ({ top: at(upper, upperLine, c), bottom: at(lower, 0, c), u: (upper.src[(upperLine + c) * 2] - cx) / gapHalf }));
    if (a.bottom[1] - a.top[1] < 0.01 && b.bottom[1] - b.top[1] < 0.01) continue;
    for (const [point, v, side] of [[a.top, 0, a], [a.bottom, 1, a], [b.top, 0, b], [b.top, 0, b], [a.bottom, 1, a], [b.bottom, 1, b]]) {
      interior.pos.push(...point);
      interior.uv.push(side.u, v);
    }
  }
  return { upper, lower, interior, active: jaw + lift > 0.01 || Math.abs(corner) > 0.01 };
}

/** Lid skin above the eye, in eye heights. */
export const LID_PATCH = Object.freeze({ side: 1.2, above: 1.1, cols: 16, rows: 8, closed: 0.95 });

/**
 * The upper lid as a grid that stretches the skin between the crease and the
 * lash line down over the eye. blink 0 leaves the photo as it is; at 1 the
 * lash line reaches the lower lid. The eye corners and the top row never move,
 * and the last two pixels (the lashes) keep their size instead of stretching.
 */
export function lidMesh(eye, blink = 0) {
  const { x: ex, y: ey, width, height } = eye;
  const half = width / 2;
  const amount = Math.max(0, Math.min(1, blink));
  const top = ey - height / 2 - LID_PATCH.above * height;
  const lash = Math.min(2, 0.2 * height);
  // The lid's lowest row samples one pixel above the measured lid edge, so no eye white is carried down.
  const inset = Math.min(1, 0.12 * height);
  const arc = x => { const s = Math.abs(x - ex) / half; return s >= 1 ? 0 : (1 - s * s) ** 0.7; };
  const rows = LID_PATCH.rows;
  return grid(LID_PATCH.cols, rows, (u, v) => {
    const x = lerp(ex - LID_PATCH.side * half, ex + LID_PATCH.side * half, u);
    const open = ey - (height / 2) * arc(x);
    const source = open - inset * arc(x);
    const edge = lerp(source, ey + (height / 2) * LID_PATCH.closed * arc(x), amount);
    if (v === 1) return [x, source, x, edge];
    const t = v * rows / (rows - 1);
    return [x, lerp(top, source - lash * arc(x), t), x, lerp(top, edge - lash * arc(x), t)];
  });
}

/** Two triangles per grid cell, as flat [x, y] lists for src and dst. */
export function gridTriangles(mesh) {
  const src = [];
  const dst = [];
  const width = mesh.cols + 1;
  for (let row = 0; row < mesh.rows; row++) {
    for (let col = 0; col < mesh.cols; col++) {
      const a = row * width + col;
      for (const index of [a, a + width, a + 1, a + 1, a + width, a + width + 1]) {
        src.push(mesh.src[index * 2], mesh.src[index * 2 + 1]);
        dst.push(mesh.dst[index * 2], mesh.dst[index * 2 + 1]);
      }
    }
  }
  return { src, dst };
}
