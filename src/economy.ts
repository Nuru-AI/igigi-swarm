/**
 * The task-economy runner (SWARM_TASK_ECONOMY_SPEC.md) — the real collaboration fix.
 *
 * A PLANNER decomposes the goal into a dependency DAG; N sovereign agents work the
 * shared TaskBoard: claim an open task → buy_input each thing it consumes (paying
 * the peer who produced it, on-chain) → produce the output → submit. An agent
 * CANNOT finish without buying its inputs, so the marketplace's missing demand-side
 * is now structural: Sippar's settlement IS the binding award. Money flows up the
 * DAG; every edge is a real A2A tx. Dependency gating replaces the stagger hack.
 *
 *   SWARM_PRINCIPALS=p1,p2,p3  npm run economy -- "the shared goal"
 */
import 'dotenv/config';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Budget, type BudgetEvent } from './budget.js';
import { Sippar } from './sippar.js';
import { SwarmGuard } from './swarm-guard.js';
import { buildToolServer } from './tools.js';
import { SwarmFeed } from './feed.js';
import { TaskBoard } from './taskboard.js';
import { decompose } from './planner.js';

process.env.MAX_MCP_OUTPUT_TOKENS ||= '200000';

// The deepseek-code engine runs model-written code via AsyncFunction IN-PROCESS. A floating
// (un-awaited) promise that rejects inside that code escapes execCode()'s Promise.race and,
// since Node 15, would crash the WHOLE process — killing every other agent mid-run. Install a
// global net so one bad block can't take down the swarm. execCode() scopes these per-exec
// (via the shared buffer below) so the retry loop still sees the error and the model can fix it.
const floatingRejections: { reason: string; at: number }[] = [];
process.on('unhandledRejection', (reason: any) => {
  const msg = String(reason?.stack ?? reason?.message ?? reason);
  floatingRejections.push({ reason: msg.slice(0, 300), at: Date.now() });
  console.log(`⚠️  unhandledRejection contained (model floating promise): ${msg.slice(0, 160)}`);
});
process.on('uncaughtException', (err: any) => {
  // Last-resort net for a sync throw from a model timer/callback. The process state is
  // technically undefined after this, but for this non-adversarial spike keeping the run
  // alive beats losing every agent to one buggy block.
  console.log(`⚠️  uncaughtException contained (run continues): ${String(err?.stack ?? err).slice(0, 160)}`);
});

const PRINCIPALS = (process.env.SWARM_PRINCIPALS || process.env.AGENT_PRINCIPAL || '').split(',').map((s) => s.trim()).filter(Boolean);
const SWARM_CAP_USD = Number(process.env.SWARM_CAP_USD || '2.00'); // swarm-wide safety ceiling (per-wave); actual spend is far lower
const PER_AGENT_CAP = Number(process.env.BUDGET_CAP_USD || '0.50'); // above the funded wallet, so the WALLET (real on-chain balance) binds — never an artificial cap that blocks A2A buy_input
const PER_TX_MAX = Number(process.env.PER_TX_MAX_USD || '0.10');   // covers pricier data services (e.g. coingecko $0.06)
const KILL_FILE = process.env.SWARM_KILL_FILE || './SWARM_KILL';
const MAX_TURNS = Number(process.env.SWARM_MAX_TURNS || '40');
const RUN_TIMEOUT_MS = Number(process.env.SWARM_TIMEOUT_MS || String(30 * 60 * 1000));
const TOKEN_CAP = Number(process.env.SWARM_TOKEN_CAP || '4000000');
const MODEL = process.env.SWARM_MODEL || 'claude-sonnet-4-6';
const ERROR_HALT_STREAK = Number(process.env.SWARM_ERROR_HALT_STREAK || '12');
const CLAIM_TTL_MS = Number(process.env.ECONOMY_CLAIM_TTL_MS || String(5 * 60 * 1000));
const GOAL = process.argv.slice(2).join(' ') ||
  'Produce a concise, well-sourced market brief on the current crypto + AI-compute landscape, grounded in real data.';
// AGENT_ENGINE=deepseek runs each agent's reasoning on a Sippar-paid x402/MPP LLM (no Claude); 'claude' = the SDK.
const AGENT_ENGINE = (process.env.AGENT_ENGINE || 'claude').toLowerCase();
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DS_MAX_TURNS = Number(process.env.DEEPSEEK_MAX_TURNS || '30');
// The reasoning BRAIN is decoupled from the on-chain economy. Default = DeepSeek via Sippar MPP
// (on-thesis: each thought settles on-chain). 'openrouter' = a stronger off-cap brain (e.g. Kimi
// K2-Thinking, purpose-built for multi-turn agentic tool-calling) — NOT x402-payable, but the
// Sippar thesis is the A2A WORK settlements (buy_input/buy_service), which stay on-chain regardless.
const INFER_PROVIDER = (process.env.INFERENCE_PROVIDER || (process.env.OPENROUTER_API_KEY ? 'openrouter' : process.env.LOCUS_API_KEY ? 'locus-anthropic' : 'sippar-deepseek')).toLowerCase();
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2-thinking';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
// 'locus-anthropic' = Claude via the Locus Wrapped API (Bearer key, billed per-call in USDC from
// the Locus Base wallet). No Claude weekly cap (API-billed), no ICP signature per thought (Locus
// debits its own wallet) — so the signer stays reserved for the A2A edges. Anthropic is Wrapped-only
// (not on MPP). Uses the Anthropic Messages format (system top-level, input_schema tools).
const LOCUS_API_KEY = process.env.LOCUS_API_KEY || '';
const LOCUS_ANTHROPIC_MODEL = process.env.LOCUS_ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const LOCUS_ANTHROPIC_URL = process.env.LOCUS_ANTHROPIC_URL || 'https://api.paywithlocus.com/api/wrapped/anthropic/messages';
const LOCUS_MAX_TOKENS = Number(process.env.LOCUS_MAX_TOKENS || '1024');
// On the on-chain path, which Sippar MPP service rail is the brain, and which model on it.
// Default deepseek-chat ($0.004). The 'groq' rail forwards stronger Groq-hosted tool-callers
// (openai/gpt-oss-120b, qwen/qwen3-32b, meta-llama/llama-4-scout, $0.008) — verified to return
// real OpenAI tool_calls — giving a much stronger agentic brain that STILL settles on-chain.
const INFERENCE_SERVICE = (process.env.INFERENCE_SERVICE || 'deepseek').toLowerCase();
const INFERENCE_MODEL = process.env.INFERENCE_MODEL || '';
// The Locus 'groq' proxy 502s on OpenAI tool-role message history for every NON-gpt-oss model
// (qwen3, llama-4, …) but accepts a flattened plain-text history (verified). Auto-flatten for
// those so non-OpenAI brains can run the multi-turn loop on-chain. Override with FLATTEN_TOOL_HISTORY=0/1.
const FLATTEN_TOOL_HISTORY = process.env.FLATTEN_TOOL_HISTORY != null
  ? process.env.FLATTEN_TOOL_HISTORY === '1'
  : ((INFERENCE_SERVICE === 'groq' && !/gpt-oss/i.test(INFERENCE_MODEL)) || INFER_PROVIDER === 'locus-anthropic');

// Short label for the dashboard/feed per-agent tag: the ACTUAL reasoning brain, not the loop
// scaffold. Without this the UI mislabels a Claude-brained run as "deepseek" (the engine name).
const BRAIN_TAG = AGENT_ENGINE === 'claude' ? 'claude-sdk'
  : INFER_PROVIDER === 'openrouter'
    ? (/claude/i.test(OPENROUTER_MODEL) ? 'claude' : (OPENROUTER_MODEL.split('/').pop() || OPENROUTER_MODEL).replace(/[:_-].*$/, ''))
  : INFER_PROVIDER === 'locus-anthropic' ? 'claude'
  : INFERENCE_SERVICE;

