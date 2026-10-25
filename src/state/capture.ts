import { displayByte, type BitDecision, type CapturedFrame, type DecodedByte, type SpectralColumn } from '../protocol/frame';
export const collecting = (frame:CapturedFrame) => frame.status==='ARMED'||frame.status==='RECEIVING';
export function recordBit(frame:CapturedFrame,id:number,bit:BitDecision):boolean {
  if(frame.id!==id||!collecting(frame))return false;
  if(frame.decisions.some(d=>d.index===bit.index&&d.channel===bit.channel))return false;
  frame.decisions.push(bit);return true;
}
export function recordByte(frame:CapturedFrame,id:number,byte:DecodedByte):boolean {
  if(frame.id!==id||!collecting(frame))return false;
  if(frame.bytes.some(b=>b.slot===byte.slot&&b.channel===byte.channel))return false;
  frame.bytes.push(byte);frame.text[byte.channel]+=displayByte(byte.value);
  if(byte.error)frame.errors.push(`Channel ${byte.channel}, slot ${byte.slot+1}: ${byte.value===null?'unknown bits':'nonprintable ASCII'}`);
  return true;
}
export function recordSpectrum(frame:CapturedFrame,timestamp:number,bins:Uint8Array):SpectralColumn|null {
  if(!collecting(frame)||timestamp<frame.start||timestamp>=frame.end)return null;
  const column={time:(timestamp-frame.start)/1000,bins};frame.spectrum.push(column);return column;
}
export function finishCapture(frame:CapturedFrame,aborted:boolean,now:number):boolean {
  if(!collecting(frame))return false;
  frame.status=aborted?'ABORTED':'FROZEN';frame.actualEnd=aborted?now:frame.end;
  if(aborted)frame.errors.push('Capture stopped before the full frame completed.');
  return true;
}
