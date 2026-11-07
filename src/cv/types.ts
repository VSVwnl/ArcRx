export type ExerciseKey = 'shoulder_abduction' | 'elbow_flexion' | 'neck_rotation' | 'neck_lateral_flexion';
export type Side = 'left' | 'right';
export type CvModel = 'pose' | 'face';

export interface Point {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/** What the overlay needs to draw for a pose-model frame. */
export interface PoseDraw {
  kind: 'pose';
  landmarks: Point[];
  joint: Point;         // vertex of the goniometer
  refDir: Point;        // unit vector of the reference segment (e.g. trunk down)
  limbDir: Point;       // unit vector of the moving segment
}

/** What the overlay needs for a face-model frame. */
export interface FaceDraw {
  kind: 'face';
  center: Point;        // head centre, normalized
  size: number;         // head height, normalized
  yaw: number;          // degrees, relative to calibration
  pitch: number;
  roll: number;
  oval: Point[];        // face outline points
}

export interface Observation {
  t: number;                        // ms
  angle: number;                    // primary joint angle, degrees (raw)
  flags: Record<string, boolean>;   // compensations active this frame
  draw: PoseDraw | FaceDraw;
  confidence: number;               // 0..1
}

export interface RepResult {
  index: number;
  peak_angle: number;
  duration_ms: number;
  hold_ms: number;
  smoothness: number;
  compensation_flags: string[];
}

export interface ExerciseSpec {
  key: ExerciseKey;
  label: string;
  model: CvModel;
  normalRom: number;
  cue: string;
  compensations: string[];
  restAngle: number;      // angle at the starting position
  minRepRom: number;      // degrees above rest needed to count a rep
}

export const EXERCISE_SPECS: Record<ExerciseKey, ExerciseSpec> = {
  shoulder_abduction: {
    key: 'shoulder_abduction', label: 'Shoulder abduction', model: 'pose', normalRom: 180,
    cue: 'Arm straight. Raise it out to the side, palm down, as high as is comfortable, then lower slowly.',
    compensations: ['trunk_lean', 'shoulder_hike'], restAngle: 12, minRepRom: 20,
  },
  elbow_flexion: {
    key: 'elbow_flexion', label: 'Elbow flexion', model: 'pose', normalRom: 145,
    cue: 'Upper arm still at your side. Bend the elbow to bring your hand toward your shoulder, then straighten.',
    compensations: ['shoulder_drift', 'trunk_lean'], restAngle: 10, minRepRom: 25,
  },
  neck_rotation: {
    key: 'neck_rotation', label: 'Cervical rotation', model: 'face', normalRom: 80,
    cue: 'Shoulders square to the screen. Turn your head to look over one shoulder, then return to centre.',
    compensations: ['head_tilt', 'chin_drop'], restAngle: 0, minRepRom: 15,
  },
  neck_lateral_flexion: {
    key: 'neck_lateral_flexion', label: 'Cervical lateral flexion', model: 'face', normalRom: 45,
    cue: 'Drop one ear toward the shoulder without lifting the shoulder, then return to centre.',
    compensations: ['head_rotation', 'chin_drop'], restAngle: 0, minRepRom: 10,
  },
};

export const COMPENSATION_LABELS: Record<string, string> = {
  trunk_lean: 'Trunk lean',
  shoulder_hike: 'Shoulder hike',
  shoulder_drift: 'Shoulder drift',
  head_tilt: 'Head tilt',
  head_rotation: 'Head rotation',
  chin_drop: 'Chin drop',
};

// MediaPipe pose landmark indices
export const LM = {
  nose: 0, leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26,
} as const;

export const POSE_CONNECTIONS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26],
  [0, 2], [0, 5], [2, 7], [5, 8],
];
