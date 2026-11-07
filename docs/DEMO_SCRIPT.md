# ArcRx — 3-minute live demo script

Live app: https://bodapati-arcrx-rehab-coach.go.informer-apps.com (Entrinsik judges open this on their
phones; create an account there once beforehand). Adding a patient asks for the clinic code: 2026. For the stage demo, the offline copy below is the
safer choice if Wi-Fi is uncertain; the two behave identically.

Setup before judges arrive: `npm run dev` running, browser at http://localhost:5173, laptop
on a table, presenter standing ~2 m back for the shoulder exercise (or seated for the
cervical exercise). Camera permission already granted once. Demo Simulation is one click
away at all times.

| Time | Screen | Say | Do |
|---|---|---|---|
| 0:00–0:25 | Exercise tab, camera off | "After rotator cuff surgery, patients do home exercises alone for months. Half of them stop, and the therapist finds out at the next visit, weeks later. ArcRx turns any laptop webcam into a goniometer and puts a physical therapist's judgment into the loop every single session." | Point at the prescription card: *Shoulder abduction, right, 150° target.* |
| 0:25–1:15 | Live camera | "Video never leaves the browser. MediaPipe runs on the GPU here, and the protractor you see is drawn at my shoulder in real time." Raise the arm 3–4 times. On one rep, lean the trunk: "It also sees how I cheat: that's trunk lean. PTs call this compensation; it's the difference between rehab and re-injury." | Watch rep rows appear with peak angle, smoothness and flags. If lighting fails: click **Demo simulation** and continue the same script with the virtual patient. |
| 1:15–1:35 | Finish & save | "Only the scored angles are saved to the Informer workspace." | Set pain to 2, click **Finish & save session**. The outcome card shows the trajectory status and the agent's actions: alert raised, note written. |
| 1:35–2:20 | Clinic tab | "This is what the therapist sees in Informer: the whole caseload, governed by role. Priya regressed with pain 6/10, the triage agent raised a high alert and wrote the objective note. Tomás stopped practising; the Monday caseload agent flagged him for outreach." | Click Priya → longitudinal ROM chart with target line, rep-by-rep bars with compensation in coral, agent note in the timeline. Acknowledge an alert. |
| 2:20–2:45 | Ask tab | "Clinicians can just ask the data." | Click *Who regressed this week?* then *Show compensation by patient*. Point out the governed read-only query badge. |
| 2:45–3:00 | Agents tab | "Everything you saw is an Informer App: informer.yaml declares the roles, events and these two agents; server routes and tools run inside Informer's sandbox against the app's private Postgres. It runs offline today on PGlite and deploys to Informer with `npm run deploy`." | Click **Run now** on the weekly report to show the auditable tool calls. |

Fallbacks
- Camera denied / dark room → **Demo simulation** (same pipeline, scripted compensation every 3rd rep; slider changes how far the virtual patient reaches).
- Presenter too close for shoulder tracking → switch exercise to **Cervical rotation** (face model works seated at the keyboard).
- Projector too small → the numeral in the right column mirrors the on-video gauge.

Pre-demo checklist (60 seconds)
1. `npm run dev` → console shows `[arcrx-local] workspace ready … (4 patients)`.
2. Open http://localhost:5173 → Exercise tab shows the prescription card for the selected patient.
3. Click **Start camera**, allow the camera, hold still 1.5 s, raise the arm: the amber arc tracks
   the shoulder and the big numeral follows. If anything is off, **Demo simulation**.
4. Complete 3 reps, lean once → a rep row shows *Trunk lean*. Click **Finish & save session** →
   the purple card says *Session saved · triage agent* with the alert/note lines.
5. Clinic tab → the new alert is in the queue; click the patient → chart shows today's point.
6. Ask tab → *Who regressed this week?* answers with Priya.
7. Agents tab → **Run now** on `weekly_caseload_report` → tool calls listed, Tomás flagged.
