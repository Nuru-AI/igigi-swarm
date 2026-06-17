/**
 * The swarm runner — S1 of TRUTH_TERMINAL_SWARM_EXPERIMENT.md, built INSIDE the cage.
 *
 * Spins up N sovereign agents (each its own ICP principal → own threshold wallet →
 * own budget) and runs them concurrently, all under a single SwarmGuard:
 *   - global kill switch (create the kill-file, or Ctrl-C → halt all agents)
 *   - swarm-wide total spend ceiling (the entire at-risk amount, small + known)
 * Per-agent caps (on-chain balance, signer 100/3600, per-tx) still apply below this.
 * Every agent is tool-confined (discover/buy/check + read-only) — no web, shell,
 * file-write, or posting tools. They cannot take real-world actions beyond buying
 * from the allowlisted catalog. (S5 guardrails; S6 = let them fly.)
 *
 * Reasoning runs on the Claude subscription (CLAUDE_CODE_OAUTH_TOKEN). Money is the
 * only thing spent.
 *
 *   SWARM_PRINCIPALS=p1,p2,p3  SWARM_CAP_USD=0.30  npm run swarm -- "your open mandate"
 */
import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Budget, type BudgetEvent } from './budget.js';
import { Sippar } from './sippar.js';
import { SwarmGuard } from './swarm-guard.js';
import { buildToolServer } from './tools.js';
import { Marketplace } from './marketplace.js';
import { AgentStore } from './agent-store.js';

// Keep large MCP results inline (no temp-file spill).
process.env.MAX_MCP_OUTPUT_TOKENS ||= '200000';

const PRINCIPALS = (process.env.SWARM_PRINCIPALS || process.env.AGENT_PRINCIPAL || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const SWARM_CAP_USD = Number(process.env.SWARM_CAP_USD || '0.30');     // total at-risk ceiling
const PER_AGENT_CAP = Number(process.env.BUDGET_CAP_USD || '0.10');
const PER_TX_MAX = Number(process.env.PER_TX_MAX_USD || '0.04');
const KILL_FILE = process.env.SWARM_KILL_FILE || './SWARM_KILL';        // create this to halt
const MAX_TURNS = Number(process.env.SWARM_MAX_TURNS || '30');
const RUN_TIMEOUT_MS = Number(process.env.SWARM_TIMEOUT_MS || String(15 * 60 * 1000)); // wall-clock cap
const TOKEN_CAP = Number(process.env.SWARM_TOKEN_CAP || '2000000'); // compute ceiling: halt if total Claude tokens exceed this
const MODEL = process.env.SWARM_MODEL || 'claude-sonnet-4-6'; // pinned for predictability + lighter subscription rate-limit use than Opus
const STAGGER_MS = Number(process.env.SWARM_STAGGER_MS || '90000'); // delay each agent after the first, so sellers post before buyers shop (a continuous swarm has this naturally)
const MANDATE = process.argv.slice(2).join(' ') ||
  'You have a small budget and real hands (paid services across chains). Be useful with it — produce something of value. Spend economically and stop when your wallet is low.';
// Per-agent role mandates ("||"-separated), parallel to SWARM_PRINCIPALS. When set,
// agent i gets ROLES[i] instead of the shared MANDATE — lets agents have
// complementary, dependent tasks (e.g. a producer of a unique deliverable + a
// consumer that must buy it), which creates real demand in the findings-market.
const ROLES = (process.env.SWARM_ROLES || '').split('||').map((s) => s.trim()).filter(Boolean);

// Tool confinement — identical to the single-agent harness. The ONLY way to reach
// the outside world is buying from the allowlist; no web/shell/file/posting tools.
const HANDS = new Set([
  'mcp__hands__discover_services',
  'mcp__hands__buy_service',
  'mcp__hands__check_budget',
  'mcp__hands__pay_agent',
  'mcp__hands__post_finding',
  'mcp__hands__list_findings',
  'mcp__hands__buy_finding',
  'mcp__hands__remember',
]);
const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
  if (HANDS.has(toolName)) return { behavior: 'allow' as const, updatedInput: input };
  if (toolName === 'Read') {
    const p = String((input as { file_path?: unknown }).file_path ?? '').toLowerCase();
    if (p.includes('.env') || p.includes('credential') || p.includes('setuptoken') || p.includes('.git') || p.includes('swarm_kill')) {
      return { behavior: 'deny' as const, message: 'Reading local secrets/control files is not allowed.' };
    }
    return { behavior: 'allow' as const, updatedInput: input };
  }
  return {
    behavior: 'deny' as const,
    message: `"${toolName}" is disabled. No free internet, no real-world actions — the only way to get external data is to BUY it via buy_service.`,
  };
};

