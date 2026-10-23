const toDb = power => 10 * Math.log10(Math.max(power, 1e-12));
const distance = (a, b, binHz) => Math.abs(a - b) / Math.max(4 * binHz, Math.min(a, b) * (2 ** (1 / 12) - 1));
const HOLD_MS = 1500;
const ACQUIRE_MS = 450;
const REPLACE_MS = 800;

export class PeakTracker {
  constructor() { this.minLevel = -85; this.minFrequency = 20; this.maxFrequency = 20000; this.maxPeaks = 3; this.reset(); }

  configure({ floor = -100, minFrequency = 20, maxFrequency = 20000, maxPeaks = this.maxPeaks } = {}) {
    this.minLevel = Math.max(-105, Math.min(-25, floor + 15));
    this.minFrequency = minFrequency;
    this.maxFrequency = maxFrequency;
    this.slots = this.slots.map(t => t && t.frequency >= minFrequency && t.frequency <= maxFrequency && t.level >= this.minLevel ? t : null);
    this.pending = this.pending.filter(p => p.frequency >= minFrequency && p.frequency <= maxFrequency && p.level >= this.minLevel);
    if ([1, 2, 3].includes(maxPeaks) && maxPeaks !== this.maxPeaks) {
      this.maxPeaks = maxPeaks;
      this.slots = this.slots.filter(Boolean).sort((a, b) => Number(a.held) - Number(b.held) || b.level - a.level).slice(0, maxPeaks);
      while (this.slots.length < maxPeaks) this.slots.push(null);
    }
  }

  reset() {
    this.power = null;
    this.previousTime = null;
    this.pending = [];
    this.slots = Array(this.maxPeaks).fill(null);
  }

  resume(now) {
    if (this.previousTime !== null) {
      const gap = now - this.previousTime;
      for (const track of [...this.slots, ...this.pending]) {
        if (!track) continue;
        track.lastSeen += gap;
        if (track.since !== undefined) track.since += gap;
        if (track.displayAt !== undefined) track.displayAt += gap;
        if (track.replaceSince !== undefined) track.replaceSince += gap;
        if (track.feedbackUntil) track.feedbackUntil += gap;
        for (const sample of track.history || []) sample.time += gap;
      }
    }
    this.previousTime = now;
  }

  update(data, binHz, now) {
    const dt = this.previousTime === null ? 100 : Math.max(1, Math.min(250, now - this.previousTime));
    this.previousTime = now;
    const fresh = !this.power || this.power.length !== data.length;
    if (fresh) this.power = new Float64Array(data.length);
    const alpha = fresh ? 1 : 1 - Math.exp(-dt / 180);
    for (let i = 0; i < data.length; i++) {
      const power = Number.isFinite(data[i]) ? 10 ** (data[i] / 10) : 0;
      this.power[i] += alpha * (power - this.power[i]);
    }
    const peaks = this.detect(data, binHz);
    const used = new Set();

    // Assign the nearest frequency first; a rank change never swaps colours.
    const pairs = [];
    this.slots.forEach((track, slot) => {
      if (!track) return;
      peaks.forEach((peak, index) => {
        const delta = distance(track.frequency, peak.frequency, binHz);
        if (delta < 1) pairs.push({ slot, index, delta });
      });
    });
    pairs.sort((a, b) => a.delta - b.delta);
    const matched = new Set();
    for (const pair of pairs) {
      if (matched.has(pair.slot) || used.has(pair.index)) continue;
      const track = this.slots[pair.slot], peak = peaks[pair.index];
      if (now - track.lastSeen > 250) track.history = [];
      track.frequency += (peak.frequency - track.frequency) * (1 - Math.exp(-dt / 300));
      track.level += (peak.level - track.level) * (1 - Math.exp(-dt / 300));
      track.lastSeen = now;
      track.held = false;
      track.history.push({ ...peak, time: now });
      matched.add(pair.slot);
      used.add(pair.index);
    }
    this.slots.forEach((track, index) => {
      if (!track) return;
      if (now - track.lastSeen > HOLD_MS) this.slots[index] = null;
      else {
        track.held = !matched.has(index);
        if (track.held) { track.feedback = false; track.feedbackUntil = 0; }
      }
    });

    const previousPending = this.pending;
    const consumed = new Set();
    this.pending = [];
    peaks.forEach((peak, index) => {
      if (used.has(index) || this.slots.some(t => t && distance(t.frequency, peak.frequency, binHz) < 1)) return;
      let best = -1, bestDistance = 1;
      previousPending.forEach((old, i) => {
        const d = distance(old.frequency, peak.frequency, binHz);
        if (!consumed.has(i) && now - old.lastSeen <= 250 && d < bestDistance) { best = i; bestDistance = d; }
      });
      if (best >= 0) consumed.add(best);
      const pending = { ...peak, since: best >= 0 ? previousPending[best].since : now, lastSeen: now };
      this.pending.push(pending);
    });

    for (const candidate of this.pending) {
      const age = now - candidate.since;
      if (age < ACQUIRE_MS) continue;
      if (this.slots.some(t => t && distance(t.frequency, candidate.frequency, binHz) < 1)) continue;
      let slot = this.slots.findIndex(t => !t);
      if (slot < 0) {
        slot = this.slots.reduce((weakest, t, i, all) => t.level < all[weakest].level ? i : weakest, 0);
        const weakest = this.slots[slot];
        const enough = candidate.level > weakest.level + 4;
        if (!enough) { candidate.replaceSince = undefined; continue; }
        const old = previousPending.find(p => distance(p.frequency, candidate.frequency, binHz) < 1);
        candidate.replaceSince = old?.replaceSince ?? now;
        if (now - candidate.replaceSince < REPLACE_MS) continue;
      }
      this.slots[slot] = { frequency: candidate.frequency, level: candidate.level, lastSeen: now, held: false, displayAt: -Infinity, history: [{ ...candidate, time: now }], feedback: false };
    }

    for (const track of this.slots) {
      if (track && !track.held) this.assessFeedback(track, now, binHz);
      if (!track || now - track.displayAt < 500) continue;
      const step = track.frequency >= 10000 ? 10 : track.frequency >= 1000 ? 5 : 1;
      const rounded = Math.round(track.frequency / step) * step;
      if (!track.displayFrequency || Math.abs(rounded - track.displayFrequency) >= Math.max(step, binHz * .6, track.frequency * .002)) track.displayFrequency = rounded;
      track.displayLevel = Math.round(track.level);
      track.displayAt = now;
    }
    return this.slots;
  }

