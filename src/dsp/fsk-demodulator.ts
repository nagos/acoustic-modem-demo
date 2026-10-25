import { Goertzel } from './goertzel';
import { BIT_SECONDS, FREQUENCIES, bitsByte, owner, sampleBoundary, type BitDecision, type DecodedByte, type FrameSettings } from '../protocol/frame';
interface Window { start: number; end: number; filters: Goertzel[]; weight: number; count: number }
/** Absolute frame-relative sample positions; block size and message timing do not affect decisions. */
export class FskDemodulator {
  readonly decisions: BitDecision[] = [];
  readonly bytes: DecodedByte[] = [];
  private index = 0;
  private window: Window;
  private nextByte = 0;
  constructor(readonly settings: FrameSettings, readonly rate: number, private onBit?: (bit: BitDecision) => void, private onByte?: (byte: DecodedByte) => void) { this.window = this.makeWindow(); }
  private makeWindow(): Window {
    return {
      start: sampleBoundary(this.index * BIT_SECONDS + 0.14 + this.settings.offsetMs / 1000, this.rate),
      end: sampleBoundary(this.index * BIT_SECONDS + 0.56 + this.settings.offsetMs / 1000, this.rate),
      filters: (this.settings.mode === 'FDM' ? [1200,1600,2800,3200] : [1200,1600]).map(f => new Goertzel(f,this.rate)), weight:0, count:0
    };
  }
  private finishBit() {
    const w = this.window;
    for (let c = 0; c < (this.settings.mode === 'FDM' ? 2 : 1); c++) {
      const p0 = w.filters[c*2].power(), p1 = w.filters[c*2+1].power();
      const winner = p1 > p0 ? 1 : 0;
      const high = Math.max(p0,p1), low = Math.min(p0,p1);
      const levelDb = 10 * Math.log10(Math.max(1e-12, 2 * high / Math.max(1,w.weight ** 2)));
      const separationDb = Math.min(120, 10 * Math.log10((high + 1e-20) / (low + 1e-20)));
      const complete = w.count >= w.end - w.start;
      const reason = !complete ? 'Missing audio samples' : levelDb < this.settings.floorDb ? 'Below signal threshold' : separationDb < this.settings.separationDb ? 'Ambiguous frequencies' : null;
      const channel = this.settings.mode === 'FDM' ? (c ? 'B' : 'A') : owner(this.settings.mode, Math.floor(this.index / 8));
      const decision: BitDecision = { index:this.index, channel, value:reason ? null : winner, confidence:reason ? 0 : Math.max(0, Math.min(1, (high-low) / (high+low+1e-20))), frequency:reason ? null : FREQUENCIES[c ? 'B' : 'A'][winner], levelDb, separationDb, reason };
      this.decisions.push(decision); this.onBit?.(decision);
    }
  }
  private finishBytes(relativeSample: number) {
    while (this.nextByte < 10 && relativeSample >= sampleBoundary((this.nextByte + 1) * 5.6, this.rate)) {
      const slot = this.nextByte;
      const channels = this.settings.mode === 'FDM' ? ['A','B'] as const : [owner(this.settings.mode,slot)];
      if (channels.some(c => this.decisions.filter(d => d.channel === c && Math.floor(d.index / 8) === slot).length < 8)) break;
      for (const channel of channels) {
        const bits = this.decisions.filter(d => d.channel === channel && Math.floor(d.index / 8) === slot).map(d => d.value);
        const value = bitsByte(bits);
        const byte: DecodedByte = {slot,channel,value,error:value === null || value < 32 || value > 126};
        this.bytes.push(byte); this.onByte?.(byte);
      }
      this.nextByte++;
    }
  }
  process(samples: Float32Array, firstSample: number) {
    for (let j = 0; j < samples.length; j++) {
      const pos = firstSample + j;
      while (this.index < 80 && pos >= this.window.end) {
        this.finishBit(); this.index++; if (this.index < 80) this.window = this.makeWindow();
      }
      if (this.index < 80 && pos >= this.window.start && pos < this.window.end) {
        const w = this.window;
        const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * (pos - w.start) / Math.max(1,w.end-w.start-1));
        for (const filter of w.filters) filter.push(samples[j] * hann);
        w.weight += hann; w.count++;
      }
    }
    this.finishBytes(firstSample + samples.length - 1);
  }
}
