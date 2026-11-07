// The session engine: camera or simulator → landmarks → joint angle →
// One Euro filter → rep detector → overlay, all on the client.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { measureFace, measurePose, headPoseFromMatrix, dist, type FaceBaseline, type PoseBaseline } from './angles';
import { OneEuro, RunningMean } from './filters';
import { FACE_OVAL, loadLandmarker, type Landmarker } from './mediapipe';
import { drawOverlay } from './overlay';
import { RepDetector } from './repDetector';
import { defaultSim, simulate, type SimConfig } from './simulator';
import { EXERCISE_SPECS, type ExerciseKey, type Observation, type Point, type RepResult, type Side } from './types';

export type Source = 'webcam' | 'simulation';
export type EngineStatus = 'idle' | 'starting' | 'calibrating' | 'tracking' | 'error';

export interface EngineOptions {
  exercise: ExerciseKey;
  side: Side;
  targetRom: number;
  source: Source;
}

export interface EngineState {
  status: EngineStatus;
  statusText: string;
  angle: number;
  repPeak: number;
  reps: RepResult[];
  flags: Record<string, boolean>;
  confidence: number;
  fps: number;
  phase: string;
  startedAt: string | null;
  source: Source;
  inFrame: boolean;
}

const INITIAL: EngineState = {
  status: 'idle', statusText: 'Ready', angle: 0, repPeak: 0, reps: [], flags: {}, confidence: 0, fps: 0, phase: 'rest', startedAt: null, source: 'webcam', inFrame: false,
};

const CALIBRATION_MS = 1500;

