const NS = 'http://www.w3.org/2000/svg';
const asset = 'assets/owner/akilay2-removebg-preview-1.png';
const number = (value, fallback, min = -100000) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= 100000 ? value : fallback;
const color = (value, fallback) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
const current = (channel, fallback = 0, min = -1, max = 1) =>
  Math.max(min, Math.min(max, number(channel?.current, fallback)));

/** Append svg to the stage; render consumes the smoothed FaceState channels. */
export class FaceRenderer {
  constructor(config = {}, { document = globalThis.document } = {}) {
    const element = (tag, attributes = {}) => {
      const node = document.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      return node;
    };
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
      return { ...geometry,
        white: element('ellipse', { cx: geometry.x, cy: geometry.y, rx: geometry.width / 2, ry: geometry.height / 2, fill: '#FFFFFF' }),
        pupil: element('ellipse', { fill: color(eye.irisColor, '#45382F') }),
        lid: element('path', { fill: '#C58F76' })
      };
    });
    for (const layer of ['white', 'pupil', 'lid']) {
      for (const eye of this.eyes) this.group.appendChild(eye[layer]);
    }
    const mouth = config.mouth ?? {};
    this.mouth = { x: number(mouth.x, 232, 0), y: number(mouth.y, 223, 0), width: number(mouth.width, 54, 1) };
    this.mouthPath = element('path', { fill: color(mouth.lipColor, '#985D50'), stroke: color(mouth.lipColor, '#985D50'), 'stroke-width': 2, 'stroke-linecap': 'round' });
    this.group.appendChild(this.mouthPath);
    this.render();
  }

  render(state = {}) {
    const open = current(state.mouth?.open, 0, 0);
    const width = current(state.mouth?.width, 0.5, 0);
    const round = current(state.mouth?.round, 0, 0);
    const { x, y } = this.mouth;
    const half = this.mouth.width * (0.5 + width) * (1 - round * 0.4) / 2;
    const depth = this.mouth.width * open * (0.35 + round * 0.25);
    this.mouthPath.setAttribute('d', `M ${x - half} ${y} Q ${x} ${y - depth} ${x + half} ${y} Q ${x} ${y + depth} ${x - half} ${y} Z`);
    const eyelid = current(state.eyelid, 0, 0);
    for (const eye of this.eyes) {
      eye.pupil.setAttribute('cx', eye.x + current(state.pupil?.x) * eye.width * 0.2);
      eye.pupil.setAttribute('cy', eye.y + current(state.pupil?.y) * eye.height * 0.15);
      eye.pupil.setAttribute('rx', eye.height * 0.3);
      eye.pupil.setAttribute('ry', eye.height * 0.4 * (1 - eyelid));
      const top = eye.y - eye.height / 2;
      eye.lid.setAttribute('d', `M ${eye.x - eye.width / 2} ${top} H ${eye.x + eye.width / 2} V ${top + eye.height * eyelid} H ${eye.x - eye.width / 2} Z`);
    }
    this.group.setAttribute('transform', `translate(0 ${current(state.breath) * 2}) rotate(${current(state.headTilt, 0, -30, 30)} ${this.center.x} ${this.center.y})`);
  }
}
