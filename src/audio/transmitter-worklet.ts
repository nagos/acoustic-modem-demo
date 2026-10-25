import { FskModulator } from '../dsp/fsk-modulator';
import type { TxCommand } from './messages';
class TransmitterProcessor extends AudioWorkletProcessor {
  private modulator: FskModulator | null = null;
  private start = 0;
  private id = 0;
  private started = false;
  constructor() {
    super();
    this.port.onmessage = (event:MessageEvent<TxCommand>) => {
      const msg=event.data;
      if(msg.type==='stop') {this.modulator=null;return;}
      this.start=msg.startFrame;this.id=msg.id;this.started=false;
      this.modulator=new FskModulator(msg.payload,sampleRate,msg.volume);
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out=outputs[0]?.[0];if(!out)return true;
    out.fill(0);
    if(!this.modulator)return true;
    for(let i=0;i<out.length;i++) {
      const relative=currentFrame+i-this.start;
      if(relative>=0&&!this.started){this.started=true;this.port.postMessage({type:'started',id:this.id});}
      if(relative>=Math.round(60*sampleRate)) {this.port.postMessage({type:'complete',id:this.id});this.modulator=null;break;}
      out[i]=this.modulator.sample(relative);
    }
    return true;
  }
}
registerProcessor('modem-transmitter',TransmitterProcessor);
