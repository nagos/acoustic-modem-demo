import { displayByte, type CapturedFrame, type Channel, type Mode } from '../protocol/frame';
import { channelProgress } from '../state/channel-progress';

export function channelMarkup(channel:Channel):string {
  return `<article class="channel channel-${channel.toLowerCase()}" id="channel-${channel}"><div class="channel-top"><h3><span class="channel-dot"></span>Channel ${channel}</h3><span class="channel-activity">STANDBY</span></div><div class="decoded" aria-label="Channel ${channel} decoded text">—</div><div class="byte-line"><span class="byte-label">BYTE —</span><span class="byte-result">awaiting bits</span></div><div class="bits" aria-label="Current byte bits">${Array.from({length:8},()=>'<span class="bit pending">·</span>').join('')}</div><div class="channel-bottom"><span class="char-count">0 characters</span><span class="confidence">confidence —</span></div></article>`;
}
export function mountChannels(container:HTMLElement){
  container.innerHTML=(['A','B'] as const).map(channelMarkup).join('');
}
export function updateChannel(channel:Channel,frame:CapturedFrame|null,seconds:number,receiving:boolean,selectedMode:Mode) {
  const el=document.querySelector<HTMLElement>(`#channel-${channel}`)!;
  const progress=channelProgress(channel,frame,seconds,receiving,selectedMode);
  el.classList.toggle('active',progress.active);
  el.querySelector('.decoded')!.textContent=progress.text.length?progress.text.replace(/ /g,'␠'):'—';
  el.querySelector('.decoded')!.setAttribute('title',progress.text.length?JSON.stringify(progress.text):'No decoded characters');
  const bits=Array.from(el.querySelectorAll<HTMLElement>('.bit'));
  for(let i=0;i<8;i++){
    const value=progress.bits[i];
    bits[i].textContent=value===undefined?'·':value===null?'?':String(value);
    bits[i].className=`bit ${value===undefined?'pending':value===null?'unknown':value?'one':'zero'}`;
    bits[i].classList.toggle('current',i===progress.highlight);
  }
  el.querySelector('.byte-label')!.textContent=`BYTE ${progress.byteIndex}/${progress.capacity} · BIT ${progress.bitIndex}/8`;
  el.querySelector('.byte-result')!.textContent=progress.byte?(progress.byte.error?'decode error':progress.byte.value===32?'space':displayByte(progress.byte.value)):'collecting bits';
  el.querySelector('.char-count')!.textContent=`${progress.count} / ${progress.capacity} characters`;
  el.querySelector('.confidence')!.textContent=progress.confidence===null?'confidence —':`confidence ${Math.round(progress.confidence*100)}%`;
  el.querySelector('.channel-activity')!.textContent=progress.active?'ON AIR':progress.byte?.error?'ERROR':receiving?'HOLD':'STANDBY';
}
