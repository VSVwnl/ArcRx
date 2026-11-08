# Devpost submission — ArcRx

Paste-ready copy for every Devpost field. Items in `[[double brackets]]` are placeholders to replace before the final submission (deadline Sunday Nov 8 2026, 10:00 AM EST).

---

## Project name

ArcRx

## Tagline (≤ 200 characters)

A webcam goniometer with a physical therapist's judgment in the loop: measures every rehab rep in the browser, scores compensation, and lets an Informer agent triage the patient.

## Tracks / challenges

- Health & Wellness track
- Entrinsik Challenge: Best Use of Informer Apps

## Team members

- [[Your name]] — [[role, e.g. full-stack / CV / product]]
- [[Teammate name]] — [[role]]

## Links

- GitHub repository: https://github.com/VSVwnl/ArcRx
- Demo video (≤ 3 min): [[YouTube / Loom URL — record from docs/DEMO_SCRIPT.md]]
- Live app (deployed on Entrinsik Informer): https://bodapati-arcrx-rehab-coach.go.informer-apps.com
- Also runs fully offline: `npm install && npm run dev` (or `npm run demo:offline` for the production bundle)
- Clinic code for adding a patient on the live app: `2026`

## Built with (tags)

react, typescript, vite, tailwindcss, mediapipe, webgl, postgresql, pglite, entrinsik-informer, informer-apps, recharts, node.js, anthropic, yaml

## Gallery

Upload these from `docs/media/` (all captured from the real app; camera scenes use Demo simulation):

1. `session.gif`: a session from calibration to the triage result (Devpost accepts GIFs)
2. `exercise-session.png`: the goniometer arc, live angle and scored reps
3. `session-result.png`: the triage result with a plateau alert, plan progression and note
4. `clinic-dashboard.png`: caseload with trajectory pills, sparklines and the alert queue
5. `patient-chart.png`: Priya's longitudinal chart, rep bars, compensation history and notes
6. `ask.png`: "Show compensation by patient" with chart and table
7. `agents.png`: the two agents and the auditable tool calls of a run
8. `phone-signin.png` and `phone-clinic.png`: the app on a phone

---

## About the project

### Inspiration

After orthopaedic surgery or injury, recovery depends on home exercise programs done alone for weeks. Published adherence sits around 35–50%, and therapists only discover that a patient stalled, regressed, or started compensating at the next visit. Range of motion, the primary outcome, is still measured with a hand-held goniometer a few times a month. Nobody sees the other 95% of the reps. We wanted the laptop every patient already owns to become that instrument, and we wanted a therapist's judgment, not just a rep counter, to run after every session.

### What it does

ArcRx turns a laptop webcam into a clinical range-of-motion instrument backed by an Entrinsik Informer App.

- **Measures every rep on the device.** MediaPipe Pose and Face Landmarker models run in the browser (WebGL with CPU fallback, models served from the app). Shoulder abduction and elbow flexion use pose landmarks; cervical rotation and lateral flexion use the face model's head transform. Frames never leave the laptop; only scored angles are saved.
- **Scores movement quality, not just count.** Each rep records peak angle, duration, end-range hold, a smoothness score, and compensation flags that therapists watch for: trunk lean, shoulder hike, shoulder drift, head tilt, chin drop.
- **Governs the data in Informer.** Sessions and reps land in the app's private Postgres workspace. Patients see only their own record; clinicians see the caseload. Every server route enforces the role.
- **Lets an agent act.** The `rehab_triage` agent is declared on every `session.completed` event: it reads 30 days of history, assesses the trajectory (on track / ready to progress / plateau / regression / low adherence), raises alerts, adjusts the prescription within guard rails (±10°, ±2 reps), and writes a SOAP-style progress note. A `weekly_caseload_report` agent runs Monday 07:00 and flags adherence gaps for outreach. Every tool call is written to an audit log the clinic can read. Our Informer tenant has no AI model in its catalog yet, so the app detects that and runs the identical protocol in-process with the same tools; with a model, Informer's agent runner takes over with no code change.
- **Answers questions over the caseload.** "Who regressed this week?" is answered by a model-drafted, validated read-only SQL query when the tenant has a model, or by a deterministic intent router over the same tables (what the live app uses today), always scoped to the asker's role.
- **Adds patients safely.** A clinician adds a patient with a first prescription using a clinic code, and can link the record to their own account to exercise on their own chart.
- **One-click Demo Simulation** drives the identical pipeline with a virtual patient if lighting or camera access fails.

### How we built it

