import { describe,it } from 'vitest';
import assert from 'node:assert/strict';
import { RollingSpectrum,SPECTRUM_COLUMNS } from '../state/rolling-spectrum';
const bins=(n:number)=>new Uint8Array([n]);
describe('continuous spectrogram sweep',()=>{
  it('starts immediately without arming and replaces only passed slots at minute rollover',()=>{
    const s=new RollingSpectrum();s.start();s.write(10000,bins(1),48000);s.write(59980,bins(2),48000);
    const old=s.columns[1799];const update=s.write(60010,bins(3),48000)!;
    assert.equal(s.state,'RUNNING');assert.deepEqual(update.cleared,[0]);assert.equal(s.columns[1799],old);
    assert.equal(s.columns[300]?.bins[0],1);assert.equal(s.columns[0]?.bins[0],3);assert.equal(s.cursor,.01);
  });
  it('clears skipped columns only where the running cursor has passed',()=>{
    const s=new RollingSpectrum();s.start();s.write(10000,bins(1),48000);s.write(59980,bins(2),48000);
    const update=s.write(60080,bins(3),48000)!;assert.deepEqual(update.cleared,[0,1,2]);assert.ok(s.columns[300]);assert.equal(s.columns[1],null);
  });
  it('freezes samples and cursor, ignoring in-flight measurements until Start',()=>{
    const s=new RollingSpectrum();s.start();s.write(10000,bins(1),48000);s.write(11000,bins(2),48000);s.freeze();
    const saved=JSON.stringify(s.columns);assert.equal(s.write(12000,bins(3),48000),null);assert.equal(JSON.stringify(s.columns),saved);assert.equal(s.cursor,11);
    s.start();const update=s.write(70010,bins(4),48000)!;assert.deepEqual(update.cleared,[]);assert.equal(s.columns[300]?.bins[0],4);assert.equal(s.columns[330]?.bins[0],2);
  });
  it('stops and resumes while preserving the frozen image',()=>{
    const s=new RollingSpectrum();s.start();s.write(15000,bins(1),48000);s.stop();assert.equal(s.state,'STOPPED');assert.equal(s.write(16000,bins(2),48000),null);assert.equal(s.cursor,15);s.start();s.write(16000,bins(2),48000);assert.equal(s.columns[450]?.bins[0],1);
  });
  it('bounds storage and keeps only current measurements after a full missed sweep',()=>{
    const s=new RollingSpectrum();s.start();s.write(0,bins(1),48000);s.write(180010,bins(2),48000);
    assert.equal(s.columns.length,SPECTRUM_COLUMNS);assert.equal(s.columns.filter(Boolean).length,1);assert.equal(s.columns[0]?.timestamp,180010);
  });
  it('resets incompatible spectral bins when the input sample rate changes',()=>{
    const s=new RollingSpectrum();s.start();s.write(1000,bins(1),48000);const update=s.write(2000,bins(2),44100)!;
    assert.equal(update.cleared.length,SPECTRUM_COLUMNS);assert.equal(s.columns[30],null);assert.equal(s.columns[60]?.bins[0],2);assert.equal(s.rate,44100);
  });
  it('ignores stale timestamps without rewinding the cursor',()=>{
    const s=new RollingSpectrum();s.start();s.write(11000,bins(1),48000);assert.equal(s.write(10000,bins(2),48000),null);assert.equal(s.cursor,11);
  });
});
