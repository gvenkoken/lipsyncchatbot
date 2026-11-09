import { describe, expect, it, vi } from 'vitest';
import { FakeSpeech, type SpeechClock } from '../../speech/FakeSpeech';
import { createVisemeTimeline, letterToViseme, VisemePlayer } from './index';

describe('Turkish visemes', () => {
  it.each([
    ['Aa', 'a'], ['Ee', 'e'], ['İi', 'i'], ['Iı', 'ı'], ['Oo', 'o'],
    ['Öö', 'ö'], ['Uu', 'u'], ['Üü', 'ü'], ['BbmpPNnĞğ', 'closed'],
    ['FfVv', 'fv'], ['SsZz', 'sz'], ['TtDd', 'td'], ['Ll', 'l'], ['Rr', 'r'],
    ['ÇçŞşCcJj', 'çş'], ['GgKk', 'gk'], ['Hh', 'h'], ['Yy', 'y'], [' .!?🙂', 'closed'],
  ])('maps %s to %s', (letters, pose) => {
    for (const letter of letters) expect(letterToViseme(letter)).toBe(pose);
  });

  it('normalizes decomposed dotted capital I', () => {
    expect(letterToViseme('I\u0307')).toBe('i');
  });

  it('produces identical syllable timing without randomness', () => {
    const random = vi.spyOn(Math, 'random');
    try {
      const settings = { rate: 1.2, syllableMs: 160 };
      const first = createVisemeTimeline('Işık, güzel İstanbul! 🙂', settings);
      expect(createVisemeTimeline('Işık, güzel İstanbul! 🙂', settings)).toEqual(first);
      expect(random).not.toHaveBeenCalled();
      expect(createVisemeTimeline('araba').durationMs).toBeCloseTo(540);
      expect(createVisemeTimeline('araba', { rate: 2 }).durationMs).toBeCloseTo(270);
      expect(Object.isFrozen(first.cues)).toBe(true);
    } finally { random.mockRestore(); }
  });

  it('never carries vowel weights into consonants, whitespace or punctuation', () => {
    const timeline = createVisemeTimeline('A b! E.');
    const player = new VisemePlayer(timeline);
    player.handleSpeechEvent({ type: 'start' });
    let previous = 0;
    for (const cue of timeline.cues) {
      const at = (cue.startMs + cue.endMs) / 2;
      const weights = player.update(at - previous);
      previous = at;
      const open = weights.filter(weight => ['a', 'e', 'i', 'ı', 'o', 'ö', 'u', 'ü'].includes(weight.pose));
      expect(open.some(weight => weight.weight > 0)).toBe(cue.isVowel);
      expect(weights.reduce((sum, weight) => sum + weight.weight, 0)).toBeCloseTo(1);
    }
    expect(player.update(timeline.durationMs)).toEqual([{ pose: 'closed', weight: 1 }]);
  });

  it('blends the current pose toward closed without crossing cue boundaries', () => {
    const player = new VisemePlayer(createVisemeTimeline('a ', { blendMs: 30 }));
    player.handleSpeechEvent({ type: 'start' });
    expect(player.update(165)).toEqual([{ pose: 'a', weight: 0.5 }, { pose: 'closed', weight: 0.5 }]);
    expect(player.update(15)).toEqual([{ pose: 'closed', weight: 1 }]);
  });
});

/** Explicit scheduler: no real timers, sleeps, or global clock patching. */
function fakeClock() {
  let now = 0;
  let serial = 0;
  const jobs = new Map<number, { at: number; callback: () => void }>();
  const scheduler: SpeechClock = {
    setTimeout(callback, delay) { const id = ++serial; jobs.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(handle) { jobs.delete(handle as number); },
  };
  return { scheduler, advance(to: number, player: VisemePlayer) {
    for (;;) {
      const next = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > to) break;
      player.update(next[1].at - now);
      now = next[1].at;
      jobs.delete(next[0]);
      next[1].callback();
    }
    const weights = player.update(to - now);
    now = to;
    return weights;
  } };
}

describe('speech alignment', () => {
  it('waits for start, opens at start, rests in gaps, realigns at word boundary and closes on end', () => {
    const time = fakeClock();
    const speech = new FakeSpeech(true, time.scheduler);
    const player = new VisemePlayer(createVisemeTimeline('a e'));
    const unsubscribe = speech.subscribe(event => player.handleSpeechEvent(event));
    speech.speak('a e', { rate: 1, pitch: 1 });
    expect(player.update(0)).toEqual([{ pose: 'closed', weight: 1 }]);
    expect(time.advance(0, player)[0]).toEqual({ pose: 'a', weight: 1 });
    expect(time.advance(185, player)).toEqual([{ pose: 'closed', weight: 1 }]);
    // FakeSpeech reports first word at 200 and second at 400.
    expect(time.advance(200, player)[0]).toEqual({ pose: 'a', weight: 1 });
    expect(time.advance(400, player)[0]).toEqual({ pose: 'e', weight: 1 });
    expect(time.advance(600, player)).toEqual([{ pose: 'closed', weight: 1 }]);
    unsubscribe();
    speech.dispose();
  });

  it('keeps initial consonants closed and supports cancellation and restart', () => {
    const player = new VisemePlayer(createVisemeTimeline('ba'));
    player.handleSpeechEvent({ type: 'boundary', charIndex: 0, wordIndex: 0 });
    expect(player.update(100)).toEqual([{ pose: 'closed', weight: 1 }]);
    player.handleSpeechEvent({ type: 'start' });
    expect(player.update(0)).toEqual([{ pose: 'closed', weight: 1 }]);
    expect(player.update(45)[0].pose).toBe('a');
    player.reset();
    expect(player.update(0)).toEqual([{ pose: 'closed', weight: 1 }]);
    player.handleSpeechEvent({ type: 'start' });
    expect(player.update(45)[0].pose).toBe('a');
    player.handleSpeechEvent({ type: 'voiceUnavailable' });
    expect(player.update(0)).toEqual([{ pose: 'closed', weight: 1 }]);
  });

  it.each([-1, NaN, Infinity])('rejects invalid timing %s', value => {
    expect(() => createVisemeTimeline('a', { rate: value })).toThrow(RangeError);
    expect(() => createVisemeTimeline('a', { syllableMs: value })).toThrow(RangeError);
    expect(() => new VisemePlayer(createVisemeTimeline('a')).update(value)).toThrow(RangeError);
  });

  it('handles empty text and ignores unknown boundaries', () => {
    const player = new VisemePlayer(createVisemeTimeline(''));
    player.handleSpeechEvent({ type: 'start' });
    player.handleSpeechEvent({ type: 'boundary', charIndex: 99, wordIndex: 99 });
    expect(player.update(0)).toEqual([{ pose: 'closed', weight: 1 }]);
  });
});