// Ablation toggle: NO_GROUNDING=1 strips paid external data (buy_service/discover_services) so agents
// must reason from their own knowledge — the memory-only arm of the grounded-vs-ungrounded A/B that
// isolates whether PAID GROUNDING (not money per se) is what reduces factual error.
const NO_GROUNDING = process.env.NO_GROUNDING === '1';

const HANDS = new Set([
  'mcp__hands__discover_services', 'mcp__hands__buy_service', 'mcp__hands__think', 'mcp__hands__check_budget',
  'mcp__economy__list_open_tasks', 'mcp__economy__wait_for_task', 'mcp__economy__claim_task', 'mcp__economy__buy_input', 'mcp__economy__submit_task',
]);
const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
  if (HANDS.has(toolName)) return { behavior: 'allow' as const, updatedInput: input };
  if (toolName === 'Read') {
    const p = String((input as { file_path?: unknown }).file_path ?? '').toLowerCase();
    if (p.includes('.env') || p.includes('credential') || p.includes('setuptoken') || p.includes('.git') || p.includes('swarm_kill'))
      return { behavior: 'deny' as const, message: 'Reading local secrets/control files is not allowed.' };
    return { behavior: 'allow' as const, updatedInput: input };
  }
  return { behavior: 'deny' as const, message: `"${toolName}" is disabled. Work the task board; buy data via buy_service/buy_input.` };
};

// The four board tools — claim / buy-input (settles on-chain) / submit.
function taskServer(board: TaskBoard, label: string, selfAddr: string, sippar: Sippar, feed: SwarmFeed) {
  return createSdkMcpServer({ name: 'economy', version: '0.1.0', tools: [
    tool('list_open_tasks', 'List the tasks AWARDED TO YOU that you can claim right now (every input they need has been produced). Shows produces, consumes, the price a consumer pays you, and which input keys to buy first. If empty, your upstream peers are still producing your inputs — wait and re-check.', {},
      async () => ({ content: [{ type: 'text', text: JSON.stringify(board.listOpen(label)) }] })),
    tool('wait_for_task', 'Block efficiently until one of YOUR awarded tasks becomes claimable (a peer has produced your input) or until timeout — use this INSTEAD of polling list_open_tasks in a loop, so you do not waste your turns. Returns your claimable tasks when ready.', { max_seconds: z.number().default(180) },
      async ({ max_seconds }) => {
        const deadline = Date.now() + Math.min(300, Math.max(10, max_seconds)) * 1000;
        let open = board.listOpen(label);
        while (open.length === 0 && Date.now() < deadline && board.remaining() > 0) {
          await new Promise((r) => setTimeout(r, 4000));
          open = board.listOpen(label);
        }
        return { content: [{ type: 'text', text: JSON.stringify({ ready: open.length > 0, tasks: open, boardRemaining: board.remaining() }) }] };
      }),
    tool('claim_task', 'Claim an open task (exclusive; auto-releases if you do not submit in time). Then buy_input everything it consumes, produce its output, and submit_task.', { id: z.string() },
      async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(board.claim(label, id)) }] })),
    tool('buy_input', 'Buy a completed input your task needs from the peer who produced it — pays them on-chain (real A2A settlement) and returns the content. You CANNOT submit a task until you have bought every input it consumes.', { produces_key: z.string() },
      async ({ produces_key }) => {
        const inp = board.inputFor(produces_key);
        if (!inp) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `no completed producer for "${produces_key}" yet — re-check list_open_tasks` }) }] };
        if (inp.producerAddr === selfAddr) { board.recordPurchase(label, produces_key); return { content: [{ type: 'text', text: JSON.stringify({ success: true, note: 'your own output (free)', content: inp.output }) }] }; }
        const pay = await sippar.payAgent(inp.producerAddr!, inp.priceUSD);
        if (!pay.success) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `payment failed: ${pay.error}` }) }] };
        board.recordPurchase(label, produces_key);
        feed.emit('market_buy', { agent: label, seller: inp.producerLabel, id: inp.id, amountUSD: pay.amountPaid, tx: pay.tx });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, paidTo: inp.producerLabel, amountUSD: pay.amountPaid, tx: pay.tx, content: inp.output }) }] };
      }),
    tool('submit_task', 'Submit your claimed task\'s output. Marks it completed, lets peers buy it (you earn), and unblocks downstream tasks. You must have bought every input it consumes first.', { id: z.string(), output: z.string() },
      async ({ id, output }) => {
        const r = board.submit(label, id, output, selfAddr);
        if (r.ok) feed.emit('market_post', { agent: label, id, summary: `produced ${id}`, priceUSD: 0 });
        return { content: [{ type: 'text', text: JSON.stringify(r) }] };
      }),
  ] });
}

const SYSTEM = (capUsd: number, goal: string) => `You are one sovereign agent in a TEAM building toward a shared goal, broken into a task DAG on a shared board. You have a real non-custodial on-chain wallet (~$${capUsd}); you never hold a key; payments settle automatically. There is NO free internet and no real-world actions beyond buying data (buy_service) and paying peers (buy_input).

THE GOAL: ${goal}

You are AWARDED specific tasks in the DAG (you cannot do other agents' tasks). Other agents own the rest. So you will often need an input that a PEER must produce first — you buy it from them.

HOW TO WORK (loop until you have no awarded task left):
1. list_open_tasks — your awarded tasks whose inputs are ready. If it is EMPTY, your input is still being produced by a peer — call wait_for_task (it blocks until your input is ready; do NOT poll in a loop and do NOT give up — your inputs WILL arrive). Never fabricate inputs.
2. claim_task(id) — take ONE.
3. ★ FIRST, for EACH key your task consumes: buy_input(key) — pays the peer who produced it (on-chain) and returns their content. Buy ALL your inputs BEFORE anything else — they are cheap and mandatory; you cannot submit without them. Never let other spending crowd them out.
4. Produce your task's output:
   - If your task CONSUMES inputs (it is an ANALYSIS / SYNTHESIS / intermediate task), the bought inputs ARE your data. ANALYZE and COMBINE them. Do NOT buy external services to re-gather data you already bought — that wastes your budget and time. Write the analysis yourself from the inputs.
   - Only a SOURCE task (consumes nothing) should buy external data via buy_service. Buy the minimum you need; one or two calls, not many.
   - (think/LLM services may be flaky — if so, just write the output yourself.)
5. ★ THE MOMENT you have your output text, IMMEDIATELY call submit_task(id, output). Do NOT look for other tasks first, do NOT keep researching — SUBMIT. An unsubmitted task blocks the whole team and you are not paid until you submit.
Only AFTER submitting, list_open_tasks for another awarded task; if none, call wait_for_task. If wait_for_task returns boardRemaining 0 (or your awarded work is done), you are FINISHED — stop. Earn by producing what peers need; keep your own messages short.`;

interface AgentRec { label: string; principal: string; address: string; balanceUSD: number; role?: string; }

