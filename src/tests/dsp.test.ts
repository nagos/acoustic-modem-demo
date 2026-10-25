import { describe,it } from 'vitest';
import assert from 'node:assert/strict';
import { FskModulator } from '../dsp/fsk-modulator';
import { FskDemodulator } from '../dsp/fsk-demodulator';
import { Goertzel } from '../dsp/goertzel';
import { spectrum } from '../dsp/fft';
import { loopback } from '../dsp/loopback';
import { makePayload, type FrameSettings } from '../protocol/frame';
const settings:FrameSettings={mode:'FDM',decoder:true,offsetMs:0,floorDb:-50,separationDb:6};
const power=(samples:Float32Array,hz:number,rate=48000)=>{const g=new Goertzel(hz,rate);for(const s of samples)g.push(s);return g.power();};
describe('real PCM modulation and frequency measurement',()=>{
  it('generates simultaneous independent FDM sine waves without clipping',()=>{
    const m=new FskModulator(makePayload('FDM','@',' '),48000,0.8);
    const pcm=m.render(0,48000*.65).subarray(4800);
    assert.ok(power(pcm,1200)>power(pcm,1600)*100);assert.ok(power(pcm,2800)>power(pcm,3200)*100);
    assert.ok(power(pcm,1200)>1);assert.ok(power(pcm,2800)>1);
    assert.ok(pcm.every(s=>Math.abs(s)<=.800001));
  });
  it('changes the FSK frequency at a bit boundary without resetting phase',()=>{
    const m=new FskModulator(makePayload('TDM','@',''),48000);
    const all=m.render(0,48000*1.4);
    assert.ok(power(all.subarray(4800,24000),1200)>power(all.subarray(4800,24000),1600)*100);
    assert.ok(power(all.subarray(38400,60000),1600)>power(all.subarray(38400,60000),1200)*100);
    assert.ok(Math.abs(all[33600]-all[33599])<0.1);
  });
  it('ramps only the payload edges and emits silence outside 56 seconds',()=>{
    const m=new FskModulator(makePayload('TDM','HELLO','WORLD'),44100);
    assert.equal(m.sample(-1),0);assert.equal(m.sample(0),0);assert.equal(m.sample(56*44100),0);assert.equal(m.sample(59*44100),0);
    const start=m.render(0,220);assert.ok(Math.abs(start[1])<.001);
  });
  it('locates an actual tone with a Hann-windowed FFT',()=>{
    const pcm=Float32Array.from({length:4096},(_,i)=>.5*Math.sin(2*Math.PI*1600*i/48000));
    const db=spectrum(pcm);let peak=0;for(let i=1;i<db.length;i++)if(db[i]>db[peak])peak=i;
    assert.ok(Math.abs(peak*48000/4096-1600)<12);assert.ok(db[peak]>-9&&db[peak]<-5);
  });
});
describe('streaming PCM demodulation',()=>{
  for(const rate of [44100,48000])for(const mode of ['None','FDM','TDM'] as const){
    it(`decodes the complete ${mode} frame at ${rate} Hz, with no text shortcuts`,()=>{
      const a=mode==='TDM'?'HELLO':'HELLOWORLD',b=mode==='None'?'':mode==='FDM'?'DOGS__CATS':'WORLD';
      const result=loopback({mode,a,b,rate});assert.equal(result.text.A,a);assert.equal(result.text.B,b);
      assert.equal(result.decisions.length,mode==='FDM'?160:80);assert.equal(result.bytes.length,mode==='FDM'?20:10);assert.ok(result.bytes.every(b=>!b.error));
    });
  }
  it('decodes a padded single message in noise with no phantom channel B data',()=>{
    const r=loopback({mode:'None',a:'SINGLE',b:'ignored',noise:0.15});
    assert.equal(r.text.A,'SINGLE    ');assert.equal(r.text.B,'');
    assert.equal(r.decisions.length,80);assert.equal(r.bytes.length,10);
    assert.ok(r.decisions.every(d=>d.channel==='A'&&d.value!==null));assert.ok(r.bytes.every(b=>b.channel==='A'&&!b.error));
  });
  it('decodes moderate seeded broadband noise and space padding',()=>{
    const result=loopback({mode:'FDM',a:'HI',b:'OK',noise:0.15});assert.equal(result.text.A,'HI        ');assert.equal(result.text.B,'OK        ');
  });
  it('demultiplexes TDM characters in physical slot order',()=>{
    const result=loopback({mode:'TDM',a:'HELLO',b:'WORLD',noise:.05});
    assert.deepEqual(result.bytes.map(b=>b.channel),['A','B','A','B','A','B','A','B','A','B']);
    assert.equal(result.bytes.map(b=>String.fromCharCode(b.value!)).join(''),'HWEOLRLLOD');
  });
  for(const offsetMs of [-500,-150,150,500])it(`compensates a ${offsetMs} ms sample delay without cumulative timing drift`,()=>{
    const result=loopback({mode:'TDM',a:'HELLO',b:'WORLD',offsetMs,delayMs:offsetMs});
    assert.equal(result.text.A,'HELLO');assert.equal(result.text.B,'WORLD');
  });
  it('marks silence unknown instead of inventing zero bits',()=>{
    const d=new FskDemodulator(settings,48000);d.process(new Float32Array(48000),0);
    assert.equal(d.decisions.length,2);assert.ok(d.decisions.every(b=>b.value===null&&b.reason==='Below signal threshold'));
  });
  it('rejects equally strong candidate tones with insufficient separation',()=>{
    const d=new FskDemodulator(settings,48000);
    d.process(Float32Array.from({length:48000},(_,i)=>.2*Math.sin(2*Math.PI*1200*i/48000)+.2*Math.sin(2*Math.PI*1600*i/48000)),0);
    assert.equal(d.decisions[0].value,null);assert.equal(d.decisions[0].reason,'Ambiguous frequencies');
  });
  it('does not claim a valid bit when samples are missing',()=>{
    const d=new FskDemodulator(settings,48000);d.process(new Float32Array(128),48000);
    assert.ok(d.decisions.every(b=>b.value===null&&b.reason==='Missing audio samples'));
  });
  it('is independent of processing-block boundaries and delays bytes until the slot ends',()=>{
    const m=new FskModulator(makePayload('TDM','A','B'),44100),d=new FskDemodulator({...settings,mode:'TDM'},44100);
    const sizes=[127,256,333,128,19];let first=0,index=0;
    const end=Math.round(5.6*44100);
    while(first<end){const len=Math.min(sizes[index++%sizes.length],end-first);d.process(m.render(first,len),first);first+=len;}
    assert.equal(d.decisions.length,8);assert.equal(d.bytes.length,0);
    d.process(m.render(first,128),first);assert.equal(d.bytes.length,1);assert.equal(d.bytes[0].value,65);
  });
});
