# ArcRx: 3-minute live demo script

**Where to run it.** The live app is https://bodapati-arcrx-rehab-coach.go.informer-apps.com.
Entrinsik judges open it on their phones, so sign in there beforehand and pre-warm it (step 2
of the checklist). If the venue Wi-Fi is uncertain, run the same production bundle offline with
`npm run demo:offline` and open http://localhost:4173. The two behave identically. Stop any
`npm run dev` first, because both use the same local workspace.

**Room setup.** Put the laptop on a table with good front light and a plain background. Stand
about 2 m back for the shoulder exercise, or sit for the cervical exercise. Grant the camera
permission once beforehand. Demo simulation is one click away at all times.

| Time | Screen | Say | Do |
|---|---|---|---|
| 0:00–0:25 | Exercise tab, camera off | "After rotator cuff surgery, patients do home exercises alone for months. Half of them stop, and the therapist finds out at the next visit, weeks later. ArcRx turns any laptop webcam into a goniometer and puts a physical therapist's judgment into the loop every single session." | In **Exercising as**, pick **Maya Chen**. Point at the prescription card: *Shoulder abduction, right, 150° target, plateau.* |
| 0:25–1:15 | Live camera | "Video never leaves the browser. MediaPipe runs right here, and the protractor you see is drawn at my shoulder in real time." Raise the arm 3–4 times. On one rep, lean the trunk: "It also sees how I cheat: that's trunk lean. PTs call this compensation; it's the difference between rehab and re-injury." | Watch rep rows appear with peak angle, smoothness and flags. If tracking is poor, press **Demo simulation** and carry on with the same script. |
| 1:15–1:35 | Finish & save | "Only the scored angles are saved to the Informer workspace, and the triage protocol runs on them straight away." | Set pain to 2, press **Finish & save session**. The result card shows the trajectory status and the agent's actions. For Maya near her usual ~120°, that is a plateau alert, a modest plan progression and a note. |
| 1:35–2:20 | Clinic tab | "This is what the therapist sees in Informer: the whole caseload, governed by role. Priya regressed with pain 6/10, so triage raised a high alert and wrote the objective note. Tomás has stopped practising; the Monday digest flags him for outreach, and I'll run it in a moment." | Open Priya: the trajectory against the target line, rep bars with compensation in coral, the agent's note. Acknowledge her alert. |
| 2:20–2:45 | Ask tab | "Clinicians can just ask the data." | Press *Who is missing sessions?* then *Show compensation by patient*. Point at the badge: "Deterministic query" today; with a model in the tenant it becomes "Model-drafted SQL, validated read-only". |
| 2:45–3:00 | Agents tab | "Everything you saw is an Informer App. informer.yaml declares the roles, events and these two agents; the server routes and tools run in Informer's sandbox against the app's private Postgres, and every tool call lands in this audit log." | Press **Run now** on the weekly report: the digest flags Tomás and the tool calls appear. |

Say it accurately: our tenant has no AI model in its catalog yet, so triage runs as a
deterministic protocol through the same tools. The app labels it that way. Don't call it
"Informer AI" unless the catalog has synced.

**Fallbacks**

- **Camera denied, dark room, or no camera.** Press **Demo simulation**. It is the same pipeline with scripted compensation every 3rd rep, and the slider sets how far the virtual patient reaches.
- **Presenter too close for shoulder tracking.** Switch the exercise to **Cervical rotation**. The face model works seated at the keyboard.
- **A save fails** (Wi-Fi drops). The reps are kept. Press **Retry save** when the connection is back; it never writes a duplicate.
- **First camera start is slow on the live site.** It downloads about 20 MB the first time. The pre-warm step avoids this.
- **Projector too small.** The large numeral in the right column mirrors the on-video gauge.

**Pre-demo checklist (2 minutes)**

1. Close other apps that use the camera (Teams, Zoom, Camera). Plug in power.
2. Open the live app in Chrome or Edge and sign in. On the Exercise tab press **Start camera**, wait for "Step into frame", then **Stop** and **Discard**. This caches the vision files and grants the camera permission.
3. Stand back and do three slow raises plus one with a trunk lean. Expect 3–4 reps, one *Trunk lean* row, and an fps badge of 20 or more.
4. Clinic tab: Priya's high alert is in the queue. Agents tab: two agent cards.
5. Offline fallback ready: `npm run demo:offline` starts on http://localhost:4173 (with `npm run dev` stopped).
