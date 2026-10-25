import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { ACTIVE_SECONDS, BIT_SECONDS, BYTE_SECONDS, FRAME_SECONDS, bitAt, bitsByte, byteBits, capacity, encodeAscii, makePayload, nextMinute, owner, sampleBoundary, validateAscii } from '../protocol/frame';
describe('fixed ASCII frame protocol',()=>{
  it('encodes every printable ASCII character and preserves spaces',()=>{
    const text=String.fromCharCode(...Array.from({length:95},(_,i)=>i+32));
    assert.deepEqual(Array.from(encodeAscii(text,95)),Array.from({length:95},(_,i)=>i+32));
    assert.deepEqual(Array.from(encodeAscii('A ',4)),[65,32,32,32]);
    assert.deepEqual(Array.from(encodeAscii('',2)),[32,32]);
  });
  it('rejects Unicode, controls and excessive lengths',()=>{
    for(const text of ['é','🐈','\n','\t','\x7f'])assert.ok(validateAscii(text,10));
    assert.ok(validateAscii('123456',5));assert.throws(()=>encodeAscii('123456',5));
    assert.throws(()=>encodeAscii('é',5));assert.equal(validateAscii('Hi ~',5),null);
  });
  it('converts MSB first, including unknown and incomplete bytes',()=>{
    assert.deepEqual(byteBits(65),[0,1,0,0,0,0,0,1]);assert.equal(bitsByte(byteBits(126)),126);
    assert.equal(bitsByte([0,1]),null);assert.equal(bitsByte([0,1,0,0,0,0,0,null]),null);
    assert.equal(bitsByte([0,1,0,0,0,0,0,2]),null);
  });
  it('has the exact specified durations',()=>{
    assert.equal(BIT_SECONDS,0.7);assert.equal(BYTE_SECONDS,5.6);assert.equal(ACTIVE_SECONDS,56);assert.equal(FRAME_SECONDS,60);
    assert.equal(BIT_SECONDS*8,BYTE_SECONDS);assert.equal(BIT_SECONDS*80,ACTIVE_SECONDS);
  });
  it('calculates the strictly next minute, including rollover',()=>{
    assert.equal(nextMinute(0),60000);assert.equal(nextMinute(60000),120000);assert.equal(nextMinute(119999),120000);
    const t=Date.UTC(2026,9,25,23,59,59,999);assert.equal(nextMinute(t),Date.UTC(2026,9,26));
  });
  it('indexes boundaries without decoding the silence tail',()=>{
    assert.equal(bitAt(-0.01),null);assert.equal(bitAt(0),0);assert.equal(bitAt(.69999),0);assert.equal(bitAt(.7),1);
    assert.equal(bitAt(55.999),79);assert.equal(bitAt(56),null);assert.equal(bitAt(60),null);
  });
  it('rounds absolute sample positions without accumulated duration drift',()=>{
    for(const rate of [44100,48000,44117]) {
      assert.equal(sampleBoundary(80*BIT_SECONDS,rate),56*rate);
      for(let bit=0;bit<80;bit++)assert.ok(Math.abs(sampleBoundary(bit*BIT_SECONDS,rate)/rate-bit*BIT_SECONDS)<=.5/rate+1e-12);
    }
  });
});
describe('multiplexing',()=>{
  it('sends one ten-byte stream without multiplexing or channel B validation',()=>{
    const p=makePayload('None','HELLO','🐈 ignored hidden input');
    assert.equal(capacity('None'),10);assert.deepEqual(Array.from(p.a),Array.from(encodeAscii('HELLO',10)));
    assert.equal(p.b.length,0);assert.equal(p.streams.length,1);assert.equal(p.streams[0].length,80);
    assert.deepEqual(p.streams[0],Array.from(p.a).flatMap(byteBits));
    assert.ok(Array.from({length:10},(_,i)=>owner('None',i)).every(c=>c==='A'));
  });
  it('validates and pads the single message to exactly ten ASCII bytes',()=>{
    assert.equal(makePayload('None','HELLOWORLD').a.length,10);
    assert.throws(()=>makePayload('None','ELEVENBYTES'));
    assert.throws(()=>makePayload('None','привет'));
    assert.deepEqual(Array.from(makePayload('None','').a),Array(10).fill(32));
  });
  it('keeps FDM payloads independent and fixed at ten bytes each',()=>{
    const p=makePayload('FDM','HELLO','WORLD'),q=makePayload('FDM','HELLO','OTHER');
    assert.equal(capacity('FDM'),10);assert.equal(p.a.length,10);assert.equal(p.b.length,10);assert.equal(p.streams.length,2);
    assert.equal(p.streams[0].length,80);assert.deepEqual(p.streams[0],q.streams[0]);assert.notDeepEqual(p.streams[1],q.streams[1]);
  });
  it('interleaves TDM whole bytes and assigns alternating logical owners',()=>{
    const p=makePayload('TDM','HELLO','WORLD');assert.equal(capacity('TDM'),5);assert.equal(p.a.length,5);assert.equal(p.b.length,5);assert.equal(p.streams.length,1);assert.equal(p.streams[0].length,80);
    const bytes=Array.from({length:10},(_,i)=>bitsByte(p.streams[0].slice(i*8,i*8+8))!);
    assert.equal(String.fromCharCode(...bytes),'HWEOLRLLOD');
    assert.deepEqual(Array.from({length:10},(_,i)=>owner('TDM',i)),['A','B','A','B','A','B','A','B','A','B']);
    assert.throws(()=>makePayload('TDM','123456','OK'));
  });
});
