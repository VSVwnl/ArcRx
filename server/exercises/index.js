// GET /api/_server/exercises — the exercise catalogue (shared with the CV client via lib/).
import { EXERCISES, COMPENSATION_LABELS } from '../../lib/rehab.js';

export async function GET() {
  return { exercises: Object.values(EXERCISES), compensationLabels: COMPENSATION_LABELS };
}