const SYSTEM = (capUsd: number) => `You are one sovereign agent in a swarm. You have a real on-chain wallet you control (non-custodial, ICP threshold-signed) seeded with ~$${capUsd} in stablecoins, and tools to discover and BUY real paid services across chains. Spend your OWN money to pursue the mandate well; be economical and stop when your wallet runs low. You never hold a private key; payments settle on-chain automatically. There is NO free internet and you cannot post, message humans, or take any action other than buying from the catalog. Your true spendable balance is reported after every purchase (walletBalanceUSD) — it is the hard limit.`;

interface AgentRec { label: string; principal: string; address: string; balanceUSD: number; mandate: string; }

async function runAgent(agent: AgentRec, allAgents: AgentRec[], guard: SwarmGuard, market: Marketplace, store: AgentStore, startDelayMs = 0): Promise<void> {
  const { label, principal } = agent;
  const state = store.load(principal); // durable memory across runs (S2)
  if (startDelayMs > 0) {
    console.log(`⏳ [${label}] starts in ${Math.round(startDelayMs / 1000)}s (letting sellers post to the market first)`);
    await new Promise((r) => setTimeout(r, startDelayMs));
    if (guard.halted_) return;
  }
  const onEvent = (e: BudgetEvent) => {
    if (e.type === 'spent') console.log(`💸 [${label}] $${e.amount.toFixed(4)} ${e.service.padEnd(16)} → wallet leftover $${e.remaining.toFixed(4)}${e.tx ? `  tx ${e.tx.slice(0, 12)}…` : ''}`);
    else console.log(`🛑 [${label}] BLOCKED ${e.service.padEnd(16)} ${e.reason}`);
  };
  const budget = new Budget(PER_AGENT_CAP, PER_TX_MAX, onEvent);
  const sippar = new Sippar(budget, { principal, guard });
  // This agent's view of the swarm: the OTHER agents it can pay, by label.
  const roster = Object.fromEntries(
    allAgents.filter((x) => x.label !== label && x.address).map((x) => [x.label, x.address]),
  );

  try {
    for await (const msg of query({
      prompt: agent.mandate,
      options: {
        systemPrompt:
          SYSTEM(agent.balanceUSD) +
          `\n\n[YOUR DURABLE MEMORY]\n${AgentStore.memoryBrief(state)}\nBefore you finish, call remember(...) to save what you did / learned / earned and your next goal, so your future self can continue.` +
          (Object.keys(roster).length ? `\n\nYou are in a swarm with other agents: ${Object.keys(roster).join(', ')}. There is a shared findings-market. ALWAYS run list_findings FIRST before buying any service — buying another agent's existing finding is usually cheaper than paying for your own search, and may be the only grounded option if your wallet is small. If the market is empty but you cannot afford your own search, do NOT fabricate — call check_budget / list_findings again after a moment; other agents may post a finding you can buy shortly. You can SELL your own research with post_finding (others pay you on-chain and receive the content) to recoup cost. You can also pay_agent directly. Trade when it makes economic sense.` : ''),
        mcpServers: { hands: buildToolServer(budget, sippar, Object.keys(roster).length ? { selfLabel: label, selfAddr: agent.address, roster, marketplace: market, remember: (note: string) => store.remember(state, note) } : undefined) },
        settingSources: [],
        allowedTools: [...HANDS, 'Read'],
        disallowedTools: ['WebSearch', 'WebFetch', 'Bash', 'BashOutput', 'KillShell', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep', 'Task', 'Agent', 'Skill', 'Workflow', 'SlashCommand', 'TodoWrite'],
        canUseTool,
        model: MODEL,
        permissionMode: 'default',
        maxTurns: MAX_TURNS,
      },
    })) {
      if (guard.halted_) break; // kill switch / token ceiling tripped elsewhere
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) console.log(`\n🤖 [${label}] ${block.text.trim()}`);
        }
      } else if (msg.type === 'result') {
        const u = (msg as any).usage ?? {};
        const inTok = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        const outTok = u.output_tokens ?? 0;
        guard.recordUsage(inTok, outTok, (msg as any).total_cost_usd ?? 0);
        console.log(`🧮 [${label}] turns ${(msg as any).num_turns ?? '?'} · tokens ${inTok + outTok} · swarm total ${guard.tokens}/${guard.tokenCap}`);
      }
    }
  } catch (e) {
    console.log(`⚠️  [${label}] ended: ${String((e as Error).message)}`);
  } finally {
    // Persist this run into durable memory so the agent resumes its thread next time.
    const endBal = (await sippar.walletInfo())?.balanceUSD ?? agent.balanceUSD;
    const spent = budget.summary().spent;
    const inflow = Math.max(0, endBal - agent.balanceUSD + spent); // payments received (e.g. sold findings)
    state.runs += 1;
    state.cumulativeSpentUSD += spent;
    state.cumulativeEarnedUSD += inflow;
    state.label = label;
    store.remember(state, `Run ${state.runs}: wallet $${agent.balanceUSD.toFixed(4)} → $${endBal.toFixed(4)}; external spend $${spent.toFixed(4)}; received $${inflow.toFixed(4)}.`);
    console.log(`💾 [${label}] memory saved (run ${state.runs}, ${state.journal.length} notes, cum earned $${state.cumulativeEarnedUSD.toFixed(4)})`);
  }
}

