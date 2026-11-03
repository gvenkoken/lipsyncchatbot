import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../../web/src/config/config-loader.js';
import { FaceRenderer } from '../../web/src/face/index.js';
import { createWidget } from '../../web/src/widget/index.js';
import { FakeElement } from '../helpers/dom.js';
import { setup } from '../conversation/helpers.js';

test('each panel opening fetches validated face settings and warns on invalid fields', async t => {
  const config = JSON.parse(await readFile(path.resolve(process.cwd(), 'web/config/lypsync.config.json'), 'utf8'));
  const requests = [];
  const warnings = [];
  const fetch = async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true, json: async () => structuredClone(config) };
  };
  const logger = { warn: message => warnings.push(message) };
  const document = {
    createElement: tag => new FakeElement(tag),
    createElementNS: (_, tag) => new FakeElement(tag)
  };
  const renderer = new FaceRenderer(config, { document });
  const env = setup({ loadConfig: () => loadConfig(fetch, logger) });
  const widget = createWidget({ document, renderer, config, ...env });
  t.after(() => widget.dispose());
  widget.toggle.dispatch('click');
  await widget.opened;
  widget.toggle.dispatch('click');
  config.mouth.x = 'invalid';
  config.mouth.lipColor = '#123456';
  config.eyes[0].width = -1;
  widget.toggle.dispatch('click');
  await widget.opened;
  assert.deepEqual(requests, Array.from({ length: 2 }, () => ({
    url: '/config/lypsync.config.json', method: 'GET', cache: 'no-store'
  })));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /varsayılan/);
  assert.equal(renderer.mouth.x, 232);
  assert.equal(renderer.eyes[0].white.getAttribute('rx'), '17.5');
  assert.equal(renderer.mouthPath.getAttribute('fill'), '#123456');
  assert.equal(renderer.group.children.length, 8);
  assert.equal(renderer.svg.children.length, 1);
});
