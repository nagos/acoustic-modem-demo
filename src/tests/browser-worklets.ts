/** Manual browser integration check: run verifyBrowserWorklets() from the dev console.
 * OfflineAudioContext executes the production worklets without using speakers or a microphone.
 */
import { makePayload, type Mode, type Channel } from '../protocol/frame';
import txUrl from '../audio/transmitter-worklet.ts?worker&url';
import rxUrl from '../audio/receiver-worklet.ts?worker&url';
import type { AudioEvent } from '../audio/messages';
export async function verifyBrowserWorklets() {
  const results=[];
  for(const rate of [44100,48000])for(const mode of ['None','FDM','TDM'] as Mode[]) {
    results.push(await run(rate,mode,false));
  }
  results.push(await run(48000,'TDM',true));
  return results;
}
async function run(rate:number,mode:Mode,lateArm:boolean) {
  const ctx=new OfflineAudioContext(1,61*rate,rate);
  await ctx.audioWorklet.addModule(txUrl);await ctx.audioWorklet.addModule(rxUrl);
  const tx=new AudioWorkletNode(ctx,'modem-transmitter',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
  const rx=new AudioWorkletNode(ctx,'modem-receiver',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
  tx.connect(rx).connect(ctx.destination);
  const text:Record<Channel,string>={A:'',B:''};let bits=0,unknown=0,txComplete=false,rxComplete=false,samples=0;
  tx.port.onmessage=(e:MessageEvent<AudioEvent>)=>{if(e.data.type==='complete')txComplete=true;};
  rx.port.onmessage=(e:MessageEvent<AudioEvent>)=>{
    const d=e.data;
    if(d.type==='byte')text[d.byte.channel]+=d.byte.value===null?'?':String.fromCharCode(d.byte.value);
    if(d.type==='bit'){bits++;if(d.bit.value===null)unknown++;}
    if(d.type==='pcm')samples+=d.samples.length;
    if(d.type==='complete')rxComplete=true;
  };
  const a=mode==='TDM'?'HELLO':'HELLOWORLD',b=mode==='None'?'':mode==='FDM'?'DOGS__CATS':'WORLD';
  tx.port.postMessage({type:'arm',id:1,startFrame:lateArm?0:Math.round(.5*rate),payload:makePayload(mode,a,b),volume:.35});
  const arm=()=>rx.port.postMessage({type:'arm',id:1,startFrame:Math.round(.5*rate),settings:{mode,decoder:true,offsetMs:lateArm?-500:0,floorDb:-50,separationDb:6}});
  if(!lateArm)arm();
  await new Promise(r=>setTimeout(r,30));
  const suspended=lateArm?ctx.suspend(.4):null;
  const rendered=ctx.startRendering();
  if(suspended){await suspended;arm();await new Promise(r=>setTimeout(r,30));await ctx.resume();}
  await rendered;await new Promise(r=>setTimeout(r,100));
  tx.disconnect();rx.disconnect();tx.port.close();rx.port.close();
  if(text.A!==a||text.B!==b||unknown||bits!==(mode==='FDM'?160:80)||!txComplete||!rxComplete)throw new Error(`Worklet integration failed: ${JSON.stringify({rate,mode,lateArm,text,bits,unknown,txComplete,rxComplete})}`);
  return {rate,mode,lateArm,text,bits,unknown,samples,txComplete,rxComplete};
}
