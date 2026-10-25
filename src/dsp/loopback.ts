import { makePayload, displayByte, type FrameSettings, type Mode } from '../protocol/frame';
import { FskModulator } from './fsk-modulator';
import { FskDemodulator } from './fsk-demodulator';
export interface LoopbackOptions { mode:Mode; a:string; b:string; rate?:number; noise?:number; offsetMs?:number; delayMs?:number }
export function loopback(options:LoopbackOptions) {
  const {mode,a,b,rate=48000,noise=0,offsetMs=0,delayMs=0}=options;
  const settings:FrameSettings={mode,decoder:true,offsetMs,floorDb:-50,separationDb:6};
  const mod=new FskModulator(makePayload(mode,a,b),rate);
  const demod=new FskDemodulator(settings,rate);
  let seed=48271;
  const delay=Math.round(delayMs/1000*rate);
  for(let first=-Math.round(rate*0.5);first<60*rate;first+=1024) {
    const block=mod.render(first-delay,Math.min(1024,60*rate-first));
    if(noise) for(let j=0;j<block.length;j++){seed=(seed*16807)%2147483647;block[j]+=(seed/2147483647*2-1)*noise;}
    demod.process(block,first);
  }
  const text={A:'',B:''};for(const byte of demod.bytes)text[byte.channel]+=displayByte(byte.value);
  return {text,decisions:demod.decisions,bytes:demod.bytes};
}
