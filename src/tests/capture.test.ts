import { describe,it } from 'vitest';
import assert from 'node:assert/strict';
import { recordBit,recordByte,recordSpectrum,finishCapture } from '../state/capture';
import type { BitDecision,CapturedFrame } from '../protocol/frame';
function frame():CapturedFrame{return {id:7,start:60000,end:120000,actualEnd:null,status:'RECEIVING',sampleRate:48000,settings:{mode:'FDM',decoder:true,offsetMs:0,floorDb:-50,separationDb:6},spectrum:[],decisions:[],bytes:[],text:{A:'',B:''},errors:[]};}
const bit:BitDecision={index:0,channel:'A',value:0,confidence:1,frequency:1200,levelDb:-20,separationDb:40,reason:null};
describe('captured frame integrity',()=>{
  it('ignores old-frame and duplicate worklet events',()=>{const f=frame();assert.equal(recordBit(f,6,bit),false);assert.equal(recordBit(f,7,bit),true);assert.equal(recordBit(f,7,bit),false);assert.equal(f.decisions.length,1);});
  it('preserves raw spaces and unknown bytes while preventing duplicates',()=>{const f=frame();const b={slot:0,channel:'A' as const,value:32,error:false};assert.equal(recordByte(f,7,b),true);assert.equal(recordByte(f,7,b),false);recordByte(f,7,{slot:1,channel:'A',value:null,error:true});assert.equal(f.text.A,' �');assert.equal(f.bytes[0].value,32);assert.equal(f.bytes[1].value,null);assert.equal(f.errors.length,1);});
  it('records only measured spectral timestamps inside the sixty-second capture',()=>{const f=frame(),bins=new Uint8Array([12,42]);assert.equal(recordSpectrum(f,59999,bins),null);assert.equal(recordSpectrum(f,120000,bins),null);assert.equal(recordSpectrum(f,119999,bins)?.time,59.999);});
  it('never modifies frozen results after rollover or delayed worker messages',()=>{const f=frame();recordBit(f,7,bit);recordByte(f,7,{slot:0,channel:'A',value:65,error:false});recordSpectrum(f,61000,new Uint8Array([42]));assert.equal(finishCapture(f,false,130000),true);const saved=JSON.stringify(f);recordBit(f,7,{...bit,index:1});recordByte(f,7,{slot:1,channel:'A',value:66,error:false});recordSpectrum(f,62000,new Uint8Array([99]));finishCapture(f,true,180000);assert.equal(JSON.stringify(f),saved);assert.equal(f.actualEnd,120000);});
  it('preserves partial aborted data',()=>{const f=frame();recordBit(f,7,bit);finishCapture(f,true,67000);assert.equal(f.status,'ABORTED');assert.equal(f.actualEnd,67000);assert.equal(f.decisions.length,1);assert.equal(recordBit(f,7,{...bit,index:1}),false);});
});
