// GET /api/agents/status — how the app's agents run on this install, for the
// badge on the Agents tab: { ai: true } when the tenant has a model in its
// catalog (Informer runs the agents), { ai: false } when it has none and the
// session and "Run now" routes run the protocol in-process (lib/triage.js).
export const config = { roles: ['clinician', 'admin'] };

import { aiConfigured } from '../../lib/ai.js';

export async function GET({ fetch }) {
  return { ai: await aiConfigured(fetch) };
}
