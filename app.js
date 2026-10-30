import { PeakTracker } from './peak-tracker.mjs?v=26.10.5';
import { VOICE_BANDS, BandActivity } from './band-activity.mjs?v=26.10.5';
import { WaterfallBuffer } from './waterfall.mjs?v=26.10.5';

const $ = id => document.getElementById(id);
const FFT_SIZE = 16384;
const peakTracker = new PeakTracker();
const waterfallBuffer = new WaterfallBuffer();
const bandActivity = new BandActivity();
let waterfallBitmap, waterfallBitmapRevision=-1, waterfallBitmapFloor;
let frequencyProbe = null;
const peakColors = ['#ffd18b', '#83d9ff', '#eeb1f7'];
const numberFormat = new Intl.NumberFormat('pl-PL');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const db = x => x > 0 ? 20 * Math.log10(x) : -Infinity;
let ctx, stream, analyser, processor, frequencyData;
let sampleRate = 48000, state = 'idle', busy = false, sessionId = 0;
let raf = 0, lastFrame = -Infinity, lastPeakUpdate = -Infinity;
let rmsDb = -Infinity, peakDb = -Infinity, maxDb = -Infinity, maxRmsDb = -Infinity, needle = -90;
let peakCount = 3;
let spectrumFloor = -100, frequencyFrom = 20, frequencyTo = 20000;
let mode = 'analog', view = 'spectrum', unit = 'dbfs', offset = 100, dbmOffset = null, feedbackEnabled = true;
try {
  const saved = JSON.parse(localStorage.getItem('spectrum-settings') || '{}');
  mode = saved.mode === 'bar' ? 'bar' : 'analog';
  view = ['spectrum','waterfall','level','bands'].includes(saved.view) ? saved.view : 'spectrum';
  unit = ['dbfs', 'spl', 'dbm'].includes(saved.unit) ? saved.unit : saved.calibrated ? 'spl' : 'dbfs';
  offset = Number.isFinite(saved.offset) ? saved.offset : 100;
  dbmOffset = Number.isFinite(saved.dbmOffset) ? saved.dbmOffset : null;
  feedbackEnabled = saved.feedbackEnabled !== false;
  peakCount = [1,2,3].includes(saved.peakCount) ? saved.peakCount : 3;
  spectrumFloor = Number.isFinite(saved.spectrumFloor) ? clamp(Math.round(saved.spectrumFloor / 5) * 5, -120, -40) : -100;
  if (Number.isFinite(saved.frequencyFrom) && Number.isFinite(saved.frequencyTo) && saved.frequencyFrom >= 20 && saved.frequencyTo <= 20000 && saved.frequencyTo - saved.frequencyFrom >= 10) { frequencyFrom = saved.frequencyFrom; frequencyTo = saved.frequencyTo; }
  $('smooth').value = ['0', '0.65', '0.85'].includes(String(saved.smooth)) ? String(saved.smooth) : '0.65';
} catch {}
$('units').value = unit;
$('offset').value = offset;
$('meterType').value = mode;
$('feedbackEnabled').checked = feedbackEnabled;

