// Capture only. Audio never plays back to the microphone user's speakers.
class GeminiPCMProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.samples = []; this.position = 0; this.output = new Int16Array(320); this.used = 0; }
  process(inputs, outputs) {
    outputs[0]?.forEach(channel => channel.fill(0));
    const input = inputs[0]?.[0]; if (!input) return true;
    for (const value of input) this.samples.push(value);
    const step = sampleRate / 16000;
    while (this.position + 1 < this.samples.length) {
      const index = Math.floor(this.position), fraction = this.position - index;
      const value = this.samples[index] * (1 - fraction) + this.samples[index + 1] * fraction;
      const limited = Math.max(-1, Math.min(1, value)); this.output[this.used++] = Math.round(limited * (limited < 0 ? 32768 : 32767));
      this.position += step;
      if (this.used === this.output.length) { this.port.postMessage(this.output.buffer, [this.output.buffer]); this.output = new Int16Array(320); this.used = 0; }
    }
    const consumed = Math.min(Math.floor(this.position), this.samples.length - 1); this.samples.splice(0, consumed); this.position -= consumed;
    return true;
  }
}
registerProcessor('gemini-pcm', GeminiPCMProcessor);
