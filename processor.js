class MeterProcessor extends AudioWorkletProcessor {
  constructor(){super();this.sum=0;this.peak=0;this.count=0;}
  process(inputs){const data=inputs[0]?.[0];if(data){for(const x of data){this.sum+=x*x;this.peak=Math.max(this.peak,Math.abs(x));}this.count+=data.length;if(this.count>=sampleRate/8){this.port.postMessage({rms:Math.sqrt(this.sum/this.count),peak:this.peak});this.sum=0;this.peak=0;this.count=0;}}return true;}
}
registerProcessor('meter-processor',MeterProcessor);
