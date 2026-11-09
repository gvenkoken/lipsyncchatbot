import { PhotoFace } from './photo-gl.js';

let filterSequence = 0;
const NS = 'http://www.w3.org/2000/svg';
const asset = 'assets/owner/akilay2-removebg-preview-1.png';
const number = (value, fallback, min = -100000) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= 100000 ? value : fallback;
const color = (value, fallback) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
const current = (channel, fallback = 0, min = -1, max = 1) =>
  Math.max(min, Math.min(max, number(channel?.current, fallback)));

/** Append svg (and canvas, when present) to the stage; render consumes the smoothed FaceState channels.
 * In photo mode a WebGL canvas animates the photo itself; the SVG layers are the fallback. */
export class FaceRenderer {
  constructor(config = {}, { document = globalThis.document, webgl = true } = {}) {
    this.document = document;
    const element = (tag, attributes = {}) => {
      const node = document.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      return node;
    };
    this.photo = config.face?.style === 'photo';
    const filterId = `face-soft-edge-${++filterSequence}`;
    const softEdge = `url(#${filterId})`;
    const body = config.body ?? {};
    const width = number(body.width, 463, 1);
    const height = number(body.height, 539, 1);
    this.center = { x: width / 2, y: height / 2 };
    this.svg = element('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Akilay karakteri' });
    this.group = element('g');
    this.svg.appendChild(this.group);
    const src = typeof body.src === 'string' && /^\/?assets\/(?:[\w-]+\/)*[\w.-]+\.(?:png|jpe?g|webp)$/i.test(body.src) ? body.src : asset;
    this.group.appendChild(element('image', { href: src, x: 0, y: 0, width, height }));
    this.eyes = [{ x: 198, y: 150 }, { x: 270, y: 150 }].map((fallback, index) => {
      const eye = config.eyes?.[index] ?? {};
      const geometry = {
        x: number(eye.x, fallback.x, 0), y: number(eye.y, fallback.y, 0),
        width: number(eye.width, 35, 1), height: number(eye.height, 16, 1)
      };
      if (this.photo) return { ...geometry,
        lid: element('path', { fill: color(eye.lidColor, '#C8937A'), filter: softEdge }),
        lash: element('path', { fill: 'none', stroke: '#3A2A22', 'stroke-width': 1.5, filter: softEdge })
      };
      return { ...geometry,
        white: element('ellipse', { cx: geometry.x, cy: geometry.y, rx: geometry.width / 2, ry: geometry.height / 2, fill: '#FFFFFF' }),
        pupil: element('ellipse', { fill: color(eye.irisColor, '#45382F') }),
        lid: element('path', { fill: '#C58F76' })
      };
    });
    for (const layer of (this.photo ? ['lid', 'lash'] : ['white', 'pupil', 'lid'])) {
      for (const eye of this.eyes) this.group.appendChild(eye[layer]);
    }
    if (this.photo) {
      const defs = element('defs');
      const filter = element('filter', { id: filterId, x: '-20%', y: '-20%', width: '140%', height: '140%' });
      filter.appendChild(element('feGaussianBlur', { stdDeviation: 0.6 }));
      defs.appendChild(filter);
      this.group.appendChild(defs);
    }
    const mouth = config.mouth ?? {};
    this.mouth = { x: number(mouth.x, 232, 0), y: number(mouth.y, 223, 0), width: number(mouth.width, 54, 1) };
    this.mouthPath = element('path', { fill: color(mouth.lipColor, '#985D50'), stroke: color(mouth.lipColor, '#985D50'), 'stroke-width': 2, 'stroke-linecap': 'round' });
    if (this.photo) {
      this.mouthPath.setAttribute('fill', '#2A1414');
      this.mouthPath.setAttribute('opacity', 0.85);
      this.mouthPath.setAttribute('stroke-width', 1.5);
      this.mouthPath.setAttribute('filter', softEdge);
    }
    this.group.appendChild(this.mouthPath);
    if (this.photo && webgl) {
      this.photoFace = PhotoFace.create(document, this.geometry(config));
      this.canvas = this.photoFace?.canvas;
      if (this.photoFace) this.photoFace.onReady = () => this.render(this.lastState);
    }
    this.render();
  }

  dispose() {
    this.photoFace?.dispose();
    this.photoFace = null;
    this.canvas?.remove?.();
  }

  /** The validated geometry the canvas needs, in the same coordinates as the SVG. */
  geometry(config) {
    const body = config.body ?? {};
    const width = number(body.width, 463, 1);
    const height = number(body.height, 539, 1);
    const src = typeof body.src === 'string' && /^\/?assets\/(?:[\w-]+\/)*[\w.-]+\.(?:png|jpe?g|webp)$/i.test(body.src) ? body.src : asset;
    return {
      body: { src, width, height },
      mouth: { ...this.mouth },
      eyes: this.eyes.map(({ x, y, width: w, height: h }) => ({ x, y, width: w, height: h }))
    };
  }

  updateConfig(config) {
    // Keep the renderer identity used by the animator and the existing SVG nodes.
    const updated = new FaceRenderer(config, { document: this.document, webgl: false });
    this.center = updated.center;
    this.mouth = updated.mouth;
    this.svg.setAttribute('viewBox', updated.svg.getAttribute('viewBox'));
    if (this.photo !== updated.photo) {
      this.group.textContent = '';
      for (const child of [...updated.group.children]) this.group.appendChild(child);
      this.eyes = updated.eyes;
      this.mouthPath = updated.mouthPath;
    } else {
      const copy = (node, next) => {
        for (const attribute of Array.from(next.attributes)) {
          const [key, value] = Array.isArray(attribute) ? attribute : [attribute.name, attribute.value];
          node.setAttribute(key, value);
        }
        Array.from(node.children).forEach((child, i) => copy(child, next.children[i]));
      };
      copy(this.group, updated.group);
      this.eyes.forEach((eye, i) => {
        for (const key of ['x', 'y', 'width', 'height']) eye[key] = updated.eyes[i][key];
      });
    }
    this.photo = updated.photo;
    if (this.photoFace) {
      this.photoFace.setConfig(updated.geometry(config));
      this.canvas.hidden = !this.photo;
    }
    this.render();
  }

  render(state = {}) {
    this.lastState = state;
    const open = current(state.mouth?.open, 0, 0);
    const width = current(state.mouth?.width, 0.5, 0);
    const round = current(state.mouth?.round, 0, 0);
    const tilt = current(state.headTilt, 0, -30, 30);
    const shift = current(state.breath) * 2;
    if (this.photo && this.photoFace?.render({ open, width, round, eyelid: current(state.eyelid, 0, 0), tilt, shift })) {
      // The canvas shows the photo and its motion; the SVG copy stays hidden underneath.
      this.svg.setAttribute('visibility', 'hidden');
      return;
    }
    this.svg.removeAttribute?.('visibility');
    const { x, y } = this.mouth;
    const half = this.mouth.width * (0.5 + width) * (1 - round * 0.4) / 2;
    const depth = this.mouth.width * open * (0.35 + round * 0.25);
    if (this.photo) {
      const rx = this.mouth.width * (0.5 + 0.3 * width) * (1 - 0.3 * round) / 2;
      const ry = this.mouth.width * open * 0.4 / 2;
      this.mouthPath.setAttribute('display', open < 0.05 ? 'none' : 'inline');
      this.mouthPath.setAttribute('d', `M ${x - rx} ${y} A ${rx} ${ry} 0 1 0 ${x + rx} ${y} A ${rx} ${ry} 0 1 0 ${x - rx} ${y} Z`);
    } else {
      this.mouthPath.setAttribute('d', `M ${x - half} ${y} Q ${x} ${y - depth} ${x + half} ${y} Q ${x} ${y + depth} ${x - half} ${y} Z`);
    }
    const eyelid = current(state.eyelid, 0, 0);
    for (const eye of this.eyes) {
      if (this.photo) {
        // An almond-shaped lid that meets at the eye corners: its upper edge follows the upper eyelid arc and its lower
        // (lash) edge moves from that arc down to the lower lash line as the eye closes. No straight edges, no box.
        const left = eye.x - eye.width / 2;
        const right = eye.x + eye.width / 2;
        const top = eye.y - eye.height / 2;
        const closed = eye.y + eye.height * 0.35;
        const edge = top + (closed - top) * eyelid;
        eye.lid.setAttribute('d', `M ${left} ${eye.y} Q ${eye.x} ${2 * top - eye.y} ${right} ${eye.y} Q ${eye.x} ${2 * edge - eye.y} ${left} ${eye.y} Z`);
        eye.lash.setAttribute('d', `M ${left} ${eye.y} Q ${eye.x} ${2 * edge - eye.y} ${right} ${eye.y}`);
        for (const node of [eye.lid, eye.lash]) node.setAttribute('display', eyelid === 0 ? 'none' : 'inline');
        continue;
      }
      eye.pupil.setAttribute('cx', eye.x + current(state.pupil?.x) * eye.width * 0.2);
      eye.pupil.setAttribute('cy', eye.y + current(state.pupil?.y) * eye.height * 0.15);
      eye.pupil.setAttribute('rx', eye.height * 0.3);
      eye.pupil.setAttribute('ry', eye.height * 0.4 * (1 - eyelid));
      const top = eye.y - eye.height / 2;
      eye.lid.setAttribute('d', `M ${eye.x - eye.width / 2} ${top} H ${eye.x + eye.width / 2} V ${top + eye.height * eyelid} H ${eye.x - eye.width / 2} Z`);
    }
    this.group.setAttribute('transform', `translate(0 ${shift}) rotate(${tilt} ${this.center.x} ${this.center.y})`);
  }
}
