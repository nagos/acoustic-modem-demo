declare const currentFrame: number;
declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort; constructor(options?: unknown); }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
