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

/**
 * Does this install have an AI model the agents and NL→SQL can use?
 * Informer answers GET /api/ai-budget with `configured`; the offline mirror
 * answers it from its own state. Unknown → false, so callers fall back.
 */
export async function aiConfigured(fetch) {
  try {
    const budget = await fetch('ai-budget');
    if (!budget || budget.status < 200 || budget.status >= 300 || !budget.body || typeof budget.body !== 'object') return false;
    if (budget.body.configured !== true) return false;
    // A credit pool can exist while the tenant's model catalog is still empty
    // (agent runs then fail with "Could not resolve AI model"), so also require
    // at least one model to be listed.
    const models = await fetch('chat-models');
    if (!models || models.status < 200 || models.status >= 300 || !models.body) return false;
    const b = models.body;
    const list = Array.isArray(b) ? b : b?._embedded?.['inf:model'] || b?.items || [];
    const total = typeof b?.total === 'number' ? b.total : list.length;
    return total > 0;
  } catch {
    return false;
  }
}

// Write / DDL / catalog / comment tricks. `pg_` is matched as a prefix on purpose.
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|set|do|call|execute|into|returning|lock|listen|notify|refresh|comment|security)\b|\bpg_\w*|information_schema|\$\$|--|\/\*|"/i;
// Only the app's own tables may be read; anything else is refused.
const ALLOWED_TABLES = ['patients', 'exercise_plans', 'sessions', 'reps', 'alerts', 'progress_notes', 'plan_changes'];
const ALLOWED_CALLS = new Set([
  // aggregates & window
  'count', 'sum', 'avg', 'min', 'max', 'stddev', 'variance', 'percentile_cont', 'percentile_disc', 'string_agg', 'array_agg', 'json_agg', 'jsonb_agg',
  'row_number', 'rank', 'dense_rank', 'lag', 'lead', 'first_value', 'last_value', 'ntile',
  // scalar
  'round', 'abs', 'ceil', 'floor', 'coalesce', 'nullif', 'greatest', 'least', 'lower', 'upper', 'length', 'trim', 'concat', 'left', 'right', 'substring', 'replace', 'initcap',
  'date_trunc', 'date_part', 'extract', 'now', 'age', 'to_char', 'to_date', 'make_interval', 'justify_interval',
  'jsonb_array_elements_text', 'jsonb_array_elements', 'jsonb_array_length', 'jsonb_typeof', 'jsonb_extract_path_text', 'cast', 'numeric', 'text', 'int', 'integer', 'date', 'interval', 'timestamptz',
  // keywords that can precede a parenthesis
  'select', 'from', 'where', 'and', 'or', 'not', 'in', 'exists', 'any', 'all', 'as', 'on', 'over', 'filter', 'partition', 'by', 'values', 'join', 'using', 'with', 'having', 'when', 'then', 'else', 'case', 'end', 'between', 'is', 'null', 'distinct', 'order', 'group', 'limit', 'offset', 'union', 'except', 'intersect', 'lateral', 'cross', 'inner', 'outer',
]);

/**
 * Read-only SQL guard for model-drafted queries: one SELECT/WITH statement, a
 * denylist of write/catalog keywords and comment tricks, every FROM/JOIN target
 * must be an app table or a CTE, and the result is wrapped with a LIMIT. The
 * query still runs under the app workspace credentials, which only own these
 * tables — the guard is defence in depth; the route also executes the query
 * inside a READ ONLY transaction with a statement timeout (runGovernedSql).
 */
export function guardReadOnlySql(sql) {
  const s = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!s) return { ok: false, reason: 'empty SQL' };
  if (s.includes(';')) return { ok: false, reason: 'multiple statements' };
  if (!/^(select|with)\b/i.test(s)) return { ok: false, reason: 'only SELECT queries are allowed' };
  if (FORBIDDEN.test(s)) return { ok: false, reason: 'statement contains a forbidden keyword' };
  // Function allow-list: anything written as `name(` must be a known aggregate,
  // scalar or SQL keyword. This blocks set_config(), current_setting(),
  // query_to_xml(), dblink(), lo_*() and friends by construction.
  for (const m of s.matchAll(/([a-z_][a-z0-9_]*)\s*\(/gi)) {
    const fn = m[1].toLowerCase();
    if (!ALLOWED_CALLS.has(fn)) return { ok: false, reason: `function ${fn}() is not allowed` };
  }
  const ctes = new Set([...s.matchAll(/(?:with|,)\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()));
  for (const m of s.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_.]*)/gi)) {
    const name = m[1].toLowerCase();
    if (!ALLOWED_TABLES.includes(name) && !ctes.has(name)) return { ok: false, reason: `table ${name} is not queryable` };
  }
  return { ok: true, sql: `SELECT * FROM (${s}) AS governed LIMIT 200` };
}

/**
 * Execute a guarded query inside a READ ONLY transaction with a short
 * statement timeout. Postgres refuses any write, DDL or sequence advance in a
 * read-only transaction regardless of what the text looked like. Throws when
 * the platform offers no transaction() — callers then skip the AI path.
 */
export async function runGovernedSql(transaction, sql, { timeoutMs = 3000 } = {}) {
  if (typeof transaction !== 'function') throw new Error('read-only transactions are unavailable on this platform');
  return transaction(async ({ query }) => {
    await query('SET TRANSACTION READ ONLY');
    await query(`SET LOCAL statement_timeout = ${Math.max(100, Math.floor(timeoutMs))}`);
    return query(sql);
  });
}
