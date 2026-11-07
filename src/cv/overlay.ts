// Canvas overlay: skeleton / head outline plus the goniometer arc at the joint.
// Drawn in landmark space; the canvas is mirrored with CSS like the video.
import { POSE_CONNECTIONS, type Observation, type PoseDraw, type FaceDraw } from './types';

export const INK = {
  amber: '#F5B942',
  teal: '#4FD1C5',
  coral: '#F0636B',
  paper: '#EEF2FF',
  mute: 'rgba(238,242,255,0.55)',
  dim: 'rgba(238,242,255,0.22)',
};

export interface OverlayState {
  obs: Observation | null;
  angle: number;        // filtered
  target: number;
  calibrating: boolean;
  compensating: boolean;
  phase: string;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, s: OverlayState) {
  ctx.clearRect(0, 0, w, h);
  if (!s.obs) return;
  const P = (p: { x: number; y: number }) => ({ x: p.x * w, y: p.y * h });
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.obs.draw.kind === 'pose') drawPose(ctx, P, s.obs.draw, s, Math.min(w, h));
  else drawFace(ctx, P, s.obs.draw, s, Math.min(w, h));
}

function drawPose(ctx: CanvasRenderingContext2D, P: (p: { x: number; y: number }) => { x: number; y: number }, d: PoseDraw, s: OverlayState, scale: number) {
  const lm = d.landmarks;
  ctx.lineWidth = Math.max(2, scale * 0.006);
  ctx.strokeStyle = s.compensating ? 'rgba(240,99,107,0.75)' : INK.dim;
  for (const [a, b] of POSE_CONNECTIONS) {
    const A = lm[a], B = lm[b];
    if (!A || !B || (A.visibility ?? 1) < 0.3 || (B.visibility ?? 1) < 0.3) continue;
    const pa = P(A), pb = P(B);
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }
  ctx.fillStyle = INK.mute;
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24]) {
    const p = lm[i];
    if (!p || (p.visibility ?? 1) < 0.3) continue;
    const q = P(p);
    ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(3, scale * 0.008), 0, Math.PI * 2); ctx.fill();
  }
  // moving limb highlighted
  const J = P(d.joint);
  const limbEnd = P({ x: d.joint.x + d.limbDir.x * 0.16, y: d.joint.y + d.limbDir.y * 0.16 });
  ctx.strokeStyle = INK.amber;
  ctx.lineWidth = Math.max(3, scale * 0.009);
  ctx.beginPath(); ctx.moveTo(J.x, J.y); ctx.lineTo(limbEnd.x, limbEnd.y); ctx.stroke();
  goniometer(ctx, J, Math.atan2(d.refDir.y, d.refDir.x), Math.atan2(d.limbDir.y, d.limbDir.x), scale * 0.16, s);
}

function drawFace(ctx: CanvasRenderingContext2D, P: (p: { x: number; y: number }) => { x: number; y: number }, d: FaceDraw, s: OverlayState, scale: number) {
  const C = P(d.center);
  ctx.strokeStyle = s.compensating ? 'rgba(240,99,107,0.8)' : INK.mute;
  ctx.lineWidth = Math.max(2, scale * 0.005);
  if (d.oval.length) {
    ctx.beginPath();
    d.oval.forEach((p, i) => { const q = P(p); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
    ctx.closePath(); ctx.stroke();
  }
  // nose direction: a short line in the direction of rotation/tilt
  const rad = (d.yaw * Math.PI) / 180;
  const rollRad = (d.roll * Math.PI) / 180;
  const len = d.size * scale * 0.45;
  ctx.strokeStyle = INK.amber;
  ctx.lineWidth = Math.max(3, scale * 0.008);
  ctx.beginPath(); ctx.moveTo(C.x, C.y);
  ctx.lineTo(C.x + Math.sin(rad) * len + Math.sin(rollRad) * len * 0.6, C.y - Math.cos(rollRad) * len * 0.6 + Math.abs(Math.sin(rad)) * 2);
  ctx.stroke();
  // reference is straight up from the head centre; measured direction rotates by the primary angle
  const primary = ((s.angle) * Math.PI) / 180;
  goniometer(ctx, { x: C.x, y: C.y - d.size * scale * 0.05 }, -Math.PI / 2, -Math.PI / 2 + primary, d.size * scale * 0.62, s);
}

/** Protractor-style arc from the reference ray to the measured ray, with the target tick. */
function goniometer(ctx: CanvasRenderingContext2D, J: { x: number; y: number }, refA: number, limbA: number, r: number, s: OverlayState) {
  const sweep = normalize(limbA - refA);
  const dir = sweep >= 0 ? 1 : -1;
  const angleRad = (Math.abs(s.angle) * Math.PI) / 180 * dir;
  const targetRad = (s.target * Math.PI) / 180 * dir;
  // faint full protractor
  ctx.strokeStyle = INK.dim;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(J.x, J.y, r, refA, refA + Math.PI * dir, dir < 0); ctx.stroke();
  for (let deg = 0; deg <= 180; deg += 30) {
    const a = refA + (deg * Math.PI / 180) * dir;
    const inner = deg % 90 === 0 ? r * 0.86 : r * 0.92;
    ctx.beginPath(); ctx.moveTo(J.x + Math.cos(a) * inner, J.y + Math.sin(a) * inner); ctx.lineTo(J.x + Math.cos(a) * r, J.y + Math.sin(a) * r); ctx.stroke();
  }
  // target tick
  ctx.strokeStyle = INK.teal;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(J.x + Math.cos(refA + targetRad) * r * 0.8, J.y + Math.sin(refA + targetRad) * r * 0.8);
  ctx.lineTo(J.x + Math.cos(refA + targetRad) * r * 1.06, J.y + Math.sin(refA + targetRad) * r * 1.06);
  ctx.stroke();
  // live arc
  ctx.strokeStyle = s.calibrating ? INK.mute : s.compensating ? INK.coral : INK.amber;
  ctx.lineWidth = Math.max(4, r * 0.07);
  ctx.beginPath(); ctx.arc(J.x, J.y, r * 0.98, refA, refA + angleRad, dir < 0); ctx.stroke();
  // reference ray
  ctx.strokeStyle = INK.mute;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 6]);
  ctx.beginPath(); ctx.moveTo(J.x, J.y); ctx.lineTo(J.x + Math.cos(refA) * r * 1.1, J.y + Math.sin(refA) * r * 1.1); ctx.stroke();
  ctx.setLineDash([]);
}

function normalize(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