  assessFeedback(track, now, binHz) {
    track.history = track.history.filter(p => now - p.time <= 3000);
    const history = track.history;
    const age = history.length ? now - history[0].time : 0;
    if (age < 900) { track.feedback = false; return; }
    const recent = history.filter(p => now - p.time <= 1600);
    const frequencies = recent.map(p => p.frequency);
    const stable = Math.max(...frequencies) - Math.min(...frequencies) <= Math.max(2 * binHz, track.frequency * .008);
    const narrow = recent.every(p => p.widthHz <= Math.max(6 * binHz, p.frequency * .025));
    const clear = recent.every(p => p.prominence >= 12);
    const level = recent[recent.length - 1].level;
    const growth = level - recent[0].level;
    const sustained = age >= 2500 && recent.every(p => p.prominence >= 16);
    if (stable && narrow && clear && level >= this.minLevel + 15 && (growth >= 4 || sustained)) track.feedbackUntil = now + 1200;
    track.feedback = now < (track.feedbackUntil || 0);
  }

  detect(raw, binHz) {
    const first = Math.max(1, Math.ceil(this.minFrequency / binHz));
    const last = Math.min(this.power.length - 2, Math.floor(this.maxFrequency / binHz));
    let strongest = -120;
    for (let i = first; i <= last; i++) strongest = Math.max(strongest, toDb(this.power[i]));
    const candidates = [];
    for (let i = first; i <= last; i++) {
      const p = this.power[i];
      if (!(p > this.power[i - 1] && p >= this.power[i + 1])) continue;
      const level = toDb(p);
      if (level < this.minLevel || level < strongest - 30 || !Number.isFinite(raw[i]) || raw[i] < level - 9) continue;
      const radius = Math.max(8, Math.round(i * .15));
      const background = [];
      const stride = Math.max(1, Math.ceil(2 * radius / 32));
      for (let j = Math.max(first, i - radius); j <= Math.min(last, i + radius); j += stride) {
        if (Math.abs(j - i) > 2) background.push(this.power[j]);
      }
      background.sort((a, b) => a - b);
      const prominence = background.length ? level - toDb(background[Math.floor(background.length / 2)]) : 0;
      if (prominence < 6) continue;
      let lower = i, upper = i;
      while (lower > first && this.power[lower - 1] >= p / 4) lower--;
      while (upper < last && this.power[upper + 1] >= p / 4) upper++;
      const widthHz = (upper - lower + 1) * binHz;
      const a = toDb(this.power[i - 1]), b = level, c = toDb(this.power[i + 1]);
      const denominator = a - 2 * b + c;
      const delta = denominator ? Math.max(-.5, Math.min(.5, .5 * (a - c) / denominator)) : 0;
      candidates.push({ frequency: (i + delta) * binHz, level, prominence, widthHz });
    }
    candidates.sort((a, b) => b.level - a.level);
    const distinct = [];
    for (const peak of candidates) {
      if (distinct.every(p => distance(p.frequency, peak.frequency, binHz) >= 1)) distinct.push(peak);
      if (distinct.length === 24) break;
    }
    return distinct;
  }
}
