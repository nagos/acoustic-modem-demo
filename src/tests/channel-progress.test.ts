import { describe,it } from 'vitest';
import assert from 'node:assert/strict';
import { channelProgress } from '../state/channel-progress';
import { byteBits, type CapturedFrame, type Channel, type Mode } from '../protocol/frame';
function frame(mode:Mode='None'):CapturedFrame {
  return {id:1,start:0,end:60000,actualEnd:null,status:'RECEIVING',settings:{mode,decoder:true,offsetMs:0,floorDb:-50,separationDb:6},sampleRate:48000,spectrum:[],decisions:[],bytes:[],text:{A:'',B:''},errors:[]};
}
function addByte(f:CapturedFrame,slot:number,channel:Channel,value:number){
  f.decisions.push(...byteBits(value).map((value,index)=>({index:slot*8+index,channel,value:value as 0|1,confidence:1,frequency:1200,levelDb:-20,separationDb:40,reason:null})));
  f.bytes.push({slot,channel,value,error:false});f.text[channel]+=String.fromCharCode(value);
}
describe('decoder panel byte progress',()=>{
  for(const mode of ['None','FDM'] as const)it(`advances ${mode} to a pending second byte before its first decision`,()=>{
    const f=frame(mode);addByte(f,0,'A',65);
    const p=channelProgress('A',f,5.7,true,mode);
    assert.equal(p.byteIndex,2);assert.equal(p.bitIndex,1);assert.equal(p.byte,undefined);
    assert.deepEqual(p.bits,Array(8).fill(undefined));assert.equal(p.text,'A');assert.equal(p.count,1);
  });
  it('fills only the received bits of the new byte, including unknown decisions',()=>{
    const f=frame();addByte(f,0,'A',65);f.decisions.push({...f.decisions[0],index:8,value:null});
    const p=channelProgress('A',f,6.2,true,'None');assert.equal(p.byteIndex,2);assert.equal(p.bits[0],null);assert.ok(p.bits.slice(1).every(b=>b===undefined));
  });
  it('advances the active TDM channel while retaining the inactive completed byte',()=>{
    const f=frame('TDM');addByte(f,0,'A',72);addByte(f,1,'B',87);
    const a=channelProgress('A',f,11.3,true,'TDM'),b=channelProgress('B',f,11.3,true,'TDM');
    assert.equal(a.active,true);assert.equal(a.byteIndex,2);assert.deepEqual(a.bits,Array(8).fill(undefined));
    assert.equal(b.active,false);assert.equal(b.byteIndex,1);assert.equal(b.byte?.value,87);assert.equal(b.text,'W');
  });
  it('keeps the pending byte when an early stop occurs before its first decision',()=>{
    const f=frame();addByte(f,0,'A',65);f.status='ABORTED';f.actualEnd=5700;
    const p=channelProgress('A',f,5.7,false,'None');assert.equal(p.byteIndex,2);assert.equal(p.bitIndex,0);assert.equal(p.highlight,null);assert.deepEqual(p.bits,Array(8).fill(undefined));
  });
  it('retains the final byte through the silence tail and freeze',()=>{
    const f=frame();for(let i=0;i<10;i++)addByte(f,i,'A',65+i);
    const p=channelProgress('A',f,60,false,'None');assert.equal(p.byteIndex,10);assert.equal(p.bitIndex,8);assert.equal(p.count,10);assert.equal(p.byte?.value,74);
  });
  it('uses the selected idle mode without fabricating characters or decisions',()=>{
    const p=channelProgress('B',null,-1,false,'TDM');assert.equal(p.capacity,5);assert.equal(p.byteIndex,1);assert.equal(p.count,0);assert.deepEqual(p.bits,Array(8).fill(undefined));
  });
});
