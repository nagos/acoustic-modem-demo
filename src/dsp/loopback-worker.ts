import { loopback, type LoopbackOptions } from './loopback';
self.onmessage=(event:MessageEvent<LoopbackOptions>)=>{
  try { self.postMessage({ok:true,result:loopback(event.data)}); }
  catch(error){self.postMessage({ok:false,error:String(error)});}
};
