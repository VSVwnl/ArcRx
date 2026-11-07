// Computer-vision unit checks with controlled landmark fixtures: exact angle and
// rep-detector boundaries, mirroring, and low-confidence handling. Loads the
// TypeScript sources through Vite's own transform (no config, no browser).
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, root: import.meta.dirname + '/..', logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const { angleAt, measurePose } = await vite.ssrLoadModule('/src/cv/angles.ts');
const { RepDetector } = await vite.ssrLoadModule('/src/cv/repDetector.ts');
const { EXERCISE_SPECS, LM } = await vite.ssrLoadModule('/src/cv/types.ts');

let pass = 0; let fail = 0; const failures = [];
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS ${name}`); } else { fail++; failures.push(name); console.log(`  FAIL ${name} ${detail}`); } };
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

// A standing figure in normalised image coordinates (y grows downward).
function figure({ armDeg = 0, side = 'right', vis = 0.99, lean = 0 } = {}) {
  const pts = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: vis }));
  const set = (i, x, y) => { pts[i] = { x, y, z: 0, visibility: vis }; };
  set(LM.leftShoulder, 0.6 + lean, 0.3); set(LM.rightShoulder, 0.4 + lean, 0.3);
  // Hips directly below the shoulders: the trunk line is vertical, so arm-to-trunk = arm-from-vertical.
  set(LM.leftHip, 0.6, 0.6); set(LM.rightHip, 0.4, 0.6);
  // Arm of length 0.15 from the shoulder, armDeg away from straight down (abduction).
  const s = side === 'right' ? pts[LM.rightShoulder] : pts[LM.leftShoulder];
  const dir = side === 'right' ? -1 : 1; // the right arm abducts toward smaller x in image space
  const r = (armDeg * Math.PI) / 180;
  const e = { x: s.x + dir * 0.15 * Math.sin(r), y: s.y + 0.15 * Math.cos(r) };
  const w = { x: s.x + dir * 0.28 * Math.sin(r), y: s.y + 0.28 * Math.cos(r) };
  if (side === 'right') { set(LM.rightElbow, e.x, e.y); set(LM.rightWrist, w.x, w.y); set(LM.leftElbow, 0.62, 0.45); set(LM.leftWrist, 0.63, 0.58); }
  else { set(LM.leftElbow, e.x, e.y); set(LM.leftWrist, w.x, w.y); set(LM.rightElbow, 0.38, 0.45); set(LM.rightWrist, 0.37, 0.58); }
  return pts;
}
const mirror = (pts) => pts.map((p) => ({ ...p, x: 1 - p.x }));

console.log('# Angles');
ok('angleAt: right angle', near(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }), 90));
ok('angleAt: straight line', near(angleAt({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 180));
ok('angleAt: degenerate (zero-length ray) is finite', Number.isFinite(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })));
for (const deg of [10, 45, 90, 150]) {
  const o = measurePose(figure({ armDeg: deg }), 'shoulder_abduction', 'right', null, 0);
  ok(`abduction ${deg}° measured within 3°`, near(o.angle, deg, 3), `got ${o.angle.toFixed(1)}`);
}
{
  const a = measurePose(figure({ armDeg: 70 }), 'shoulder_abduction', 'right', null, 0).angle;
  // The app mirrors only the display (CSS); landmarks keep their labels. An x-mirrored frame must give the same angle.
  const b = measurePose(mirror(figure({ armDeg: 70 })), 'shoulder_abduction', 'right', null, 0).angle;
  ok('mirrored coordinates give the same angle (display mirroring cannot skew the reading)', near(a, b, 0.01), `${a.toFixed(2)} vs ${b.toFixed(2)}`);
}
{
  const o = measurePose(figure({ armDeg: 60, vis: 0.2 }), 'shoulder_abduction', 'right', null, 0);
  ok('low landmark visibility → confidence below the 0.35 tracking floor', o.confidence < 0.35, `confidence ${o.confidence}`);
  ok('missing landmarks → no observation', measurePose([], 'shoulder_abduction', 'right', null, 0) === null);
}
{
  const upright = measurePose(figure({ armDeg: 60 }), 'shoulder_abduction', 'right', null, 0);
  const leaning = measurePose(figure({ armDeg: 60, lean: 0.12 }), 'shoulder_abduction', 'right', null, 0);
  ok('upright trunk → no trunk-lean flag', upright.flags.trunk_lean === false);
  ok('trunk tilted ~20° → trunk-lean flag', leaning.flags.trunk_lean === true);
}

console.log('# Rep detector boundaries (rest 10°, min range 30°, start +12°, return +18°)');
const feed = (det, angles, t0 = 0) => angles.map((a, i) => det.update(t0 + i * 50, a, {})).filter(Boolean);
{
  const d = new RepDetector(10, 30);
  feed(d, [10, 15, 22, 22, 15, 10]);
  ok('exactly rest+12° never starts a rep', d.phase === 'rest' && d.reps.length === 0, d.phase);
  feed(d, [22.1]);
  ok('just above rest+12° starts a rep', d.phase === 'rising');
}
{
  const d = new RepDetector(10, 30);
  feed(d, [10, 20, 30, 39, 39, 30, 20, 12, 10]);
  ok('peak range 29° (< min 30°) does not count', d.reps.length === 0, `${d.reps.length} reps`);
}
{
  const d = new RepDetector(10, 30);
  const reps = feed(d, [10, 20, 30, 41, 41, 30, 25, 20, 10]);
  ok('peak range 31° counts exactly one rep', reps.length === 1 && near(reps[0].peak_angle, 41, 0.01), JSON.stringify(reps.map((r) => r.peak_angle)));
}
{
  const d = new RepDetector(10, 30);
  feed(d, [10, 30, 60, 80, 80]);
  // Tracking lost: the engine sends no samples while the person is out of frame.
  const back = feed(d, [80], 5000);
  ok('no rep is completed by a tracking gap alone', back.length === 0 && d.reps.length === 0);
  const ret = feed(d, [40, 20, 12], 5100);
  ok('the rep completes only once the arm is seen returning to rest', ret.length === 1 && d.reps.length === 1);
}
{
  const d = new RepDetector(10, 30);
  // 35° is above the return zone (rest+18° = 28°), so it is a half return, not a rep boundary.
  const reps = feed(d, [10, 50, 80, 50, 35, 80, 50, 20, 10]);
  ok('a half return (above rest+18°) does not split one rep into two', reps.length === 1, `${reps.length} reps`);
}

console.log('# Exercise catalogue sanity');
for (const spec of Object.values(EXERCISE_SPECS)) ok(`${spec.key}: min range below normal range`, spec.minRepRom > 0 && spec.minRepRom < spec.normalRom);

await vite.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log('Failed: ' + failures.join(' | '));
process.exit(fail ? 1 : 0);