async function runAgent(agent: AgentRec, board: TaskBoard, guard: SwarmGuard, feed: SwarmFeed): Promise<void> {
  const { label, principal } = agent;
  feed.emit('agent_start', { agent: label, principal, address: agent.address, balanceUSD: agent.balanceUSD });
  const onEvent = (e: BudgetEvent) => {
    if (e.type === 'spent') {
      console.log(`💸 [${label}] $${e.amount.toFixed(4)} ${e.service.padEnd(16)} → leftover $${e.remaining.toFixed(4)}${e.tx ? `  tx ${e.tx.slice(0, 12)}…` : ''}`);
      if (!e.service.startsWith('→')) feed.emit('buy', { agent: label, service: e.service, amountUSD: e.amount, tx: e.tx, chain: e.chain, recordId: e.recordId, remaining: e.remaining });
    } else { console.log(`🛑 [${label}] BLOCKED ${e.service} ${e.reason}`); feed.emit('blocked', { agent: label, service: e.service, amountUSD: e.amount, reason: e.reason }); }
  };
  const budget = new Budget(PER_AGENT_CAP, PER_TX_MAX, onEvent);
  const sippar = new Sippar(budget, { principal, guard });
  try {
    for await (const msg of query({
      prompt: 'Work the task board toward the shared goal: claim, buy your inputs from peers, produce, submit. Repeat while tasks remain.',
      options: {
        systemPrompt: SYSTEM(agent.balanceUSD, GOAL),
        mcpServers: { hands: buildToolServer(budget, sippar, undefined, true), economy: taskServer(board, label, agent.address, sippar, feed) },
        settingSources: [],
        allowedTools: [...HANDS, 'Read'],
        disallowedTools: ['WebSearch', 'WebFetch', 'Bash', 'BashOutput', 'KillShell', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep', 'Task', 'Agent', 'Skill', 'Workflow', 'SlashCommand', 'TodoWrite'],
        canUseTool, model: MODEL, permissionMode: 'default', maxTurns: MAX_TURNS,
      },
    })) {
      if (guard.halted_) break;
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) if (block.type === 'text' && block.text.trim()) { console.log(`\n🤖 [${label}] ${block.text.trim()}`); feed.emit('decision', { agent: label, text: block.text.trim() }); }
      } else if (msg.type === 'result') {
        const u = (msg as any).usage ?? {};
        const inTok = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        const outTok = u.output_tokens ?? 0;
        guard.recordUsage(inTok, outTok, (msg as any).total_cost_usd ?? 0);
        console.log(`🧮 [${label}] turns ${(msg as any).num_turns ?? '?'} · tokens ${inTok + outTok} · swarm ${guard.tokens}/${guard.tokenCap}`);
        feed.emit('usage', { agent: label, turns: (msg as any).num_turns ?? null, tokens: inTok + outTok, swarmTokens: guard.tokens, tokenCap: guard.tokenCap });
      }
    }
  } catch (e) {
    console.log(`⚠️  [${label}] ended: ${String((e as Error).message)}`);
  } finally {
    const endBal = (await sippar.walletInfo())?.balanceUSD ?? agent.balanceUSD;
    const spent = budget.summary().spent;
    const inflow = Math.max(0, endBal - agent.balanceUSD + spent);
    feed.emit('agent_end', { agent: label, balanceUSD: endBal, spentUSD: spent, earnedUSD: inflow });
    console.log(`🏁 [${label}] end $${endBal.toFixed(4)} · spent $${spent.toFixed(4)} · earned $${inflow.toFixed(4)}`);
  }
}

// ── OFF-CLAUDE ENGINE: same economy, but the agent's whole reasoning loop runs on
// a Sippar-paid x402/MPP LLM (DeepSeek). No Claude SDK, no Claude tokens. The tools
// are the SAME board/settlement primitives, exposed as OpenAI function schemas. ──
function extractMessage(resp: any): any {
  return resp?.choices?.[0]?.message ?? resp?.data?.choices?.[0]?.message ?? resp?.message ?? null;
}

// Single inference entry point for the off-Claude engines. Returns the SAME shape as sippar.pay
// ({success, response:<OpenAI-completion>, amountPaid}) so extractMessage works either way.
// - sippar-deepseek (default): DeepSeek via Sippar MPP — each call settles on-chain (on-thesis).
// - openrouter: a stronger brain (Kimi K2-Thinking et al.) over OpenAI-compatible OpenRouter —
//   off-cap, NOT on-chain; the on-chain A2A work settlements still flow through Sippar.
async function inferLLM(sippar: Sippar, payload: { model?: string; messages: any[]; tools?: any[]; tool_choice?: any }): Promise<{ success: boolean; response?: any; amountPaid?: number; error?: string }> {
  // The MPP rails are intermittently flaky (502/transient). Retry a few times before giving up,
  // so one bad settlement doesn't kill an agent mid-loop.
  let last: { success: boolean; response?: any; amountPaid?: number; error?: string } = { success: false, error: 'no attempt' };
  for (let i = 0; i < 5; i++) {
    last = await inferOnce(sippar, payload);
    if (last.success) return last;
    await new Promise((r) => setTimeout(r, 2000)); // ride out transient signer congestion (concurrent agents)
  }
  return last;
}

async function inferOnce(sippar: Sippar, payload: { model?: string; messages: any[]; tools?: any[]; tool_choice?: any }): Promise<{ success: boolean; response?: any; amountPaid?: number; error?: string }> {
  if (INFER_PROVIDER === 'locus-anthropic') {
    if (!LOCUS_API_KEY) return { success: false, error: 'INFERENCE_PROVIDER=locus-anthropic but LOCUS_API_KEY is not set' };
    // Translate our OpenAI-shaped payload -> Anthropic Messages format (FLATTEN keeps history as
    // plain alternating user/assistant text, so no tool-role/tool_use round-trip needed here).
    const all = payload.messages || [];
    const system = all.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n\n');
    const conv: any[] = [];
    for (const m of all) {
      if (m.role === 'system') continue;
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = typeof m.content === 'string' && m.content.trim() ? m.content : (m.content ? JSON.stringify(m.content) : '(continue)');
      const last = conv[conv.length - 1];
      if (last && last.role === role) last.content += '\n' + content; // coalesce -> strict alternation (Anthropic requires it)
      else conv.push({ role, content });
    }
    while (conv.length && conv[0].role !== 'user') conv.shift(); // Anthropic: first message must be 'user'
    const tools = (payload.tools || []).map((t: any) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters || { type: 'object', properties: {} } }));
    const tc = payload.tool_choice;
    const tool_choice = tc === 'required' ? { type: 'any' } : tc === 'none' ? { type: 'none' } : (tc && tc.type ? tc : { type: 'auto' });
    const body: any = { model: INFERENCE_MODEL || LOCUS_ANTHROPIC_MODEL, max_tokens: LOCUS_MAX_TOKENS, messages: conv };
    if (system) body.system = system;
    if (tools.length) { body.tools = tools; body.tool_choice = tool_choice; }
    try {
      const res = await fetch(LOCUS_ANTHROPIC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOCUS_API_KEY}` }, body: JSON.stringify(body) });
      const env: any = await res.json().catch(() => ({}));
      const data = env?.data ?? env; // Locus wraps { success, data: <anthropic-response> }
      if (!res.ok || data?.error || env?.error) return { success: false, error: (data?.error?.message ?? data?.error ?? env?.error?.message ?? env?.error ?? `Locus HTTP ${res.status}`) };
      const content = Array.isArray(data?.content) ? data.content : [];
      const text = content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const tool_calls = content.filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
      const message: any = { role: 'assistant', content: text };
      if (tool_calls.length) message.tool_calls = tool_calls;
      return { success: true, response: { choices: [{ message }] }, amountPaid: 0 }; // billed off the Locus wallet, not the agent's
    } catch (e) { return { success: false, error: String((e as Error).message) }; }
  }
  if (INFER_PROVIDER === 'openrouter') {
    if (!OPENROUTER_KEY) return { success: false, error: 'INFERENCE_PROVIDER=openrouter but OPENROUTER_API_KEY is not set' };
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_KEY}`, 'X-Title': 'sippar-swarm' },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: payload.messages,
          ...(payload.tools ? { tools: payload.tools } : {}),
          ...(payload.tool_choice ? { tool_choice: payload.tool_choice } : {}),
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.choices?.length) return { success: false, error: data?.error?.message || `OpenRouter HTTP ${res.status}` };
      return { success: true, response: data, amountPaid: 0 }; // brain is off-chain; A2A buys still settle on Sippar
    } catch (e) { return { success: false, error: String((e as Error).message) }; }
  }
  // On-chain path: pay the chosen LLM rail (deepseek | groq | mistral) per thought.
  const model = INFERENCE_MODEL || payload.model || DEEPSEEK_MODEL;
  return sippar.pay(INFERENCE_SERVICE, { ...payload, model });
}

