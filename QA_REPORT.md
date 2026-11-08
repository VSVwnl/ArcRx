# ArcRx QA report — release decision for the Triangle AI Hackathon demo

Date: 2026-11-07 (evening before judging). Owner: QA/release pass on `main`.
Verdict: **CONDITIONAL GO** (conditions at the end).

## What was tested and where

| Target | What it is | How it was exercised |
|---|---|---|
| Production bundle, local | `vite build` output served by `vite preview` with the offline mirror reporting a non-dev platform (no injected context, no dev role switch, in-process triage) on a fresh, isolated database per run | 35-scenario browser matrix, every scenario in a new browser context (clean profile) |
| Live Informer app | https://bodapati-arcrx-rehab-coach.go.informer-apps.com on tenant `bodapati.go.informer.cloud` (Informer 2026.2.0-react-ea9) | API-level checks as the tenant admin via the `inf` CLI token, plus an anonymous browser visit |
| Offline dev server | `npm run dev` path (official-plugin-compatible mirror on PGlite) on an isolated database | 18-scenario subset |
| Browsers | Chrome 156.0.8078.80 and Microsoft Edge 157.0.4341.42 (installed), both headless via `playwright-core` | Firefox and Safari are not installed on this machine: **not run** |
| Hardware | Windows 11 laptop, Node 22.20 | Real webcam with a person in frame: **not run** (see gaps) |

Evidence levels are labelled in every result: `[sim]` the in-app simulator, `[synthetic-cam]` an animated
canvas fed to the app as the camera (no person in frame), `[stub]` a forced getUserMedia outcome or network
response. None of these is a real-webcam run. Chrome's built-in fake camera was unusable here: on this
machine it either fails to open or ends its track within ~250 ms, even outside the app.

## How to reproduce

```bash
npm run typecheck
npm test                                   # 99 server checks + 23 CV fixture checks (no network)
npm run build && ARCRX_DATA_DIR=/tmp/arcrx-qa npx vite preview   # production bundle on an isolated DB, :4173
npm run test:e2e                           # 35-scenario browser matrix → qa/e2e-results.json, qa/evidence/
CHROME_PATH="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" npm run test:e2e   # Edge
node qa/live-check.mjs                     # live Informer checks (needs `inf login`); creates and deletes one QA patient
```

Results on the release build:

| Suite | Result |
|---|---|
| Typecheck, production build | clean |
| `npm test` (server + CV fixtures) | 99/99, 23/23 |
| Browser matrix, production bundle, Chrome | **35/35** in one clean run (`qa/e2e-results.json`) |
| Browser subset, production bundle, Edge | 8/8 (`qa/e2e-results-edge.json`) |
| Browser subset, offline dev server | 17/18 (`qa/e2e-results-dev.json`); the one failure is Vite's hot-reload websocket to localhost, see Privacy |
| Live Informer checks | 17/17 (`qa/live-check.log`) |

## Core journeys that passed

- **Complete session** (F2): simulator → 3 reps → Finish → exactly one session row → triage runs → the result card lists the agent's tool calls and stays on screen → the agent run in the audit log carries that session's id.
- **Failure then recovery** (F4–F8): save answers 500, 401, 429, 503, malformed JSON, or the network drops → plain-language error, reps kept, **Retry save** writes exactly one row. A response lost *after* the server wrote the row (F5) does not duplicate on retry.
- **Camera lifecycle** ([synthetic-cam] C1–C9): no person → tracking never starts, 0 reps, Finish refuses; Stop, leaving the tab, repeated start/stop ×8, model-load failure, and leaving while the permission prompt is pending all leave **zero live camera tracks** and stop the inference loop; a camera that disconnects mid-session is reported and the loop stops; permission denied / no camera / camera in use each give a specific message and a Demo-simulation fallback.
- **Data integrity**: double-click Finish (F3), refresh mid-session (F11), switching patient mid-session (F10), back-to-back sessions with a slow agent result (F12).
- **Sponsor flow, live on Informer**: synthetic patient created with the clinic code → session saved (582 ms including triage) → triage protocol ran on the platform and wrote its note against that exact session id → retry with the same `client_ref` returns the same session; two concurrent duplicates collapse to one row → anonymous call 401, wrong clinic code 403, malformed payloads 400 (never 5xx), prompt injection in Ask changes nothing, seeded demo patients cannot be deleted → QA patient deleted, counts back to the starting values.
- **Usability**: no horizontal scrolling on any tab at 360, 390, 768, 683 (200 % zoom proxy), 1366, 1920 px (U1); keyboard-only start with a visible focus ring (U2); lost tracking shows "—" and a dimmed gauge instead of a stale live number (U3).

## Defects found and fixed

Release blockers first. Every fix has a regression check that failed before the fix and passes after.

