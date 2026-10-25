export type TxState = 'IDLE' | 'ARMED' | 'TRANSMITTING' | 'COMPLETE' | 'ABORTED';
export type RxState = 'IDLE' | 'ARMED' | 'RECEIVING' | 'FROZEN' | 'ABORTED';
export class TransmitterState {
  state: TxState = 'IDLE';
  start = 0;
  arm(start: number) { if(this.state==='ARMED'||this.state==='TRANSMITTING') throw new Error('Transmitter is busy'); this.start=start;this.state='ARMED'; }
  disarm() { if(this.state==='ARMED') this.state='IDLE'; }
  tick(now: number) { if(this.state==='ARMED' && now>=this.start) this.state='TRANSMITTING'; if(this.state==='TRANSMITTING'&&now>=this.start+60000) this.state='COMPLETE'; }
  stop() { if(this.state==='TRANSMITTING'||this.state==='ARMED') this.state='ABORTED'; }
}
export class ReceiverState {
  state: RxState = 'IDLE';
  start = 0;
  arm(start: number) { if(this.state==='ARMED'||this.state==='RECEIVING') throw new Error('Receiver is busy');this.start=start;this.state='ARMED'; }
  disarm() { if(this.state==='ARMED') this.state='IDLE'; }
  tick(now: number) { if(this.state==='ARMED'&&now>=this.start)this.state='RECEIVING';if(this.state==='RECEIVING'&&now>=this.start+60000)this.state='FROZEN'; }
  stop() { if(this.state==='RECEIVING'||this.state==='ARMED')this.state='ABORTED'; }
}
