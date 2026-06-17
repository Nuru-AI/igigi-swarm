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
const MANDATE = process.argv.slice(2).join(' ') ||
  'You have a small budget and real hands (paid services across chains). Be useful with it — produce something of value. Spend economically and stop when your wallet is low.';

// Tool confinement — identical to the single-agent harness. The ONLY way to reach
// the outside world is buying from the allowlist; no web/shell/file/posting tools.
const HANDS = new Set([
  'mcp__hands__discover_services',
  'mcp__hands__buy_service',
  'mcp__hands__check_budget',
  'mcp__hands__pay_agent',
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

interface AgentRec { label: string; principal: string; address: string; balanceUSD: number; }

async function runAgent(agent: AgentRec, allAgents: AgentRec[], guard: SwarmGuard): Promise<void> {
  const { label, principal } = agent;
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
      prompt: MANDATE,
      options: {
        systemPrompt: SYSTEM(agent.balanceUSD) + (Object.keys(roster).length ? `\n\nOther agents you can pay (pay_agent): ${Object.keys(roster).join(', ')}.` : ''),
        mcpServers: { hands: buildToolServer(budget, sippar, roster) },
        settingSources: [],
        allowedTools: [...HANDS, 'Read'],
        disallowedTools: ['WebSearch', 'WebFetch', 'Bash', 'BashOutput', 'KillShell', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep', 'Task', 'Agent', 'Skill', 'Workflow', 'SlashCommand', 'TodoWrite'],
        canUseTool,
        permissionMode: 'default',
        maxTurns: MAX_TURNS,
      },
    })) {
      if (guard.halted_) break; // kill switch tripped elsewhere
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) console.log(`\n🤖 [${label}] ${block.text.trim()}`);
        }
      }
    }
  } catch (e) {
    console.log(`⚠️  [${label}] ended: ${String((e as Error).message)}`);
  }
}

async function main() {
  console.log(`\n=== Truth Terminal Swarm — let the agents fly (caged) ===`);
  if (PRINCIPALS.length === 0) {
    console.error('No agents. Set SWARM_PRINCIPALS=p1,p2,p3 (funded sovereign wallets) in .env.');
    process.exit(1);
  }
  console.log(`Agents: ${PRINCIPALS.length}  ·  swarm ceiling: $${SWARM_CAP_USD}  ·  per-agent: $${PER_AGENT_CAP}  ·  kill-file: ${KILL_FILE}`);
  console.log(`Mandate: ${MANDATE}\n`);

  const guard = new SwarmGuard(SWARM_CAP_USD, KILL_FILE, (m) => console.log(m));

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
    agents.push({ label, principal, address: w?.address ?? '', balanceUSD: w?.balanceUSD ?? 0 });
    console.log(`🤖 [${label}] ${principal.slice(0, 14)}… wallet ${w?.address ?? '(?)'} balance $${(w?.balanceUSD ?? 0).toFixed(4)}`);
  }
  console.log();

  await Promise.allSettled(agents.map((a) => runAgent(a, agents, guard)));
  clearTimeout(timer);

  console.log(`\n=== Swarm done ===  total spent $${guard.spent.toFixed(4)} / $${SWARM_CAP_USD}${guard.halted_ ? '  (HALTED)' : ''}`);
}

main().catch((e) => { console.error('SWARM FAILED', e); process.exit(1); });
