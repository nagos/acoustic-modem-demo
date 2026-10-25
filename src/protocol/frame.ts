export type Mode = 'None' | 'FDM' | 'TDM';
export type Channel = 'A' | 'B';
export const BIT_SECONDS = 0.7;
export const BYTE_SECONDS = 5.6;
export const ACTIVE_SECONDS = 56;
export const FRAME_SECONDS = 60;
export const BIT_COUNT = 80;
export const FREQUENCIES = { A: [1200, 1600], B: [2800, 3200] } as const;
export const capacity = (mode: Mode) => mode === 'TDM' ? 5 : 10;
export const nextMinute = (now: number) => (Math.floor(now / 60000) + 1) * 60000;
export const bitAt = (seconds: number) => seconds >= 0 && seconds < ACTIVE_SECONDS ? Math.floor(seconds / BIT_SECONDS + 1e-10) : null;
export const sampleBoundary = (seconds: number, rate: number) => Math.round(seconds * rate);
export const owner = (mode: Mode, byte: number): Channel => mode === 'TDM' && byte % 2 ? 'B' : 'A';
export function validateAscii(text: string, limit: number): string | null {
  if (/[^\x20-\x7e]/.test(text)) return 'Use printable ASCII only (space through ~). Unicode and line breaks cannot be sent.';
  if (text.length > limit) return `Maximum ${limit} characters per channel in this mode.`;
  return null;
}
export function encodeAscii(text: string, length: number): Uint8Array {
  const error = validateAscii(text, length);
  if (error) throw new Error(error);
  return Uint8Array.from(text.padEnd(length, ' '), c => c.charCodeAt(0));
}
export const byteBits = (byte: number): number[] => Array.from({length:8}, (_, i) => byte >> (7 - i) & 1);
export function bitsByte(bits: readonly (number | null)[]): number | null {
  return bits.length === 8 && bits.every(b => b === 0 || b === 1) ? bits.reduce<number>((n,b) => n * 2 + b!, 0) : null;
}
export interface Payload { mode: Mode; a: Uint8Array; b: Uint8Array; streams: number[][] }
export function makePayload(mode: Mode, a: string, b = ''): Payload {
  const aa = encodeAscii(a, capacity(mode)), bb = mode === 'None' ? new Uint8Array(0) : encodeAscii(b, capacity(mode));
  const bytes = mode === 'None' ? [Array.from(aa)] : mode === 'FDM' ? [Array.from(aa), Array.from(bb)] : [Array.from({length:10}, (_, i) => (i % 2 ? bb : aa)[Math.floor(i / 2)])];
  return { mode, a: aa, b: bb, streams: bytes.map(s => s.flatMap(byteBits)) };
}
export interface FrameSettings { mode: Mode; decoder: boolean; offsetMs: number; floorDb: number; separationDb: number }
export interface BitDecision {
  index: number; channel: Channel; value: 0 | 1 | null; confidence: number;
  frequency: number | null; levelDb: number; separationDb: number; reason: string | null;
}
export interface DecodedByte { slot: number; channel: Channel; value: number | null; error: boolean }
export interface SpectralColumn { time: number; bins: Uint8Array }
export interface CapturedFrame {
  id: number; start: number; end: number; actualEnd: number | null;
  status: 'ARMED' | 'RECEIVING' | 'FROZEN' | 'ABORTED'; settings: FrameSettings; sampleRate: number;
  spectrum: SpectralColumn[]; decisions: BitDecision[]; bytes: DecodedByte[];
  text: Record<Channel,string>; errors: string[];
}
export function displayByte(value: number | null): string {
  return value === null ? '�' : value >= 32 && value <= 126 ? String.fromCharCode(value) : `⟨${value.toString(16).padStart(2,'0')}⟩`;
}
