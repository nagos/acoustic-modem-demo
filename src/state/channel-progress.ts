import { bitAt, capacity, owner, type CapturedFrame, type Channel, type Mode } from '../protocol/frame';

/** Snapshot for one decoder panel, independent of DOM and render timing. */
export function channelProgress(channel:Channel,frame:CapturedFrame|null,seconds:number,receiving:boolean,selectedMode:Mode) {
  const mode=frame?.settings.mode??selectedMode;
  const bit=bitAt(seconds);
  const slot=bit===null?null:Math.floor(bit/8);
  const ownsSlot=slot!==null&&(mode==='FDM'||owner(mode,slot)===channel);
  const active=receiving&&ownsSlot;
  const decisions=frame?.decisions.filter(d=>d.channel===channel)??[];
  const last=decisions.at(-1);
  // Advance with the physical clock, even before the new slot's first decision.
  // Only the inactive TDM channel (or the silent tail) holds the previous byte.
  const selectedSlot=ownsSlot?slot!:last?Math.floor(last.index/8):mode==='TDM'&&channel==='B'?1:0;
  const current=decisions.filter(d=>Math.floor(d.index/8)===selectedSlot);
  const bytes=frame?.bytes.filter(b=>b.channel===channel)??[];
  return {
    active,
    byteIndex:mode==='TDM'?Math.floor(selectedSlot/2)+1:selectedSlot+1,
    bitIndex:active?bit!%8+1:current.length,
    highlight:active?bit!%8:null,
    bits:Array.from({length:8},(_,i)=>current.find(d=>d.index%8===i)?.value),
    byte:bytes.find(b=>b.slot===selectedSlot),
    count:bytes.length,
    capacity:capacity(mode),
    confidence:last?.confidence??null,
    text:frame?.text[channel]??'',
  };
}
