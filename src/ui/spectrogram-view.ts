import type { RollingUpdate } from '../state/rolling-spectrum';
import { bitAt, type CapturedFrame, type SpectralColumn } from '../protocol/frame';
export const SPECTRUM_MIN_DBFS = -60;
export const SPECTRUM_MAX_DBFS = -18;
// Stored spectral bins retain their original -100..0 dBFS encoding.
// Only the display contrast changes, including when repainting a frozen frame.
export function spectrumColorIndex(dbfs:number):number {
  return Math.max(0,Math.min(255,Math.round((dbfs-SPECTRUM_MIN_DBFS)/(SPECTRUM_MAX_DBFS-SPECTRUM_MIN_DBFS)*255)));
}
const colorIndices=Uint8Array.from({length:256},(_,i)=>spectrumColorIndex(i/255*100-100));
const palette=Array.from({length:256},(_,i)=>{
  const t=i/255;
  const stops=[[8,17,25],[18,40,65],[22,87,113],[23,161,153],[118,213,177],[255,217,126]];
  const p=t*(stops.length-1),a=stops[Math.floor(p)],b=stops[Math.min(stops.length-1,Math.floor(p)+1)],f=p%1;
  return a.map((n,j)=>Math.round(n+(b[j]-n)*f));
});
export class SpectrogramView {
  private context:CanvasRenderingContext2D;
  private layer=document.createElement('canvas');
  private lc:CanvasRenderingContext2D;
  private columns:readonly (SpectralColumn|null)[]=[];
  private rate=48000;
  private maxHz=4000;
  private hover:number|null=null;
  private frame:CapturedFrame|null=null;
  private observer:ResizeObserver;
  private width=1000;
  private height=310;
  onInspect:(time:number|null)=>void=()=>{};
  constructor(private canvas:HTMLCanvasElement) {
    this.context=canvas.getContext('2d')!;this.layer.width=1800;this.layer.height=512;this.lc=this.layer.getContext('2d')!;
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);
    canvas.addEventListener('pointermove',e=>{
      const rect=canvas.getBoundingClientRect();this.inspect(Math.max(0,Math.min(59.999,(e.clientX-rect.left-56)/(rect.width-76)*60)));
    });
    canvas.addEventListener('pointerleave',()=>{this.hover=null;this.onInspect(null);});
    canvas.addEventListener('click',()=>canvas.focus());
    canvas.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();this.inspect(Math.max(0,Math.min(59.999,(this.hover??0)+(e.key==='ArrowRight'?0.7:-0.7))));}});
  }
  private inspect(time:number){this.hover=time;this.onInspect(time);}
  private resize(){const rect=this.canvas.getBoundingClientRect();this.width=rect.width;this.height=rect.height;this.canvas.width=Math.round(rect.width*devicePixelRatio);this.canvas.height=Math.round(rect.height*devicePixelRatio);}
  setRange(hz:number){this.maxHz=hz;this.redrawLayer();}
  setFrame(frame:CapturedFrame|null,columns:SpectralColumn[],rate:number){this.frame=frame;this.columns=columns;this.rate=rate;this.redrawLayer();}
  setRolling(columns:readonly (SpectralColumn|null)[],rate:number){this.frame=null;this.columns=columns;this.rate=rate;this.redrawLayer();}
  updateRolling(update:RollingUpdate,rate:number){
    this.rate=rate;
    for(const slot of update.cleared)this.lc.clearRect(slot,0,1,512);
    this.paintColumn(update.column);
  }
  private redrawLayer(){this.lc.clearRect(0,0,1800,512);for(const col of this.columns)if(col)this.paintColumn(col);}
  add(column:SpectralColumn){this.paintColumn(column);}
  private paintColumn(column:SpectralColumn){
    const image=this.lc.createImageData(1,512);
    for(let y=0;y<512;y++) {
      const hz=(1-y/511)*this.maxHz;
      const bin=Math.min(column.bins.length-1,Math.round(hz/(this.rate/2)*column.bins.length));
      const color=palette[colorIndices[column.bins[bin]??0]];
      const off=y*4;image.data[off]=color[0];image.data[off+1]=color[1];image.data[off+2]=color[2];image.data[off+3]=255;
    }
    // A column represents its measured timestamp, not the browser's paint time.
    const x=Math.floor(column.time/60*1800);this.lc.putImageData(image,x,0);
  }
  draw(seconds:number,monitoring:boolean,circular=false){
    const c=this.context,w=this.width,h=this.height;if(!w||!h)return;
    c.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);c.clearRect(0,0,w,h);
    const x=56,y=24,pw=Math.max(1,w-76),ph=Math.max(1,h-60);
    c.fillStyle='#081119';c.fillRect(x,y,pw,ph);c.drawImage(this.layer,x,y,pw,ph);
    if(!circular){c.fillStyle='#b8c4d208';c.fillRect(x+pw*56/60,y,pw*4/60,ph);}
    c.font='10px ui-monospace,monospace';c.lineWidth=1;
    for(let i=0;i<=60;i++){
      const xx=x+pw*i/60;c.strokeStyle=i%10===0?'#7891a52d':'#7891a513';c.beginPath();c.moveTo(xx,y);c.lineTo(xx,y+ph);c.stroke();
      if(i%10===0){c.fillStyle='#7992a5';c.textAlign='center';c.fillText(`${i}s`,xx,y+ph+20);}
    }
    if(!circular)for(let i=1;i<=10;i++) {const xx=x+pw*i*5.6/60;c.strokeStyle='#a8bdcb33';c.setLineDash([3,5]);c.beginPath();c.moveTo(xx,y);c.lineTo(xx,y+ph);c.stroke();}c.setLineDash([]);
    for(let hz=0;hz<=this.maxHz;hz+=1000){const yy=y+ph*(1-hz/this.maxHz);c.strokeStyle='#7891a52d';c.beginPath();c.moveTo(x,yy);c.lineTo(x+pw,yy);c.stroke();c.fillStyle='#7992a5';c.textAlign='right';c.fillText(hz===0?'0':`${hz/1000}k`,x-10,yy+3);}
    c.fillStyle='#7992a5';c.textAlign='left';c.fillText('Hz',12,14);if(!circular){c.fillText('PAYLOAD',x,14);c.textAlign='right';c.fillText('SILENCE',x+pw,14);}
    const cursor=Math.max(0,Math.min(60,seconds));
    if(monitoring||this.frame){const xx=x+pw*cursor/60;c.strokeStyle='#b7f4dc';c.beginPath();c.moveTo(xx,y);c.lineTo(xx,y+ph);c.stroke();}
    if(this.hover!==null){const xx=x+pw*this.hover/60;c.strokeStyle='#ffd98b';c.setLineDash([4,3]);c.beginPath();c.moveTo(xx,y);c.lineTo(xx,y+ph);c.stroke();c.setLineDash([]);}

  }
  inspection(time:number,frame:CapturedFrame):string {
    const mode=frame.settings.mode;
    const bit=bitAt(time);if(bit===null)return `${time.toFixed(3)} s · Silence interval · no payload bits`;
    const slot=Math.floor(bit/8),logical=mode==='TDM'?(slot%2?'B':'A'):mode==='None'?'A':'A + B';
    const channels=mode==='FDM'?['A','B']: [logical];
    return `${time.toFixed(3)} s · slot ${slot+1} · bit ${bit%8+1}/8 (physical ${bit+1}/80) · `+channels.map(channel=>{
      const d=frame.decisions.find(b=>b.index===bit&&b.channel===channel);
      return d?`${channel}: ${d.value??'?'} / ${d.frequency===null?'no reliable tone':d.frequency+' Hz'} / ${(d.confidence*100).toFixed(0)}%${d.reason?' · '+d.reason:''}`:`${channel}: ${frame.settings.decoder?'pending / not captured':'decoder disabled'}`;
    }).join('  |  ');
  }
  suspend(){this.observer.disconnect();}
  resume(){this.observer.observe(this.canvas);this.resize();}
}
