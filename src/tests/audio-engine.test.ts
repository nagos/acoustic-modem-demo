import { afterEach,beforeEach,describe,it,vi } from 'vitest';
import assert from 'node:assert/strict';
import { AudioEngine } from '../audio/audio-engine';

vi.mock('../dsp/spectrum-worker.ts?worker',()=>({default:class {
  onmessage:unknown=null;onerror:unknown=null;
  postMessage=vi.fn();terminate=vi.fn();
}}));
class Node {
  gain={value:0,setValueAtTime:vi.fn(),setTargetAtTime:vi.fn()};
  connect(node:Node){return node;}
  disconnect=vi.fn();
}
class Worklet extends Node {
  port={onmessage:null,postMessage:vi.fn(),close:vi.fn()};
  onprocessorerror:unknown=null;
}
class Context {
  static instances:Context[]=[];
  static load:Promise<void>|null=null;
  state='suspended';currentTime=0;sampleRate=48000;onstatechange:unknown=null;
  destination=new Node();audioWorklet={addModule:vi.fn(()=>Context.load??Promise.resolve())};
  constructor(){Context.instances.push(this);}
  async resume(){if(this.state==='closed')throw new DOMException('Closed','InvalidStateError');this.state='running';}
  async close(){this.state='closed';}
  createGain(){return new Node();}
  createMediaStreamSource=vi.fn(()=>new Node());
}
function microphone(id:string){
  const track={readyState:'live',onended:null,stop:vi.fn(()=>{track.readyState='ended'}),getSettings:()=>({deviceId:id})};
  return {track,stream:{getTracks:()=>[track],getAudioTracks:()=>[track]} as unknown as MediaStream};
}
let getUserMedia:ReturnType<typeof vi.fn>;
const engines:AudioEngine[]=[];
function engine(){const value=new AudioEngine();engines.push(value);return value;}
beforeEach(()=>{
  Context.instances=[];Context.load=null;getUserMedia=vi.fn();
  vi.stubGlobal('window',{isSecureContext:true,AudioContext:Context,AudioWorkletNode:Worklet});
  vi.stubGlobal('AudioContext',Context);vi.stubGlobal('AudioWorkletNode',Worklet);
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
});
afterEach(()=>{for(const item of engines.splice(0))item.dispose();vi.unstubAllGlobals();});
describe('audio lifecycle and microphone recovery',()=>{
  it('creates a fresh context after disposal',async()=>{
    const audio=engine();await audio.prepare();const first=audio.context!;audio.dispose();
    assert.equal(first.state,'closed');assert.equal(audio.context,null);
    await audio.prepare();assert.notEqual(audio.context,first);assert.equal(audio.context!.state,'running');
  });
  it('recovers if the underlying context was closed externally',async()=>{
    const audio=engine();await audio.prepare();const first=audio.context!;await first.close();
    await audio.prepare();assert.notEqual(audio.context,first);assert.equal(audio.context!.state,'running');
  });
  it('cleans a failed module load and permits a fresh initialization',async()=>{
    const audio=engine();Context.load=Promise.reject(new Error('Module unavailable'));
    await assert.rejects(audio.prepare(),/Module unavailable/);assert.equal(audio.context,null);assert.equal(Context.instances[0].state,'closed');
    Context.load=null;await audio.prepare();assert.equal(audio.context!.state,'running');
  });
  it('retains the working microphone when the replacement is unavailable',async()=>{
    const audio=engine(),old=microphone('old');getUserMedia.mockResolvedValueOnce(old.stream);
    await audio.startMicrophone('old');getUserMedia.mockRejectedValueOnce(new DOMException('Busy','NotReadableError'));
    await assert.rejects(audio.startMicrophone('other'),{name:'NotReadableError'});
    assert.equal(audio.monitoring,true);assert.equal(audio.settings?.deviceId,'old');assert.equal(old.track.readyState,'live');assert.equal(old.track.stop.mock.calls.length,0);
  });
  it('cleans failed replacement resources without stopping the old microphone',async()=>{
    const audio=engine(),old=microphone('old'),next=microphone('next');
    getUserMedia.mockResolvedValueOnce(old.stream);await audio.startMicrophone('old');
    Context.instances[0].createMediaStreamSource.mockImplementationOnce(()=>{throw new Error('Cannot build graph')});
    getUserMedia.mockResolvedValueOnce(next.stream);await assert.rejects(audio.startMicrophone('next'),/Cannot build graph/);
    assert.equal(next.track.readyState,'ended');assert.equal(old.track.readyState,'live');assert.equal(audio.settings?.deviceId,'old');
  });
  it('ends the old track only after a successful replacement',async()=>{
    const audio=engine(),old=microphone('old'),next=microphone('next');
    getUserMedia.mockResolvedValueOnce(old.stream);await audio.startMicrophone('old');
    getUserMedia.mockImplementationOnce(()=>{assert.equal(old.track.readyState,'live');return Promise.resolve(next.stream)});
    await audio.startMicrophone('next');assert.equal(old.track.readyState,'ended');assert.equal(next.track.readyState,'live');assert.equal(audio.settings?.deviceId,'next');
  });
  it('leaves the engine retryable after initial permission denial',async()=>{
    const audio=engine();getUserMedia.mockRejectedValueOnce(new DOMException('Denied','NotAllowedError'));
    await assert.rejects(audio.startMicrophone(''),{name:'NotAllowedError'});assert.equal(audio.monitoring,false);
    getUserMedia.mockResolvedValueOnce(microphone('retry').stream);await audio.startMicrophone('retry');assert.equal(audio.monitoring,true);
  });
  it('closes a late permission result without overwriting a new context',async()=>{
    const audio=engine(),late=microphone('late');let resolve!:(stream:MediaStream)=>void;
    getUserMedia.mockImplementationOnce(()=>new Promise<MediaStream>(r=>{resolve=r}));
    const pending=audio.startMicrophone('late');
    while(!resolve)await Promise.resolve();
    const rejected=assert.rejects(pending,{name:'AbortError'});
    audio.dispose();await audio.prepare();const restored=audio.context;
    resolve(late.stream);await rejected;
    assert.equal(late.track.readyState,'ended');assert.equal(audio.monitoring,false);assert.equal(audio.context,restored);assert.equal(restored!.state,'running');
  });
  it('does not let an old initialization dispose a restored engine',async()=>{
    const audio=engine();let finish!:()=>void;Context.load=new Promise<void>(r=>{finish=r});
    const pending=audio.prepare(),rejected=assert.rejects(pending,{name:'AbortError'});
    while(Context.instances[0].audioWorklet.addModule.mock.calls.length===0)await Promise.resolve();
    audio.dispose();Context.load=null;await audio.prepare();const restored=audio.context;
    finish();await rejected;assert.equal(audio.context,restored);assert.equal(restored!.state,'running');
  });
});