export function useSessionEngine(videoRef: RefObject<HTMLVideoElement | null>, canvasRef: RefObject<HTMLCanvasElement | null>) {
  const [state, setState] = useState<EngineState>(INITIAL);
  const live = useRef<EngineState>({ ...INITIAL });
  const raf = useRef<number>(0);
  const stream = useRef<MediaStream | null>(null);
  const landmarker = useRef<Landmarker | null>(null);
  const opts = useRef<EngineOptions | null>(null);
  const sim = useRef<SimConfig | null>(null);
  const filter = useRef(new OneEuro());
  const detector = useRef<RepDetector | null>(null);
  const poseBaseline = useRef<PoseBaseline | null>(null);
  const faceBaseline = useRef<FaceBaseline | null>(null);
  const calib = useRef<{ t0: number; drop: RunningMean; rest: RunningMean; yaw: RunningMean; pitch: RunningMean; roll: RunningMean } | null>(null);
  const frameTimes = useRef<number[]>([]);
  const lastVideoT = useRef(-1);
  const simT0 = useRef(0);
  // Incremented by every start() and stop(): a start whose awaits resolve after a
  // newer start/stop (or after unmount) releases what it acquired and bails out.
  const generation = useRef(0);

  const patch = (p: Partial<EngineState>) => Object.assign(live.current, p);

  // Publish the live ref to React at ~15 Hz so the HUD stays cheap.
  useEffect(() => {
    const id = setInterval(() => setState({ ...live.current }), 66);
    return () => clearInterval(id);
  }, []);

  const stopLoop = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  };

  const releaseCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [videoRef]);

  const stop = useCallback(() => {
    generation.current++;
    stopLoop();
    releaseCamera();
    patch({ status: 'idle', statusText: 'Stopped', inFrame: false });
  }, [releaseCamera]);

  /** Stop and forget the current session's reps (Discard). */
  const discard = useCallback(() => {
    stop();
    live.current = { ...INITIAL };
    setState({ ...INITIAL });
  }, [stop]);

  /** The live engine state (React state lags it by up to one publish tick). */
  const snapshot = useCallback((): EngineState => ({ ...live.current, reps: [...live.current.reps] }), []);

  useEffect(() => () => stop(), [stop]);

  const observe = (t: number): Observation | null => {
    const o = opts.current!;
    const spec = EXERCISE_SPECS[o.exercise];
    if (o.source === 'simulation') {
      const f = simulate(sim.current!, t - simT0.current);
      if (f.pose) return measurePose(f.pose, o.exercise, o.side, poseBaseline.current, t);
      if (f.head) return measureFace(f.head.pose, f.head.center, f.head.size, f.head.oval, o.exercise, faceBaseline.current, t);
      return null;
    }
    const video = videoRef.current;
    const lm = landmarker.current;
    if (!video || !lm || video.readyState < 2) return null;
    const vt = Math.max(Math.floor(t), lastVideoT.current + 1);
    lastVideoT.current = vt;
    if (lm.kind === 'pose') {
      const res = lm.lm.detectForVideo(video, vt);
      const pts = res.landmarks?.[0] as Point[] | undefined;
      if (!pts) return null;
      return measurePose(pts, o.exercise, o.side, poseBaseline.current, t);
    }
    const res = lm.lm.detectForVideo(video, vt);
    const pts = res.faceLandmarks?.[0] as Point[] | undefined;
    const mat = res.facialTransformationMatrixes?.[0]?.data;
    if (!pts || !mat) return null;
    const pose = headPoseFromMatrix(mat);
    const center = { x: (pts[10].x + pts[152].x) / 2, y: (pts[10].y + pts[152].y) / 2 };
    const size = dist(pts[10], pts[152]);
    const oval = FACE_OVAL.map((i) => pts[i]);
    void spec;
    return measureFace(pose, center, size, oval, o.exercise, faceBaseline.current, t);
  };

  const loop = () => {
    raf.current = requestAnimationFrame(loop);
    const o = opts.current;
    const canvas = canvasRef.current;
    if (!o || !canvas) return;
    const t = performance.now();
    const spec = EXERCISE_SPECS[o.exercise];

    // Keep the canvas at the video's intrinsic size (or 16:9 for the simulator).
    const video = videoRef.current;
    const w = o.source === 'webcam' && video?.videoWidth ? video.videoWidth : 1280;
    const h = o.source === 'webcam' && video?.videoHeight ? video.videoHeight : 720;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d')!;

    let obs: Observation | null = null;
    try {
      obs = observe(t);
    } catch (err) {
      console.error('[cv] frame failed', err);
    }

    frameTimes.current.push(t);
    while (frameTimes.current.length && frameTimes.current[0] < t - 1000) frameTimes.current.shift();
    patch({ fps: frameTimes.current.length });

    if (!obs || obs.confidence < 0.35) {
      patch({ inFrame: false, statusText: live.current.status === 'calibrating' ? 'Step into frame to calibrate' : 'Lost tracking — step back into frame', confidence: obs?.confidence ?? 0 });
      drawOverlay(ctx, w, h, { obs: null, angle: 0, target: o.targetRom, calibrating: false, compensating: false, phase: 'rest' });
      return;
    }

    // Calibration window: capture neutral posture and the rest angle.
    if (live.current.status === 'calibrating') {
      const c = calib.current!;
      if (obs.draw.kind === 'pose') {
        const d = obs.draw;
        const lmk = d.landmarks;
        const sIdx = o.side === 'left' ? 11 : 12;
        const oIdx = o.side === 'left' ? 12 : 11;
        const torso = Math.hypot(lmk[sIdx].x - lmk[o.side === 'left' ? 23 : 24].x, lmk[sIdx].y - lmk[o.side === 'left' ? 23 : 24].y) || 1e-6;
        c.drop.add((lmk[sIdx].y - lmk[oIdx].y) / torso);
      } else {
        c.yaw.add(obs.draw.yaw + (faceBaseline.current?.yaw ?? 0));
        c.pitch.add(obs.draw.pitch + (faceBaseline.current?.pitch ?? 0));
        c.roll.add(obs.draw.roll + (faceBaseline.current?.roll ?? 0));
      }
      c.rest.add(obs.angle);
      const remaining = Math.max(0, CALIBRATION_MS - (t - c.t0));
      patch({ inFrame: true, statusText: `Hold still — calibrating ${(remaining / 1000).toFixed(1)}s`, angle: obs.angle, confidence: obs.confidence });
      drawOverlay(ctx, w, h, { obs, angle: obs.angle, target: o.targetRom, calibrating: true, compensating: false, phase: 'rest' });
      if (remaining === 0 && c.rest.count > 10) {
        if (spec.model === 'pose') {
          poseBaseline.current = { shoulderDrop: c.drop.value };
          detector.current!.setRest(Math.max(spec.restAngle, Math.min(c.rest.value, spec.restAngle + 25)));
        } else {
          faceBaseline.current = { yaw: c.yaw.value, pitch: c.pitch.value, roll: c.roll.value };
          detector.current!.setRest(0);
        }
        filter.current.reset();
        patch({ status: 'tracking', statusText: spec.cue, startedAt: new Date().toISOString() });
      }
      return;
    }

    const angle = filter.current.filter(obs.angle, t);
    const det = detector.current!;
    const rep = det.update(t, angle, obs.flags);
    const compensating = Object.values(obs.flags).some(Boolean) && det.phase !== 'rest';
    patch({
      inFrame: true,
      angle,
      repPeak: det.currentPeak,
      flags: obs.flags,
      confidence: obs.confidence,
      phase: det.phase,
      reps: rep ? [...det.reps] : live.current.reps,
      statusText: rep ? `Rep ${rep.index}: ${rep.peak_angle.toFixed(0)}°${rep.compensation_flags.length ? ' with compensation' : ''}` : live.current.statusText,
    });
    drawOverlay(ctx, w, h, { obs, angle, target: o.targetRom, calibrating: false, compensating, phase: det.phase });
  };

  const start = useCallback(async (o: EngineOptions) => {
    stop();
    const my = ++generation.current;
    const superseded = () => my !== generation.current;
    opts.current = o;
    const spec = EXERCISE_SPECS[o.exercise];
    detector.current = new RepDetector(spec.restAngle, spec.minRepRom);
    filter.current = new OneEuro(spec.model === 'face' ? 1.0 : 1.2, 0.015);
    poseBaseline.current = null;
    faceBaseline.current = null;
    lastVideoT.current = -1;
    live.current = { ...INITIAL, status: 'starting', statusText: 'Starting', source: o.source };
    try {
      if (o.source === 'webcam') {
        patch({ statusText: 'Requesting camera' });
        const ms = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
        if (superseded()) { ms.getTracks().forEach((t) => t.stop()); return; }
        stream.current = ms;
        // Camera unplugged, revoked, or taken by another app: say so and stop the
        // loop instead of reporting "step into frame" on a dead feed. Reps so far stay.
        ms.getVideoTracks().forEach((t) => t.addEventListener('ended', () => {
          if (stream.current !== ms) return;
          generation.current++;
          stopLoop();
          releaseCamera();
          patch({ status: 'error', inFrame: false, statusText: 'The camera stopped (unplugged, turned off, or taken by another app). Start it again, or switch to Demo simulation.' });
        }));
        const video = videoRef.current;
        if (!video) { releaseCamera(); return; }
        video.srcObject = ms;
        await video.play();
        if (superseded()) { if (stream.current === ms) releaseCamera(); return; }
        landmarker.current = await loadLandmarker(spec.model, (s) => { if (!superseded()) patch({ statusText: s }); });
        if (superseded()) { if (stream.current === ms) releaseCamera(); return; }
      } else {
        sim.current = defaultSim(o.exercise, o.side, o.targetRom);
        simT0.current = performance.now() + 400; // a beat at rest before the first rep
      }
    } catch (err) {
      // Never leave the camera on after a failed start (e.g. the model failed to load).
      releaseCamera();
      if (superseded()) return;
      const name = (err as Error)?.name;
      const message = name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Camera permission was denied. Allow the camera in the address bar, or switch to Demo simulation.'
        : name === 'NotFoundError' || name === 'OverconstrainedError'
          ? 'No usable camera found. Connect one, or switch to Demo simulation.'
          : name === 'NotReadableError' || name === 'AbortError'
            ? 'The camera is in use by another app or could not start. Close other apps using it and try again, or switch to Demo simulation.'
            : /model|fetch|wasm/i.test(String((err as Error)?.message))
              ? 'The vision model could not load. Check the connection and try again, or switch to Demo simulation.'
              : `Could not start the camera: ${(err as Error)?.message || err}`;
      patch({ status: 'error', statusText: message });
      throw err;
    }
    if (superseded()) return;
    calib.current = { t0: performance.now(), drop: new RunningMean(), rest: new RunningMean(), yaw: new RunningMean(), pitch: new RunningMean(), roll: new RunningMean() };
    patch({ status: 'calibrating', statusText: 'Hold still — calibrating' });
    stopLoop();
    raf.current = requestAnimationFrame(loop);
  }, [stop, releaseCamera]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Nudge the simulated patient (demo controls). */
  const setSim = useCallback((p: Partial<SimConfig>) => {
    if (sim.current) sim.current = { ...sim.current, ...p };
  }, []);

  return { state, start, stop, discard, snapshot, setSim };
}
