import type { RepResult } from './types';

export type RepPhase = 'rest' | 'rising' | 'returning';

interface Sample {
  t: number;
  angle: number;
  flags: Record<string, boolean>;
}

/**
 * Rep state machine over the filtered joint angle.
 *   rest → rising once angle exceeds rest + startDelta
 *   rising → returning once angle falls below peak − 35% of the achieved range
 *   returning → rest once angle is back within returnDelta of rest; the rep is scored
 */
export class RepDetector {
  phase: RepPhase = 'rest';
  reps: RepResult[] = [];
  private samples: Sample[] = [];
  private peak = 0;
  private startT = 0;

  constructor(private restAngle: number, private minRepRom: number, private startDelta = 12, private returnDelta = 18) {}

  /** Re-anchor the rest angle after calibration. */
  setRest(rest: number) {
    this.restAngle = rest;
  }

  get currentPeak() {
    return this.phase === 'rest' ? 0 : this.peak;
  }

  update(t: number, angle: number, flags: Record<string, boolean>): RepResult | null {
    const rel = angle - this.restAngle;
    switch (this.phase) {
      case 'rest':
        if (rel > this.startDelta) {
          this.phase = 'rising';
          this.startT = t;
          this.peak = angle;
          this.samples = [{ t, angle, flags }];
        }
        return null;
      case 'rising':
        this.samples.push({ t, angle, flags });
        if (angle > this.peak) {
          this.peak = angle;
        }
        if (angle < this.peak - 0.35 * (this.peak - this.restAngle) && this.peak - this.restAngle > this.minRepRom) {
          this.phase = 'returning';
        } else if (angle < this.restAngle + this.startDelta * 0.5) {
          this.phase = 'rest'; // aborted — never reached the minimum range
        }
        return null;
      case 'returning':
        this.samples.push({ t, angle, flags });
        if (rel < this.returnDelta) {
          this.phase = 'rest';
          return this.score(t);
        }
        return null;
    }
  }

  private score(tEnd: number): RepResult {
    const s = this.samples;
    const duration = Math.max(1, tEnd - this.startT);
    // hold: time spent within 6° of the peak
    let hold = 0;
    for (let i = 1; i < s.length; i++) if (s[i].angle >= this.peak - 6) hold += s[i].t - s[i - 1].t;
    // smoothness from velocity irregularity and direction reversals
    const range = Math.max(10, this.peak - this.restAngle);
    let dvSum = 0;
    let dvN = 0;
    let reversals = 0;
    let prevV = 0;
    for (let i = 1; i < s.length; i++) {
      const dt = Math.max(1, s[i].t - s[i - 1].t) / 1000;
      const v = (s[i].angle - s[i - 1].angle) / dt;
      if (i > 1) {
        dvSum += Math.abs(v - prevV);
        dvN += 1;
        if (Math.sign(v) !== Math.sign(prevV) && Math.abs(v) > 15 && Math.abs(prevV) > 15) reversals += 1;
      }
      prevV = v;
    }
    const meanDv = dvN ? dvSum / dvN : 0;              // deg/s change per frame
    const reversalsPerSec = reversals / (duration / 1000);
    const smoothness = clamp(100 - (meanDv / range) * 55 - reversalsPerSec * 9, 0, 100);
    // compensation flags: active on more than 30% of the rep's frames
    const counts: Record<string, number> = {};
    for (const x of s) for (const [k, v] of Object.entries(x.flags)) if (v) counts[k] = (counts[k] || 0) + 1;
    const compensation_flags = Object.entries(counts).filter(([, n]) => n / s.length > 0.3).map(([k]) => k);
    const rep: RepResult = {
      index: this.reps.length + 1,
      peak_angle: Number(this.peak.toFixed(1)),
      duration_ms: Math.round(duration),
      hold_ms: Math.round(hold),
      smoothness: Number(smoothness.toFixed(1)),
      compensation_flags,
    };
    this.reps.push(rep);
    this.samples = [];
    return rep;
  }

  reset() {
    this.phase = 'rest';
    this.reps = [];
    this.samples = [];
    this.peak = 0;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