| # | Defect (how found) | Fix | Files | Regression |
|---|---|---|---|---|
| 1 | A failed save lost the scored session: Finish disappeared, the only way on was to start over (F4: no retry after a 500) | Reps stay; **Retry save** / **Discard**; specific messages per status | `src/views/SessionView.tsx`, `src/cv/useSessionEngine.ts` | F4, F6×3, F7, F8 |
| 2 | Retrying after a lost response wrote a duplicate session | `client_ref` idempotency key per session; unique index; concurrent duplicates return the stored row | `migrations/005-session-idempotency.sql`, `server/sessions/index.js` | F5; `npm test` idempotency ×5; live ×3 |
| 3 | Switching patient mid-session saved patient A's reps to patient B (F10: "patient 2's reps were saved to patient 1") | Session view keyed by patient: switching ends the session and releases the camera | `src/views/PatientHome.tsx` | F10 |
| 4 | The agent result card vanished right after appearing whenever triage progressed the plan (1 in 5 runs; exactly the "Plan progressed" moment the demo shows) | The plan-sync effect no longer clears the outcome | `src/views/SessionView.tsx` | F2 now asserts the card survives the refresh; 0/8 lost after the fix |
| 5 | Camera stayed on after the vision model failed to load (C5) | Release the stream on any failed start | `src/cv/useSessionEngine.ts` | C5 |
| 6 | A camera granted after the user left the tab, or after choosing the simulator, stayed on with no UI (C6, C9) | Start generation token: a superseded start releases what it acquired; start buttons disabled while starting | `src/cv/useSessionEngine.ts`, `src/views/SessionView.tsx` | C6, C9 |
| 7 | A disconnected camera was not noticed: the loop kept running on a dead feed and said "step into frame" | Track `ended` handler: stop the loop, say the camera stopped, keep the reps | `src/cv/useSessionEngine.ts` | C8 (also on Edge) |
| 8 | Offline demo: a second dev server silently started on port 5174 against the same embedded database (found a real stale one running since morning) | Data-directory owner lock with a clear error; fixed ports | `dev/local-informer.ts`, `vite.config.ts` | Verified: second `npm run dev` fails on the port; a server on another port refuses the shared workspace |
| 9 | Offline demo: Add patient was refused ("Only clinicians can add patients") because the Exercise tab acts as the patient role in dev | Patient creation acts as clinician in the dev servers | `src/lib/api.ts` | A3 on the dev server |
| 10 | Lost tracking still showed the last angle in "live" amber | "—", dimmed gauge, "not tracking: no reading" | `src/views/SessionView.tsx` | U3 |
| 11 | Malformed server response surfaced a raw `TypeError` | Response shape check, plain message, retry | `src/views/SessionView.tsx` | F7 |
| 12 | New patient: "Loading history" spinner forever; while switching, the previous patient's chart showed under the new name | Empty state; only render the selected patient's record | `src/views/PatientHome.tsx` | A3 path (manual check of the empty state in the R1 screenshot) |
| 13 | First camera start on the live site downloads ~20 MB with only "Loading…" | Status names the size ("about 15 MB the first time") | `src/cv/mediapipe.ts` | — |

Test-infrastructure added: `test/e2e.mjs` (browser matrix, `playwright-core` driving the installed Chrome/Edge), `test/cv.mjs` (landmark fixtures: angle accuracy, mirroring, low-confidence floor, rep-detector boundaries, tracking gaps), idempotency cases in `test/smoke.mjs`, `qa/live-check.mjs`. The offline mirror can now serve `vite preview` (production bundle) with `ARCRX_DATA_DIR` isolation.

Flakiness note: F2 failed twice early on and passed on rerun. It was not retried into green; it was traced to defect 4 and fixed.

## Privacy: what leaves the browser

Measured with request capture during a synthetic-camera run plus a saved session (`qa/evidence/P1-network.json`) and an anonymous visit to the live site (`qa/evidence/live-anonymous-visit.json`).

- **Only the app's own origin** is contacted, locally and live. No third-party hosts, no CDN, no telemetry. Live: `/`, `assets/*.js|css`, `/api/me`, `favicon.svg` on first visit.
- **Camera frames never leave the device.** No request body contains image data, base64 blobs, or landmark arrays.
- **The only write** is `POST /api/sessions`, about 450 bytes: `patient_id, exercise_key, side, started_at, ended_at, pain_score, source, reps[], client_ref`. Each rep holds `index, peak_angle, duration_ms, hold_ms, smoothness, compensation_flags`. The random `client_ref` is the only new identifier.
- **No localStorage, sessionStorage or IndexedDB** is written, and no app cookies are set. The live sign-in session cookie is Informer's and is HttpOnly.
- **No websockets** in the production bundle. The dev server opens Vite's hot-reload socket to localhost, which carries no app data. Running the offline demo from the production bundle avoids it.
- **Model and runtime files** come from the app's own origin, not a CDN. That is why the first camera start downloads them.

## Measured performance (headless, this laptop; synthetic inputs)

