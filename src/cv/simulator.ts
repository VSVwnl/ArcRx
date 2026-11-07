// Demo Simulation Mode: synthesises landmarks for a virtual patient so the
// entire pipeline (angles → filter → rep detector → scoring → Informer) runs
// unchanged when there is no camera, bad lighting, or a nervous presenter.
import { EXERCISE_SPECS, type ExerciseKey, type Point, type Side } from './types';
import type { HeadPose } from './angles';

export interface SimConfig {
  exercise: ExerciseKey;
  side: Side;
  peakRom: number;       // degrees the virtual patient reaches
  periodMs: number;      // one rep
  compensateEvery: number; // every Nth rep shows a compensation
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** 0..1 rep profile: rise, hold, lower, rest. */
function profile(phase: number) {
  if (phase < 0.35) return smoothstep(phase / 0.35);
  if (phase < 0.5) return 1;
  if (phase < 0.85) return 1 - smoothstep((phase - 0.5) / 0.35);
  return 0;
}

function noise(t: number, f: number, a: number) {
  return a * (Math.sin(t * f) * 0.6 + Math.sin(t * f * 2.7 + 1.3) * 0.4);
}

export interface SimFrame {
  pose?: Point[];
  head?: { pose: HeadPose; center: Point; size: number; oval: Point[] };
}

export function simulate(cfg: SimConfig, tMs: number): SimFrame {
  const spec = EXERCISE_SPECS[cfg.exercise];
  const rep = Math.floor(tMs / cfg.periodMs);
  const phase = (tMs % cfg.periodMs) / cfg.periodMs;
  const drift = Math.sin(rep * 1.7) * 4; // a few degrees of rep-to-rep variability
  const compensating = cfg.compensateEvery > 0 && rep % cfg.compensateEvery === cfg.compensateEvery - 1;
  const p = profile(phase);
  const amp = Math.max(5, cfg.peakRom + drift - spec.restAngle);
  const angle = spec.restAngle + amp * p + noise(tMs / 1000, 9, 0.8);
  const rad = (angle * Math.PI) / 180;
  const sign = cfg.side === 'left' ? 1 : -1; // image x grows to the right; the subject's left is on image right

  if (spec.model === 'pose') {
    const lean = compensating ? 0.08 * p : 0;
    const hike = compensating ? 0.035 * p : 0;
    const cx = 0.5 + lean;
    const shoulderY = 0.3;
    const torso = 0.3;
    const hipY = shoulderY + torso;
    const shoulderW = 0.13;
    const upper = 0.19;
    const fore = 0.17;
    const L: Point[] = Array.from({ length: 33 }, () => ({ x: cx, y: shoulderY - 0.18, visibility: 1 }));
    const set = (i: number, x: number, y: number) => (L[i] = { x, y, visibility: 1 });
    set(0, cx, shoulderY - 0.14);
    set(2, cx - 0.025, shoulderY - 0.165); set(5, cx + 0.025, shoulderY - 0.165);
    set(7, cx - 0.06, shoulderY - 0.15); set(8, cx + 0.06, shoulderY - 0.15);
    const lsx = cx - shoulderW, rsx = cx + shoulderW;
    set(11, lsx, shoulderY); set(12, rsx, shoulderY);
    set(23, cx - 0.5 * lean - shoulderW * 0.8, hipY); set(24, cx - 0.5 * lean + shoulderW * 0.8, hipY);
    set(25, L[23].x, hipY + 0.26); set(26, L[24].x, hipY + 0.26);
    const sIdx = cfg.side === 'left' ? 11 : 12;
    const eIdx = cfg.side === 'left' ? 13 : 14;
    const wIdx = cfg.side === 'left' ? 15 : 16;
    const oE = cfg.side === 'left' ? 14 : 13;
    const oW = cfg.side === 'left' ? 16 : 15;
    const S = { ...L[sIdx], y: shoulderY - hike };
    L[sIdx] = S;
    if (cfg.exercise === 'shoulder_abduction') {
      // arm rotates about the shoulder from pointing down (0°) outward
      const ex = S.x + sign * Math.sin(rad) * upper;
      const ey = S.y + Math.cos(rad) * upper;
      set(eIdx, ex, ey);
      set(wIdx, ex + sign * Math.sin(rad) * fore, ey + Math.cos(rad) * fore);
    } else {
      // elbow flexion: upper arm vertical (drifts outward when compensating), forearm folds up
      const driftRad = compensating ? (35 * Math.PI) / 180 * p : 0;
      const ex = S.x + sign * Math.sin(driftRad) * upper;
      const ey = S.y + Math.cos(driftRad) * upper;
      set(eIdx, ex, ey);
      const foreAngle = driftRad + Math.PI - rad; // 0° flexion = forearm continues down
      set(wIdx, ex + sign * Math.sin(foreAngle) * fore, ey + Math.cos(foreAngle) * fore);
    }
    // the other arm rests at the side
    const O = L[cfg.side === 'left' ? 12 : 11];
    set(oE, O.x, O.y + upper);
    set(oW, O.x, O.y + upper + fore);
    return { pose: L };
  }

  // face model: head turns/tilts; compensation = tilt during rotation or rotation during tilt
  const main = angle * (cfg.side === 'left' ? -1 : 1);
  const compAmt = compensating ? 16 * p : 0;
  const pose: HeadPose =
    cfg.exercise === 'neck_rotation'
      ? { yaw: main, roll: compAmt, pitch: noise(tMs / 1000, 3, 1.5) }
      : { yaw: compAmt, roll: main, pitch: noise(tMs / 1000, 3, 1.5) };
  const center = { x: 0.5, y: 0.42 };
  const size = 0.34;
  const oval: Point[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    // squash the oval horizontally as the head turns, shear it as it tilts
    const squash = cfg.exercise === 'neck_rotation' ? Math.cos((pose.yaw * Math.PI) / 180) * 0.55 + 0.45 : 1;
    const rr = (pose.roll * Math.PI) / 180;
    const px = Math.cos(a) * size * 0.38 * squash;
    const py = Math.sin(a) * size * 0.5;
    oval.push({ x: center.x + px * Math.cos(rr) - py * Math.sin(rr), y: center.y + px * Math.sin(rr) + py * Math.cos(rr) });
  }
  return { head: { pose, center, size, oval } };
}

export function defaultSim(exercise: ExerciseKey, side: Side, targetRom: number): SimConfig {
  const spec = EXERCISE_SPECS[exercise];
  return { exercise, side, peakRom: Math.min(spec.normalRom - 5, targetRom * 0.88), periodMs: 3600, compensateEvery: 3 };
}
