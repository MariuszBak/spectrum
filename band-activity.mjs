export const VOICE_BANDS = [
  {
    "label": "20–63 Hz",
    "description": "Pomruk · drżenie",
    "centers": [
      20,
      25,
      31.5,
      40,
      50,
      63
    ],
    "hue": 30
  },
  {
    "label": "80 Hz",
    "description": "Głęboki bas",
    "centers": [
      80
    ],
    "hue": 44
  },
  {
    "label": "100–125 Hz",
    "description": "Ciężkie MMM",
    "centers": [
      100,
      125
    ],
    "hue": 58
  },
  {
    "label": "160–200 Hz",
    "description": "Ciepłe UUU",
    "centers": [
      160,
      200
    ],
    "hue": 72
  },
  {
    "label": "250–315 Hz",
    "description": "Głuche UUU",
    "centers": [
      250,
      315
    ],
    "hue": 86
  },
  {
    "label": "400–500 Hz",
    "description": "Pudełkowe OOO",
    "centers": [
      400,
      500
    ],
    "hue": 99
  },
  {
    "label": "630–800 Hz",
    "description": "Gardłowe AAA",
    "centers": [
      630,
      800
    ],
    "hue": 113
  },
  {
    "label": "1 kHz",
    "description": "Nosowe AAA",
    "centers": [
      1000
    ],
    "hue": 127
  },
  {
    "label": "1,25 kHz",
    "description": "Twarde AAA",
    "centers": [
      1250
    ],
    "hue": 141
  },
  {
    "label": "1,6 kHz",
    "description": "Jasne EEE",
    "centers": [
      1600
    ],
    "hue": 155
  },
  {
    "label": "2 kHz",
    "description": "Przenikliwe EEE",
    "centers": [
      2000
    ],
    "hue": 169
  },
  {
    "label": "2,5 kHz",
    "description": "Ostre EEE–III",
    "centers": [
      2500
    ],
    "hue": 183
  },
  {
    "label": "3,15 kHz",
    "description": "Cienkie III",
    "centers": [
      3150
    ],
    "hue": 197
  },
  {
    "label": "4 kHz",
    "description": "Szorstkie ŚŚŚ",
    "centers": [
      4000
    ],
    "hue": 211
  },
  {
    "label": "5 kHz",
    "description": "Szeleszczące SZ",
    "centers": [
      5000
    ],
    "hue": 224
  },
  {
    "label": "6,3 kHz",
    "description": "Syczące SSS",
    "centers": [
      6300
    ],
    "hue": 238
  },
  {
    "label": "8 kHz",
    "description": "Ostre SSS",
    "centers": [
      8000
    ],
    "hue": 252
  },
  {
    "label": "10 kHz",
    "description": "Powietrzny syk",
    "centers": [
      10000
    ],
    "hue": 266
  },
  {
    "label": "12,5–20 kHz",
    "description": "Powietrze · szelest",
    "centers": [
      12500,
      16000,
      20000
    ],
    "hue": 280
  }
];
const CENTERS=VOICE_BANDS.flatMap(band=>band.centers);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export class BandActivity {
  constructor(){
    this.bounds=VOICE_BANDS.map(band=>{
      const first=CENTERS.indexOf(band.centers[0]),last=first+band.centers.length-1;
      return {low:first?Math.sqrt(CENTERS[first-1]*CENTERS[first]):CENTERS[first]/2**(1/6),high:last<CENTERS.length-1?Math.sqrt(CENTERS[last]*CENTERS[last+1]):CENTERS[last]*2**(1/6)};
    });
    this.floor=-100;this.minFrequency=20;this.maxFrequency=20000;this.reset();
  }
  reset(){this.previousTime=null;this.states=VOICE_BANDS.map(()=>({value:0,level:-Infinity,enabled:true,holdUntil:0,target:0}));this.configure({floor:this.floor,minFrequency:this.minFrequency,maxFrequency:this.maxFrequency});}
  configure({floor=-100,minFrequency=20,maxFrequency=20000}={}){
    this.floor=floor;this.minFrequency=minFrequency;this.maxFrequency=maxFrequency;
    this.states.forEach((state,i)=>{
      state.enabled=this.bounds[i].high>minFrequency&&this.bounds[i].low<maxFrequency;
      if(!state.enabled){state.value=0;state.target=0;state.holdUntil=0;state.level=-Infinity;}
    });
  }
  update(data,binHz,now){
    const dt=this.previousTime===null?100:clamp(now-this.previousTime,1,250);this.previousTime=now;
    const levels=this.bounds.map((band,i)=>{
      if(!this.states[i].enabled)return -Infinity;
      const low=Math.max(band.low,this.minFrequency),high=Math.min(band.high,this.maxFrequency);
      const first=Math.max(1,Math.ceil(low/binHz)),last=Math.min(data.length-1,Math.ceil(high/binHz)-1);
      let level=-Infinity;for(let k=first;k<=last;k++)if(Number.isFinite(data[k]))level=Math.max(level,data[k]);
      return level;
    });
    const strongest=Math.max(...levels),gate=this.floor+15;
    this.states.forEach((state,i)=>{
      state.level=levels[i];if(!state.enabled)return;
      let target=0;
      if(Number.isFinite(levels[i])&&levels[i]>=gate+3&&levels[i]>=strongest-24){
        target=(.2+.8*clamp((levels[i]-gate)/32,0,1))*clamp((levels[i]-strongest+24)/18,0,1);
        state.target=target;state.holdUntil=now+300;
      }else if(now<state.holdUntil)target=state.target;
      const alpha=1-Math.exp(-dt/(target>state.value?80:550));
      state.value+=alpha*(target-state.value);if(state.value<.005)state.value=0;
    });
    return this.states;
  }
}
