import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { mp4Info } from '../src/chat/gemini-player.ts';

function box(type: string, content: Uint8Array) { const bytes = new Uint8Array(content.length + 8); new DataView(bytes.buffer).setUint32(0, bytes.length); bytes.set(new TextEncoder().encode(type), 4); bytes.set(content, 8); return bytes; }
test('MP4 initialization detects the actual AVC profile and muxed audio, and waits for incomplete metadata', () => {
  const ftyp = box('ftyp', new TextEncoder().encode('isom'));
  const moov = box('moov', new Uint8Array([...new TextEncoder().encode('avc1avcC'), 1, 0x64, 0, 0x28, ...new TextEncoder().encode('mp4a')]));
  const init = new Uint8Array([...ftyp, ...moov]); const all = new Uint8Array([...init, ...box('moof', new Uint8Array([1, 2]))]);
  assert.equal(mp4Info(init.slice(0, -2)), null); assert.equal(mp4Info(new Uint8Array([1, 2, 3])), null);
  assert.equal(mp4Info(all)?.mime, 'video/mp4; codecs="avc1.640028, mp4a.40.2"'); assert.deepEqual(mp4Info(all)?.init, init);
});
test('microphone worklet preserves sample rate across 128-sample block boundaries and emits only silent monitor output', () => {
  const code = readFileSync(new URL('../public/gemini-pcm-worklet.js', import.meta.url), 'utf8');
  for (const rate of [16000, 44100, 48000]) {
    let Processor: any; const sent: number[] = [];
    vm.runInNewContext(code, { sampleRate: rate, AudioWorkletProcessor: class { port = { postMessage: (buffer: ArrayBuffer) => sent.push(...new Int16Array(buffer)) }; }, registerProcessor: (_name: string, value: unknown) => { Processor = value; } });
    const processor = new Processor(), length = rate;
    for (let offset = 0; offset < length; offset += 128) {
      const input = Float32Array.from({ length: Math.min(128, length - offset) }, (_, i) => .5 * Math.sin(2 * Math.PI * 200 * (offset + i) / rate));
      const output = new Float32Array(128).fill(1); processor.process([[input]], [[output]]); assert.ok(output.every(value => value === 0));
    }
    const all = [...sent, ...processor.output.slice(0, processor.used)];
    assert.ok(Math.abs(all.length - 16000) <= 1, `sample rate drift at ${rate}: ${all.length}`);
    for (let i = 0; i < all.length; i += 37) assert.ok(Math.abs(all[i] / 32768 - .5 * Math.sin(2 * Math.PI * 200 * i / 16000)) < .001, `waveform drift at ${rate}, sample ${i}`);
    assert.ok(processor.samples.length < 5);
  }
});
