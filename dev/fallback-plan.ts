// Executes the declarative `fallback.steps` plan from agents/<name>.yaml with
// the real tool handlers. A tiny, auditable DSL:
//   args values:  "$payload.x" (raw value), "text {path.to.value}" (template),
//                 { add: [a, b] } (sum), nested objects
//   when:         { path, eq|in|notIn|lt|lte|gt|gte }, { all: [...] }, { any: [...] }
//   forEach:      iterate a list; each item is bound under `as`
import type { AgentStep } from './local-ai.ts';

export interface PlanStep {
  tool?: string;
  as?: string;
  args?: Record<string, unknown>;
  when?: unknown;
  forEach?: string;
}

export interface FallbackPlan {
  steps: PlanStep[];
  summary?: string;
}

type Ctx = Record<string, unknown>;

export function getPath(ctx: Ctx, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), ctx);
}

function stringify(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(stringify).join(' ');
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function resolve(value: unknown, ctx: Ctx): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('$')) return getPath(ctx, value.slice(1));
    return value.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, p: string) => stringify(getPath(ctx, p)));
  }
  if (Array.isArray(value)) return value.map((v) => resolve(v, ctx));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.add)) return (obj.add as unknown[]).reduce<number>((a, b) => a + Number(resolve(b, ctx) ?? 0), 0);
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolve(v, ctx)]));
  }
  return value;
}

export function evaluate(cond: unknown, ctx: Ctx): boolean {
  if (cond == null) return true;
  const c = cond as Record<string, unknown>;
  if (Array.isArray(c.all)) return (c.all as unknown[]).every((x) => evaluate(x, ctx));
  if (Array.isArray(c.any)) return (c.any as unknown[]).some((x) => evaluate(x, ctx));
  const v = getPath(ctx, String(c.path));
  if ('eq' in c) return v === c.eq;
  if ('in' in c) return (c.in as unknown[]).includes(v);
  if ('notIn' in c) return !(c.notIn as unknown[]).includes(v);
  if ('lt' in c) return Number(v) < Number(c.lt);
  if ('lte' in c) return Number(v) <= Number(c.lte);
  if ('gt' in c) return Number(v) > Number(c.gt);
  if ('gte' in c) return Number(v) >= Number(c.gte);
  return Boolean(v);
}

export async function runFallbackPlan(opts: {
  plan: FallbackPlan;
  payload: unknown;
  tools: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
  log: (line: string) => void;
}): Promise<{ steps: AgentStep[]; text: string }> {
  const ctx: Ctx = { payload: opts.payload };
  const steps: AgentStep[] = [];

  const call = async (step: PlanStep, localCtx: Ctx) => {
    if (!step.tool) return;
    if (!evaluate(step.when, localCtx)) return;
    const fn = opts.tools[step.tool];
    if (!fn) {
      steps.push({ type: 'text', text: `Tool ${step.tool} is not available` });
      return;
    }
    const args = (resolve(step.args || {}, localCtx) || {}) as Record<string, unknown>;
    let result: unknown;
    try {
      result = await fn(args);
    } catch (err) {
      result = { error: (err as Error).message };
    }
    opts.log(`fallback ${step.tool} → ${JSON.stringify(result).slice(0, 160)}`);
    steps.push({ type: 'tool_call', toolCalls: [{ name: step.tool, args, result }] });
    if (step.as) localCtx[step.as] = result;
    if (step.as && localCtx !== ctx) ctx[step.as] = result;
  };

  for (const step of opts.plan.steps || []) {
    if (step.forEach) {
      const list = getPath(ctx, step.forEach);
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const local: Ctx = { ...ctx, [step.as || 'item']: item };
        await call({ ...step, as: undefined }, local);
      }
      continue;
    }
    await call(step, ctx);
  }
  const text = opts.plan.summary ? String(resolve(opts.plan.summary, ctx)) : 'Plan completed';
  steps.push({ type: 'text', text });
  return { steps, text };
}
