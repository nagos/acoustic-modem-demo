import { FskDemodulator } from '../dsp/fsk-demodulator';
import type { RxCommand } from './messages';
class ReceiverProcessor extends AudioWorkletProcessor {
  private decoder: FskDemodulator | null = null;
  private start = 0;
  private id: number | null = null;
  private started = false;
  private buffer = new Float32Array(2048);
  private used = 0;
  private first = 0;
  private squares = 0;
  private peak = 0;
  private history = new Float32Array(Math.ceil(sampleRate * 0.5));
  private historyHead = 0;
  private historyCount = 0;
  private historyEnd = 0;
  constructor() {
    super();
    this.port.onmessage=(event:MessageEvent<RxCommand>)=>{
      const msg=event.data;
      if(msg.type==='stop'){this.decoder=null;this.id=null;return;}
      this.start=msg.startFrame;this.id=msg.id;this.started=false;
      this.decoder=msg.settings.decoder ? new FskDemodulator(msg.settings,sampleRate,
        bit=>this.port.postMessage({type:'bit',id:this.id,bit}),
        byte=>this.port.postMessage({type:'byte',id:this.id,byte})) : null;
      if(this.decoder&&this.historyCount){
        const previous=new Float32Array(this.historyCount);
        const first=(this.historyHead-this.historyCount+this.history.length)%this.history.length;
        for(let i=0;i<previous.length;i++)previous[i]=this.history[(first+i)%this.history.length];
        this.decoder.process(previous,this.historyEnd-this.historyCount-this.start);
      }
    };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    for(const channel of outputs[0]??[])channel.fill(0);
    const input=inputs[0];
    const length=input?.[0]?.length ?? outputs[0]?.[0]?.length ?? 128;
    // No input is represented by silence; disconnected tracks are also handled by the main thread.
    const mono=new Float32Array(length);
    if(input?.length) for(let i=0;i<length;i++){for(const c of input)mono[i]+=c[i]/input.length;}
    if(this.id!==null) {
      if(currentFrame+length>this.start&&!this.started){this.started=true;this.port.postMessage({type:'started',id:this.id});}
      this.decoder?.process(mono,currentFrame-this.start);

    }
    for(let i=0;i<length;i++) {
      this.history[this.historyHead]=mono[i];this.historyHead=(this.historyHead+1)%this.history.length;
      this.historyCount=Math.min(this.history.length,this.historyCount+1);
      if(this.used===0)this.first=currentFrame+i;
      const x=mono[i];this.buffer[this.used++]=x;this.squares+=x*x;this.peak=Math.max(this.peak,Math.abs(x));
      if(this.used===this.buffer.length) {
        this.port.postMessage({type:'pcm',samples:this.buffer,firstFrame:this.first,rate:sampleRate,level:Math.sqrt(this.squares/this.used),peak:this.peak},[this.buffer.buffer]);
        this.buffer=new Float32Array(2048);this.used=0;this.squares=0;this.peak=0;
      }
    }
    this.historyEnd=currentFrame+length;
    if(this.id!==null&&currentFrame+length>=this.start+60*sampleRate) {
      if(this.used) {
        const samples=this.buffer.slice(0,this.used);
        this.port.postMessage({type:'pcm',samples,firstFrame:this.first,rate:sampleRate,level:Math.sqrt(this.squares/this.used),peak:this.peak},[samples.buffer]);
        this.used=0;this.squares=0;this.peak=0;
      }
      this.port.postMessage({type:'complete',id:this.id});this.id=null;this.decoder=null;
    }
    return true;
  }
}
registerProcessor('modem-receiver',ReceiverProcessor);
