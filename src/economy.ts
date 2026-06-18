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

interface AgentRec { label: string; principal: string; address: string; balanceUSD: number; }

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

  feed.emit('swarm_start', {
    capUSD: SWARM_CAP_USD, perAgentUSD: PER_AGENT_CAP, model: MODEL, mandate: `TASK-ECONOMY: ${GOAL}`,
    agents: agents.map((a) => ({ label: a.label, principal: a.principal, address: a.address, balanceUSD: a.balanceUSD })),
    plan: plan.map((t) => ({ id: t.id, produces: t.produces, consumes: t.consumes, priceUSD: t.priceUSD })),
  });

  // 3) Run all agents concurrently — the DAG orders them (no stagger needed).
  await Promise.allSettled(agents.map((a) => runAgent(a, board, guard, feed)));
  clearTimeout(timer);

  // 4) Observe.
  const u = guard.usageSummary;
  const snap = board.snapshot();
  const done = snap.filter((s) => s.status === 'completed').length;
  feed.emit('swarm_end', { moneyUSD: guard.spent, capUSD: SWARM_CAP_USD, tokens: u.tokens, halted: guard.halted_, tasksDone: done, tasksTotal: snap.length });
  console.log(`\n=== Task-economy done ===  tasks ${done}/${snap.length} completed · money $${guard.spent.toFixed(4)}/$${SWARM_CAP_USD} · ${u.tokens} Claude tokens${guard.halted_ ? ' · HALTED' : ''}`);
  console.log(`   board: ${snap.map((s) => `${s.id}:${s.status}${s.by ? '(' + s.by + ')' : ''}`).join('  ')}`);
  const deliverable = board.sink();
  if (deliverable?.output) console.log(`\n=== DELIVERABLE (${deliverable.id}) ===\n${deliverable.output.slice(0, 1200)}`);
  console.log(`\n📡 feed written: ${feed.file}`);
}

main().catch((e) => { console.error('ECONOMY FAILED', e); process.exit(1); });
