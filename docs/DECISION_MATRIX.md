# Concept selection — Triangle AI Hackathon 2026

Three webcam-based Health & Wellness concepts were scored against the 24-point rubric
(Technical Sophistication 1–7, Novelty 1–7, Value Proposition 1–7, Presentation 1–3).
All three require both real-time browser computer vision *and* Informer's governed
data, analytics and agent architecture.

| Concept | Tech | Novelty | Value | Presentation | Total | Notes |
|---|---:|---:|---:|---:|---:|---|
| **A. ArcRx — webcam range-of-motion rehab coach** (pose + face landmarks → goniometer angles, rep quality, compensation detection; clinician dashboards; triage agent) | 6 | 5 | **7** | **3** | **21** | Highest-stakes problem (post-op rehab adherence ≈ 35–50%); clean multi-role governance story (patient vs clinician); robust at a desk (cervical) and standing back (shoulder/elbow); every rep yields clinically meaningful numbers for Informer. |
| B. Ocular strain / micro-fatigue early warning (blink rate, PERCLOS, gaze stability, yawning → burnout index; recovery scheduling agent) | 6 | 4 | 5 | 3 | 18 | Very reliable at a laptop, but drowsiness detection is well-trodden (driver monitoring) and the clinical action is soft (“take a break”). |
| C. Breathing cadence / rPPG stress regulation coach (shoulder-rise respiration + remote PPG heart-rate variability; longitudinal wellness analytics) | **7** | **6** | 5 | 1 | 19 | Most technically ambitious, but rPPG is fragile under stage lighting and webcam compression; a live demo could fail on the day. |

**Decision: Concept A.** It wins on Value and Presentation, ties on Tech, and its
differentiation comes from *what* is measured rather than from a fragile sensor:

- **Goniometer-grade joint angles in the browser** (shoulder abduction, elbow flexion,
  cervical rotation and lateral flexion) with a One Euro filter and calibration to the
  patient's own neutral posture.
- **Movement-quality scoring**, not just rep counting: smoothness (velocity irregularity
  and reversals) and **compensation detection** (trunk lean, shoulder hike, shoulder
  drift, head tilt, chin drop) — the substitutions physical therapists actually watch for.
- **Governed longitudinal analytics on Informer**: per-patient trajectories, adherence,
  compensation trends; patients see only their own record, clinicians see the caseload.
- **An agent that acts**: `rehab_triage` runs on every `session.completed` event, assesses
  trajectory, raises alerts, progresses the prescription within guard rails and writes a
  SOAP-style note; `weekly_caseload_report` runs on a cron for outreach.
- **Demo resilience**: the whole loop runs offline (PGlite workspace, deterministic agent
  plans) and a Demo Simulation Mode drives the identical pipeline with a virtual patient.
