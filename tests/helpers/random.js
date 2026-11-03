export class FakeRandom {
  constructor(values = [0.5]) {
    if (!values.length || values.some(value => !Number.isFinite(value) || value < 0 || value >= 1)) {
      throw new RangeError('Random değerleri [0, 1) aralığında olmalıdır.');
    }
    this.values = [...values];
    this.index = 0;
  }
  next = () => this.values[this.index++ % this.values.length];
}