| Measure | Result | Notes |
|---|---|---|
| First load to interactive shell, local production bundle | DOMContentLoaded 127 ms; shell 0.56 s | F1 |
| Live site, anonymous, phone viewport | network idle 1.25 s | landing page only |
| Live API latency, `GET /api/patients` | median 205 ms (203–306) | 5 calls |
| Live session save including in-process triage | 582 ms; idempotent replay 229 ms | live-check |
| Camera start to inference loop | 1.7–7.2 s locally (first context includes WASM compile) | [synthetic-cam] C1/R2 |
| Cold download of vision runtime + pose model from the live site | 14.6 MB in 9.9 s + 5.8 MB in 4.0 s | **~14 s on first camera start** on this connection; `cache-control: max-age=0` so the browser revalidates |
| Inference loop rate, pose model, 1280×720 | 75–80 fps | no person in frame; a real person may be slower; headless has no vsync cap |
| Simulator loop rate | 166 fps; 145 fps at 4× CPU throttle | R1 |
| Memory over a 20 s session + 10 repeat sessions | JS heap 3.3 → 4.5 MB; listeners 200 → 204; DOM nodes 452 → 454 | no growth trend (R1) |
| Bundle | app JS 696 KB (gzip 202 KB), vision bundle 154 KB | — |

No project budgets exist. These are baselines, not pass/fail thresholds, except R1, which fails above 25 MB heap or 200 listeners of growth.

## Not run, simulated, or blocked, and the impact

| Gap | Why | Impact | Shortest manual check |
|---|---|---|---|
| **Real webcam with a person** | No human-in-frame fixture; I will not open the user's real camera unattended | **High.** Angle accuracy, rep counting and compensation on a real body are covered only by landmark fixtures and the simulator | On the demo laptop: Start camera, stand ~2 m back, 3 slow shoulder raises plus one with trunk lean. Expect 3 or 4 reps within ±10° of eyeballed angles, and one "Trunk lean" row |
| Real inference rate with a person, real GPU delegate | headless, synthetic input | Medium | Read the "fps" badge during the check above; expect ≥ 20 |
| Live UI signed in as an app account | creating accounts on the live site is off-limits for me; I verified the live API as the tenant admin and the live landing page anonymously | Medium. A signed-in walkthrough on the live site was done by the user earlier today (Agents tab screenshot) | Sign in on a phone, add yourself with code 2026, save one simulated session, check Clinic and Agents |
| Informer AI agents and AI natural-language SQL, live | The tenant's model catalog is empty (`/api/chat-models` total 0) | Medium for the sponsor story. Triage runs live through the identical tool protocol in-process, which the app labels "deterministic protocol", not "Informer AI" | If the catalog syncs, redeploy is not needed. Save a session and check the run is labelled Informer AI |
| Patient-role isolation on live | no patient account | Low. Server scoping is covered by `npm test` (patient sees only their record; 403 on others) | — |
| Firefox, Safari | not installed | Medium if a judge uses Safari on an iPhone. MediaPipe GPU in Safari is unverified | Open the live URL on an iPhone, run Demo simulation |
| Multiple tabs, tab backgrounding, browser back/forward | not run; the app has no client routes, so back leaves the page | Low | — |
| Real slow network, real token expiry | simulated with stubs and offline mode | Low | — |

Known non-blocking observations:

- **Ask wording.** "-3% drop" reads oddly when the regression is due to pain rather than range.
- **Trajectory status.** It reflects range of motion only. High compensation or pain is raised as a separate alert and does not change the status label.

## Release decision: CONDITIONAL GO

The demo path, its recovery paths, the privacy claim, and the live Informer data flow are verified on the
exact build that is deployed (live bundle `assets/index-CpC2Azop.js` = tested bundle). Every release
blocker found was fixed and is covered by a regression check. The conditions:

1. Run the real-webcam check above on the presenting laptop before judging. If tracking is poor, present with Demo simulation, which drives the same pipeline.
2. Pre-warm the live site on every device you will demo from, to avoid the ~14 s first camera start.
3. Say "deterministic triage protocol" rather than "Informer AI" unless the tenant's model catalog has synced.

## Pre-demo checklist (laptop, browser, webcam, Informer)

1. **Laptop:** close other apps that use the camera (Teams, Zoom, Camera). Plug in power.
2. **Browser:** Chrome or Edge, current version, zoom 100 %. Open https://bodapati-arcrx-rehab-coach.go.informer-apps.com and sign in.
3. **Pre-warm:** on the Exercise tab press Start camera once, wait for "Step into frame", then Stop and Discard. This caches the ~20 MB vision files and grants the camera permission.
4. **Webcam:** good front light, plain background, stand ~2 m back for the shoulder exercise. Check the fps badge reads ≥ 20 and the arc follows your arm.
5. **Informer:** `inf whoami` shows the `bodapati.go.informer.cloud` sign-in. Clinic tab shows Priya's open high alert. Agents tab shows two agent cards.
6. **Offline fallback:** stop any other dev server first. Then run `npm run demo:offline` and open http://localhost:4173. It serves the same production bundle with a local database. If a second server is running, it refuses with a clear message instead of corrupting the workspace.
7. **If anything fails on stage,** press Demo simulation. If a save fails, press Retry save. The reps are kept.
