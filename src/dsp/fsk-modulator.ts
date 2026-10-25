import { ACTIVE_SECONDS, BIT_SECONDS, FREQUENCIES, type Payload } from '../protocol/frame';
/** Shared by the worklet and the offline PCM loopback. */
export class FskModulator {
  private phases = [0, 0];
  constructor(readonly payload: Payload, readonly rate: number, readonly volume = 0.35) {}
  sample(relativeSample: number): number {
    const t = relativeSample / this.rate;
    if (t < 0 || t >= ACTIVE_SECONDS) return 0;
    const bit = Math.min(79, Math.floor(t / BIT_SECONDS + 1e-10));
    let out = 0;
    for (let c = 0; c < this.payload.streams.length; c++) {
      const freq = FREQUENCIES[c === 0 ? 'A' : 'B'][this.payload.streams[c][bit]];
      out += Math.sin(this.phases[c]);
      this.phases[c] = (this.phases[c] + 2 * Math.PI * freq / this.rate) % (2 * Math.PI);
    }
    const ramp = Math.max(0, Math.min(1, t / 0.005, (ACTIVE_SECONDS - t) / 0.005));
    return out * Math.min(1, Math.max(0, this.volume)) / this.payload.streams.length * ramp;
  }
  render(first: number, length: number): Float32Array {
    return Float32Array.from({length}, (_, i) => this.sample(first + i));
  }
}
