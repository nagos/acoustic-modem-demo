import { describe,it } from 'vitest';
import assert from 'node:assert/strict';
import { TransmitterState, ReceiverState } from '../state/machines';
describe('one-shot transmitter state machine',()=>{
  it('arms, disarms, and snapshots the scheduled start',()=>{const s=new TransmitterState();assert.equal(s.state,'IDLE');s.arm(60000);assert.equal(s.state,'ARMED');assert.equal(s.start,60000);s.disarm();s.tick(60000);assert.equal(s.state,'IDLE');});
  it('waits for the boundary, includes the silence tail, and never retransmits',()=>{const s=new TransmitterState();s.arm(60000);s.tick(59999);assert.equal(s.state,'ARMED');s.tick(60000);assert.equal(s.state,'TRANSMITTING');s.tick(116000);assert.equal(s.state,'TRANSMITTING');s.tick(120000);assert.equal(s.state,'COMPLETE');s.tick(180000);assert.equal(s.state,'COMPLETE');s.arm(240000);assert.equal(s.state,'ARMED');});
  it('rejects double arming and aborts on stop',()=>{const s=new TransmitterState();s.arm(60000);assert.throws(()=>s.arm(120000));s.tick(60000);s.stop();assert.equal(s.state,'ABORTED');s.tick(120000);assert.equal(s.state,'ABORTED');s.arm(180000);assert.equal(s.state,'ARMED');});
});
describe('independent receiver capture state machine',()=>{
  it('disarms without starting capture',()=>{const s=new ReceiverState();s.arm(60000);assert.equal(s.state,'ARMED');s.disarm();s.tick(60000);assert.equal(s.state,'IDLE');});
  it('captures all sixty seconds then freezes without rollover',()=>{const s=new ReceiverState();s.arm(60000);s.tick(59999);assert.equal(s.state,'ARMED');s.tick(60000);assert.equal(s.state,'RECEIVING');s.tick(119999);assert.equal(s.state,'RECEIVING');s.tick(120000);assert.equal(s.state,'FROZEN');s.tick(360000);assert.equal(s.state,'FROZEN');});
  it('stops partial capture, retains aborted state, and arms again explicitly',()=>{const s=new ReceiverState();s.arm(60000);assert.throws(()=>s.arm(120000));s.tick(60000);s.stop();assert.equal(s.state,'ABORTED');s.tick(180000);assert.equal(s.state,'ABORTED');s.arm(240000);assert.equal(s.state,'ARMED');});
});