- **Frontend:** Vite, React 19, TypeScript, Tailwind v4, Recharts. A canvas overlay draws the skeleton and a goniometer arc with the target tick directly on the mirrored video.
- **Computer vision:** `@mediapipe/tasks-vision` Pose Landmarker (lite) and Face Landmarker. A 1.5-second calibration to the patient's own neutral posture, a One Euro filter, and a rep state machine (minimum range, return threshold) make counts and peaks repeatable. Compensation uses exercise-specific geometry (shoulder rise relative to torso length, hip–shoulder deviation from vertical, head roll during rotation).
- **Informer App:** `informer.yaml` declares roles, events and two agents; `server/` holds file-convention routes served at `/api/…`; `tools/` holds the agent tools; `migrations/` carries the schema, six weeks of realistic demo data for four patients, an agent audit log and idempotent session saves; `lib/` holds shared domain logic. The app is public with its own sign-up (Informer accounts), and deploys with `npx informer-deploy`.
- **Offline mirror:** the official Vite plugin only mounts routes and agents when a live Informer is configured, so we wrote a drop-in mirror of its dev server on PGlite (Postgres in WASM) with the same handler bag, the same routes, and the same `window.__INFORMER__` injection. The exact `server/`, `tools/`, and `migrations/` files run offline and deploy unchanged.
- **Agents without a model:** each agent ships a declarative fallback plan (a small `when` / `forEach` / template DSL) that the offline mirror runs with the real tool handlers, and the deployed app runs the same protocol in-process when the tenant has no model. The tools, alerts, notes and audit log are the same either way.

### Challenges we ran into

- **Demo-day resilience.** We could not depend on conference Wi-Fi or a reachable Informer instance, which forced the PGlite mirror and deterministic agent plans.
- **Angles that mean something.** Raw landmark angles jitter and depend on where the patient stands. Calibration, filtering, and a proper rep state machine took several iterations; an early simulator bug reported 170° elbow flexion at rest because the forearm vector pointed the wrong way.
- **Compensation detection** needed per-exercise geometry rather than a single heuristic.
- **Governed natural-language SQL.** Model-drafted SQL is accepted only if it is a single SELECT over an allow-list of app tables and an allow-list of functions, with no comments, catalog access or write keywords, then wrapped in a LIMIT and executed inside a read-only transaction with a statement timeout.
- **Reliability under real conditions.** A release QA pass with a 35-scenario browser matrix found and fixed sessions lost after a failed save, duplicate rows on retry, a camera left on after failures, and an undetected camera disconnect.

### Accomplishments that we're proud of

- A complete loop, live on Informer and fully offline: webcam → scored reps → Informer workspace → triage → clinician alert and note → longitudinal dashboard. A save including triage takes about 0.6 s on the live tenant.
- Privacy verified at runtime: only the app's own origin is contacted, and the only write is about 450 bytes of scored numbers per session.
- Four exercises across two vision models, each with its own compensation checks.
- Six weeks of realistic longitudinal data for four patients (plateau, regression with pain, ready-to-progress, non-adherent) so the analytics and both agents have something true to say.
- Full conformance to the Informer Apps structure: `informer.yaml`, `server/`, `tools/`, `migrations/`, `lib/`, package `informer` block, workspace and deploy scripts.
- 102 server checks, 23 computer-vision fixture checks, a 35-scenario browser matrix (Chrome and Edge) and 17 live Informer checks.

### What we learned

- Informer's event → agent → tool model maps cleanly onto clinical workflows: a session is an event, triage is an agent, and every clinical action (alert, note, plan change) is an auditable tool call.
- Client-side CV is good enough for clinical screening when you calibrate to the individual and filter deliberately; the hard part is defining what a "rep" and a "compensation" are, not running the model.
- Defence in depth matters for AI-drafted queries: allow-lists plus database-enforced read-only transactions, never one alone.

### What's next for ArcRx

- A cooldown on automatic plan progression, and simulated sessions marked and kept out of triage.
- Push notifications to the treating clinician through Informer's `notifications:` opt-in.
- Real patient identities via Informer SSO (the `patients.username` mapping already exists).
- Live channels pushing agent alerts into the clinic view in real time.
- Bilateral comparison and clinician protocol templates per surgery type.
- Validation against hand-held goniometer measurements with a partner clinic.

---

## Optional short description (≈ 100 words, for listings)

ArcRx turns a laptop webcam into a clinical range-of-motion instrument. A patient performs prescribed rehab exercises in the browser while MediaPipe measures joint angles every frame on the client, scoring each rep for range, smoothness and the compensation patterns therapists watch for. Only the numbers are saved to a role-governed Entrinsik Informer workspace, where a triage agent raises alerts, progresses the prescription within guard rails and writes an objective progress note. Clinicians get longitudinal dashboards, an alert queue and natural-language questions over their caseload. It is live on Entrinsik Informer, and the same code runs fully offline on a laptop.

*ArcRx is a hackathon prototype and not a medical device.*
