// Lazy loader for MediaPipe Tasks Vision. The WASM runtime and the .task models
// are served from public/ so the app works with no network at all.
import type { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { CvModel } from './types';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const WASM_PATH = `${BASE}/mediapipe`;
const MODELS = {
  pose: `${BASE}/models/pose_landmarker_lite.task`,
  face: `${BASE}/models/face_landmarker.task`,
};

export type Landmarker = { kind: 'pose'; lm: PoseLandmarker } | { kind: 'face'; lm: FaceLandmarker };

let visionPromise: Promise<typeof import('@mediapipe/tasks-vision')> | null = null;
const landmarkers: Partial<Record<CvModel, Promise<Landmarker>>> = {};

async function vision() {
  return (visionPromise ||= import('@mediapipe/tasks-vision'));
}

export async function loadLandmarker(model: CvModel, onStatus?: (s: string) => void): Promise<Landmarker> {
  if (!landmarkers[model]) {
    landmarkers[model] = (async (): Promise<Landmarker> => {
      onStatus?.('Loading vision runtime');
      const mp = await vision();
      const fileset = await mp.FilesetResolver.forVisionTasks(WASM_PATH);
      onStatus?.(model === 'pose' ? 'Loading pose model' : 'Loading face model');
      const make = async (delegate: 'GPU' | 'CPU'): Promise<Landmarker> => {
        if (model === 'pose') {
          const lm = await mp.PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODELS.pose, delegate },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
          return { kind: 'pose', lm };
        }
        const lm = await mp.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODELS.face, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFacialTransformationMatrixes: true,
          outputFaceBlendshapes: false,
        });
        return { kind: 'face', lm };
      };
      try {
        return await make('GPU');
      } catch (err) {
        console.warn('[cv] GPU delegate unavailable, falling back to CPU', err);
        onStatus?.('GPU unavailable, using CPU');
        return await make('CPU');
      }
    })().catch((err) => {
      delete landmarkers[model];
      throw err;
    });
  }
  return landmarkers[model]!;
}

/** MediaPipe face-mesh outline indices. */
export const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