const correction = () => unit === 'spl' ? offset : unit === 'dbm' ? dbmOffset : 0;
const shown = x => Number.isFinite(x) && correction() !== null ? (x + correction()).toFixed(1) : '—';
const tick = x => correction() === null ? '—' : String(Math.round((x + correction()) * 10) / 10);
const unitName = () => unit === 'spl' ? 'dB SPL · est.' : unit === 'dbm' ? (dbmOffset === null ? 'dBm · skalibruj' : 'dBm · kal.') : 'dBFS';
function save() {
  try { localStorage.setItem('spectrum-settings', JSON.stringify({ mode, view, unit, offset, dbmOffset, feedbackEnabled, peakCount, spectrumFloor, frequencyFrom, frequencyTo, smooth: Number($('smooth').value) })); } catch {}
}
function readings() {
  $('level').textContent = shown(rmsDb);
  $('peak').textContent = shown(peakDb);
  $('max').textContent = shown(maxDb);
  $('maxRms').textContent = shown(maxRmsDb);
  $('levelUnit').textContent = $('unitBadge').textContent = unitName();
  document.querySelectorAll('.reading-unit').forEach(el => el.textContent = unitName());
}
function unitUI() {
  $('splSettings').hidden = unit !== 'spl';
  $('dbmSettings').hidden = unit !== 'dbm';
  $('dbmCalibration').textContent = dbmOffset === null ? 'Brak kalibracji dBm.' : `Kalibracja zapisana · korekta ${dbmOffset.toFixed(1)} dB`;
  $('meterTypeLabel').textContent = mode === 'analog' ? 'WSKAZÓWKA' : 'BARGRAF';
}
function spectrumUI() {
  clearFrequencyProbe(false);
  $('peakCount').value = peakCount;
  $('peakCards').style.setProperty('--peak-count',peakCount);
  $('peakCards').setAttribute('aria-label',`Dominujące częstotliwości: ${peakCount}`);
  $('spectrumFloor').value = spectrumFloor;
  $('floorValue').textContent = `${spectrumFloor} dBFS`;
  $('floorHint').textContent = `Skala: ${spectrumFloor}…0 dBFS. Piki od ${spectrumFloor + 15} dBFS.`;
  $('frequencyFrom').value = frequencyFrom;
  $('frequencyTo').value = frequencyTo;
  $('spectrum').setAttribute('aria-label', `Widmo od ${frequencyFrom} do ${frequencyTo} Hz · liczba pików: ${peakCount}`);
  peakTracker.configure({ floor: spectrumFloor, minFrequency: frequencyFrom, maxFrequency: frequencyTo, maxPeaks: peakCount });
  waterfallBuffer.configure(frequencyFrom, frequencyTo);
  bandActivity.configure({floor:spectrumFloor,minFrequency:frequencyFrom,maxFrequency:frequencyTo});
  renderBands();
  $('waterfallScale').textContent = `${spectrumFloor}…0 dBFS`;
  if (analyser) analyser.minDecibels = spectrumFloor;
  renderPeaks();
}
function changeFrequencyRange() {
  const rawFrom = String($('frequencyFrom').value).trim(), rawTo = String($('frequencyTo').value).trim();
  const low = Number(rawFrom), high = Number(rawTo);
  if (!rawFrom || !rawTo || !Number.isFinite(low) || !Number.isFinite(high) || low < 20 || high > 20000 || high - low < 10) {
    $('rangeHint').textContent = 'Zakres: 20–20 000 Hz; szerokość co najmniej 10 Hz.';
    $('frequencyFrom').value = frequencyFrom; $('frequencyTo').value = frequencyTo; return;
  }
  frequencyFrom = Math.round(low); frequencyTo = Math.round(high);
  $('rangeHint').textContent = 'Wykrywanie pików w wybranym paśmie.';
  spectrumUI(); save(); draw();
}
function message(text = '', error = false) {
  $('message').textContent = $('message').title = text;
  $('message').classList.toggle('error', error);
}
function stateUI() {
  const active = state === 'running';
  $('status').textContent = active ? 'NA ŻYWO' : state === 'starting' ? 'ŁĄCZENIE' : state === 'stopped' ? 'STOP' : 'GOTOWY';
  $('status').classList.toggle('live', active);
  $('start').classList.toggle('running', active);
  $('start').disabled = busy;
  $('startText').textContent = state === 'starting' ? '…' : active ? 'Stop' : 'Start';
  $('playIcon').textContent = active ? '■' : '▶';
  $('start').setAttribute('aria-label', active ? 'Zatrzymaj pomiar i wyłącz mikrofon' : 'Uruchom mikrofon i pomiar');
  $('empty').hidden = !!frequencyData;
  renderPeaks();
}
function setView(next) {
  clearFrequencyProbe(false);
  if(next!==view){peakTracker.reset();lastPeakUpdate=-Infinity;if(next==='waterfall')waterfallBuffer.reset();if(next==='bands')bandActivity.reset();}
  view = next;
  $('spectrumView').hidden=view!=='spectrum'&&view!=='waterfall';$('levelView').hidden=view!=='level';$('bandsView').hidden=view!=='bands';
  $('spectrumView').classList.toggle('waterfall-mode',view==='waterfall');
  $('spectrumView').setAttribute('aria-labelledby',view==='waterfall'?'waterfallTab':'spectrumTab');
  $('spectrumTitle').textContent=view==='waterfall'?'Widmo + Waterfall':'Widmo';
  $('waterfallBox').hidden=view!=='waterfall';$('peakCards').hidden=view==='waterfall';$('peakStatus').hidden=view==='waterfall';
  for(const name of ['spectrum','waterfall','level','bands']){$(name+'Tab').setAttribute('aria-selected',String(name===view));$(name+'Tab').tabIndex=name===view?0:-1;}
  renderPeaks();save();draw();
}
function surface(id) {
  const canvas = $(id), rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, rect.width, rect.height);
  return [c, rect.width, rect.height];
}
function renderBands(){
  let active=0;
  bandActivity.states.forEach((band,i)=>{
    const card=$('bandCard'+i),lit=band.enabled&&band.value>=.16;
    card.style.setProperty('--activity',band.value.toFixed(3));
    card.classList.toggle('lit',lit);card.classList.toggle('out-of-band',!band.enabled);
    const details=Number.isFinite(band.level)?`${Math.round(band.level)} dBFS`:band.enabled?'Brak aktywności':'Poza wybranym pasmem';
    card.title=`${VOICE_BANDS[i].label} · ${VOICE_BANDS[i].description} · ${details}`;
    if(lit)active++;
  });
  $('bandsStatus').textContent=`${active} ${active===1?'pasmo':active>=2&&active<=4?'pasma':'pasm'}`;
  const format=f=>f>=1000?`${Math.round(f/100)/10} kHz`:`${f} Hz`;
  $('bandsRange').textContent=`${format(frequencyFrom)}–${format(frequencyTo)}`;
}
function drawMeter() {
  const s = surface('meter'); if (!s) return;
  const [c, w, h] = s, value = clamp(needle, -90, 0);
  c.font = '10px ui-monospace, monospace'; c.textAlign = 'center';
  if (mode === 'analog') {
    const cx = w / 2, cy = h - 12, r = Math.min(w * .44, h * .92);
    if (r < 22) return;
    const start = -Math.PI * .88, end = -Math.PI * .12;
    const angle = v => start + (v + 90) / 90 * (end - start);
    c.lineWidth = 9; c.strokeStyle = '#2d3c37'; c.beginPath(); c.arc(cx, cy, r, start, end); c.stroke();
    c.lineWidth = 4; c.strokeStyle = '#b9f27a'; c.beginPath(); c.arc(cx, cy, r, start, angle(value)); c.stroke();
    const labelStep = r < 95 ? 30 : 15;
    for (let v = -90; v <= 0; v += 5) {
      const a = angle(v), major = v % labelStep === 0;
      c.strokeStyle = v >= -10 ? '#ffd18b' : '#8caa91'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * (r - 9), cy + Math.sin(a) * (r - 9));
      c.lineTo(cx + Math.cos(a) * (r - (major ? 19 : 13)), cy + Math.sin(a) * (r - (major ? 19 : 13))); c.stroke();
      if (major && r > 60) { c.fillStyle = '#a1b6a9'; c.fillText(tick(v), cx + Math.cos(a) * (r - 32), cy + Math.sin(a) * (r - 32) + 3); }
    }
    const a = angle(value);
    c.strokeStyle = '#e5f5d0'; c.lineWidth = 2; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * (r - 22), cy + Math.sin(a) * (r - 22)); c.stroke();
    c.fillStyle = '#b9f27a'; c.beginPath(); c.arc(cx, cy, 5, 0, 2 * Math.PI); c.fill();
  } else {
    const x = 22, bw = w - 44, bh = Math.max(12, Math.min(70, h * .4)), y = Math.max(5, (h - bh - 25) / 2), n = 45;
    for (let i = 0; i < n; i++) { c.fillStyle = i / n < (value + 90) / 90 ? (i > 40 ? '#ff939f' : i > 34 ? '#ffd18b' : '#b9f27a') : '#2a3742'; c.fillRect(x + i * bw / n, y, bw / n - 3, bh); }
    for (let v = -90; v <= 0; v += 15) { c.fillStyle = '#91a1b7'; c.fillText(tick(v), x + (v + 90) / 90 * bw, y + bh + 20); }
    if (Number.isFinite(maxDb)) { const xx = x + clamp((maxDb + 90) / 90, 0, 1) * bw; c.fillStyle = '#fff'; c.fillRect(xx - 1, y - 4, 2, bh + 8); }
  }
}
function renderPeaks() {
  const tracks = peakTracker.slots, live = tracks.filter(t => t && !t.held);
  const strongest = live.reduce((best, t) => !best || t.level > best.level ? t : best, null);
  let suspects = 0;
  for(let i=0;i<3;i++){
    const track=tracks[i];$('peakCard'+i).hidden=i>=peakCount;
    const suspected = !!track && feedbackEnabled && track.feedback && !track.held;
    if (suspected) suspects++;
    $('peakFrequency' + i).textContent = track ? numberFormat.format(track.displayFrequency) : '—';
    $('peakLevel' + i).textContent = track ? `${track.displayLevel} dBFS` : '— dBFS';
    $('peakState' + i).textContent = !track ? '—' : state !== 'running' ? 'ZATRZYMANO' : track.held ? 'PODTRZYMANIE' : suspected ? 'WZBUDZENIE?' : track === strongest ? 'NAJSILNIEJSZY' : 'STABILNY';
    $('peakCard' + i).classList.toggle('held', !!track?.held);
    $('peakCard' + i).classList.toggle('detected', !!track);
    $('peakCard' + i).classList.toggle('suspected', suspected && state === 'running');
  }
  $('peakStatus').textContent = state === 'stopped' ? 'ZATRZYMANE' : suspects && state === 'running' ? `WZBUDZENIE? ${suspects}` : state === 'running' && !live.length ? 'SZUKAM PIKÓW' : peakCount===1?'1 PIK':`${peakCount} PIKI`;
  $('peakStatus').classList.toggle('alert', suspects > 0 && state === 'running');
}
function drawPeakMarkers(c, x, y, top, bottom, left, right) {
  peakTracker.slots.forEach((track, i) => {
    if (!track) return;
    const xx = x(track.displayFrequency); if (xx < left || xx > right) return;
    let level = track.markerLevel ?? track.displayLevel;
    if (!track.held && frequencyData) {
      const bin = Math.round(track.displayFrequency / (sampleRate / FFT_SIZE)); level = spectrumFloor;
      for (let k = Math.max(1, bin - 2); k <= Math.min(frequencyData.length - 1, bin + 2); k++) level = Math.max(level, frequencyData[k]);
      track.markerLevel = level;
    }
    const yy = y(level), suspected = feedbackEnabled && track.feedback && !track.held;
    c.save(); c.globalAlpha = track.held ? .45 : 1;
    c.strokeStyle = c.fillStyle = peakColors[i]; c.lineWidth = 1; c.setLineDash([3, 4]);
    c.beginPath(); c.moveTo(xx, top); c.lineTo(xx, bottom); c.stroke(); c.setLineDash([]);
    if (suspected) { c.strokeStyle = '#ff939f'; c.lineWidth = 2; c.beginPath(); c.arc(xx, yy, 10, 0, 2 * Math.PI); c.stroke(); }
    c.beginPath(); c.arc(xx, yy, 5, 0, 2 * Math.PI); c.fill(); c.strokeStyle = '#0c111b'; c.lineWidth = 2; c.stroke();
    const bx = clamp(xx, left + 10, right - 10), by = top + 11 + i * 22;
    c.fillStyle = peakColors[i]; c.beginPath(); c.arc(bx, by, 9, 0, 2 * Math.PI); c.fill();
    c.fillStyle = '#101623'; c.font = 'bold 11px ui-monospace, monospace'; c.textAlign = 'center'; c.fillText(String(i + 1), bx, by + 4); c.restore();
  });
}
function plotBounds(id,w,h){return {left:34,right:w-12,top:id==='spectrum'?14:8,bottom:h-(id==='spectrum'?27:8)};}
function selectedFrequency(){
  const max=Math.min(frequencyTo,sampleRate/2),min=Math.min(frequencyFrom,max-10);
  return min*(max/min)**frequencyProbe.ratio;
}
function clearFrequencyProbe(redraw=true){
  frequencyProbe=null;$('frequencyProbe').hidden=true;if(redraw)draw();
}
function updateFrequencyProbe(id,event){
  const rect=$(id).getBoundingClientRect(),bounds=plotBounds(id,rect.width,rect.height);
  if(bounds.right<=bounds.left||bounds.bottom<=bounds.top)return;
  frequencyProbe={canvas:id,pointerId:event.pointerId,ratio:clamp((event.clientX-rect.left-bounds.left)/(bounds.right-bounds.left),0,1),heightRatio:clamp((event.clientY-rect.top-bounds.top)/(bounds.bottom-bounds.top),0,1)};
  event.preventDefault();draw();
}
function drawFrequencyProbe(c,id,left,right,top,bottom){
  if(!frequencyProbe)return;
  const xx=left+frequencyProbe.ratio*(right-left);
  c.save();c.strokeStyle='#f3f6fc';c.lineWidth=1.5;c.setLineDash([5,3]);
  c.beginPath();c.moveTo(xx,top);c.lineTo(xx,bottom);c.stroke();c.setLineDash([]);
  if(frequencyProbe.canvas===id){const yy=top+frequencyProbe.heightRatio*(bottom-top);c.fillStyle='#f3f6fc';c.beginPath();c.arc(xx,yy,4,0,2*Math.PI);c.fill();}
  c.restore();
}
function showFrequencyProbe(){
  if(!frequencyProbe||(view!=='spectrum'&&view!=='waterfall')){$('frequencyProbe').hidden=true;return;}
  const rect=$(frequencyProbe.canvas).getBoundingClientRect(),root=$('workspace').getBoundingClientRect(),bounds=plotBounds(frequencyProbe.canvas,rect.width,rect.height);
  const xx=rect.left-root.left+bounds.left+frequencyProbe.ratio*(bounds.right-bounds.left);
  const yy=rect.top-root.top+bounds.top+frequencyProbe.heightRatio*(bounds.bottom-bounds.top);
  const popup=$('frequencyProbe');$('probeFrequency').textContent=numberFormat.format(Math.round(selectedFrequency()));
  popup.style.left=clamp(xx-66,6,Math.max(6,root.width-138))+'px';
  popup.style.top=clamp(yy>=64?yy-62:yy+30,6,Math.max(6,root.height-44))+'px';
  popup.hidden=false;
}
function drawSpectrum() {
  const s = surface('spectrum'); if (!s) return;
  const [c, w, h] = s;const {left,right,top,bottom}=plotBounds('spectrum',w,h);
  if (right <= left || bottom <= top) return;
  const xmax = Math.min(frequencyTo, sampleRate / 2), xmin = Math.min(frequencyFrom, xmax - 10);
  const x = f => left + Math.log(f / xmin) / Math.log(xmax / xmin) * (right - left);
  const y = d => top + clamp(d, spectrumFloor, 0) / spectrumFloor * (bottom - top);
  c.font = '10px ui-monospace, monospace'; c.lineWidth = 1;
  for (let d = 0; d >= spectrumFloor; d -= h < 160 ? 40 : 20) {
    c.strokeStyle = '#263449'; c.beginPath(); c.moveTo(left, y(d)); c.lineTo(right, y(d)); c.stroke();
    c.fillStyle = '#8498b2'; c.textAlign = 'right'; c.fillText(d, left - 7, y(d) + 3);
  }
  const ticks = [xmin, xmax];
  for (let decade = 1; decade <= 10000; decade *= 10) for (const factor of [1, 2, 5]) {
    const frequency = factor * decade; if (frequency > xmin && frequency < xmax) ticks.push(frequency);
  }
  const ordered = [...new Set(ticks)].sort((a, b) => a - b); let previousLabel = -Infinity;
  for (const f of ordered) {
    const xx = x(f); c.strokeStyle = '#202d40'; c.beginPath(); c.moveTo(xx, top); c.lineTo(xx, bottom); c.stroke();
    const endpoint = f === xmin || f === xmax;
    if (!endpoint && (xx - previousLabel < 48 || right - xx < 48)) continue;
    c.textAlign = f === xmin ? 'left' : f === xmax ? 'right' : 'center'; c.fillStyle = '#91a1b7';
    c.fillText(f >= 1000 ? String(Math.round(f / 100) / 10) + 'k' : String(Math.round(f)), xx, h - 9); previousLabel = xx;
  }
  if (!frequencyData) {drawFrequencyProbe(c,'spectrum',left,right,top,bottom);return;}
  const binHz = sampleRate / FFT_SIZE, bins = frequencyData.length, cols = Math.floor(right - left), points = [];
  for (let i = 0; i < cols; i++) {
    const low = xmin * (xmax / xmin) ** (i / cols), high = xmin * (xmax / xmin) ** ((i + 1) / cols);
    const a = clamp(Math.floor(low / binHz), 1, bins - 1), b = clamp(Math.ceil(high / binHz), a + 1, bins);
    let value = spectrumFloor; for (let k = a; k < b; k++) value = Math.max(value, frequencyData[k]);
    points.push([left + i, y(value)]);
  }
  const fill = c.createLinearGradient(0, top, 0, bottom); fill.addColorStop(0, '#83d9ff45'); fill.addColorStop(1, '#83d9ff02');
  c.beginPath(); c.moveTo(left, bottom); for (const p of points) c.lineTo(...p); c.lineTo(right, bottom); c.closePath(); c.fillStyle = fill; c.fill();
  c.beginPath(); points.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.strokeStyle = '#99d8ed'; c.lineWidth = 1.5; c.stroke();
  if(view!=='waterfall')drawPeakMarkers(c, x, y, top, bottom, left, right);
  drawFrequencyProbe(c,'spectrum',left,right,top,bottom);
}
function drawWaterfall(){
  const s=surface('waterfall');if(!s)return;const[c,w,h]=s;const{left,right,top,bottom}=plotBounds('waterfall',w,h);
  if(right<=left||bottom<=top)return;
  if(!waterfallBitmap)waterfallBitmap=document.createElement('canvas');
  if(waterfallBitmapRevision!==waterfallBuffer.revision||waterfallBitmapFloor!==spectrumFloor){
    const bitmap=waterfallBuffer.render(spectrumFloor);waterfallBitmap.width=bitmap.width;waterfallBitmap.height=bitmap.height;
    const off=waterfallBitmap.getContext('2d'),image=off.createImageData(bitmap.width,bitmap.height);image.data.set(bitmap.pixels);off.putImageData(image,0,0);
    waterfallBitmapRevision=waterfallBuffer.revision;waterfallBitmapFloor=spectrumFloor;
  }
  c.imageSmoothingEnabled=false;c.drawImage(waterfallBitmap,left,top,right-left,bottom-top);
  c.font='9px ui-monospace,monospace';c.fillStyle='#91a1b7';c.textAlign='right';c.fillText('0 s',left-7,top+8);
  const rows=waterfallBuffer.rows,last=rows.at(-1),age=last?rows[0].time-last.time:0;
  $('waterfallInfo').textContent=Math.round(age/1000)+' s';let previous=top;
  for(let elapsed=5000;elapsed<=age;elapsed+=5000){
    const index=rows.findIndex(row=>rows[0].time-row.time>=elapsed),yy=top+index/waterfallBuffer.maxRows*(bottom-top);
    if(index>=0&&yy-previous>15){c.fillText('−'+elapsed/1000,left-7,yy+3);previous=yy;}
  }
  drawFrequencyProbe(c,'waterfall',left,right,top,bottom);
}
function draw() { if (view === 'level') drawMeter(); else if(view==='bands')renderBands(); else {drawSpectrum();if(view==='waterfall')drawWaterfall();} showFrequencyProbe(); }
function loop(t) {
  if (state !== 'running') return;
  if (t - lastFrame >= 33) {
    lastFrame = t; analyser.getFloatFrequencyData(frequencyData);
    if (t - lastPeakUpdate >= 100) { if(view==='spectrum'){peakTracker.update(frequencyData, sampleRate / FFT_SIZE, t);renderPeaks();}else if(view==='waterfall')waterfallBuffer.push(frequencyData,sampleRate/FFT_SIZE,t);else if(view==='bands')bandActivity.update(frequencyData,sampleRate/FFT_SIZE,t);lastPeakUpdate=t; }
    needle += (Math.max(-90, rmsDb) - needle) * .24;
    draw();
  }
  raf = requestAnimationFrame(loop);
}
function releaseAudio() {
  if (stream) stream.getTracks().forEach(track => { track.onended = null; track.stop(); });
  if (processor) { processor.port.onmessage = null; processor.disconnect(); }
  if (ctx) { ctx.onstatechange = null; void ctx.close().catch(() => {}); }
  stream = null; ctx = null; analyser = null; processor = null;
}
function stopCapture(text = '') {
  sessionId++; cancelAnimationFrame(raf); state = 'stopped'; releaseAudio();
  stateUI(); message(text); draw();
}
async function start() {
  if (busy) return;
  if (state === 'running') { stopCapture(); return; }
  busy = true; state = 'starting'; message(); stateUI();
  const request = ++sessionId;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
    const localContext = new (window.AudioContext || window.webkitAudioContext)(); ctx = localContext;
    await localContext.resume();
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false });
    if (request !== sessionId || document.hidden) { acquired.getTracks().forEach(t => t.stop()); if (localContext.state !== 'closed') await localContext.close(); return; }
    stream = acquired;
    await localContext.audioWorklet.addModule('processor.js');
    if (request !== sessionId || document.hidden) { releaseAudio(); return; }
    await localContext.resume();
    if (localContext.state !== 'running') throw new Error('resume');
    sampleRate = localContext.sampleRate;
    analyser = localContext.createAnalyser(); analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = Number($('smooth').value); analyser.minDecibels = spectrumFloor; analyser.maxDecibels = 0;
    frequencyData = new Float32Array(analyser.frequencyBinCount).fill(-Infinity);
    peakTracker.reset(); waterfallBuffer.reset(); bandActivity.reset(); rmsDb = peakDb = -Infinity; needle = -90;
    processor = new AudioWorkletNode(localContext, 'meter-processor');
    processor.port.onmessage = ({ data }) => {
      if (state !== 'running') return;
      rmsDb = db(data.rms); peakDb = db(data.peak); maxDb = Math.max(maxDb, peakDb); maxRmsDb = Math.max(maxRmsDb, rmsDb); readings();
    };
    const source = localContext.createMediaStreamSource(stream), silent = localContext.createGain(); silent.gain.value = 0;
    source.connect(analyser); source.connect(processor); processor.connect(silent).connect(localContext.destination);
    stream.getAudioTracks()[0].onended = () => stopCapture('Mikrofon został odłączony.');
    state = 'running'; lastFrame = lastPeakUpdate = -Infinity;
    localContext.onstatechange = () => { if (state === 'running' && localContext.state !== 'running') stopCapture('Audio przerwane. Naciśnij Start.'); };
    $('sampleRate').textContent = `${sampleRate / 1000} kHz · MONO`;
    readings(); raf = requestAnimationFrame(loop);
  } catch (e) {
    if (request === sessionId) {
      releaseAudio(); state = frequencyData ? 'stopped' : 'idle';
      const text = e.name === 'NotAllowedError' ? 'Zezwól na mikrofon w Safari.' : e.name === 'NotFoundError' ? 'Nie znaleziono mikrofonu.' : e.message === 'unsupported' ? 'Otwórz aplikację przez HTTPS w Safari.' : 'Audio niedostępne. Spróbuj ponownie.';
      message(text, true);
    }
  } finally { busy = false; if (state === 'starting') state = 'stopped'; stateUI(); draw(); }
}
function calibrate(kind) {
  const target = $(kind + 'Calibration'), raw = $(kind + 'Reference').value.trim(), reference = Number(raw);
  if (!raw || !Number.isFinite(reference) || reference < (kind === 'dbm' ? -200 : 0) || reference > (kind === 'dbm' ? 100 : 160)) { target.textContent = 'Podaj poprawny poziom odniesienia.'; return; }
  if (state !== 'running' || !Number.isFinite(rmsDb) || rmsDb < -90) { target.textContent = 'Uruchom pomiar i podaj stabilny sygnał odniesienia.'; return; }
  const value = reference - rmsDb;
  if (kind === 'dbm') dbmOffset = value;
  else { if (value < 0 || value > 160) { target.textContent = 'Korekta musi mieścić się w zakresie 0–160 dB.'; return; } offset = value; $('offset').value = offset.toFixed(1); }
  save(); unitUI(); target.textContent = `Kalibracja zapisana · korekta ${value.toFixed(1)} dB`; readings(); draw();
}
for(const id of ['spectrum','waterfall']){
  const canvas=$(id);
  canvas.addEventListener('pointerdown',event=>{
    if(event.isPrimary===false||event.button>0||(frequencyProbe&&frequencyProbe.pointerId!==event.pointerId))return;
    try{canvas.setPointerCapture(event.pointerId);}catch{}
    updateFrequencyProbe(id,event);
  },{passive:false});
  canvas.addEventListener('pointermove',event=>{if(frequencyProbe?.pointerId===event.pointerId&&frequencyProbe.canvas===id)updateFrequencyProbe(id,event);},{passive:false});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,event=>{if(frequencyProbe?.pointerId===event.pointerId&&frequencyProbe.canvas===id)clearFrequencyProbe();});
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
}
window.addEventListener('blur',()=>clearFrequencyProbe());
$('start').addEventListener('click', start);
$('spectrumTab').onclick = () => setView('spectrum');
$('levelTab').onclick = () => setView('level');
$('waterfallTab').onclick = () => setView('waterfall');
$('bandsTab').onclick = () => setView('bands');
for(const name of ['spectrum','waterfall','level','bands'])$(name+'Tab').onkeydown=e=>{
  if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
    e.preventDefault();const names=['spectrum','waterfall','level','bands'],index=names.indexOf(view);
    const next=e.key==='Home'?'spectrum':e.key==='End'?'level':names[(index+(e.key==='ArrowLeft'?3:1))%4];setView(next);$(next+'Tab').focus();
  }
};
$('settingsOpen').onclick = () => {clearFrequencyProbe();$('settings').showModal();};
$('settingsClose').onclick = () => $('settings').close();
$('settings').addEventListener('click', e => { if (e.target === $('settings')) { const r = $('settings').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('settings').close(); } });
$('units').onchange = () => { unit = $('units').value; save(); unitUI(); readings(); draw(); };
$('offset').onchange = () => { offset = clamp(Number($('offset').value) || 0, 0, 160); $('offset').value = offset; save(); readings(); draw(); };
$('meterType').onchange = () => { mode = $('meterType').value; save(); unitUI(); draw(); };
$('peakCount').onchange = () => { peakCount = Number($('peakCount').value); if(![1,2,3].includes(peakCount))peakCount=3; spectrumUI(); save(); draw(); };
$('spectrumFloor').oninput = () => { spectrumFloor = clamp(Number($('spectrumFloor').value), -120, -40); spectrumUI(); save(); draw(); };
$('frequencyFrom').onchange = $('frequencyTo').onchange = changeFrequencyRange;
$('resetSpectrum').onclick = () => { spectrumFloor = -100; frequencyFrom = 20; frequencyTo = 20000; $('rangeHint').textContent = 'Wykrywanie pików w wybranym paśmie.'; spectrumUI(); save(); draw(); };
$('smooth').onchange = () => { if (analyser) analyser.smoothingTimeConstant = Number($('smooth').value); save(); };
$('feedbackEnabled').onchange = () => { feedbackEnabled = $('feedbackEnabled').checked; save(); renderPeaks(); draw(); };
$('calibrateDbm').onclick = () => calibrate('dbm');
$('calibrateSpl').onclick = () => calibrate('spl');
$('reset').onclick = () => { maxDb = maxRmsDb = -Infinity; readings(); draw(); message('MAX wyzerowane'); };
document.addEventListener('visibilitychange', () => { if (document.hidden && (state === 'running' || state === 'starting')) stopCapture(); });
window.addEventListener('pagehide', () => { if (state === 'running' || state === 'starting') stopCapture(); });
function fitViewport() {
  const height = window.visualViewport?.height || window.innerHeight;
  if (height) document.documentElement.style.setProperty('--app-height', `${Math.floor(height)}px`);
  draw();
}
window.addEventListener('resize', fitViewport);
window.visualViewport?.addEventListener('resize', fitViewport);
if (typeof ResizeObserver !== 'undefined') { const observer = new ResizeObserver(() => requestAnimationFrame(draw)); observer.observe($('spectrum')); observer.observe($('meter')); observer.observe($('waterfall')); }
unitUI(); readings(); stateUI(); spectrumUI(); setView(view); fitViewport();
