import txUrl from './transmitter-worklet.ts?worker&url';
import rxUrl from './receiver-worklet.ts?worker&url';
import SpectrumWorker from '../dsp/spectrum-worker.ts?worker';
import type { AudioEvent, RxCommand, TxCommand } from './messages';
import type { FrameSettings, Payload } from '../protocol/frame';
export interface SpectrumEvent { bins:Uint8Array; timestamp:number; rate:number }
export class AudioEngine {
  context: AudioContext | null = null;
  private tx: AudioWorkletNode | null = null;
  private rx: AudioWorkletNode | null = null;
  private txGain: GainNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private silent: GainNode | null = null;
  private worker: Worker | null = null;
  private oscillator: OscillatorNode | null = null;
  private toneGain: GainNode | null = null;
  private epoch = 0;
  private initializing: Promise<void> | null = null;
  private generation = 0;
  private receiverId: number | null = null;
  onEvent: (event:AudioEvent)=>void = ()=>{};
  onSpectrum: (event:SpectrumEvent)=>void = ()=>{};
  onIssue: (message:string)=>void = ()=>{};
  onLevel: (rms:number,peak:number)=>void = ()=>{};
  get monitoring() { return this.stream !== null; }
  get rate() { return this.context?.sampleRate ?? 48000; }
  get settings() { return this.stream?.getAudioTracks()[0]?.getSettings() as (MediaTrackSettings & {latency?:number}) | undefined; }
  private async initialize(generation:number) {
    if(!window.isSecureContext)throw new Error('Audio capture requires HTTPS or localhost.');
    if(!window.AudioContext || !window.AudioWorkletNode)throw new Error('This browser needs AudioContext and AudioWorklet support. Use desktop Chrome or Chromium.');
    const ctx=new AudioContext({latencyHint:'interactive'});this.context=ctx;
    // Resume immediately within the initiating user gesture.
    await ctx.resume();
    await Promise.all([ctx.audioWorklet.addModule(txUrl),ctx.audioWorklet.addModule(rxUrl)]);
    if(generation!==this.generation || ctx!==this.context || ctx.state==='closed')throw new DOMException('Audio initialization cancelled.','AbortError');
    this.epoch=Date.now()-ctx.currentTime*1000;
    this.tx=new AudioWorkletNode(ctx,'modem-transmitter',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
    this.txGain=ctx.createGain();this.txGain.gain.value=0;this.tx.connect(this.txGain).connect(ctx.destination);
    this.tx.port.onmessage=(e:MessageEvent<AudioEvent>)=>this.onEvent(e.data);
    this.tx.onprocessorerror=()=>this.onIssue('Transmitter audio processor failed. Reload the page before retrying.');
    ctx.onstatechange=()=>{if(ctx.state==='suspended'||(ctx.state as string)==='interrupted')this.onIssue('AudioContext was suspended or interrupted. The active frame cannot keep its timing. Resume audio, then arm again.');};
  }
  async prepare() {
    if(this.context?.state==='closed')this.dispose();
    if(!this.initializing){
      const generation=this.generation;
      this.initializing=this.initialize(generation).catch(error=>{
        if(generation===this.generation)this.dispose();
        throw error;
      });
    }
    await this.initializing;
    const ctx=this.context;
    if(!ctx)throw new DOMException('Audio initialization cancelled.','AbortError');
    if(ctx.state!=='running')await ctx.resume();
    if(ctx!==this.context)throw new DOMException('Audio initialization cancelled.','AbortError');
    this.epoch=Date.now()-ctx.currentTime*1000;
  }
  /** Maps output device time when available; capture uses context-processing time. */
  startSample(timestamp:number, output=false):number {
    const ctx=this.context!;
    if(output) {
      const stamp=ctx.getOutputTimestamp?.();
      if(stamp && typeof stamp.performanceTime==='number' && typeof stamp.contextTime==='number' && stamp.performanceTime>0 && stamp.contextTime>0 && Math.abs(performance.now()-stamp.performanceTime)<1000) {
        const targetPerformance=performance.now()+(timestamp-Date.now());
        return Math.round((stamp.contextTime+(targetPerformance-stamp.performanceTime)/1000)*ctx.sampleRate);
      }
      return Math.round(((timestamp-this.epoch)/1000-(ctx.baseLatency||0))*ctx.sampleRate);
    }
    return Math.round((timestamp-this.epoch)/1000*ctx.sampleRate);
  }
  transmit(id:number,start:number,payload:Payload,volume:number) {
    this.stopTone();
    const msg:TxCommand={type:'arm',id,startFrame:this.startSample(start,true),payload,volume};
    if(msg.startFrame < Math.ceil(this.context!.currentTime*this.rate)+256)throw new Error('Too close to the minute boundary to schedule output safely. Arm again after the boundary.');
    this.txGain!.gain.setValueAtTime(1,this.context!.currentTime);this.tx!.port.postMessage(msg);
  }
  stopTransmit() {
    if(this.txGain&&this.context)this.txGain.gain.setValueAtTime(0,this.context.currentTime);
    this.tx?.port.postMessage({type:'stop'} satisfies TxCommand);
  }
  async startTone(frequency:number,volume:number) {
    await this.prepare();this.stopTransmit();this.stopTone();
    const ctx=this.context!;this.oscillator=ctx.createOscillator();this.toneGain=ctx.createGain();
    this.oscillator.frequency.value=frequency;this.toneGain.gain.value=0;
    this.oscillator.connect(this.toneGain).connect(ctx.destination);this.oscillator.start();
    this.toneGain.gain.setTargetAtTime(volume,ctx.currentTime,0.01);
  }
  updateTone(frequency:number,volume:number) {
    const ctx=this.context;if(!ctx)return;
    this.oscillator?.frequency.setTargetAtTime(frequency,ctx.currentTime,0.015);
    this.toneGain?.gain.setTargetAtTime(volume,ctx.currentTime,0.01);
  }
  /** Keep the oscillator running; key only its amplitude with a short click-free ramp. */
  keyTone(pressed:boolean,frequency:number,volume:number) {
    const ctx=this.context;if(!ctx||!this.toneGain||!this.oscillator)return;
    this.oscillator.frequency.setTargetAtTime(frequency,ctx.currentTime,0.015);
    const gain=this.toneGain.gain;
    gain.cancelAndHoldAtTime(ctx.currentTime);
    gain.linearRampToValueAtTime(pressed?volume:0,ctx.currentTime+0.005);
  }
  stopTone() {
    const osc=this.oscillator,gain=this.toneGain,ctx=this.context;
    this.oscillator=null;this.toneGain=null;
    if(osc&&gain&&ctx) {
      gain.gain.cancelScheduledValues(ctx.currentTime);gain.gain.setTargetAtTime(0,ctx.currentTime,0.003);
      osc.stop(ctx.currentTime+0.025);osc.onended=()=>{osc.disconnect();gain.disconnect();};
    }
  }
  async startMicrophone(deviceId:string) {
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone capture is unavailable. Open this page over HTTPS or localhost in Chrome.');
    await this.prepare();
    const ctx=this.context!,generation=this.generation;
    let stream:MediaStream|null=null;
    let source:MediaStreamAudioSourceNode|null=null;
    let rx:AudioWorkletNode|null=null;
    let silent:GainNode|null=null;
    let worker:Worker|null=null;
    try {
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1,...(deviceId?{deviceId:{exact:deviceId}}:{})}});
      if(generation!==this.generation || ctx!==this.context || ctx.state==='closed')throw new DOMException('Microphone activation cancelled.','AbortError');
      source=ctx.createMediaStreamSource(stream);
      rx=new AudioWorkletNode(ctx,'modem-receiver',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
      silent=ctx.createGain();silent.gain.value=0;source.connect(rx).connect(silent).connect(ctx.destination);
      worker=new SpectrumWorker();
      // Commit only after the replacement is ready: failures retain the old stream.
      this.stopMicrophone();
      this.stream=stream;this.source=source;this.rx=rx;this.silent=silent;this.worker=worker;
      worker.onmessage=(e:MessageEvent)=>{
        if(worker!==this.worker)return;
        if(e.data.type==='barrier'){if(e.data.id===this.receiverId){this.onEvent({type:'complete',id:e.data.id});this.receiverId=null;}return;}
        this.onSpectrum({bins:e.data.bins,timestamp:this.epoch+e.data.frame/e.data.rate*1000,rate:e.data.rate});
      };
      worker.onerror=()=>this.onIssue('Spectral processing failed. Stop the microphone and start it again.');
      rx.port.onmessage=(e:MessageEvent<AudioEvent>)=>{
        const data=e.data;
        if(data.type==='pcm') {
          this.onLevel(data.level,data.peak);
          worker!.postMessage(data,[data.samples.buffer]);
        } else if(data.type==='complete')worker!.postMessage({type:'barrier',id:data.id});
        else this.onEvent(data);
      };
      rx.onprocessorerror=()=>this.onIssue('Receiver audio processor failed. Stop the microphone and start it again.');
      for(const track of stream.getTracks())track.onended=()=>{this.stopMicrophone();this.onIssue('The microphone was disconnected. Partial capture has been frozen.');};
    } catch(error) {
      for(const track of stream?.getTracks()??[]){track.onended=null;track.stop();}
      source?.disconnect();rx?.port.close();rx?.disconnect();silent?.disconnect();worker?.terminate();
      throw error;
    }
  }
  receive(id:number,start:number,settings:FrameSettings) {
    if(!this.rx)throw new Error('Microphone is not running.');
    this.receiverId=id;
    this.rx.port.postMessage({type:'arm',id,startFrame:this.startSample(start),settings} satisfies RxCommand);
  }
  stopReceive() {this.receiverId=null;this.rx?.port.postMessage({type:'stop'} satisfies RxCommand);}
  stopMicrophone() {
    this.stopReceive();
    for(const track of this.stream?.getTracks()??[]){track.onended=null;track.stop();}
    this.stream=null;this.source?.disconnect();this.source=null;this.rx?.disconnect();
    if(this.rx){this.rx.port.onmessage=null;this.rx.port.close();this.rx.onprocessorerror=null;}
    this.rx=null;this.silent?.disconnect();this.silent=null;this.worker?.terminate();this.worker=null;this.onLevel(0,0);
  }
  dispose() {
    this.generation++;
    this.stopTone();this.stopTransmit();this.stopMicrophone();
    const ctx=this.context;
    if(ctx)ctx.onstatechange=null;
    this.tx?.port.close();this.tx?.disconnect();this.tx=null;
    this.txGain?.disconnect();this.txGain=null;
    this.context=null;this.initializing=null;
    if(ctx&&ctx.state!=='closed')void ctx.close().catch(()=>{});
  }
}
