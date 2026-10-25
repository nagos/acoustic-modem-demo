import type { SpectralColumn } from '../protocol/frame';
export const SPECTRUM_COLUMNS = 1800;
export interface RollingColumn extends SpectralColumn { timestamp: number }
export interface RollingUpdate { column: RollingColumn; cleared: number[] }
/** One fixed minute-wide sweep. Wrapping overwrites traversed columns, never the entire image. */
export class RollingSpectrum {
  readonly columns: (RollingColumn | null)[] = Array(SPECTRUM_COLUMNS).fill(null);
  state: 'STOPPED' | 'RUNNING' | 'FROZEN' = 'STOPPED';
  cursor: number | null = null;
  rate = 48000;
  private lastAbsolute: number | null = null;
  private lastTimestamp = -Infinity;
  start() { this.state = 'RUNNING'; this.lastAbsolute = null; this.lastTimestamp = -Infinity; }
  freeze() { if (this.state === 'RUNNING') this.state = 'FROZEN'; }
  stop() { this.state = 'STOPPED'; }
  write(timestamp: number, bins: Uint8Array, rate: number): RollingUpdate | null {
    if (this.state !== 'RUNNING' || timestamp < this.lastTimestamp) return null;
    const time = ((timestamp % 60000) + 60000) % 60000 / 1000;
    const slot = Math.min(SPECTRUM_COLUMNS - 1, Math.floor(time * 30));
    const absolute = Math.floor(timestamp / 60000) * SPECTRUM_COLUMNS + slot;
    const cleared: number[] = [];
    if (this.rate !== rate) {
      this.columns.fill(null); this.rate = rate;
      for (let i = 0; i < SPECTRUM_COLUMNS; i++) cleared.push(i);
    } else if (this.lastAbsolute !== null) {
      const count = Math.min(SPECTRUM_COLUMNS, absolute - this.lastAbsolute);
      for (let i = count - 1; i >= 0; i--) {
        const index = ((absolute - i) % SPECTRUM_COLUMNS + SPECTRUM_COLUMNS) % SPECTRUM_COLUMNS;
        this.columns[index] = null; cleared.push(index);
      }
    }
    const column = { time, timestamp, bins };
    this.columns[slot] = column; this.cursor = time;
    this.lastAbsolute = absolute; this.lastTimestamp = timestamp;
    return { column, cleared };
  }
}
