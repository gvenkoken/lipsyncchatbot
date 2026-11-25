import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSettings, DEFAULT_SETTINGS, SYNTHESIA_AVATARS } from '../src/chat/settings.ts';

test('default and invalid settings select the Gemini avatar with voice on; explicit choices persist', () => {
  assert.deepEqual(DEFAULT_SETTINGS, { mode: 'gemini', synthesiaAvatar: 'default', voice: true });
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('{"avatar":"Synthesia","stt":"Azure"}'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('invalid'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('{"mode":"synthesia","synthesiaAvatar":"custom"}'), { mode: 'synthesia', synthesiaAvatar: 'custom', voice: true });
  assert.deepEqual(parseSettings('{"mode":"video","voice":false}'), { mode: 'video', synthesiaAvatar: 'default', voice: false });
  assert.deepEqual(parseSettings('{"mode":"local","synthesiaAvatar":"default"}'), { mode: 'local', synthesiaAvatar: 'default', voice: true });
  assert.deepEqual(parseSettings('{"mode":"gemini","synthesiaAvatar":"default"}'), { mode: 'gemini', synthesiaAvatar: 'default', voice: true });
  assert.deepEqual(parseSettings('{"mode":"other","synthesiaAvatar":"other"}'), DEFAULT_SETTINGS);
  assert.deepEqual(SYNTHESIA_AVATARS.map(avatar => avatar.value), ['default', 'custom']);
});