async function main() {
  console.log(`\n=== Truth Terminal Swarm — let the agents fly (caged) ===`);
  if (PRINCIPALS.length === 0) {
    console.error('No agents. Set SWARM_PRINCIPALS=p1,p2,p3 (funded sovereign wallets) in .env.');
    process.exit(1);
  }
  console.log(`Agents: ${PRINCIPALS.length}  ·  model: ${MODEL}  ·  swarm ceiling: $${SWARM_CAP_USD}  ·  per-agent: $${PER_AGENT_CAP}  ·  kill-file: ${KILL_FILE}`);
  console.log(`Mandate: ${MANDATE}\n`);

  const guard = new SwarmGuard(SWARM_CAP_USD, KILL_FILE, (m) => console.log(m), TOKEN_CAP);

  // Kill switch on Ctrl-C, and a hard wall-clock cap.
  process.on('SIGINT', () => { console.log('\n🛑 SIGINT — halting swarm'); guard.halt(); });
  const timer = setTimeout(() => { console.log('\n⏱️  run timeout — halting swarm'); guard.halt(); }, RUN_TIMEOUT_MS);

  // Resolve every agent's sovereign wallet first, so they can find each other.
  const agents: AgentRec[] = [];
  for (let i = 0; i < PRINCIPALS.length; i++) {
    const principal = PRINCIPALS[i];
    const label = `A${i + 1}`;
    const probe = new Sippar(new Budget(PER_AGENT_CAP, PER_TX_MAX), { principal, guard });
    const w = await probe.walletInfo();
    const mandate = ROLES[i] || MANDATE;
    agents.push({ label, principal, address: w?.address ?? '', balanceUSD: w?.balanceUSD ?? 0, mandate });
    console.log(`🤖 [${label}] ${principal.slice(0, 14)}… wallet ${w?.address ?? '(?)'} balance $${(w?.balanceUSD ?? 0).toFixed(4)}${ROLES[i] ? `  role: ${ROLES[i].slice(0, 60)}…` : ''}`);
  }
  console.log();

  const market = new Marketplace(); // shared findings-market (in-process; payments are real on-chain)
  const store = new AgentStore();   // durable per-agent memory across runs (S2)
  // Stagger: agent i waits i×STAGGER, so earlier agents can post findings before later ones shop.
  await Promise.allSettled(agents.map((a, i) => runAgent(a, agents, guard, market, store, i * STAGGER_MS)));
  clearTimeout(timer);

  const u = guard.usageSummary;
  console.log(`\n=== Swarm done === money $${guard.spent.toFixed(4)}/$${SWARM_CAP_USD} · Claude ${u.tokens} tokens (notional $${u.notionalCostUsd.toFixed(4)}, free on subscription) / cap ${TOKEN_CAP}${guard.halted_ ? ' · HALTED' : ''}`);
}

main().catch((e) => { console.error('SWARM FAILED', e); process.exit(1); });
