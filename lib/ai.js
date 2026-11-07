// Thin helpers over Informer's AI API (POST /api/models/:id/_object) using the
// sandbox `fetch()`; the dev mirror answers the same route locally.

/**
 * Ask a model for a JSON object matching `schema`. Returns null when the AI
 * endpoint is unavailable (offline mirror without a key, or a platform without
 * aiCompletions), so callers can fall back to deterministic logic.
 */
export async function askObject(fetch, { model = 'go_everyday', system, prompt, schema }) {
  const text = system ? `${system}\n\n${prompt}` : prompt;
  let res;
  try {
    res = await fetch(`models/${model}/_object`, {
      method: 'POST',
      body: { schema, messages: [{ role: 'user', parts: [{ type: 'text', text }] }] },
    });
  } catch {
    return null;
  }
  if (!res || res.status < 200 || res.status >= 300 || !res.body || typeof res.body !== 'object') return null;
  return res.body;
}

// Write / DDL / catalog / comment tricks. `pg_` is matched as a prefix on purpose.
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|set|do|call|execute|into|returning|lock|listen|notify|refresh|comment|security)\b|\bpg_\w*|information_schema|\$\$|--|\/\*/i;
// Only the app's own tables may be read; anything else is refused.
const ALLOWED_TABLES = ['patients', 'exercise_plans', 'sessions', 'reps', 'alerts', 'progress_notes', 'plan_changes'];

/**
 * Read-only SQL guard for model-drafted queries: one SELECT/WITH statement, a
 * denylist of write/catalog keywords and comment tricks, every FROM/JOIN target
 * must be an app table or a CTE, and the result is wrapped with a LIMIT. The
 * query still runs under the app workspace credentials, which only own these
 * tables — the guard is defence in depth, not the only control.
 */
export function guardReadOnlySql(sql) {
  const s = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!s) return { ok: false, reason: 'empty SQL' };
  if (s.includes(';')) return { ok: false, reason: 'multiple statements' };
  if (!/^(select|with)\b/i.test(s)) return { ok: false, reason: 'only SELECT queries are allowed' };
  if (FORBIDDEN.test(s)) return { ok: false, reason: 'statement contains a forbidden keyword' };
  const ctes = new Set([...s.matchAll(/(?:with|,)\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()));
  for (const m of s.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_.]*)/gi)) {
    const name = m[1].toLowerCase();
    if (!ALLOWED_TABLES.includes(name) && !ctes.has(name)) return { ok: false, reason: `table ${name} is not queryable` };
  }
  return { ok: true, sql: `SELECT * FROM (${s}) AS governed LIMIT 200` };
}
