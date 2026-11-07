/** One Euro filter (Casiez et al. 2012): low jitter at rest, low lag during fast motion. */
export class OneEuro {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(private minCutoff = 1.2, private beta = 0.015, private dCutoff = 1.0) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, tMs: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = tMs;
      return x;
    }
    const dt = Math.max((tMs - this.tPrev) / 1000, 1 / 120);
    this.tPrev = tMs;
    const dx = (x - this.xPrev) / dt;
    const aD = OneEuro.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = OneEuro.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

/** Running mean for calibration windows. */
export class RunningMean {
  private n = 0;
  private sum = 0;
  add(v: number) {
    this.n += 1;
    this.sum += v;
  }
  get value() {
    return this.n ? this.sum / this.n : 0;
  }
  get count() {
    return this.n;
  }
}
