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

- GitHub repository: https://github.com/VSVwnl/Triangle-AI-Hackathon
- Demo video (≤ 3 min): [[YouTube / Loom URL — record from docs/DEMO_SCRIPT.md]]
- Live demo: runs locally with `npm install && npm run dev` (no hosted instance needed; fully offline)

## Built with (tags)

react, typescript, vite, tailwindcss, mediapipe, webgl, postgresql, pglite, entrinsik-informer, informer-apps, recharts, node.js, anthropic, yaml

## Gallery

- [[Screenshot 1: Exercise tab with live goniometer arc on the shoulder]]
- [[Screenshot 2: Session saved card showing the triage agent's alert + note]]
- [[Screenshot 3: Clinic dashboard with caseload status pills and alert queue]]
- [[Screenshot 4: Patient detail with longitudinal ROM chart and compensation bars]]
- [[Screenshot 5: Ask tab answering "Who regressed this week?"]]
- [[Screenshot 6: Agents console with weekly_caseload_report tool calls]]

---

## About the project

### Inspiration

After orthopaedic surgery or injury, recovery depends on home exercise programs done alone for weeks. Published adherence sits around 35–50%, and therapists only discover that a patient stalled, regressed, or started compensating at the next visit. Range of motion, the primary outcome, is still measured with a hand-held goniometer a few times a month. Nobody sees the other 95% of the reps. We wanted the laptop every patient already owns to become that instrument, and we wanted a therapist's judgment, not just a rep counter, to run after every session.

### What it does

ArcRx turns a laptop webcam into a clinical range-of-motion instrument backed by an Entrinsik Informer App.

- **Measures every rep on the device.** MediaPipe Pose and Face Landmarker models run in the browser (WebGL with CPU fallback, models served from the app). Shoulder abduction and elbow flexion use pose landmarks; cervical rotation and lateral flexion use the face model's head transform. Frames never leave the laptop; only scored angles are saved.
- **Scores movement quality, not just count.** Each rep records peak angle, duration, end-range hold, a smoothness score, and compensation flags that therapists watch for: trunk lean, shoulder hike, shoulder drift, head tilt, chin drop.
- **Governs the data in Informer.** Sessions and reps land in the app's private Postgres workspace. Patients see only their own record; clinicians see the caseload. Every server route enforces the role.
- **Lets an agent act.** The `rehab_triage` agent runs on every `session.completed` event: it reads 30 days of history, assesses the trajectory (on track / ready to progress / plateau / regression / low adherence), raises alerts, adjusts the prescription within guard rails (±10°, ±2 reps), and writes a SOAP-style progress note. A `weekly_caseload_report` agent runs Monday 07:00 and flags adherence gaps for outreach.
- **Answers questions over the caseload.** "Who regressed this week?" is answered by a model-drafted, validated read-only SQL query when a model is available, or by a deterministic intent router over the same tables, always scoped to the asker's role.
- **One-click Demo Simulation** drives the identical pipeline with a virtual patient if lighting or camera access fails.

### How we built it

- **Frontend:** Vite, React 19, TypeScript, Tailwind v4, Recharts. A canvas overlay draws the skeleton and a goniometer arc with the target tick directly on the mirrored video.
- **Computer vision:** `@mediapipe/tasks-vision` Pose Landmarker (lite) and Face Landmarker. A 1.5-second calibration to the patient's own neutral posture, a One Euro filter, and a rep state machine (minimum range, return threshold) make counts and peaks repeatable. Compensation uses exercise-specific geometry (shoulder rise relative to torso length, hip–shoulder deviation from vertical, head roll during rotation).
- **Informer App:** `informer.yaml` declares roles, events and two agents; `server/` holds file-convention routes mounted at `/api/_server`; `tools/` holds the agent tools; `migrations/` carries the schema plus six weeks of realistic demo data for four patients; `lib/` holds shared domain logic. Everything conforms to the documented Informer Apps shape and deploys with `npm run deploy`.
- **Offline mirror:** the official Vite plugin only mounts routes and agents when a live Informer is configured, so we wrote a drop-in mirror of its dev server on PGlite (Postgres in WASM) with the same handler bag, the same routes, and the same `window.__INFORMER__` injection. The exact `server/`, `tools/`, and `migrations/` files run offline and deploy unchanged.
- **Agents without a model:** each agent ships a declarative fallback plan (a small `when` / `forEach` / template DSL) executed with the real tool handlers, so the demo behaves identically with Informer AI, with an Anthropic key, or with no model at all.

### Challenges we ran into

- **Demo-day resilience.** We could not depend on conference Wi-Fi or a reachable Informer instance, which forced the PGlite mirror and deterministic agent plans.
- **Angles that mean something.** Raw landmark angles jitter and depend on where the patient stands. Calibration, filtering, and a proper rep state machine took several iterations; an early simulator bug reported 170° elbow flexion at rest because the forearm vector pointed the wrong way.
- **Compensation detection** needed per-exercise geometry rather than a single heuristic.
- **Governed natural-language SQL.** Model-drafted SQL is accepted only if it is a single SELECT over an allow-list of app tables and an allow-list of functions, with no comments, catalog access or write keywords, then wrapped in a LIMIT and executed inside a read-only transaction with a statement timeout.

### Accomplishments that we're proud of

- A complete loop that runs with zero network: webcam → scored reps → Informer workspace → triage agent → clinician alert and note → longitudinal dashboard.
- Four exercises across two vision models, each with its own compensation checks.
- Six weeks of realistic longitudinal data for four patients (plateau, regression with pain, ready-to-progress, non-adherent) so the analytics and both agents have something true to say.
- Full conformance to the Informer Apps structure: `informer.yaml`, `server/`, `tools/`, `migrations/`, `lib/`, package `informer` block, workspace and deploy scripts.

### What we learned

- Informer's event → agent → tool model maps cleanly onto clinical workflows: a session is an event, triage is an agent, and every clinical action (alert, note, plan change) is an auditable tool call.
- Client-side CV is good enough for clinical screening when you calibrate to the individual and filter deliberately; the hard part is defining what a "rep" and a "compensation" are, not running the model.
- Defence in depth matters for AI-drafted queries: allow-lists plus database-enforced read-only transactions, never one alone.

### What's next for ArcRx

- Real patient identities via Informer SSO (the `patients.username` mapping already exists).
- Live channels pushing agent alerts into the clinic view in real time.
- Bilateral comparison and clinician protocol templates per surgery type.
- Validation against hand-held goniometer measurements with a partner clinic.

---

## Optional short description (≈ 100 words, for listings)

ArcRx turns a laptop webcam into a clinical range-of-motion instrument. A patient performs prescribed rehab exercises in the browser while MediaPipe measures joint angles every frame on the client, scoring each rep for range, smoothness and the compensation patterns therapists watch for. Only the numbers are saved to a role-governed Entrinsik Informer workspace, where a triage agent raises alerts, progresses the prescription within guard rails and writes an objective progress note. Clinicians get longitudinal dashboards, an alert queue and natural-language questions over their caseload. Everything runs offline on a laptop and deploys unchanged to Informer.

*ArcRx is a hackathon prototype and not a medical device.*
