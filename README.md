# ArcRx — a webcam goniometer with a physical therapist's judgment in the loop

**Triangle AI Hackathon 2026 · Health & Wellness track · Entrinsik Challenge: Best Use of Informer Apps**

ArcRx turns a laptop webcam into a clinical range-of-motion instrument. A patient does their
prescribed rehab exercise in front of the browser; MediaPipe measures the joint angle every
frame on the client, scores every rep for range, smoothness and *compensation* (the cheating
patterns therapists watch for), and saves only the numbers to a governed Informer workspace.
An Informer agent then triages the session: it raises clinician alerts, progresses the
prescription within guard rails and writes an objective progress note. Clinicians get
longitudinal dashboards, an alert queue and natural-language questions over their caseload.

```bash
npm install
npm run dev          # http://localhost:5173 — fully offline: PGlite workspace + deterministic agents
```

---

## Problem

After orthopaedic surgery or injury, recovery depends on home exercise programs done alone for
weeks. Published adherence is roughly 35–50%, and therapists only learn a patient has stalled,
regressed or started compensating at the next visit. Range of motion, the primary outcome, is
measured with a hand-held goniometer a few times a month. Nobody sees the other 95% of the reps.

## Solution

- **Measure every rep, on the device.** Pose and face landmark models run in the browser
  (WebGL/WASM, served from the app, no network needed). Shoulder abduction and elbow flexion use
  the pose model; cervical rotation and lateral flexion use the face model's head transform. A
  One Euro filter and a 1.5-second calibration to the patient's own neutral posture give stable,
  repeatable angles. Frames never leave the laptop.
- **Score movement quality, not just count.** Each rep records peak angle, duration, end-range
  hold, a smoothness score (velocity irregularity and reversals) and compensation flags: trunk
  lean, shoulder hike, shoulder drift, head tilt, chin drop.
- **Govern the data in Informer.** Sessions and reps land in the app's private Postgres
  workspace. Patients see only their own record; clinicians see the caseload. Every route
  enforces the role server-side.
- **Let an agent act.** `rehab_triage` runs on every `session.completed` event: it reads 30 days
  of history, runs a deterministic trajectory assessment (on track / ready to progress / plateau /
  regression / low adherence), raises alerts, adjusts the plan inside guard rails (±10°, ±2 reps)
  and writes a SOAP-style note. `weekly_caseload_report` runs Monday 07:00 and flags adherence
  gaps for outreach.
- **Ask the data.** "Who regressed this week?" is answered either by a model-drafted, validated
  read-only SQL query (when Informer AI or a key is available) or by a deterministic intent router
  over the same tables, scoped to the asker's role.

## What the judges will see (3 minutes)

See [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md). Live camera → goniometer arc at the shoulder →
compensation caught on a rep → session saved → agent raises an alert and writes the note →
clinician dashboard, longitudinal chart, ask-your-data, agent audit log. A one-click **Demo
Simulation** drives the identical pipeline with a virtual patient if lighting or Wi-Fi fail.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vite 8, React 19, TypeScript, Tailwind v4, Recharts | Informer's documented app shape; fast local dev |
| Computer vision | `@mediapipe/tasks-vision` Pose Landmarker (lite) + Face Landmarker, GPU delegate with CPU fallback | Browser-native, ~10 MB of models served from `public/`, zero network |
| Signal processing | One Euro filter, calibration windows, rep state machine | Stable angles without lag; clinically meaningful rep boundaries |
| App platform | **Entrinsik Informer Apps** (`@entrinsik/vite-plugin-informer` 2.14) | Roles, private Postgres workspace, sandboxed server routes, events, agents, deploy pipeline |
| Offline mirror | PGlite (Postgres in WASM) + the same handler contract | Judging-day resilience: `npm run dev` works with no Informer instance and no Wi-Fi |
| LLM (optional) | Informer AI (`go_everyday` / `go_advanced`) in production; Anthropic SDK (`claude-opus-5-5`) in the local mirror | Agents and NL→SQL; a deterministic plan runs when no model is reachable |

## Informer Apps architecture

```
informer.yaml          roles (patient, clinician, admin), events, two agents
migrations/            001 schema (patients, exercise_plans, sessions, reps, alerts,
                       progress_notes, plan_changes, agent_runs) · 002 six weeks of demo data
server/                file-convention routes → /api/_server/…
  patients/            caseload with trajectory assessment · patients/[id] longitudinal record
  sessions/            POST scores a session, emits session.completed
  alerts/, notes/, plans/[id], caseload/, exercises/, agents/runs
  ask/                 NL questions → validated read-only SQL (AI) or deterministic router
tools/                 agent tools: get_patient_history, assess_progress, create_alert,
                       write_progress_note, adjust_plan, summarize_caseload
agents/                runbooks + deterministic fallback plans for each agent
lib/                   shared domain logic (exercise catalogue, trajectory assessment, SQL guard)
src/cv/                landmarks → angles → One Euro → rep detector → overlay; simulator
dev/local-informer.ts  offline mirror of the Informer dev server (same bag, same routes)
```

