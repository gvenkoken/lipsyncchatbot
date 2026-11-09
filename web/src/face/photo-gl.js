import { gridTriangles, lidMesh, mouthMeshes } from './photo-mesh.js';

const SCALE = 2; // Canvas pixels per image pixel: smooth lip and lid edges.

const VERTEX = `
attribute vec2 a_pos;
attribute vec2 a_tex;
uniform vec2 u_size;
uniform vec2 u_center;
uniform float u_angle;
uniform vec2 u_shift;
uniform vec2 u_texScale;
varying vec2 v_tex;
void main() {
  vec2 p = a_pos - u_center;
  float c = cos(u_angle);
  float s = sin(u_angle);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + u_center + u_shift;
  v_tex = a_tex * u_texScale;
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
}`;

// Mode 0 draws the photo (v_tex is 0…1); mode 1 the inside of the open mouth (v_tex is u, v there).
const FRAGMENT = `
precision mediump float;
uniform sampler2D u_image;
uniform int u_mode;
uniform float u_teeth;
uniform float u_tongue;
varying vec2 v_tex;
void main() {
  if (u_mode == 0) {
    gl_FragColor = texture2D(u_image, v_tex);
    return;
  }
  float u = abs(v_tex.x);
  float v = v_tex.y;
  float depth = 1.0 - abs(v - 0.5) * 2.0;
  // Moist inner lip at the edges, a dark mouth behind, darker towards the corners.
  vec3 color = mix(vec3(0.42, 0.22, 0.20), vec3(0.10, 0.04, 0.04), smoothstep(0.1, 0.75, depth));
  color *= 1.0 - 0.35 * smoothstep(0.55, 1.0, u);
  color = mix(color, vec3(0.40, 0.16, 0.15), smoothstep(0.7, 1.0, v) * u_tongue);
  float teeth = u_teeth * (1.0 - smoothstep(0.12, 0.3, v)) * smoothstep(0.02, 0.1, v) * (1.0 - smoothstep(0.3, 0.65, u));
  color = mix(color, vec3(0.70, 0.65, 0.60), teeth);
  gl_FragColor = vec4(color, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader');
  return shader;
}

/**
 * Draws the photo with WebGL and animates it by moving its own pixels: the jaw
 * and lips part to show the inside of the mouth, and the upper lid skin slides
 * over the eye to blink. create() returns null where WebGL is unavailable; the
 * SVG layers stay as the fallback. ready is true once the photo has loaded.
 */
export class PhotoFace {
  static create(document, config) {
    try {
      const canvas = document.createElement?.('canvas');
      const gl = canvas?.getContext?.('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: false });
      return gl ? new PhotoFace(document, canvas, gl, config) : null;
    } catch {
      return null;
    }
  }

  constructor(document, canvas, gl, config) {
    this.document = document;
    this.canvas = canvas;
    this.gl = gl;
    this.ready = false;
    this.lost = false;
    canvas.setAttribute('class', 'character-photo');
    canvas.setAttribute('aria-hidden', 'true');
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'program');
    gl.useProgram(program);
    this.program = program;
    this.attributes = { pos: gl.getAttribLocation(program, 'a_pos'), tex: gl.getAttribLocation(program, 'a_tex') };
    this.uniforms = Object.fromEntries(['u_size', 'u_texScale', 'u_center', 'u_angle', 'u_shift', 'u_image', 'u_mode', 'u_teeth', 'u_tongue']
      .map(name => [name, gl.getUniformLocation(program, name)]));
    this.buffer = gl.createBuffer();
    this.texture = gl.createTexture();
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; this.ready = false; });
    this.setConfig(config);
  }

  setConfig(config) {
    const body = config.body ?? {};
    this.size = { width: body.width, height: body.height };
    this.mouth = { ...config.mouth };
    this.eyes = (config.eyes ?? []).map(eye => ({ ...eye }));
    this.canvas.width = Math.round(this.size.width * SCALE);
    this.canvas.height = Math.round(this.size.height * SCALE);
    if (this.src !== body.src) this.load(body.src);
  }

  load(src) {
    this.src = src;
    this.ready = false;
    const image = this.document.createElement('img');
    image.addEventListener('load', () => {
      if (this.src !== src || this.lost) return;
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      for (const [key, value] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
      this.ready = true;
      this.onReady?.();
    });
    image.setAttribute('src', src);
  }

  draw(mode, pos, tex) {
    const gl = this.gl;
    const data = new Float32Array(pos.length * 2);
    for (let i = 0; i < pos.length / 2; i++) data.set([pos[i * 2], pos[i * 2 + 1], tex[i * 2], tex[i * 2 + 1]], i * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.attributes.pos);
    gl.vertexAttribPointer(this.attributes.pos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.attributes.tex);
    gl.vertexAttribPointer(this.attributes.tex, 2, gl.FLOAT, false, 16, 8);
    gl.uniform1i(this.uniforms.u_mode, mode);
    // Photo texture coordinates are pixels, normalised here in high precision; mouth uv is used as is.
    gl.uniform2f(this.uniforms.u_texScale, mode === 0 ? 1 / this.size.width : 1, mode === 0 ? 1 / this.size.height : 1);
    gl.drawArrays(gl.TRIANGLES, 0, pos.length / 2);
  }

  drawMesh(mesh) {
    const { src, dst } = gridTriangles(mesh);
    this.draw(0, dst, src);
  }

  /** Frees the GPU context; browsers allow only a few at a time. */
  dispose() {
    this.ready = false;
    this.lost = true;
    this.gl.getExtension?.('WEBGL_lose_context')?.loseContext();
  }

  /** open, width, round, eyelid in 0…1; tilt in degrees and shift in image pixels, as the SVG group uses. */
  render({ open = 0, width = 0.5, round = 0, eyelid = 0, tilt = 0, shift = 0 } = {}) {
    if (!this.ready || this.lost) return false;
    const gl = this.gl;
    const { width: w, height: h } = this.size;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    // Every layer replaces what is below it, so translucent photo edges never add up.
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.u_image, 0);
    gl.uniform2f(this.uniforms.u_size, w, h);
    gl.uniform2f(this.uniforms.u_center, w / 2, h / 2);
    gl.uniform1f(this.uniforms.u_angle, tilt * Math.PI / 180);
    gl.uniform2f(this.uniforms.u_shift, 0, shift);
    const quad = [0, 0, 0, h, w, 0, w, 0, 0, h, w, h];
    this.draw(0, quad, quad);

    const mouth = mouthMeshes(this.mouth, { open, width, round });
    if (mouth.active) {
      const teeth = Math.min(1, Math.max(0, (open - 0.35) / 0.5)) * (1 - 0.7 * round) * 0.55;
      gl.uniform1f(this.uniforms.u_teeth, teeth);
      gl.uniform1f(this.uniforms.u_tongue, Math.min(1, open) * 0.6);
      if (mouth.interior.pos.length) this.draw(1, mouth.interior.pos, mouth.interior.uv);
      this.drawMesh(mouth.upper);
      this.drawMesh(mouth.lower);
    }
    if (eyelid > 0.01) for (const eye of this.eyes) this.drawMesh(lidMesh(eye, eyelid));
    return true;
  }
}
