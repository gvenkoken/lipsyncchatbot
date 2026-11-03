let filterSequence = 0;
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
    this.render();
  }

  updateConfig(config) {
    // Keep the renderer identity used by the animator and the existing SVG nodes.
    const updated = new FaceRenderer(config, { document: this.document });
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
    this.render();
  }

  render(state = {}) {
    const open = current(state.mouth?.open, 0, 0);
    const width = current(state.mouth?.width, 0.5, 0);
    const round = current(state.mouth?.round, 0, 0);
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
        const left = eye.x - eye.width / 2;
        const right = eye.x + eye.width / 2;
        const top = eye.y - eye.height / 2;
        const bottom = top + eye.height * eyelid;
        // The curved edge flattens at full closure to cover the entire eye box.
        const edge = bottom - eye.height * eyelid * (1 - eyelid) * 0.5;
        eye.lid.setAttribute('d', `M ${left} ${top} H ${right} V ${edge} Q ${eye.x} ${2 * bottom - edge} ${left} ${edge} Z`);
        eye.lash.setAttribute('d', `M ${left} ${edge} Q ${eye.x} ${2 * bottom - edge} ${right} ${edge}`);
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
    this.group.setAttribute('transform', `translate(0 ${current(state.breath) * 2}) rotate(${current(state.headTilt, 0, -30, 30)} ${this.center.x} ${this.center.y})`);
  }
}