**Handler contract.** Every route and tool receives Informer's sandbox bag — `query(sql, params)`
against the app's Postgres workspace, `transaction`, `emit(event, payload)`, `notify`, `email`,
`log`, `request.roles`, `request.user` — and returns a value or `{ status, body }`. Routes that
must be clinician-only export `config = { roles: ['clinician', 'admin'] }`. Row-level scope for
patients is applied in `lib/rehab.js → resolvePatientScope`.

**Events → agents.** `POST /api/_server/sessions` emits `session.completed`; `informer.yaml`
subscribes `rehab_triage` with `on: session.completed`. Tools emit `alert.created` and
`plan.adjusted`, and call `notify()` to push the treating clinician on Informer GO.

**Two ways to run, one codebase.**

| | `INFORMER_URL` unset (default) | `INFORMER_URL` + `INFORMER_API_KEY` in `.env` |
|---|---|---|
| Plugin | `dev/local-informer.ts` | `@entrinsik/vite-plugin-informer` |
| Workspace | PGlite under `.informer-local/` (migrations applied on boot) | Informer dev workspace (`npm run workspace:init`) |
| Agents | Deterministic plans from `agents/*.yaml`, or the Anthropic SDK loop with `ANTHROPIC_API_KEY` | Informer AI (`/api/models/:id/_chat`) via `/api/_agent/:name/_trigger` |
| Deploy | — | `npm run deploy` |

## Challenges

- **The official dev plugin needs a live Informer.** It only mounts routes, `query()` and
  agents when `INFORMER_URL` is set. For a hackathon demo that cannot depend on conference
  Wi-Fi we wrote a drop-in mirror of its dev server (same `/api/_server`, `/api/_agent`,
  `/api/models` surfaces, same handler bag, same `window.__INFORMER__` injection) backed by
  PGlite, so the exact `server/`, `tools/` and `migrations/` files run offline and deploy
  unchanged.
- **Agents without a model.** Each agent ships a declarative fallback plan (a tiny `when` /
  `forEach` / template DSL) that the mirror executes with the real tool handlers. The LLM loop
  and the plan call the same tools, so what judges see offline is what Informer AI does online.
- **Angles that mean something.** Raw landmark angles jitter and depend on where the patient
  stands. Calibrating to the patient's own neutral pose, a One Euro filter and a rep state
  machine with a minimum range and return threshold made counts and peaks repeatable.
- **Compensation detection** needed exercise-specific geometry: shoulder hike is measured as
  the shoulder's rise relative to torso length since calibration; trunk lean as the hip–shoulder
  line's deviation from vertical; head tilt as roll during a rotation task.
- **Governed NL→SQL.** Model-drafted SQL is only accepted if it is a single SELECT over an
  allow-list of app tables with no comments, catalog access or write keywords, then wrapped in a
  LIMIT. Patients never hit that path at all.

## Accomplishments

- A complete loop that runs with zero network: webcam → scored reps → Informer workspace →
  triage agent → clinician alert and note → dashboard, in under 20 ms of server time per session.
- Four exercises across two vision models, each with its own compensation checks.
- Six weeks of realistic longitudinal data for four patients (plateau, regression with pain,
  ready-to-progress, non-adherent) so the analytics and both agents have something true to say.
- 100% conformance to Informer's documented app shape: `informer.yaml`, `server/`, `tools/`,
  `migrations/`, `lib/`, package `informer` block, deploy and workspace scripts.

## What's next

Real patient identities via Informer SSO (the `patients.username` mapping is already there),
live channels to push agent alerts into the clinic view, bilateral comparison, and clinician
protocol templates per surgery type.

## Judging-day checklist (60 seconds)

1. `npm run dev` → console shows `[arcrx-local] workspace ready … (4 patients)`.
2. Open http://localhost:5173 → Exercise tab shows the prescription card for the selected patient.
3. Click **Start camera**, allow the camera, hold still 1.5 s, raise the arm: the amber arc tracks
   the shoulder and the big numeral follows. If anything is off, **Demo simulation**.
4. Complete 3 reps, lean once → a rep row shows *Trunk lean*. Click **Finish & save session** →
   the purple card says *Session saved · triage agent* with the alert/note lines.
5. Clinic tab → the new alert is in the queue; click the patient → chart shows today's point.
6. Ask tab → *Who regressed this week?* answers with Priya.
7. Agents tab → **Run now** on `weekly_caseload_report` → tool calls listed, Tomás flagged.

## Configuration

Copy `.env.example` to `.env`. Everything is optional:

- `INFORMER_URL`, `INFORMER_API_KEY` — develop and deploy against a real Informer instance.
- `ANTHROPIC_API_KEY` — give the offline mirror a real model for agents and NL→SQL.
- `npm run models:fetch` re-downloads the MediaPipe models if `public/models/` is ever emptied.

ArcRx is a hackathon prototype and not a medical device.
