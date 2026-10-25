import './styles.css';
import { AudioEngine } from './audio/audio-engine';
import { capacity, makePayload, nextMinute, validateAscii, FREQUENCIES, type CapturedFrame, type FrameSettings, type Mode, type Payload } from './protocol/frame';
import { TransmitterState, ReceiverState } from './state/machines';
import { RollingSpectrum } from './state/rolling-spectrum';
import { recordBit, recordByte, recordSpectrum, finishCapture } from './state/capture';
import { SpectrogramView, SPECTRUM_MIN_DBFS, SPECTRUM_MAX_DBFS } from './ui/spectrogram-view';
import { mountChannels, updateChannel } from './ui/channel-view';
import LoopbackWorker from './dsp/loopback-worker.ts?worker';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
mountChannels($('channels'));
$('spectrum-min-level').textContent=String(SPECTRUM_MIN_DBFS);
$('spectrum-max-level').textContent=`${SPECTRUM_MAX_DBFS} dBFS`;
const engine=new AudioEngine(),tx=new TransmitterState(),rx=new ReceiverState();
const spectrogram=new SpectrogramView($<HTMLCanvasElement>('spectrogram'));
let role:'TX'|'RX'='TX',txMode:'modem'|'tone'='modem',toneRunning=false,morseEnabled=false,morseReady=false,morsePressed=false,busy=false,id=0,txId=0;
let payload:Payload|null=null,frame:CapturedFrame|null=null;
let receiverMode:'spectrogram'|'decoder'='spectrogram';
let frameVisible=false;
const rolling=new RollingSpectrum();
let displayed:CapturedFrame|null|undefined=undefined;
let actionGeneration=0;
let lastUi=0,clockDelta=Date.now()-performance.now();
let loopWorker:Worker|null=null;
const text=(name:string,value:string)=>{$(name).textContent=value;};
const hide=(name:string,value:boolean)=>{$(name).hidden=value;};
const optionalText=(name:string,value:string)=>{text(name,value);hide(name,!value);};
const number=(name:string)=>Number($<HTMLInputElement>(name).value);
const mode=(name:string)=>$<HTMLSelectElement>(name).value as Mode;
const activeTx=()=>tx.state==='ARMED'||tx.state==='TRANSMITTING';
const activeRx=()=>rx.state==='ARMED'||rx.state==='RECEIVING';
const decoderEnabled=()=>receiverMode==='decoder';
const shownFrame=()=>frameVisible?frame:null;
function notify(message:string){text('notice',message);hide('notice',!message);}
function errorMessage(error:unknown):string {
  if(error instanceof DOMException){if(error.name==='NotAllowedError')return 'Microphone permission was denied. Allow microphone access in the address bar, then try again.';if(error.name==='NotFoundError')return 'No microphone is available. Connect or enable an audio input.';if(error.name==='NotReadableError')return 'The microphone could not be opened. Check whether another application is using it.';if(error.name==='OverconstrainedError')return 'The selected microphone is unavailable. Choose another input.';}
  return error instanceof Error?error.message:String(error);
}
async function action(fn:(current:()=>boolean)=>Promise<void>|void){
  if(busy)return;
  const generation=actionGeneration,current=()=>generation===actionGeneration;
  busy=true;refresh();notify('');
  try {await fn(current);}
  catch(error){if(current()){if(role==='RX'){if(!engine.monitoring)rolling.stop();showMicSettings();}notify(errorMessage(error));}}
  finally {if(current()){busy=false;refresh();}}
}
function validate(){
  const m=mode('tx-mode'),limit=capacity(m);let valid=true;
  for(const c of ['a','b']) {
    const input=$<HTMLInputElement>(`message-${c}`),error=m==='None'&&c==='b'?null:validateAscii(input.value,limit);
    text(`count-${c}`,`${input.value.length} / ${limit}`);text(`validation-${c}`,error??'');input.setAttribute('aria-invalid',String(!!error));valid&&=!error;
  }
  return valid;
}
function refresh(){
  const txActive=activeTx(),rxActive=activeRx();
  for(const name of ['role-tx','role-rx','tab-modem','tab-tone','rx-tab-spectrogram','rx-tab-decoder'])$<HTMLButtonElement>(name).disabled=busy;
  for(const name of ['tx-mode','message-a','message-b','modem-volume'])$<HTMLInputElement>(name).disabled=txActive||busy;
  const singleTx=mode('tx-mode')==='None';
  $<HTMLInputElement>('message-b').disabled=txActive||busy||singleTx;
  $<HTMLInputElement>('message-b').closest<HTMLElement>('label')!.hidden=singleTx;
  $('message-a').closest('.message-grid')!.classList.toggle('single-channel',singleTx);
  text('message-a-title',singleTx?'● MESSAGE':'● CHANNEL A');
  text('tx-air-label',singleTx?'ON AIR':'ON AIR · A / B');
  for(const name of ['rx-mode','rx-offset','rx-floor','rx-separation','mic-device'])$<HTMLInputElement>(name).disabled=rxActive||busy;
  $<HTMLButtonElement>('tx-arm').disabled=busy||!validate();
  $<HTMLButtonElement>('rx-arm').disabled=busy;
  $<HTMLButtonElement>('tone-toggle').disabled=busy||morseEnabled;
  $<HTMLButtonElement>('morse-toggle').disabled=busy;
  $<HTMLButtonElement>('mic-stop').disabled=busy;
  hide('tx-arm',txActive);hide('tx-disarm',tx.state!=='ARMED');hide('tx-stop',tx.state!=='TRANSMITTING');
  hide('rx-arm',rxActive||!decoderEnabled());hide('rx-disarm',rx.state!=='ARMED');hide('rx-stop',rx.state!=='RECEIVING');
  text('tx-arm',tx.state==='COMPLETE'||tx.state==='ABORTED'?'◎ Arm again':'◎ Arm transmitter');
  text('rx-arm',rx.state==='FROZEN'||rx.state==='ABORTED'?'◎ Arm again':'◎ Arm receiver');
  text('tx-state',tx.state);text('rx-state',shownFrame()?rx.state:rolling.state==='RUNNING'?'LIVE':rolling.state);
  $('tx-state').className=`status ${tx.state.toLowerCase()}`;$('rx-state').className=`status ${shownFrame()?rx.state.toLowerCase():rolling.state.toLowerCase()}`;
  hide('export-frame',!decoderEnabled()||!frame||!['FROZEN','ABORTED'].includes(frame.status));
  const decoder=decoderEnabled();
  for(const [name,selected]of [['rx-tab-spectrogram',!decoder],['rx-tab-decoder',decoder]] as const){$(name).classList.toggle('selected',selected);$(name).setAttribute('aria-pressed',String(selected));}
  hide('rx-show-frame',!decoder||!frame||activeRx()||frameVisible);

  const singleRx=(frame?.settings.mode??mode('rx-mode'))==='None';
  hide('channel-B',singleRx);$('channels').classList.toggle('single-channel',singleRx);
  $('channel-A').querySelector('h3')!.lastChild!.textContent=singleRx?'Message':'Channel A';
  hide('mic-stop',!decoder||!engine.monitoring);hide('spectrum-controls',decoder);hide('channels',!decoder);
  if(!shownFrame())optionalText('inspection','');
  text('rx-control-title',decoder?'One-shot frame capture':'Continuous spectrogram');
  for(const el of $('rx-control-title').closest('.decoder-controls')!.querySelectorAll<HTMLElement>('.decoder-settings,.threshold-settings'))el.hidden=!decoder;
  $<HTMLButtonElement>('spectrum-start').disabled=busy||activeRx()||(!frameVisible&&rolling.state==='RUNNING');
  $<HTMLButtonElement>('spectrum-freeze').disabled=busy||activeRx()||frameVisible||rolling.state!=='RUNNING';
  $<HTMLButtonElement>('spectrum-stop').disabled=busy||!engine.monitoring;
}
function updateMorseUi(){
  text('morse-toggle',`Morse key · ${morseEnabled?'ON':'OFF'}`);
  $('morse-toggle').setAttribute('aria-pressed',String(morseEnabled));
  $('morse-toggle').classList.toggle('selected',morseEnabled);
  hide('morse-help',!morseEnabled);hide('morse-status',!morseEnabled);
  text('morse-status',!morseReady?'PREPARING':morsePressed?'KEY DOWN · ON AIR':'KEY UP · SILENT');
  $('morse-status').classList.toggle('transmitting',morsePressed);
  $('tone-view').classList.toggle('key-down',morsePressed);
}
function releaseMorse(){
  morsePressed=false;
  if(morseEnabled)engine.keyTone(false,number('tone-slider'),number('tone-volume'));
  updateMorseUi();
}
function stopTone(){
  releaseMorse();engine.stopTone();toneRunning=false;morseEnabled=false;morseReady=false;
  text('tone-toggle','▶ Start tone');updateMorseUi();
}
function abortTx(){if(activeTx())tx.stop();engine.stopTransmit();refresh();}
function freeze(aborted:boolean){
  if(!frame||!activeRx())return;
  if(aborted)rx.stop();else rx.tick(frame.end);
  finishCapture(frame,aborted,Date.now());
  engine.stopReceive();refresh();
}
function selectRole(next:'TX'|'RX') {
  if(role===next)return;stopTone();abortTx();if(activeRx())freeze(true);engine.stopMicrophone();rolling.stop();
  role=next;document.body.classList.toggle('receiver-active',next==='RX');hide('tx-view',next!=='TX');hide('rx-view',next!=='RX');hide('rx-modes',next!=='RX');
  for(const [name,value]of [['role-tx',next==='TX'],['role-rx',next==='RX']] as const){$(name).classList.toggle('selected',value);$(name).setAttribute('aria-pressed',String(value));}
  text('mic-state','No microphone active');refresh();
}
$('role-tx').onclick=()=>selectRole('TX');$('role-rx').onclick=()=>selectRole('RX');
function selectTxMode(next:'modem'|'tone'){if(txMode===next)return;stopTone();abortTx();txMode=next;hide('tone-view',next!=='tone');hide('modem-view',next!=='modem');$('tab-tone').classList.toggle('selected',next==='tone');$('tab-modem').classList.toggle('selected',next==='modem');}
$('tab-tone').onclick=()=>selectTxMode('tone');$('tab-modem').onclick=()=>selectTxMode('modem');
function frequencyChanged(source:string){const n=number(source);if(!Number.isFinite(n)||n<200||n>5000)return;const value=Math.round(n);$<HTMLInputElement>('tone-slider').value=String(value);$<HTMLInputElement>('tone-number').value=String(value);text('tone-hz',String(value));engine.updateTone(value,morseEnabled&&!morsePressed?0:number('tone-volume'));}
$('tone-slider').oninput=()=>frequencyChanged('tone-slider');$('tone-number').oninput=()=>frequencyChanged('tone-number');
$('tone-volume').oninput=()=>{text('tone-volume-label',`${Math.round(number('tone-volume')*100)}%`);frequencyChanged('tone-slider');};
$('tone-toggle').onclick=()=>void action(async current=>{if(toneRunning)stopTone();else{await engine.startTone(number('tone-slider'),number('tone-volume'));if(current()){toneRunning=true;text('tone-toggle','■ Stop tone');}}});
$('morse-toggle').onclick=()=>void action(async current=>{
  if(morseEnabled){stopTone();return;}
  stopTone();morseEnabled=true;updateMorseUi();
  try {await engine.startTone(number('tone-slider'),0);if(current()){morseReady=true;updateMorseUi();}}
  catch(error){if(current())stopTone();throw error;}
});
function onMorseKeyDown(event:KeyboardEvent){
  if(event.code!=='Space'||!morseEnabled||!morseReady||role!=='TX'||txMode!=='tone'||event.ctrlKey||event.altKey||event.metaKey)return;
  const target=event.target;
  if(target instanceof HTMLElement&&(target.isContentEditable||target.closest('input,textarea,select,[role="textbox"]')))return;
  event.preventDefault();
  if(event.repeat||morsePressed)return;
  morsePressed=true;engine.keyTone(true,number('tone-slider'),number('tone-volume'));updateMorseUi();
}
function onMorseKeyUp(event:KeyboardEvent){if(event.code==='Space'&&morsePressed){event.preventDefault();releaseMorse();}}
const onMorseVisibility=()=>{if(document.hidden)releaseMorse();};
window.addEventListener('keydown',onMorseKeyDown,true);
window.addEventListener('keyup',onMorseKeyUp,true);
window.addEventListener('blur',releaseMorse);
document.addEventListener('focusin',releaseMorse);
document.addEventListener('visibilitychange',onMorseVisibility);
$('modem-volume').oninput=()=>text('modem-volume-label',`${Math.round(number('modem-volume')*100)}%`);
for(const c of ['a','b'])$(`message-${c}`).oninput=()=>refresh();
$('tx-mode').onchange=()=>{
  const m=mode('tx-mode');
  text('tx-freq-b',m==='FDM'?'0 → 2800 Hz   1 → 3200 Hz':'Shared: 0 → 1200 Hz   1 → 1600 Hz');
  text('tx-snapshot','');refresh();
};
$('tx-arm').onclick=()=>void action(async current=>{
  if(!validate())throw new Error('Correct both message inputs before arming.');
  const snapshot=makePayload(mode('tx-mode'),$<HTMLInputElement>('message-a').value,$<HTMLInputElement>('message-b').value);
  await engine.prepare();if(!current())return;stopTone();payload=snapshot;txId=++id;
  const start=nextMinute(Date.now());engine.transmit(txId,start,payload,number('modem-volume'));tx.arm(start);
  text('tx-snapshot',payload.mode==='None'?`Snapshot · ${JSON.stringify(String.fromCharCode(...payload.a))}`:`Snapshot · A ${JSON.stringify(String.fromCharCode(...payload.a))} · B ${JSON.stringify(String.fromCharCode(...payload.b))}`);
});
$('tx-disarm').onclick=()=>{engine.stopTransmit();tx.disarm();refresh();};$('tx-stop').onclick=abortTx;
async function listMicrophones(){
  if(!navigator.mediaDevices?.enumerateDevices)return;
  const select=$<HTMLSelectElement>('mic-device'),previous=select.value;
  const devices=await navigator.mediaDevices.enumerateDevices();select.replaceChildren(new Option('System default',''));
  devices.filter(d=>d.kind==='audioinput').forEach((d,i)=>select.add(new Option(d.label||`Microphone ${i+1}`,d.deviceId)));
  if(Array.from(select.options).some(o=>o.value===previous))select.value=previous;
}
function showMicSettings(){
  const s=engine.settings;
  text('mic-settings',s?`Sample rate: ${engine.rate} Hz · Input channels: ${s.channelCount??'unknown'} · Input latency: ${s.latency===undefined?'not reported':(s.latency*1000).toFixed(1)+' ms'} · Echo cancellation: ${s.echoCancellation??'not reported'} · Noise suppression: ${s.noiseSuppression??'not reported'} · Automatic gain: ${s.autoGainControl??'not reported'}`:'Microphone stopped; all tracks released.');
  text('mic-state',engine.monitoring?'Listening · local PCM processing':'No microphone active');
  if(s&&(s.echoCancellation||s.noiseSuppression||s.autoGainControl))notify('The microphone reports automatic audio processing enabled. Disable it in your operating system or choose another microphone for reliable FSK.');
}
$('mic-stop').onclick=()=>{
  if(activeRx())freeze(true);
  rolling.stop();engine.stopMicrophone();showMicSettings();refresh();
};
$('spectrum-start').onclick=()=>void action(async current=>{
  if(!engine.monitoring){await engine.startMicrophone($<HTMLSelectElement>('mic-device').value);await listMicrophones();}
  else await engine.prepare();
  if(!current())return;
  rolling.start();frameVisible=false;displayed=undefined;showMicSettings();
});
$('spectrum-freeze').onclick=()=>{rolling.freeze();refresh();};
$('spectrum-stop').onclick=()=>{if(activeRx())freeze(true);rolling.stop();engine.stopMicrophone();showMicSettings();refresh();};
$('mic-device').onchange=()=>void action(async current=>{
  if(!engine.monitoring)return;
  const select=$<HTMLSelectElement>('mic-device'),previous=engine.settings?.deviceId??'';
  try {await engine.startMicrophone(select.value);}
  catch(error){if(current())select.value=Array.from(select.options).some(o=>o.value===previous)?previous:'';throw error;}
  finally {if(current())showMicSettings();}
});
$('resume-audio').onclick=()=>void action(async current=>{await engine.prepare();if(current())hide('resume-audio',true);});
function receiverSettings():FrameSettings {
  for(const name of ['rx-offset','rx-floor','rx-separation'])if(!$<HTMLInputElement>(name).checkValidity()||!Number.isFinite(number(name)))throw new Error('Receiver settings must be valid numbers within their displayed limits.');
  return {mode:mode('rx-mode'),decoder:true,offsetMs:number('rx-offset'),floorDb:number('rx-floor'),separationDb:number('rx-separation')};
}
$('rx-arm').onclick=()=>void action(async current=>{
  if(!decoderEnabled())return;
  const settings=receiverSettings();
  if(!engine.monitoring){
    await engine.startMicrophone($<HTMLSelectElement>('mic-device').value);
    if(!current())return;
    rolling.start();
    await listMicrophones().catch(()=>{});
  }
  await engine.prepare();if(!current())return;showMicSettings();
  // Choose the boundary only after permission and audio preparation have finished.
  const start=nextMinute(Date.now());
  frame={id:++id,start,end:start+60000,actualEnd:null,status:'ARMED',settings,sampleRate:engine.rate,spectrum:[],decisions:[],bytes:[],text:{A:'',B:''},errors:[]};
  rx.arm(start);engine.receive(frame.id,start,settings);frameVisible=true;
  spectrogram.setFrame(frame,frame.spectrum,frame.sampleRate);displayed=frame;
  optionalText('inspection','');
});
$('rx-disarm').onclick=()=>{engine.stopReceive();rx.disarm();frame=null;frameVisible=false;displayed=undefined;refresh();};
$('rx-stop').onclick=()=>freeze(true);
function selectReceiverMode(next:'spectrogram'|'decoder'){
  receiverMode=next;
  // Tabs change controls only. Audio, display source, and in-flight capture keep their state.
  refresh();
}
$('rx-tab-spectrogram').onclick=()=>selectReceiverMode('spectrogram');
$('rx-tab-decoder').onclick=()=>selectReceiverMode('decoder');
$('rx-show-frame').onclick=()=>{if(frame){frameVisible=true;displayed=undefined;refresh();}};
$('rx-mode').onchange=()=>refresh();
$('spectrum-range').onchange=()=>spectrogram.setRange(number('spectrum-range'));
$('export-frame').onclick=()=>{
  if(!frame)return;const blob=new Blob([JSON.stringify(frame,(_key,value)=>value instanceof Uint8Array?Array.from(value):value,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`acoustic-frame-${new Date(frame.start).toISOString().replaceAll(':','-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
engine.onEvent=event=>{
  if(event.type==='pcm')return;
  if(event.id===txId&&(event.type==='started'||event.type==='complete')){
    if(activeTx()){tx.tick(event.type==='started'?tx.start:tx.start+60000);refresh();}return;
  }
  if(!frame||event.id!==frame.id||!activeRx())return;
  if(event.type==='started'){rx.tick(frame.start);frame.status='RECEIVING';refresh();}
  if(event.type==='bit')recordBit(frame,event.id,event.bit);
  if(event.type==='byte')recordByte(frame,event.id,event.byte);
  if(event.type==='complete')freeze(false);
};
engine.onSpectrum=event=>{
  if(activeRx()&&frame) {
    const column=recordSpectrum(frame,event.timestamp,event.bins);
    if(column&&frameVisible)spectrogram.add(column);
  }
  // Keep live history independent of the chosen tab and the frozen capture.
  const update=rolling.write(event.timestamp,event.bins,event.rate);
  if(update&&!shownFrame())spectrogram.updateRolling(update,event.rate);
};
engine.onLevel=(rms,peak)=>{const db=rms?20*Math.log10(rms):-100;$('meter-fill').style.width=`${Math.max(0,Math.min(100,(db+70)/70*100))}%`;$('meter-fill').classList.toggle('clipping',peak>0.98);text('meter-db',rms?`${db.toFixed(1)} dBFS`:'−∞ dBFS');text('input-warning',peak>0.98?'CLIPPING':rms&&db<-65?'LOW INPUT':'');};
engine.onIssue=message=>{rolling.stop();if(activeTx())abortTx();if(activeRx())freeze(true);stopTone();notify(message);hide('resume-audio',engine.context?.state==='running');showMicSettings();refresh();};
spectrogram.onInspect=time=>{
  const visible=shownFrame();
  if(visible){optionalText('inspection',time===null?'':spectrogram.inspection(time,visible));return;}
  const col=time===null?null:rolling.columns[Math.min(1799,Math.floor(time*30))];
  optionalText('inspection',time===null?'':`${time.toFixed(3)} s · ${col?new Date(col.timestamp).toLocaleTimeString('en-GB',{hour12:false})+' · measured microphone spectrum':'no samples at this position'}`);
};
function testLoopback(m:Mode){
  if(loopWorker)return;text('loop-result',`Running ${m} · real PCM → Goertzel decoder…`);
  for(const name of ['loop-none','loop-fdm','loop-tdm'])$<HTMLButtonElement>(name).disabled=true;
  loopWorker=new LoopbackWorker();
  const finish=()=>{loopWorker?.terminate();loopWorker=null;for(const name of ['loop-none','loop-fdm','loop-tdm'])$<HTMLButtonElement>(name).disabled=false;};
  loopWorker.onmessage=e=>{if(e.data.ok){const r=e.data.result;text('loop-result',`${m}: ${m==='None'?JSON.stringify(r.text.A):'A '+JSON.stringify(r.text.A)+' · B '+JSON.stringify(r.text.B)} · ${r.decisions.filter((d:{value:number|null})=>d.value!==null).length}/${r.decisions.length} valid bits · internal PCM only`);}else text('loop-result',e.data.error);finish();};
  loopWorker.onerror=()=>{text('loop-result','Loopback worker failed. Check browser console.');finish();};
  loopWorker.postMessage({mode:m,a:m==='TDM'?'HELLO':'HELLOWORLD',b:m==='None'?'':m==='FDM'?'DOGS__CATS':'WORLD',noise:0.02});
}
$('loop-none').onclick=()=>testLoopback('None');
$('loop-fdm').onclick=()=>testLoopback('FDM');$('loop-tdm').onclick=()=>testLoopback('TDM');
function render(now:number){
  requestAnimationFrame(render);if(now-lastUi<33)return;lastUi=now;
  const wall=Date.now(),delta=wall-performance.now();
  if(Math.abs(delta-clockDelta)>200&& (activeTx()||activeRx())){abortTx();freeze(true);notify('System clock changed during the frame. Synchronize clocks and arm again.');}
  clockDelta=delta;text('clock',new Date(wall).toLocaleTimeString('en-GB',{hour12:false}));
  const elapsed=(wall-tx.start)/1000,txSeconds=tx.state==='COMPLETE'?60:tx.state==='TRANSMITTING'?elapsed:0;
  text('tx-countdown',tx.state==='ARMED'?`${Math.max(0,(tx.start-wall)/1000).toFixed(1)} s`:tx.state==='TRANSMITTING'?`${Math.max(0,60-elapsed).toFixed(1)} s left`:`${((nextMinute(wall)-wall)/1000).toFixed(1)} s`);
  const bit=txSeconds>=0&&txSeconds<56&&tx.state==='TRANSMITTING'?Math.floor(txSeconds/0.7+1e-10):null;
  text('tx-byte',bit===null?'— / 10':`${Math.floor(bit/8)+1} / 10`);text('tx-bit',bit===null?'— / 8':`${bit%8+1} / 8`);
  const freqs=bit!==null&&payload?payload.streams.map((s,i)=>`${FREQUENCIES[i?'B':'A'][s[bit]]} Hz (${s[bit]})`):[];
  text('tx-frequencies',freqs.join(' / ')||'— / —');$('tx-progress').style.width=`${Math.max(0,Math.min(100,txSeconds/60*100))}%`;
  optionalText('tx-detail',tx.state==='TRANSMITTING'?(elapsed<56?`Bit ${bit===null?'—':bit+1}/80`:'Silence'):tx.state==='ARMED'?new Date(tx.start).toLocaleTimeString():'');
  if(role==='RX') {
    const visible=shownFrame();
    const seconds=visible?(rx.state==='ARMED'?0:visible.actualEnd!==null?(visible.actualEnd-visible.start)/1000:(wall-visible.start)/1000):(rolling.cursor??0);
    if(visible!==displayed){if(visible)spectrogram.setFrame(visible,visible.spectrum,visible.sampleRate);else spectrogram.setRolling(rolling.columns,rolling.rate);displayed=visible;}
    spectrogram.draw(seconds,visible?engine.monitoring:rolling.cursor!==null,!visible);
    text('frame-label',visible?`${new Date(visible.start).toLocaleTimeString()} · ${Math.max(0,Math.min(60,seconds)).toFixed(1)} / 60 s`:`${seconds.toFixed(1)} / 60 s`);
    optionalText('rx-countdown',rx.state==='ARMED'?`Starts in ${Math.max(0,(rx.start-wall)/1000).toFixed(1)} s`:rx.state==='RECEIVING'?`${Math.max(0,60-(wall-rx.start)/1000).toFixed(1)} s remaining`:'');
    optionalText('rx-help',frame&&['FROZEN','ABORTED'].includes(frame.status)?`${frame.decisions.length} bits · ${frame.errors.length} errors`:'');
    const captureSeconds=frame?((frame.actualEnd??wall)-frame.start)/1000:-1;
    for(const channel of ['A','B'] as const)updateChannel(channel,frame,rx.state==='ARMED'?-1:captureSeconds,!!frame?.settings.decoder&&rx.state==='RECEIVING',mode('rx-mode'));
  }
}
refresh();requestAnimationFrame(render);void listMicrophones().catch(()=>{});
const deviceChanged=()=>void listMicrophones().catch(()=>{});navigator.mediaDevices?.addEventListener('devicechange',deviceChanged);
window.addEventListener('pagehide',()=>{
  actionGeneration++;busy=false;
  stopTone();abortTx();if(activeRx())freeze(true);
  rolling.stop();engine.dispose();spectrogram.suspend();
  loopWorker?.terminate();loopWorker=null;
  for(const name of ['loop-none','loop-fdm','loop-tdm'])$<HTMLButtonElement>(name).disabled=false;
  showMicSettings();refresh();
});
window.addEventListener('pageshow',event=>{
  if(!event.persisted)return;
  // BFCache retains this document and its listeners; audio resumes only on user action.
  clockDelta=Date.now()-performance.now();
  spectrogram.resume();showMicSettings();refresh();
});
