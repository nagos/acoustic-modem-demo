import { spectrum } from './fft';
const size=4096;
let ring=new Float32Array(size),used=0,hop=0,expected=-1;
self.onmessage=(event:MessageEvent)=>{
  if(event.data.type==='barrier'){self.postMessage(event.data);return;}
  const {samples,firstFrame,rate}=event.data;
  if(expected!==firstFrame){ring=new Float32Array(size);used=0;hop=0;}
  expected=firstFrame+samples.length;
  for(let i=0;i<samples.length;i++) {
    ring[used%size]=samples[i];used++;hop++;
    if(used>=size&&hop>=Math.round(rate/30)) {
      hop=0;
      const window=new Float32Array(size),pos=used%size;
      window.set(ring.subarray(pos));window.set(ring.subarray(0,pos),size-pos);
      const db=spectrum(window);
      const bins=Uint8Array.from(db,v=>Math.max(0,Math.min(255,Math.round((v+100)/100*255))));
      self.postMessage({type:'spectrum',bins,frame:firstFrame+i-size/2,rate}, {transfer:[bins.buffer]});
    }
  }
};
