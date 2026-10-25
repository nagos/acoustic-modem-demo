/** In-place radix-2 FFT, Hann window, normalized one-sided dBFS magnitudes. */
export function spectrum(samples: Float32Array): Float32Array {
  const n = samples.length, re = new Float64Array(n), im = new Float64Array(n);
  for (let i=0;i<n;i++) re[i] = samples[i] * (0.5 - 0.5 * Math.cos(2*Math.PI*i/(n-1)));
  for (let i=1,j=0;i<n;i++) {
    let bit = n>>1; for (;j&bit;bit>>=1) j ^= bit; j ^= bit;
    if(i<j) { const t=re[i];re[i]=re[j];re[j]=t; }
  }
  for(let size=2;size<=n;size*=2) {
    const angle=-2*Math.PI/size, wr0=Math.cos(angle), wi0=Math.sin(angle);
    for(let start=0;start<n;start+=size) {
      let wr=1,wi=0;
      for(let j=0;j<size/2;j++) {
        const a=start+j,b=a+size/2,tr=wr*re[b]-wi*im[b],ti=wr*im[b]+wi*re[b];
        re[b]=re[a]-tr; im[b]=im[a]-ti; re[a]+=tr;im[a]+=ti;
        const next=wr*wr0-wi*wi0;wi=wr*wi0+wi*wr0;wr=next;
      }
    }
  }
  return Float32Array.from({length:n/2},(_,i)=>20*Math.log10(Math.max(1e-6,Math.hypot(re[i],im[i])*4/n)));
}
