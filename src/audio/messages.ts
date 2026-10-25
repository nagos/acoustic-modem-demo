import type { BitDecision, DecodedByte, FrameSettings, Payload } from '../protocol/frame';
export type TxCommand = {type:'arm'; id:number; startFrame:number; payload:Payload; volume:number} | {type:'stop'};
export type RxCommand = {type:'arm'; id:number; startFrame:number; settings:FrameSettings} | {type:'stop'};
export type AudioEvent = {type:'started'|'complete';id:number} | {type:'bit';id:number;bit:BitDecision} | {type:'byte';id:number;byte:DecodedByte} | {type:'pcm';samples:Float32Array;firstFrame:number;rate:number;level:number;peak:number};
