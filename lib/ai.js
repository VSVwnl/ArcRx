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

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|pg_|information_schema|set\s|do\s)\b/i;

/** Read-only SQL guard: one SELECT/WITH statement, no DDL/DML, wrapped with a LIMIT. */
export function guardReadOnlySql(sql) {
  const s = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!s) return { ok: false, reason: 'empty SQL' };
  if (s.includes(';')) return { ok: false, reason: 'multiple statements' };
  if (!/^(select|with)\b/i.test(s)) return { ok: false, reason: 'only SELECT queries are allowed' };
  if (FORBIDDEN.test(s)) return { ok: false, reason: 'statement contains a forbidden keyword' };
  return { ok: true, sql: `SELECT * FROM (${s}) AS governed LIMIT 200` };
}
