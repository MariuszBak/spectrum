const STOPS = [[0,12,17,27],[.15,37,28,75],[.35,39,81,171],[.55,48,194,218],[.73,169,237,120],[.88,255,184,97],[1,255,245,231]];
const COLORS = Array.from({length:256},(_,i)=>{
  const value=i/255;let upper=1;
  while(upper<STOPS.length-1 && STOPS[upper][0]<value)upper++;
  const a=STOPS[upper-1],b=STOPS[upper],ratio=(value-a[0])/(b[0]-a[0]);
  return [1,2,3].map(k=>Math.round(a[k]+(b[k]-a[k])*ratio));
});

export function waterfallLevelRange(floor=-100,zoom=1,offset=0){
  const factor=Math.max(1,Math.min(16,Number(zoom)||1));
  const span=Math.max(40,Math.min(120,-Number(floor)||100))/factor;
  const maxLevel=Math.max(-120,Math.min(0,Number(offset)||0));
  return {minLevel:maxLevel-span,maxLevel,span};
}

export class WaterfallBuffer {
  constructor(columns=1024,maxRows=240){this.columns=columns;this.maxRows=maxRows;this.minFrequency=20;this.maxFrequency=20000;this.revision=0;this.reset();}
  reset(){this.rows=[];this.segments=null;this.revision++;this.bitmap=null;}
  configure(minFrequency,maxFrequency){
    if(minFrequency!==this.minFrequency||maxFrequency!==this.maxFrequency){this.minFrequency=minFrequency;this.maxFrequency=maxFrequency;this.reset();}
  }
  push(data,binHz,time){
    const high=Math.min(this.maxFrequency,(data.length-1)*binHz),low=Math.min(this.minFrequency,high-10);
    const key=[binHz,data.length,low,high].join(':');
    if(this.segmentKey!==key||!this.segments){
      this.segmentKey=key;
      this.segments=Array.from({length:this.columns},(_,i)=>{
        const a=Math.max(1,Math.min(data.length-1,Math.floor(low*(high/low)**(i/this.columns)/binHz)));
        const b=Math.max(a+1,Math.min(data.length,Math.ceil(low*(high/low)**((i+1)/this.columns)/binHz)));
        return [a,b];
      });
    }
    const levels=new Float32Array(this.columns);
    this.segments.forEach(([a,b],i)=>{
      let power=0;for(let k=a;k<b;k++)if(Number.isFinite(data[k]))power+=10**(data[k]/10);
      levels[i]=power>0?10*Math.log10(power/(b-a)):-Infinity;
    });
    this.rows.unshift({time,levels});if(this.rows.length>this.maxRows)this.rows.pop();
    this.revision++;
  }
  render(floor,gain=0,zoom=1,offset=0){
    const range=waterfallLevelRange(floor,zoom,offset);
    const key=this.revision+':'+floor+':'+gain+':'+zoom+':'+offset;if(this.bitmapKey===key&&this.bitmap)return this.bitmap;
    const pixels=new Uint8ClampedArray(this.columns*this.maxRows*4);
    for(let row=0;row<this.maxRows;row++)for(let col=0;col<this.columns;col++){
      const level=this.rows[row]?.levels[col]??-Infinity;
      const index=Math.max(0,Math.min(255,Math.round((level+gain-range.minLevel)/range.span*255)));
      const color=COLORS[index],offset=(row*this.columns+col)*4;
      pixels[offset]=color[0];pixels[offset+1]=color[1];pixels[offset+2]=color[2];pixels[offset+3]=255;
    }
    this.bitmapKey=key;this.bitmap={width:this.columns,height:this.maxRows,pixels};return this.bitmap;
  }
}
