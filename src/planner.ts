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
{"tasks":[{"id":"t1","title":"...","role":"...","produces":"snake_case_key","consumes":[],"priceUSD":0.01}, ...]}

HARD RULES:
- Each task gets a "role": a concise (2-4 word) specialist JOB TITLE for the agent who'd do it, fitting the GOAL's domain (e.g. "Equity Data Analyst", "Crypto Market Researcher", "Semiconductor Supply-Chain Analyst", "Chief Investment Strategist"). The single SINK task's role is the senior synthesizer (e.g. "Chief Strategist", "Lead Editor"). Roles must be DISTINCT across tasks — each agent is a different specialist.
- Each task PRODUCES exactly one unique output key (snake_case). No two tasks share a produces key.
- CONSUMES lists other tasks' produces keys (the inputs it needs), or [] for a source task.
- The graph MUST be acyclic and CONNECTED: make real dependencies — downstream tasks consume upstream outputs. Tasks must be genuinely DIFFERENT so no agent can do another's work.
- Exactly ONE final "sink" task = the deliverable, whose produces key NOTHING else consumes; it should consume the main intermediate outputs (it synthesizes them).
- At least one source task with consumes:[].
- priceUSD between 0.005 and 0.03.
- Produce about N tasks (given below).
- ★ DEPTH IS REQUIRED. Build a LAYERED DAG, not a flat fan-in. For N≥6 you MUST have at least 3 layers and at least 2 INTERMEDIATE tasks — a task that BOTH consumes another task's output AND is itself consumed by a later task. Shape: sources (consumes:[]) → intermediate tasks that combine/refine source outputs → more intermediates or the sink. Avoid "many sources all feeding one sink" — that has no depth.`;

function extractJson(s: string): string | null {
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return a >= 0 && b > a ? s.slice(a, b + 1) : null;
}

export async function decompose(goal: string, n: number, model: string): Promise<Task[]> {
  let lastErr = 'no output';
  for (let attempt = 0; attempt < 3; attempt++) {
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
      role: t.role ? String(t.role) : undefined, // CI-pattern specialist title; falls back by DAG layer in economy.ts
      produces: String(t.produces ?? `out${i + 1}`),
      consumes: Array.isArray(t.consumes) ? t.consumes.map(String) : [],
      priceUSD: Math.min(0.03, Math.max(0.005, Number(t.priceUSD ?? 0.01))),
    }));
    const v = validatePlan(tasks);
    if (v.ok) {
      // Depth gate: a real scale test needs intermediates (tasks that both consume and are consumed).
      if (n >= 6) {
        const consumed = new Set(tasks.flatMap((t) => t.consumes));
        const intermediates = tasks.filter((t) => t.consumes.length > 0 && consumed.has(t.produces)).length;
        if (intermediates < 2) { lastErr = `too shallow: only ${intermediates} intermediate task(s) — need ≥2 layers of depth`; console.log(`  planner attempt ${attempt + 1} ${lastErr} — retrying`); continue; }
      }
      return tasks;
    }
    lastErr = v.error ?? 'invalid';
    console.log(`  planner attempt ${attempt + 1} invalid: ${lastErr} — retrying`);
  }
  throw new Error(`planner failed to produce a valid DAG: ${lastErr}`);
}
