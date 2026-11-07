// Typed client for the app's own server routes (server/ → /api/_server/…)
// and the dev-only agent trigger surface (/api/_agent/…).
import type { RepResult } from '../cv/types';
import { isDevPlatform } from './informer';

export type Role = 'patient' | 'clinician';
let currentRole: Role = 'clinician';
export const setApiRole = (r: Role) => (currentRole = r);

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  // In dev the mirror honours a demo-only `__role` so the UI can switch views;
  // in production roles come from Informer and this parameter is ignored.
  const sep = path.includes('?') ? '&' : '?';
  const url = isDevPlatform() ? `${path}${sep}__role=${currentRole}` : path;
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* plain text */ }
  if (!res.ok) {
    const msg = (data as { message?: string; error?: string })?.message || (data as { error?: string })?.error || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data as T;
}

export interface Plan {
  id: number; exercise_key: string; side: 'left' | 'right'; target_rom: number; sets: number; reps: number; frequency_per_week: number; pain_threshold: number;
}
export interface Assessment {
  status: 'on_track' | 'ready_to_progress' | 'plateau' | 'regression' | 'non_adherent' | 'no_data';
  statusLabel: string;
  reasons: string[];
  recommendations: string[];
  flags: { highPain: boolean; highCompensation: boolean; risingCompensation: boolean };
  metrics: {
    sessions: number; latestPeak: number; target: number; pctOfTarget: number; slopePerSession: number; dropPct: number;
    adherence: number; sessionsLast7: number; prescribedPerWeek: number; pain: number; compensationPct: number; compensationTrend: number; smoothness: number | null;
  };
}
export interface PatientSummary {
  id: number; name: string; mrn: string; username: string; condition: string; surgery_date: string | null; clinician: string;
  plan: Plan | null; assessment: Assessment; openAlerts: number; lastSession: string | null; sparkline: number[];
}
export interface Session {
  id: number; patient_id: number; exercise_key: string; side: string; started_at: string; ended_at: string; reps: number;
  peak_rom: number; mean_rom: number; smoothness: number; compensation_pct: number; pain_score: number; source: string;
}
export interface Alert {
  id: number; patient_id: number; session_id: number | null; severity: 'low' | 'medium' | 'high'; kind: string; title: string; body: string;
  status: 'open' | 'acknowledged' | 'resolved'; created_by: string; created_at: string; patient_name?: string; mrn?: string;
}
export interface Note { id: number; patient_id: number; session_id: number | null; author: string; note: string; metrics: Record<string, unknown>; created_at: string; patient_name?: string }
export interface PlanChange { id: number; change: Record<string, { from: number; to: number }>; rationale: string; created_by: string; created_at: string }
export interface PatientDetail {
  patient: { id: number; name: string; mrn: string; condition: string; surgery_date: string | null; clinician: string };
  plan: Plan | null; assessment: Assessment; sessions: Session[];
  lastReps: Array<{ rep_index: number; peak_angle: string; duration_ms: number; hold_ms: number; smoothness: string; compensation_flags: string[] }>;
  alerts: Alert[]; notes: Note[]; planChanges: PlanChange[];
  compensation: Array<{ day: string; flag: string; n: number }>;
}
export interface Caseload {
  totals: { patients: number; sessions_7d: number; open_alerts: number; high_alerts: number; avg_comp_7d: number; avg_smooth_7d: number };
  weekly: Array<{ week: string; sessions: number; avg_peak: number; avg_comp: number }>;
  perPatient: Array<{ id: number; name: string; exercise_key: string; target_rom: number; best_7d: number | null; best_prev_7d: number | null; sessions_7d: number; frequency_per_week: number }>;
}
export interface AskResult {
  mode: 'ai' | 'rules'; answer: string; highlights: string[]; sql: string | null;
  table: { columns: string[]; rows: Array<Record<string, unknown>> } | null;
  chart: { type: 'bar' | 'line'; data: Array<{ label: string; value: number }> } | null;
}
export interface AgentInfo { name: string; description: string | null; model: string; tools: string[]; on: string | string[]; cron: string | null; mode?: 'llm' | 'fallback' }
export interface AgentStep { type: 'text' | 'tool_call'; text?: string; toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: unknown }> }
export interface AgentRun { agent: string; trigger: string; status: string; tokens?: number; mode?: string; durationMs?: number; steps: AgentStep[]; summary?: string }
export interface AgentRunRow { id: number; agent: string; trigger_event: string; payload: Record<string, unknown>; steps: AgentStep[]; status: string; summary: string | null; created_at: string }

export const api = {
  patients: () => call<PatientSummary[]>('GET', '/api/_server/patients'),
  patient: (id: number) => call<PatientDetail>('GET', `/api/_server/patients/${id}`),
  caseload: () => call<Caseload>('GET', '/api/_server/caseload'),
  alerts: (status?: string) => call<Alert[]>('GET', `/api/_server/alerts${status ? `?status=${status}` : ''}`),
  setAlertStatus: (id: number, status: Alert['status']) => call<Alert>('PATCH', `/api/_server/alerts/${id}`, { status }),
  notes: (patientId?: number) => call<Note[]>('GET', `/api/_server/notes${patientId ? `?patient_id=${patientId}` : ''}`),
  addNote: (patient_id: number, note: string) => call<Note>('POST', '/api/_server/notes', { patient_id, note }),
  updatePlan: (id: number, patch: Partial<Plan> & { rationale?: string }) => call<Plan>('PATCH', `/api/_server/plans/${id}`, patch),
  ask: (question: string) => call<AskResult>('POST', '/api/_server/ask', { question }),
  saveSession: (payload: { patient_id: number; exercise_key: string; side: string; started_at: string; ended_at: string; pain_score: number; source: string; reps: RepResult[] }) =>
    call<{ session: Record<string, unknown> & { session_id: number }; assessment: Assessment }>('POST', '/api/_server/sessions', payload),
  agents: () => call<AgentInfo[]>('GET', '/api/_agent'),
  triggerAgent: (name: string, event: string, payload: unknown) => call<AgentRun>('POST', `/api/_agent/${name}/_trigger`, { event, payload }),
  agentRuns: () => call<AgentRunRow[]>('GET', '/api/_server/agents/runs?limit=20'),
};
