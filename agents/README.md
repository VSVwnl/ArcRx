# ArcRx agents

Informer deploys agents from the `agents:` block in `informer.yaml`; each agent
calls the tools in `tools/` (one file per tool exporting `description`,
`schema` and `handler`). The YAML files in this folder are the agents'
runbooks:

| Agent | Trigger | Tools | What it does |
|---|---|---|---|
| `rehab_triage` | `on: session.completed` | get_patient_history, assess_progress, create_alert, write_progress_note, adjust_plan | Turns one webcam session into alerts, plan progressions and a SOAP-style note |
| `weekly_caseload_report` | `cron: 0 7 * * 1` | summarize_caseload, create_alert | Monday digest with adherence outreach alerts |

Each runbook has a `fallback.steps` plan. The offline dev mirror
(`dev/local-informer.ts`) executes that plan with the real tool handlers when no
LLM is reachable, so the whole loop — session → agent → alert → note → dashboard —
works on a laptop with no network. With `INFORMER_URL` (Informer AI) or an
`ANTHROPIC_API_KEY` (local mirror) the LLM drives the same tools itself.

Trigger an agent by hand while developing:

```bash
curl -X POST http://localhost:5173/api/_agent/rehab_triage/_trigger \
  -H "content-type: application/json" \
  -d '{"event":"session.completed","payload":{"patient_id":3,"session_id":0,"exercise_key":"neck_rotation","side":"right","reps":8,"peak_rom":44,"smoothness":61,"compensation_pct":55,"pain_score":6}}'
```
