export class FakeClock {
  constructor(time = 0) { this.time = time; this.nextId = 1; this.frames = new Map(); }
  now = () => this.time;
  requestAnimationFrame = callback => {
    const id = this.nextId++;
    this.frames.set(id, callback);
    return id;
  };
  cancelAnimationFrame = id => { this.frames.delete(id); };
  advance(milliseconds) {
    this.time += milliseconds;
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const callback of callbacks) callback(this.time);
  }
}
