export class Goertzel {
  private q1 = 0;
  private q2 = 0;
  private coefficient: number;
  constructor(frequency: number, sampleRate: number) { this.coefficient = 2 * Math.cos(2 * Math.PI * frequency / sampleRate); }
  push(sample: number) {
    const q0 = sample + this.coefficient * this.q1 - this.q2;
    this.q2 = this.q1; this.q1 = q0;
  }
  power(): number { return Math.max(0, this.q1 ** 2 + this.q2 ** 2 - this.coefficient * this.q1 * this.q2); }
}
