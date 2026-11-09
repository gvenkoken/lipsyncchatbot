import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, MIN_VISEME_MS, resyncAt, sampleAt, VISEME_TARGETS } from '../../web/src/lipsync/index.js';

const endOf = timeline => timeline.at(-1).startMs + timeline.at(-1).durationMs;

const kinds = text => buildTimeline(text, 1).map(entry => entry.kind);
const gapless = timeline => {
  for (let i = 1; i < timeline.length; i++) {
    assert.ok(Math.abs(timeline[i].startMs - (timeline[i - 1].startMs + timeline[i - 1].durationMs)) < 1e-8);
  }
};

test('Merhaba Ömür maps Turkish letters in order and finishes closed', () => {
  // h joins its neighbour; the space keeps the previous pose instead of closing the mouth.
  assert.deepEqual(kinds('Merhaba Ömür'), [
    'closed', 'mid', 'narrow', 'wide', 'closed', 'wide', 'round', 'closed', 'tight', 'narrow', 'closed'
  ]);
  assert.deepEqual(kinds('P A E İ I O Ö U Ü F Ş H'), [
    'closed', 'wide', 'mid', 'spread', 'round', 'tight', 'teeth', 'pucker', 'closed'
  ]);
  assert.deepEqual(kinds('ağaç'), ['wide', 'pucker', 'closed']);
  for (const entry of buildTimeline('Merhaba Ömür, çiçek!', 1)) {
    assert.deepEqual(entry.target, VISEME_TARGETS[entry.kind]);
    for (const value of Object.values(entry.target)) assert.ok(value >= 0 && value <= 1);
  }
});

test('commas and sentence ends rest the mouth; spaces and symbols do not', () => {
  const timeline = buildTimeline('Ali, gel. "Tamam"', 1);
  assert.deepEqual(timeline.map(entry => entry.kind), ['wide', 'narrow', 'spread', 'closed', 'narrow', 'mid', 'narrow', 'closed', 'narrow', 'wide', 'closed', 'wide', 'closed']);
  const comma = timeline[3];
  assert.ok(comma.durationMs >= 180);
  gapless(timeline);
  // Without punctuation the mouth never closes between words.
  assert.ok(!buildTimeline('ali gel', 1).slice(0, -1).some(entry => entry.kind === 'closed'));
});

test('rate inversely scales duration and blank text returns an empty array', () => {
  const normal = endOf(buildTimeline('Merhaba Ömür', 1));
  const slow = endOf(buildTimeline('Merhaba Ömür', 0.5));
  assert.ok(Math.abs(slow / normal - 2) <= 0.1);
  assert.deepEqual(buildTimeline(''), []);
  assert.deepEqual(buildTimeline(' \n\t '), []);
  for (const rate of [0, -1, Infinity, NaN]) assert.throws(() => buildTimeline('a', rate), RangeError);
  assert.throws(() => buildTimeline(null), TypeError);
});

test('the estimate matches Turkish voices and excludes the final rest', () => {
  const text = 'Bugün birlikte küçük bir konuşma deneyi yapıyoruz';
  const timeline = buildTimeline(text, 1);
  const lettersPerSecond = [...text].filter(character => /\p{L}/u.test(character)).length / (timeline.estimateMs / 1000);
  assert.ok(lettersPerSecond > 12 && lettersPerSecond < 17, String(lettersPerSecond));
  assert.ok(timeline.estimateMs < endOf(timeline));
  assert.equal(buildTimeline('Merhaba.', 1).estimateMs, buildTimeline('Merhaba', 1).estimateMs);
  assert.equal(buildTimeline('Merhaba', 2).estimateMs, buildTimeline('Merhaba', 1).estimateMs / 2);
});

test('short consonants merge without time gaps; vowels and closures always show', () => {
  for (const [text, rate] of [['Merhaba Ömür bugün', 1.5], ['ağaç ve şu', 1.5], ['r', 10], ['hhh', 10]]) {
    const timeline = buildTimeline(text, rate);
    assert.ok(timeline.every(entry => entry.durationMs >= MIN_VISEME_MS), text);
    gapless(timeline);
    assert.equal(timeline.at(-1).kind, 'closed');
  }
  // Even very fast speech keeps opening the mouth for every vowel.
  const fast = buildTimeline('Merhaba', 4);
  assert.deepEqual(fast.map(entry => entry.kind), ['closed', 'mid', 'wide', 'closed', 'wide', 'closed']);
  gapless(fast);
  const timeline = buildTimeline('ak', 1.5);
  assert.equal(timeline[0].kind, 'wide');
  assert.ok(Math.abs(timeline[0].durationMs - (85 + 65) / 1.5) < 1e-8);
  // A short leading consonant hands its time to the next pose.
  const leading = buildTimeline('ka', 1.5);
  assert.equal(leading[0].kind, 'wide');
  assert.equal(leading[0].startMs, 0);
  assert.ok(!Object.hasOwn(leading[0], 'keep'));
});

test('third word boundary shifts its start and all subsequent timing equally', () => {
  const text = 'Merhaba Ömür bugün nasılsın';
  const timeline = buildTimeline(text, 1.5);
  const before = timeline.map(entry => ({ ...entry }));
  const wordsBefore = timeline.words.map(word => ({ ...word }));
  const third = wordsBefore[2];
  assert.equal(third.charIndex, text.indexOf('bugün'));
  const offset = 900 - third.startMs;
  assert.equal(resyncAt(timeline, third.charIndex, 900), timeline);
  assert.equal(timeline.words[2].startMs, 900);
  timeline.words.forEach((word, index) => {
    assert.equal(word.charIndex, wordsBefore[index].charIndex);
    assert.equal(word.startMs, wordsBefore[index].startMs + offset);
  });
  timeline.forEach((entry, index) => {
    assert.equal(entry.startMs, before[index].startMs + offset);
    assert.equal(entry.durationMs, before[index].durationMs);
  });
  resyncAt(timeline, third.charIndex, 1200);
  assert.equal(timeline.words[2].startMs, 1200);
});

test('word offsets use original UTF-16 coordinates and ignore non-boundaries', () => {
  const timeline = buildTimeline('😀 İyi,  Ömür!');
  assert.deepEqual(timeline.words.map(word => word.charIndex), [3, 9]);
  const original = structuredClone(timeline);
  for (const charIndex of [-1, 0, 4, 6, 100, NaN]) resyncAt(timeline, charIndex, 500);
  resyncAt(timeline, 3, Infinity);
  assert.deepEqual(timeline, original);
  assert.deepEqual(resyncAt([], 0, 10), []);
});

test('sampling uses estimated times without boundaries and returns closed outside speech', () => {
  const timeline = buildTimeline('aeo');
  for (const entry of timeline) {
    assert.deepEqual(sampleAt(timeline, entry.startMs), entry.target);
    assert.deepEqual(sampleAt(timeline, entry.startMs + entry.durationMs / 2), entry.target);
  }
  for (const time of [-1, endOf(timeline), endOf(timeline) + 100, NaN]) {
    assert.deepEqual(sampleAt(timeline, time), VISEME_TARGETS.closed);
  }
  assert.deepEqual(sampleAt([], 0), VISEME_TARGETS.closed);
  const target = sampleAt(timeline, 0);
  target.openness = 0;
  assert.equal(sampleAt(timeline, 0).openness, 1);
  resyncAt(timeline, 0, 500);
  assert.deepEqual(sampleAt(timeline, 499), VISEME_TARGETS.closed);
  assert.deepEqual(sampleAt(timeline, 500), VISEME_TARGETS.wide);
});
