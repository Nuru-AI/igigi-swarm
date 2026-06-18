/**
 * The planner — one structured LLM call that decomposes a GOAL into a dependency
 * DAG of subtasks (SWARM_TASK_ECONOMY_SPEC.md §2). This is what creates the
 * demand-side: each task consumes specific upstream outputs, so an agent MUST buy
 * a peer's output to complete its own task. Validated + retried once on a bad DAG.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { type Task, validatePlan } from './taskboard.js';

const PLANNER_SYS = `You decompose a GOAL into a DAG of small subtasks for a team of autonomous agents who pay each other on-chain for the outputs they consume.

OUTPUT: ONLY valid JSON, no prose, no markdown fences:
{"tasks":[{"id":"t1","title":"...","produces":"snake_case_key","consumes":[],"priceUSD":0.01}, ...]}

HARD RULES:
- Each task PRODUCES exactly one unique output key (snake_case). No two tasks share a produces key.
- CONSUMES lists other tasks' produces keys (the inputs it needs), or [] for a source task.
- The graph MUST be acyclic and CONNECTED: make real dependencies — downstream tasks consume upstream outputs. Tasks must be genuinely DIFFERENT so no agent can do another's work.
- Exactly ONE final "sink" task = the deliverable, whose produces key NOTHING else consumes; it should consume the main intermediate outputs (it synthesizes them).
- At least one source task with consumes:[].
- priceUSD between 0.005 and 0.03.
- Produce about N tasks (given below). Favor a layered shape: a few sources → some middle tasks that combine them → one sink.`;

function extractJson(s: string): string | null {
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return a >= 0 && b > a ? s.slice(a, b + 1) : null;
}

export async function decompose(goal: string, n: number, model: string): Promise<Task[]> {
  let lastErr = 'no output';
  for (let attempt = 0; attempt < 2; attempt++) {
    let text = '';
    for await (const msg of query({
      prompt: `GOAL: ${goal}\n\nDecompose into about ${n} subtasks as a dependency DAG. JSON only.`,
      options: { systemPrompt: PLANNER_SYS, model, settingSources: [], allowedTools: [], maxTurns: 1, permissionMode: 'default' },
    })) {
      if (msg.type === 'assistant') for (const b of (msg as any).message.content) if (b.type === 'text') text += b.text;
    }
    const json = extractJson(text);
    if (!json) { lastErr = 'no JSON in planner output'; continue; }
    let parsed: any;
    try { parsed = JSON.parse(json); } catch (e) { lastErr = `JSON parse: ${(e as Error).message}`; continue; }
    const tasks: Task[] = (parsed.tasks ?? []).map((t: any, i: number) => ({
      id: String(t.id ?? `t${i + 1}`),
      title: String(t.title ?? `task ${i + 1}`),
      produces: String(t.produces ?? `out${i + 1}`),
      consumes: Array.isArray(t.consumes) ? t.consumes.map(String) : [],
      priceUSD: Math.min(0.03, Math.max(0.005, Number(t.priceUSD ?? 0.01))),
    }));
    const v = validatePlan(tasks);
    if (v.ok) return tasks;
    lastErr = v.error ?? 'invalid';
    console.log(`  planner attempt ${attempt + 1} invalid: ${lastErr} — retrying`);
  }
  throw new Error(`planner failed to produce a valid DAG: ${lastErr}`);
}
