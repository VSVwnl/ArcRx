// Local mirror of Informer's AI endpoints (POST /api/models/:id/_object,
// _completion, _chat) using the Anthropic SDK when ANTHROPIC_API_KEY is set.
// Without a key every call reports "unavailable" so routes fall back to rules.
import Anthropic from '@anthropic-ai/sdk';

export type InformerMessage = { role: string; parts: Array<{ type: string; text?: string }> };

export interface LocalTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentStep {
  type: 'text' | 'tool_call';
  text?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
}

const MODEL = process.env.ARCRX_LLM_MODEL || 'claude-opus-5-5';

export function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic {
  return new Anthropic();
}

function flatten(messages: InformerMessage[]): string {
  return messages
    .map((m) => `${m.role}: ${m.parts.map((p) => p.text || '').join('\n')}`)
    .join('\n\n');
}

/** POST /api/models/:id/_object — returns a JSON object matching `schema`. */
export async function objectCompletion(schema: Record<string, unknown>, messages: InformerMessage[]): Promise<unknown> {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: 'Respond with a single JSON object that validates against the provided JSON schema. No prose, no code fences.',
    messages: [{ role: 'user', content: `${flatten(messages)}\n\nJSON schema:\n${JSON.stringify(schema)}` }],
  });
  const text = res.content.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Model did not return a JSON object');
  return JSON.parse(match[0]);
}

/** POST /api/models/:id/_completion — plain text for a prompt. */
export async function textCompletion(prompt: string): Promise<string> {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });
  return res.content.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('');
}

/**
 * Agent loop: the model drives the tools until it stops calling them. Mirrors
 * what Informer's agent runtime does with `_chat` + maxSteps.
 */
export async function runAgentLoop(opts: {
  instructions: string;
  tools: LocalTool[];
  event: string;
  payload: unknown;
  log: (line: string) => void;
}): Promise<{ steps: AgentStep[]; tokens: number; text: string }> {
  const anthropic = client();
  const tools: Anthropic.Tool[] = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: 'object', ...(t.inputSchema as object) } as Anthropic.Tool.InputSchema,
  }));
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: JSON.stringify({ event: opts.event, payload: opts.payload, timestamp: new Date().toISOString() }) },
  ];
  const steps: AgentStep[] = [];
  let tokens = 0;
  let finalText = '';
  for (let i = 0; i < 12; i++) {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: opts.instructions,
      tools,
      messages,
    });
    tokens += res.usage.input_tokens + res.usage.output_tokens;
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).join('');
    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason === 'refusal') {
      steps.push({ type: 'text', text: 'The model declined this request.' });
      break;
    }
    if (toolUses.length === 0) {
      if (text) steps.push({ type: 'text', text });
      finalText = text;
      break;
    }
    messages.push({ role: 'assistant', content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    const calls: NonNullable<AgentStep['toolCalls']> = [];
    for (const tu of toolUses) {
      const tool = opts.tools.find((t) => t.name === tu.name);
      let result: unknown;
      try {
        result = tool ? await tool.handler(tu.input as Record<string, unknown>) : { error: `Unknown tool ${tu.name}` };
      } catch (err) {
        result = { error: (err as Error).message };
      }
      opts.log(`tool ${tu.name} → ${JSON.stringify(result).slice(0, 160)}`);
      calls.push({ name: tu.name, args: tu.input as Record<string, unknown>, result });
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
    }
    if (text) steps.push({ type: 'text', text });
    steps.push({ type: 'tool_call', toolCalls: calls });
    messages.push({ role: 'user', content: results });
  }
  return { steps, tokens, text: finalText };
}