async function runAgentDeepSeek(agent: AgentRec, board: TaskBoard, guard: SwarmGuard, feed: SwarmFeed): Promise<void> {
  const { label, principal } = agent;
  const selfAddr = agent.address;
  feed.emit('agent_start', { agent: label, principal, address: selfAddr, balanceUSD: agent.balanceUSD, role: agent.role, engine: BRAIN_TAG });
  const onEvent = (e: BudgetEvent) => {
    if (e.type === 'spent') {
      // The DeepSeek inference turns settle as service 'deepseek'; tool buys settle as their own service / '→addr'.
      if (e.service !== 'deepseek' && !e.service.startsWith('→')) feed.emit('buy', { agent: label, service: e.service, amountUSD: e.amount, tx: e.tx, chain: e.chain, recordId: e.recordId, remaining: e.remaining });
    } else { feed.emit('blocked', { agent: label, service: e.service, amountUSD: e.amount, reason: e.reason }); }
  };
  const budget = new Budget(PER_AGENT_CAP, PER_TX_MAX, onEvent);
  const sippar = new Sippar(budget, { principal, guard });
  // Cache successful buys so a model that re-calls buy_service/buy_input (gpt-oss loops on this)
  // gets the cached data + a hard nudge to submit, instead of re-paying — saves a signature AND
  // USDC each time. Keyed by svc:<id> / inp:<key>.
  const bought = new Map<string, any>();
  // Some models (gpt-oss) fixate on buy_service and never call submit_task on their own. When a
  // buy returns a cache hit (the agent already has that data), flip this flag; the loop then
  // FORCES tool_choice=submit_task next turn so the agent actually produces its output.
  let forceSubmit = false;

  const TOOLS = [
    { type: 'function', function: { name: 'list_open_tasks', description: 'List the tasks AWARDED TO YOU that are claimable now (inputs ready). Empty = a peer is still producing your input.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'wait_for_task', description: 'Block until one of your awarded tasks is claimable (a peer produced your input), or timeout. Use instead of polling.', parameters: { type: 'object', properties: { max_seconds: { type: 'number' } } } } },
    { type: 'function', function: { name: 'claim_task', description: 'Claim an awarded open task by id.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
    { type: 'function', function: { name: 'buy_input', description: 'Buy a completed input your task consumes from the peer who produced it (pays them on-chain) and returns the content. Required before submit.', parameters: { type: 'object', properties: { produces_key: { type: 'string' } }, required: ['produces_key'] } } },
    { type: 'function', function: { name: 'discover_services', description: 'List the REAL buyable data services with their exact ids and input shapes. Call this before buy_service if unsure of a service_id.', parameters: { type: 'object', properties: { category: { type: 'string' }, max_price: { type: 'number' } } } } },
    { type: 'function', function: { name: 'buy_service', description: 'Buy real external data (settles on-chain) for a SOURCE task. Use a REAL service_id from discover_services. For stock data use "alphavantage" payload {"symbol":"NVDA"} ($0.008, real-time quote). For web/news/sentiment use "brave" payload {"q":"query"} ($0.035, PREFERRED) or "heurist" payload {"q":"query"} ($0.002). AVOID "tavily" ($0.09 — exceeds the per-tx budget cap and will be rejected). Buy each source ONCE, then submit_task.', parameters: { type: 'object', properties: { service_id: { type: 'string' }, payload: { type: 'object' } }, required: ['service_id', 'payload'] } } },
    { type: 'function', function: { name: 'submit_task', description: 'Submit your task output text. Completes it, lets peers buy it, unblocks downstream. Must have bought every input first.', parameters: { type: 'object', properties: { id: { type: 'string' }, output: { type: 'string' } }, required: ['id', 'output'] } } },
  ].filter((t) => !NO_GROUNDING || !['buy_service', 'discover_services'].includes(t.function.name));
  const DISPATCH: Record<string, (a: any) => Promise<unknown>> = {
    list_open_tasks: async () => board.listOpen(label),
    wait_for_task: async ({ max_seconds }) => {
      const deadline = Date.now() + Math.min(240, Math.max(10, Number(max_seconds) || 120)) * 1000;
      let open = board.listOpen(label);
      while (open.length === 0 && Date.now() < deadline && board.remaining() > 0 && !guard.halted_) { await new Promise((r) => setTimeout(r, 4000)); open = board.listOpen(label); }
      return { ready: open.length > 0, tasks: open, boardRemaining: board.remaining() };
    },
    claim_task: async ({ id }) => { forceSubmit = false; return board.claim(label, id); },
    buy_input: async ({ produces_key }) => {
      if (!produces_key) return { error: 'produces_key required (a non-empty key). Never call with empty arguments.' };
      const ck = `inp:${produces_key}`;
      if (bought.has(ck)) { forceSubmit = true; return { success: true, alreadyBought: true, content: bought.get(ck), note: `Already bought "${produces_key}" — do NOT buy it again. Once you have ALL your inputs, synthesize and call submit_task.` }; }
      const inp = board.inputFor(produces_key);
      if (!inp) return { error: `no completed producer for "${produces_key}" yet — wait_for_task` };
      if (inp.producerAddr === selfAddr) { board.recordPurchase(label, produces_key); bought.set(ck, inp.output); return { success: true, note: 'your own output (free). Once you have all inputs, call submit_task.', content: inp.output }; }
      const pay = await sippar.payAgent(inp.producerAddr!, inp.priceUSD);
      if (!pay.success) return { success: false, error: `payment failed: ${pay.error}` };
      board.recordPurchase(label, produces_key);
      bought.set(ck, inp.output);
      feed.emit('market_buy', { agent: label, seller: inp.producerLabel, id: inp.id, produces: produces_key, contentPreview: String(inp.output ?? '').slice(0, 600), amountUSD: pay.amountPaid, tx: pay.tx });
      return { success: true, paidTo: inp.producerLabel, amountUSD: pay.amountPaid, tx: pay.tx, content: inp.output, yourBudgetRemaining: Number(budget.remaining.toFixed(4)), note: 'Bought (from your own budget, not the team ceiling). Once you have all inputs, synthesize and call submit_task.' };
    },
    discover_services: async ({ category, max_price }) => sippar.discover({ category, maxPrice: max_price }),
    buy_service: async ({ service_id, payload }) => {
      if (!service_id || !payload || !Object.keys(payload).length) return { error: 'service_id + non-empty payload required (a real id from discover_services). Never call with empty arguments.' };
      const ck = `svc:${service_id}:${JSON.stringify(payload)}`; // dedup by service+payload — allows alphavantage(NVDA) AND alphavantage(AMD); only EXACT repeats are blocked
      if (bought.has(ck)) { forceSubmit = true; return { success: true, alreadyBought: true, data: bought.get(ck), note: `You ALREADY bought "${service_id}" with these exact params — reuse that data. Buy a DIFFERENT service/param if you need more, else synthesize and call submit_task NOW.` }; }
      const r = await sippar.pay(service_id, payload);
      if (!r.success) return { success: false, paid: r.amountPaid, error: r.error };
      bought.set(ck, r.response);
      return { success: true, paid: r.amountPaid, tx: r.tx, data: r.response, teamCeilingRemaining: Number(guard.remaining.toFixed(4)), yourBudgetRemaining: Number(budget.remaining.toFixed(4)), note: 'You now have the data. Synthesize your output and call submit_task NEXT — do NOT buy this again. Watch teamCeilingRemaining — external buys stop when it hits 0.' };
    },
    submit_task: async ({ id, output }) => {
      forceSubmit = false;
      if (!output || String(output).length < 20) return { error: 'output must be your full result text (>=20 chars).' };
      const r = board.submit(label, id || board.listOpen(label)[0]?.id || '', output, selfAddr);
      if (r.ok) feed.emit('market_post', { agent: label, id, produces: board.snapshot().find((s) => s.id === id)?.produces, outputPreview: String(output ?? '').slice(0, 4000), summary: `produced ${id}`, priceUSD: 0 });
      return r;
    },
  };

  // Make the agent BUDGET-AWARE so it reasons within the envelope; the hard guard below is the
  // backstop, not the primary control. Prices are already exposed (discover_services + buy_service);
  // this adds the spend ENVELOPE the agent was previously blind to (shared ceiling, per-tx cap, remaining).
  const budgetBrief = `\n\nTEAM SPEND DISCIPLINE — the budget is a hard limit; plan within it, don't discover it by getting blocked:\n`
    + `- EXTERNAL DATA (buy_service) draws a SHARED team ceiling of $${guard.totalCapUsd.toFixed(2)} — about $${guard.remaining.toFixed(4)} remains right now. It is shared with ALL teammates; when it runs out, every external buy is hard-blocked. Buy the CHEAPEST source that answers your task, exactly once.\n`
    + `- PEER PAYMENTS (buy_input) come from YOUR OWN budget, NOT the shared ceiling — always buy your required inputs first; never skip them to save money.\n`
    + `- Your working budget: ~$${budget.remaining.toFixed(4)} of $${PER_AGENT_CAP.toFixed(2)}. Any single purchase over $${PER_TX_MAX.toFixed(2)} is rejected outright.\n`
    + `- Prices are listed by discover_services and in buy_service — read them and choose deliberately. Each buy result tells you the budget left; stay inside it. The hard cap is a safety floor, not your spending plan.`;
  // Ungrounded arm: no external data tools exist. Tell the agent to answer from its own knowledge and
  // label figures as unverified estimates — a fair memory-only condition (no pretending to have live data).
  const ungroundedNote = `\n\nDATA AVAILABILITY: external data services are OFFLINE this run — you have NO buy_service or discover_services tools. For any SOURCE task (one that consumes no peer inputs), produce your best answer FROM YOUR OWN KNOWLEDGE. Give concrete figures where useful, but explicitly mark each as an unverified estimate (prefix "est."). Do NOT claim live, real-time, or "as of today" data you did not actually receive. Peer payments (buy_input) still work as normal.`;
  const messages: any[] = [
    { role: 'system', content: (agent.role ? `YOUR SPECIALIST ROLE: ${agent.role}. You are this specialist on the team — bring that lens, rigor, and standards to your awarded task.\n\n` : '') + SYSTEM(agent.balanceUSD, GOAL) + (NO_GROUNDING ? ungroundedNote : budgetBrief) + `\n\nYOU REASON VIA TOOL CALLS. Call ONE tool at a time. NEVER call a tool with empty arguments — always include the required fields. When you submit_task, the output MUST be finished plain prose with the ACTUAL numbers and values copied from the data you bought — NEVER leave template placeholders like \${...}, {price}, or "X.XX". After you submit_task successfully, find your next awarded task (or wait_for_task); if boardRemaining is 0 or you have no awarded task, reply with the word DONE and stop.` },
    { role: 'user', content: 'Work the board toward the shared goal now: claim, buy your inputs from peers, produce, submit.' },
  ];
  let infCalls = 0, infSpend = 0, noTool = 0, infFails = 0;
  try {
    for (let turn = 1; turn <= DS_MAX_TURNS && !guard.halted_; turn++) {
      // 'required' forces a tool call every turn (weak models otherwise narrate); when forceSubmit
      // is set (agent already has its data but won't submit), pin tool_choice to submit_task.
      const toolChoice = forceSubmit ? { type: 'function', function: { name: 'submit_task' } } : (noTool > 0 ? 'required' : 'auto');
      const r = await inferLLM(sippar, { model: DEEPSEEK_MODEL, messages, tools: TOOLS, tool_choice: toolChoice });
      if (!r.success) {
        // Don't let one provider blip (rate-limit "Upstream API call failed") permanently kill the
        // agent and strand its task. Back off (escalating) and retry the turn; the agent keeps its
        // claim and finishes once the rate-limit window passes. Give up only after repeated failures.
        if (++infFails >= 4) { console.log(`✖ [${label}] inference failed ${infFails}x (${r.error}) — giving up`); break; }
        const wait = 8000 * infFails;
        console.log(`⚠️  [${label}] inference failed (${infFails}/4): ${r.error} — backing off ${wait / 1000}s`);
        await new Promise((res) => setTimeout(res, wait));
        turn--; // a failed turn shouldn't consume the agent's working budget
        continue;
      }
      infFails = 0;
      infCalls++; infSpend += r.amountPaid ?? 0;
      const m = extractMessage(r.response);
      if (!m) { console.log(`✖ [${label}] no message`); break; }
      if (m.content && String(m.content).trim()) { console.log(`🤖 [${label}] ${String(m.content).trim().slice(0, 160)}`); feed.emit('decision', { agent: label, text: String(m.content).trim() }); }
      if (m.tool_calls?.length) {
        noTool = 0;
        // Record the assistant turn. For non-gpt-oss groq models the rail 502s on OpenAI tool-role
        // history, so FLATTEN: paraphrase the call(s) as assistant text + fold results into a user
        // message. gpt-oss / deepseek use native tool messages.
        if (FLATTEN_TOOL_HISTORY) {
          const calls = m.tool_calls.map((c: any) => `${c.function.name}(${String(c.function.arguments || '{}').slice(0, 200)})`).join(', ');
          messages.push({ role: 'assistant', content: (String(m.content || '').trim() ? String(m.content).trim() + ' ' : '') + `Calling ${calls}.` });
        } else {
          messages.push({ role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls });
        }
        const resultLines: string[] = [];
        for (const call of m.tool_calls) {
          let args: any = {}; try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* */ }
          const fn = DISPATCH[call.function.name];
          const result = fn ? await fn(args) : { error: `unknown tool ${call.function.name}` };
          const s = JSON.stringify(result);
          console.log(`🔧 [${label}] ${call.function.name}(${JSON.stringify(args).slice(0, 60)}) → ${s.slice(0, 90)}`);
          if (FLATTEN_TOOL_HISTORY) resultLines.push(`Result of ${call.function.name}: ${s.slice(0, 4000)}`);
          else messages.push({ role: 'tool', tool_call_id: call.id, content: s.slice(0, 6000) });
        }
        if (FLATTEN_TOOL_HISTORY) messages.push({ role: 'user', content: resultLines.join('\n') + '\nContinue: call the next tool, or reply with the single word DONE if all your work is finished.' });
        if (board.allDone()) break;
        continue;
      }
      messages.push({ role: 'assistant', content: m.content ?? '' });
      // No tool call this turn. Stop only if genuinely finished (exact "DONE", or whole board done, or no work left) —
      // NOT just because the word "done" appears in narration. Else the model narrated instead of acting — force it.
      const txt = String(m.content ?? '').trim().toUpperCase();
      if (board.allDone() || txt.replace(/[^A-Z]/g, '') === 'DONE' || (board.listOpen(label).length === 0 && board.remaining() === 0)) break;
      if (++noTool >= 4) { console.log(`✖ [${label}] stuck (narrating, not acting) — stopping`); break; }
      messages.push({ role: 'user', content: 'You did NOT call any tool. Narration does nothing — only tool calls make progress. Call a tool NOW (list_open_tasks, wait_for_task, claim_task, buy_input, or submit_task). Do not describe what you will do; just call the tool.' });
    }
  } catch (e) {
    console.log(`⚠️  [${label}] ended: ${String((e as Error).message)}`);
  } finally {
    const endBal = (await sippar.walletInfo())?.balanceUSD ?? agent.balanceUSD;
    const spent = budget.summary().spent;
    feed.emit('usage', { agent: label, turns: infCalls, engine: BRAIN_TAG, inferenceUSD: infSpend });
    feed.emit('agent_end', { agent: label, balanceUSD: endBal, spentUSD: spent });
    console.log(`🏁 [${label}] end $${endBal.toFixed(4)} · spent $${spent.toFixed(4)} · ${infCalls} DeepSeek calls ($${infSpend.toFixed(4)}, 0 Claude tokens)`);
  }
}

// ── OFF-CLAUDE ENGINE v2: CodeAgent (per Gemini research / smolagents). The model
// is a STRONG CODER but weak at the multi-turn JSON tool_call protocol — so instead
// of JSON tool-calls, it writes ONE JS code block that orchestrates the supply-chain
// functions (claim/buy_input/buy_service/submit), executed in a restricted vm sandbox
// (no require/process/fetch — only the bound functions). Plays to DeepSeek's strength.
const CODE_SYSTEM = (goal: string) => `You are an autonomous agent on a team building toward a shared goal. You complete ONE specific assigned task per message by WRITING ONE JavaScript async code block that calls these pre-bound async functions (already in scope — DO NOT define or import them; ALWAYS await them):
- claim_task(id) -> {ok}                          // claim YOUR assigned task by its exact id
- buy_input(key) -> {success, content}            // buy a peer's finished output (pays them on-chain). Use for EACH key your task consumes.
- buy_service(id, payload) -> {success, data}     // buy real external data for a SOURCE task. ids: "alphavantage" {symbol:"NVDA"}, "brave" {q:"..."}, "tavily" {query:"..."}, "heurist" {q:"..."}
- submit_task(id, outputText) -> {ok}             // finish your task; outputText is your REAL result, >= 40 chars
- log(message)                                    // print progress

THE TEAM GOAL: ${goal}

You will be given ONE concrete task (its exact id, what it produces, and what it consumes). Write ONE \`\`\`js code block that completes THAT task: claim it, buy what it needs, build the real output from what you bought, and submit it.

HARD RULES — code that breaks these fails and gets discarded:
1. Use the EXACT task id given to you (a string like "t2"). NEVER invent ids, point values, or fake "task completed" messages. There is no points system — only the functions above do anything; log() just prints.
2. Use ONLY the pre-bound functions. NO require, import, process, fetch, setTimeout, or other globals. Do NOT redefine the functions or simulate them.
3. Declare every variable with const/let before using it (in THIS block — nothing persists between blocks). await EVERY function call; never leave a floating promise.
4. Build the real \`output\` from what buy_input/buy_service returned. NEVER invent data (no fake numbers, factorials, demos). Prefer a short readable summary of the key facts over a raw JSON dump, but keep the code SIMPLE. >= 40 chars.
5. Wrap everything in one try/catch and \`await log(...)\` the error. Output ONLY the code block — no prose before or after.`;

// Pick a concrete, real buy_service call for a SOURCE task from its title — so the harness
// (not the weak model) decides the service id + payload, eliminating the recurring
// "alphavantage is not defined" bare-identifier bug.
function sourceServiceCall(task: { title: string; produces: string }): string {
  const hay = `${task.title} ${task.produces}`.toLowerCase();
  if (/stock|quote|price|ticker|equity|share|nasdaq|nyse|nvda|nvidia|aapl|tsla|msft/.test(hay)) {
    const m = task.title.match(/\b([A-Z]{2,5})\b/);
    return `await buy_service("alphavantage", { symbol: "${m ? m[1] : 'NVDA'}" })`;
  }
  const q = task.title.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
  return `await buy_service("brave", { q: "${q || task.produces}" })`;
}

// The concrete, grounded task handed to the model each attempt — removes the "imagine a task"
// hallucination, but lets the model author the block itself (it rebels against "copy exactly").
// The exec scope binds the task ids and service ids as strings, so bare identifiers still work.
function codeTaskPrompt(task: { id: string; title: string; produces: string; consumes: string[]; priceUSD: number }): string {
  const isSource = task.consumes.length === 0;
  const buyBlock = isSource
    ? `  // SOURCE task — buy ONE real dataset, then build the output from it. Pick the service for "${task.title}":
  const d = ${sourceServiceCall(task)};   // <- a concrete, ready-to-run call; adjust the query/symbol if you like
  const parts = [ d && d.success ? JSON.stringify(d.data) : "" ].filter(Boolean);`
    : `  const parts = [];
  for (const key of ${JSON.stringify(task.consumes)}) { const r = await buy_input(key); if (r && r.success) parts.push(r.content); }   // buy EVERY input`;
  return `YOUR ASSIGNED TASK (already claimable — every input is ready):
  id: "${task.id}"
  title: ${task.title}
  produces: ${task.produces}
  consumes: ${JSON.stringify(task.consumes)}   ${isSource ? '(SOURCE — no peer inputs; buy real external data)' : '(buy EACH key from your peers with buy_input)'}

Write ONE \`\`\`js block that does exactly this, in order. Use the EXACT id "${task.id}" (quoted) and quoted service names:
\`\`\`js
try {
  await claim_task("${task.id}");
${buyBlock}
  const output = /* a concise, REAL "${task.produces}" built ONLY from parts above (a short readable summary of the key facts, keep it simple), >= 40 chars — never invent data */ "";
  await submit_task("${task.id}", output);
  await log("submitted ${task.id}");
} catch (e) {
  await log("ERROR: " + (e && e.message ? e.message : e));
}
\`\`\`
Output ONLY the code block. Fill in \`output\` from \`parts\` (the real purchased data). Do not add require/import/fetch or any other functions.`;
}

function extractCodeBlock(resp: any): string | null {
  const text = String(extractMessage(resp)?.content ?? '');
  const fence = text.match(/```(?:js|javascript|typescript|ts)?\s*\n?([\s\S]*?)```/i);
  let code = fence ? fence[1] : (/await |claim_task|submit_task/.test(text) ? text : null);
  if (code == null) return null;
  // The model sometimes omits the fence and emits a bare "js" language-hint line — running that
  // as code throws "js is not defined". Strip a stray leading language hint.
  code = code.replace(/^\s*(?:js|javascript|ts|typescript)\s*\r?\n/i, '');
  return code.trim();
}

// Execute the model's code in the HOST realm via AsyncFunction so `await` on our
// bound async functions works natively (vm can't await cross-realm host promises).
// NOTE: in-process, not security-sandboxed — fine for this non-adversarial spike;
// a production version runs untrusted code in isolated-vm / a subprocess / E2B.
async function execCode(code: string, api: Record<string, any>, timeoutMs: number, vars: Record<string, any> = {}): Promise<{ ok: boolean; error?: string; logs: string[] }> {
  const logs: string[] = [];
  const boundLog = (m: any) => { logs.push(String(m).slice(0, 200)); api.log(m); };
  // Bind the functions PLUS the task-id and service-id STRINGS as in-scope variables, so the
  // weak model's most common bug — bare identifiers like buy_service(alphavantage,…) or
  // claim_task(t1) — resolves to the right string instead of throwing ReferenceError.
  const names = ['list_open_tasks', 'claim_task', 'wait_for_task', 'buy_input', 'buy_service', 'submit_task', 'log', ...Object.keys(vars)];
  const fns = [api.list_open_tasks, api.claim_task, api.wait_for_task, api.buy_input, api.buy_service, api.submit_task, boundLog, ...Object.values(vars)];
  const AsyncFunction = Object.getPrototypeOf(async function () { /* */ }).constructor as any;
  const startIdx = floatingRejections.length;
  let timer: NodeJS.Timeout | undefined;
  try {
    const fn = new AsyncFunction(...names, `"use strict";\n${code}`); // SyntaxError throws here, caught below
    await Promise.race([
      fn(...fns),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('exec wall-clock timeout')), timeoutMs); }),
    ]);
    // Let any un-awaited rejections from this block surface as unhandledRejection before we read them.
    await new Promise((r) => setTimeout(r, 50));
    const floats = floatingRejections.slice(startIdx).map((f) => f.reason);
    if (floats.length) logs.push(`floating(un-awaited) rejection: ${floats.join(' ; ').slice(0, 300)}`);
    return { ok: floats.length === 0, error: floats[0], logs };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e), logs };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runAgentDeepSeekCode(agent: AgentRec, board: TaskBoard, guard: SwarmGuard, feed: SwarmFeed): Promise<void> {
  const { label, principal } = agent;
  const selfAddr = agent.address;
  feed.emit('agent_start', { agent: label, principal, address: selfAddr, balanceUSD: agent.balanceUSD, engine: BRAIN_TAG });
  const onEvent = (e: BudgetEvent) => {
    if (e.type === 'spent') { if (e.service !== 'deepseek' && !e.service.startsWith('→')) feed.emit('buy', { agent: label, service: e.service, amountUSD: e.amount, tx: e.tx, chain: e.chain, recordId: e.recordId, remaining: e.remaining }); }
    else feed.emit('blocked', { agent: label, service: e.service, amountUSD: e.amount, reason: e.reason });
  };
  const budget = new Budget(PER_AGENT_CAP, PER_TX_MAX, onEvent);
  const sippar = new Sippar(budget, { principal, guard });
  let mySubmitted = false;
  const submittedIds = new Set<string>();
  // Anti-invention guard for SOURCE tasks: board.submit only enforces buy_input for CONSUMED
  // keys, so a source task (consumes:[]) could submit fabricated data. Require ≥1 real
  // buy_service before a source submit. Reset per task by the outer loop.
  let servicesBoughtThisTask = 0;
  let currentConsumes: string[] = [];
  const api = {
    list_open_tasks: async () => board.listOpen(label),
    claim_task: async (id: string) => board.claim(label, id),
    wait_for_task: async (maxSeconds: number) => {
      const deadline = Date.now() + Math.min(240, Math.max(5, Number(maxSeconds) || 90)) * 1000;
      let open = board.listOpen(label);
      while (open.length === 0 && Date.now() < deadline && board.remaining() > 0 && !guard.halted_) { await new Promise((r) => setTimeout(r, 4000)); open = board.listOpen(label); }
      return { ready: open.length > 0, tasks: open, boardRemaining: board.remaining() };
    },
    buy_input: async (key: string) => {
      const inp = board.inputFor(key);
      if (!inp) return { success: false, error: `no completed producer for "${key}" yet` };
      if (inp.producerAddr === selfAddr) { board.recordPurchase(label, key); return { success: true, content: inp.output }; }
      const pay = await sippar.payAgent(inp.producerAddr!, inp.priceUSD);
      if (!pay.success) return { success: false, error: pay.error };
      board.recordPurchase(label, key);
      feed.emit('market_buy', { agent: label, seller: inp.producerLabel, id: inp.id, amountUSD: pay.amountPaid, tx: pay.tx });
      return { success: true, content: inp.output };
    },
    buy_service: async (service_id: string, payload: any) => {
      const r = await sippar.pay(service_id, payload ?? {});
      if (r.success) servicesBoughtThisTask++;
      return { success: r.success, data: r.success ? r.response : undefined, error: r.error };
    },
    submit_task: async (id: string, outputText: string) => {
      // Source tasks must be backed by real bought data — block fabricated submissions.
      if (currentConsumes.length === 0 && servicesBoughtThisTask === 0)
        return { ok: false, error: 'SOURCE task: call buy_service to fetch REAL data BEFORE submit_task — do not invent data.' };
      const r = board.submit(label, id, String(outputText ?? ''), selfAddr);
      if (r.ok) { mySubmitted = true; submittedIds.add(id); feed.emit('market_post', { agent: label, id, summary: `produced ${id}`, priceUSD: 0 }); }
      return r;
    },
    log: (m: any) => { const s = String(m).slice(0, 200); console.log(`📝 [${label}] ${s}`); feed.emit('decision', { agent: label, text: s }); },
  };

  let infCalls = 0, infSpend = 0;
  // Identifiers we bind into the exec scope as their own string value, so the model's bare-
  // identifier slips (buy_service(alphavantage,…), claim_task(t1)) resolve instead of throwing.
  const idVars: Record<string, any> = {};
  for (const s of board.snapshot()) idVars[s.id] = s.id;
  for (const svc of ['alphavantage', 'brave', 'tavily', 'heurist', 'mistral', 'deepseek', 'coingecko']) idVars[svc] = svc;
  // Common bare tickers/symbols the model tends to drop unquoted into payloads, e.g. {symbol: NVDA}.
  for (const sym of ['NVDA', 'NVIDIA', 'BTC', 'ETH', 'AAPL', 'TSLA', 'MSFT', 'AI', 'SOL']) idVars[sym] = sym;
  try {
    // Outer loop: work each task awarded to me, in dependency order. The HARNESS (not model
    // code) deterministically waits until one of my tasks is claimable, then hands the model
    // that ONE concrete task — so the weak model can't invent ids or stall on the wait protocol.
    while (!guard.halted_ && !board.allDone()) {
      let mine = board.listOpen(label).filter((t: any) => !submittedIds.has(t.id));
      if (mine.length === 0) {
        const deadline = Date.now() + 240000;
        while (mine.length === 0 && Date.now() < deadline && board.remaining() > 0 && !guard.halted_) {
          await new Promise((r) => setTimeout(r, 4000));
          mine = board.listOpen(label).filter((t: any) => !submittedIds.has(t.id));
        }
      }
      if (mine.length === 0) { console.log(`✔ [${label}] no more claimable tasks for me`); break; }
      const task = mine[0];
      servicesBoughtThisTask = 0; currentConsumes = task.consumes;
      console.log(`🎯 [${label}] solving ${task.id} (${task.consumes.length === 0 ? 'source' : `consumes ${task.consumes.join(',')}`}) — ${task.title}`);
      const messages: any[] = [{ role: 'system', content: CODE_SYSTEM(GOAL) }, { role: 'user', content: codeTaskPrompt(task) }];
      // Inner retry-with-error loop (CodeAgent self-repair) for THIS task.
      for (let attempt = 1; attempt <= 5 && !submittedIds.has(task.id) && !guard.halted_; attempt++) {
        const r = await inferLLM(sippar, { model: DEEPSEEK_MODEL, messages });
        if (!r.success) { console.log(`✖ [${label}] inference failed: ${r.error}`); break; }
        infCalls++; infSpend += r.amountPaid ?? 0;
        const code = extractCodeBlock(r.response);
        if (!code) { messages.push({ role: 'user', content: 'Output ONLY a ```js code block, nothing else.' }); continue; }
        console.log(`🧩 [${label}] ${task.id} attempt ${attempt}: exec ${code.length}-char block`);
        const res = await execCode(code, api, 300000, { ...idVars, t: task });
        const ok = submittedIds.has(task.id);
        console.log(`   [${label}] ${task.id} → submitted=${ok} ${res.ok ? 'ok' : 'err: ' + res.error}`);
        if (ok) break;
        messages.push({ role: 'assistant', content: '```js\n' + code + '\n```' });
        messages.push({ role: 'user', content: `Task "${task.id}" is STILL NOT submitted. Execution ${res.ok ? 'ran without throwing' : 'threw: ' + res.error}. logs: ${res.logs.join(' | ').slice(0, 600)}. Write a corrected \`\`\`js block that claims "${task.id}", buys its inputs, and ENDS with await submit_task("${task.id}", output). Use the exact id "${task.id}".` });
      }
      if (!submittedIds.has(task.id)) { console.log(`✖ [${label}] gave up on ${task.id} after retries`); break; }
    }
  } catch (e) { console.log(`⚠️  [${label}] ended: ${String((e as Error).message)}`); }
  finally {
    const endBal = (await sippar.walletInfo())?.balanceUSD ?? agent.balanceUSD;
    const spent = budget.summary().spent;
    feed.emit('usage', { agent: label, turns: infCalls, engine: BRAIN_TAG, inferenceUSD: infSpend });
    feed.emit('agent_end', { agent: label, balanceUSD: endBal, spentUSD: spent });
    console.log(`🏁 [${label}] end $${endBal.toFixed(4)} · spent $${spent.toFixed(4)} · submitted=${mySubmitted} · ${infCalls} code-gen calls ($${infSpend.toFixed(4)}, 0 Claude tokens)`);
  }
}

