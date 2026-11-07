import { LM, type ExerciseKey, type Point, type Side, type Observation, type PoseDraw, type FaceDraw } from './types';

const R2D = 180 / Math.PI;

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const norm = (v: Point): Point => {
  const l = Math.hypot(v.x, v.y) || 1e-6;
  return { x: v.x / l, y: v.y / l };
};
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Interior angle at `vertex` between rays to `a` and `b`, in degrees (0..180). */
export function angleAt(a: Point, vertex: Point, b: Point): number {
  const va = sub(a, vertex);
  const vb = sub(b, vertex);
  const dot = va.x * vb.x + va.y * vb.y;
  const mag = (Math.hypot(va.x, va.y) || 1e-6) * (Math.hypot(vb.x, vb.y) || 1e-6);
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * R2D;
}

/** Angle of a vector from straight-down vertical (0 = pointing down), degrees. */
export function angleFromVertical(v: Point): number {
  return Math.atan2(Math.abs(v.x), v.y) * R2D;
}

export interface PoseBaseline {
  shoulderDrop: number; // (shoulder.y - otherShoulder.y) / torso at calibration
}

function sideIdx(side: Side) {
  return side === 'left'
    ? { shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist, hip: LM.leftHip, oShoulder: LM.rightShoulder, oHip: LM.rightHip }
    : { shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist, hip: LM.rightHip, oShoulder: LM.leftShoulder, oHip: LM.leftHip };
}

/** Measure a pose-based exercise from 33 pose landmarks. */
export function measurePose(landmarks: Point[], exercise: ExerciseKey, side: Side, baseline: PoseBaseline | null, t: number): Observation | null {
  const i = sideIdx(side);
  const S = landmarks[i.shoulder];
  const E = landmarks[i.elbow];
  const W = landmarks[i.wrist];
  const H = landmarks[i.hip];
  const OS = landmarks[i.oShoulder];
  const OH = landmarks[i.oHip];
  if (!S || !E || !H || !OS || !OH) return null;
  const vis = Math.min(S.visibility ?? 1, E.visibility ?? 1, H.visibility ?? 1);
  const midShoulder = { x: (S.x + OS.x) / 2, y: (S.y + OS.y) / 2 };
  const midHip = { x: (H.x + OH.x) / 2, y: (H.y + OH.y) / 2 };
  const torso = dist(midShoulder, midHip) || 1e-6;
  const trunkLean = angleFromVertical(sub(midHip, midShoulder));
  const shoulderDrop = (S.y - OS.y) / torso; // negative = this shoulder higher
  const hike = baseline ? baseline.shoulderDrop - shoulderDrop : 0; // positive = shoulder rose since calibration

  if (exercise === 'shoulder_abduction') {
    // angle at the shoulder between upper arm and the trunk line (shoulder→hip)
    const angle = angleAt(E, S, H);
    const flags = { trunk_lean: trunkLean > 12, shoulder_hike: hike > 0.07 };
    const draw: PoseDraw = { kind: 'pose', landmarks, joint: S, refDir: norm(sub(H, S)), limbDir: norm(sub(E, S)) };
    return { t, angle, flags, draw, confidence: vis };
  }
  // elbow flexion: 180 - interior elbow angle; upper arm should stay vertical
  if (!W) return null;
  const elbow = angleAt(S, E, W);
  const angle = 180 - elbow;
  const upperArmDrift = angleFromVertical(sub(E, S));
  const flags = { shoulder_drift: upperArmDrift > 30, trunk_lean: trunkLean > 12 };
  const draw: PoseDraw = { kind: 'pose', landmarks, joint: E, refDir: norm(sub(S, E)), limbDir: norm(sub(W, E)) };
  return { t, angle, flags, draw, confidence: Math.min(vis, W.visibility ?? 1) };
}

export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

/** Euler angles (degrees) from MediaPipe's column-major 4x4 facial transformation matrix. */
export function headPoseFromMatrix(m: ArrayLike<number>): HeadPose {
  // R[row][col] = m[col*4 + row]
  const r02 = m[8], r22 = m[10], r10 = m[1], r11 = m[5], r12 = m[9];
  return {
    yaw: Math.atan2(r02, r22) * R2D,
    roll: Math.atan2(r10, r11) * R2D,
    pitch: Math.asin(Math.max(-1, Math.min(1, -r12))) * R2D,
  };
}

export interface FaceBaseline extends HeadPose {}

/** Measure a face-based (cervical) exercise from head pose + a few face landmarks. */
export function measureFace(
  pose: HeadPose, center: Point, size: number, oval: Point[], exercise: ExerciseKey, baseline: FaceBaseline | null, t: number, confidence = 1,
): Observation {
  const b = baseline ?? { yaw: 0, pitch: 0, roll: 0 };
  const yaw = pose.yaw - b.yaw;
  const roll = pose.roll - b.roll;
  const pitch = pose.pitch - b.pitch;
  const draw: FaceDraw = { kind: 'face', center, size, yaw, pitch, roll, oval };
  if (exercise === 'neck_rotation') {
    return { t, angle: Math.abs(yaw), flags: { head_tilt: Math.abs(roll) > 12, chin_drop: pitch < -15 }, draw, confidence };
  }
  return { t, angle: Math.abs(roll), flags: { head_rotation: Math.abs(yaw) > 15, chin_drop: pitch < -15 }, draw, confidence };
}
