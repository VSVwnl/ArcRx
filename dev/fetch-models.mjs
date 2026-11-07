// Downloads the MediaPipe task models into public/models so the app runs fully offline.
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const MODELS = {
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  'face_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
};

mkdirSync('public/models', { recursive: true });
for (const [file, url] of Object.entries(MODELS)) {
  const dest = `public/models/${file}`;
  if (existsSync(dest) && statSync(dest).size > 100_000) {
    console.log(`✓ ${file} already present`);
    continue;
  }
  console.log(`↓ ${file}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed ${url}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`✓ ${file} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
}