async function main() {
  console.log(`\n=== Swarm Task-Economy — agents pay each other up a dependency DAG ===`);
  if (PRINCIPALS.length === 0) { console.error('Set SWARM_PRINCIPALS=p1,p2,... (funded sovereign wallets) in .env.'); process.exit(1); }

  const guard = new SwarmGuard(SWARM_CAP_USD, KILL_FILE, (m) => console.log(m), TOKEN_CAP, ERROR_HALT_STREAK);
  const feed = new SwarmFeed();
  console.log(`📡 feed: ${feed.file}  ·  live view: npm run dashboard`);
  process.on('SIGINT', () => { console.log('\n🛑 SIGINT — halting'); guard.halt(); });
  const timer = setTimeout(() => { console.log('\n⏱️  wall-clock cap — halting'); guard.halt(); }, RUN_TIMEOUT_MS);

  // 1) Resolve wallets.
  const agents: AgentRec[] = [];
  for (let i = 0; i < PRINCIPALS.length; i++) {
    const principal = PRINCIPALS[i];
    const w = await new Sippar(new Budget(PER_AGENT_CAP, PER_TX_MAX), { principal, guard }).walletInfo();
    agents.push({ label: `A${i + 1}`, principal, address: w?.address ?? '', balanceUSD: w?.balanceUSD ?? 0 });
    console.log(`🤖 [A${i + 1}] ${principal.slice(0, 14)}… ${w?.address ?? '(?)'} $${(w?.balanceUSD ?? 0).toFixed(4)}`);
  }

  // 2) Plan: decompose the goal into a dependency DAG.
  console.log(`\n🧩 planning: decomposing the goal into ~${agents.length} interdependent subtasks…`);
  const plan = await decompose(GOAL, agents.length, MODEL);
  const board = new TaskBoard(plan, CLAIM_TTL_MS);
  // AWARD each task to a distinct agent (round-robin) — the Contract-Net "award" /
  // orchestrator delegation. This is what forces the value chain: the sink agent
  // must BUY its inputs from the DIFFERENT agents who own the upstream tasks,
  // instead of one fast agent doing the whole DAG for free.
  plan.forEach((t, i) => board.assign(t.id, agents[i % agents.length].label));
  console.log(`   DAG (${plan.length} tasks):`);
  for (const t of plan) console.log(`     ${t.id} → ${agents[plan.indexOf(t) % agents.length].label}  produces ${t.produces}  <= [${t.consumes.join(', ')}]  $${t.priceUSD}  — ${t.title}`);
  const sinkId = board.sink()?.id;
  console.log(`   deliverable (sink): ${sinkId ?? '(none)'}\n`);

  // Specialist ROLE per agent (CI-pattern): the planner's role for its primary awarded task,
  // else a DAG-layer fallback (source→Research Analyst, intermediate→Synthesis Analyst,
  // sink→Lead Strategist). Turns 8 homogeneous agents into a visible market of named specialists.
  agents.forEach((a, ai) => {
    const myTask = plan.find((_, i) => i % agents.length === ai);
    if (myTask) a.role = myTask.role || (myTask.id === sinkId ? 'Lead Strategist' : myTask.consumes.length === 0 ? 'Research Analyst' : 'Synthesis Analyst');
  });
  console.log(`   roles: ${agents.map((a) => `${a.label}=${a.role ?? '?'}`).join('  ')}\n`);

  feed.emit('swarm_start', {
    capUSD: SWARM_CAP_USD, perAgentUSD: PER_AGENT_CAP, model: MODEL, mandate: `TASK-ECONOMY: ${GOAL}`,
    agents: agents.map((a, ai) => ({ label: a.label, principal: a.principal, address: a.address, balanceUSD: a.balanceUSD, role: a.role, assignedTasks: plan.filter((_, i) => i % agents.length === ai).map((t) => t.id) })),
    plan: plan.map((t) => ({ id: t.id, title: t.title, role: t.role, produces: t.produces, consumes: t.consumes, priceUSD: t.priceUSD })),
  });

  // 3) Run all agents concurrently — the DAG orders them (no stagger needed).
  const run = AGENT_ENGINE === 'deepseek-code' ? runAgentDeepSeekCode : AGENT_ENGINE === 'deepseek' ? runAgentDeepSeek : runAgent;
  const brain = AGENT_ENGINE === 'claude' ? `Claude SDK (${MODEL})`
    : INFER_PROVIDER === 'locus-anthropic' ? `Claude via Locus Wrapped API (${INFERENCE_MODEL || LOCUS_ANTHROPIC_MODEL}) — off-cap (USDC-billed), A2A on-chain`
    : INFER_PROVIDER === 'openrouter' ? `OpenRouter brain (${OPENROUTER_MODEL}) — off-cap, A2A still on-chain`
    : `Sippar MPP rail '${INFERENCE_SERVICE}' (${INFERENCE_MODEL || DEEPSEEK_MODEL}) — each thought on-chain`;
  console.log(`engine: ${AGENT_ENGINE === 'deepseek-code' ? 'CodeAgent code-gen' : AGENT_ENGINE === 'deepseek' ? 'JSON tool-calls' : 'Claude SDK'} · brain: ${brain}${AGENT_ENGINE !== 'claude' && INFER_PROVIDER !== 'openrouter' ? ` · history=${FLATTEN_TOOL_HISTORY ? 'flattened' : 'native-tool-role'}` : ''} · 0 Claude tokens${AGENT_ENGINE === 'claude' ? '' : ' (agents)'}\n`);
  // Concurrency control. The inference provider rate-limits at a fixed ceiling (Locus-beta
  // Claude ≈ 5 concurrent); 8-wide bursts get "Upstream API call failed" for everyone. So cap
  // the number of agents in their active inference loop: MAX_CONCURRENT_AGENTS workers pull
  // agents from a shared counter IN INDEX ORDER (DAG-early/source tasks first), the rest queue.
  // Peak Claude-call rate stays under the limit while a large fleet still completes. 0 = no cap
  // (old behaviour). SWARM_STAGGER_MS smooths each worker's start.
  const STAGGER_MS = Number(process.env.SWARM_STAGGER_MS || '0');
  const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_AGENTS || '0');
  if (MAX_CONCURRENT > 0 && MAX_CONCURRENT < agents.length) {
    console.log(`   concurrency cap: max ${MAX_CONCURRENT} agents active at once (pool over ${agents.length})\n`);
    let next = 0;
    const worker = async (slot: number): Promise<void> => {
      if (STAGGER_MS) await new Promise((r) => setTimeout(r, slot * STAGGER_MS)); // smooth the initial burst
      while (!guard.halted_) {
        const i = next++;
        if (i >= agents.length) break;
        await run(agents[i], board, guard, feed);
      }
    };
    await Promise.allSettled(Array.from({ length: MAX_CONCURRENT }, (_, slot) => worker(slot)));
  } else {
    await Promise.allSettled(agents.map((a, i) =>
      (STAGGER_MS ? new Promise((r) => setTimeout(r, i * STAGGER_MS)) : Promise.resolve()).then(() => run(a, board, guard, feed))));
  }
  clearTimeout(timer);

  // 4) Observe.
  const u = guard.usageSummary;
  const snap = board.snapshot();
  const done = snap.filter((s) => s.status === 'completed').length;
  const deliverable = board.sink();
  feed.emit('swarm_end', { moneyUSD: guard.spent, capUSD: SWARM_CAP_USD, tokens: u.tokens, halted: guard.halted_, tasksDone: done, tasksTotal: snap.length, deliverable: deliverable ? { id: deliverable.id, produces: deliverable.produces, output: String(deliverable.output ?? '').slice(0, 8000) } : null });
  console.log(`\n=== Task-economy done ===  tasks ${done}/${snap.length} completed · money $${guard.spent.toFixed(4)}/$${SWARM_CAP_USD} · ${u.tokens} Claude tokens${guard.halted_ ? ' · HALTED' : ''}`);
  console.log(`   board: ${snap.map((s) => `${s.id}:${s.status}${s.by ? '(' + s.by + ')' : ''}`).join('  ')}`);
  if (deliverable?.output) console.log(`\n=== DELIVERABLE (${deliverable.id}) ===\n${deliverable.output.slice(0, 1200)}`);
  console.log(`\n📡 feed written: ${feed.file}`);
}

main().catch((e) => { console.error('ECONOMY FAILED', e); process.exit(1); });
