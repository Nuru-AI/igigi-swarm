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
import { SwarmFeed } from './feed.js';

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

// --- Overnight / continuous mode (unattended) ---
// Set SWARM_CONTINUOUS=1 to run repeated rounds until a stop condition, instead of
// a single run. The night's WATCHDOG = the spend ceiling (SWARM_CAP_USD) + token cap
// + the wall-clock NIGHT cap + the error-streak auto-halt + all-agents-broke + kill-file.
const CONTINUOUS = process.env.SWARM_CONTINUOUS === '1';
const NIGHT_MS = Number(process.env.SWARM_NIGHT_MS || String(8 * 60 * 60 * 1000)); // outer wall-clock cap (default 8h)
const ROUND_INTERVAL_MS = Number(process.env.SWARM_ROUND_INTERVAL_MS || String(5 * 60 * 1000)); // pause between rounds
const MAX_ROUNDS = Number(process.env.SWARM_MAX_ROUNDS || '500');
const MIN_SPENDABLE_USD = Number(process.env.SWARM_MIN_SPENDABLE_USD || '0.0015'); // below this an agent can't buy the cheapest service → "broke"
const ERROR_HALT_STREAK = Number(process.env.SWARM_ERROR_HALT_STREAK || '12'); // consecutive failed payments → auto-halt
const OFFLOAD = process.env.SWARM_OFFLOAD !== '0'; // compute-offload: give agents the `think` tool + tell them to delegate heavy work (set 0 for the A/B baseline)
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
  'mcp__hands__think',
  'mcp__hands__check_budget',
  'mcp__hands__pay_agent',
  'mcp__hands__post_finding',
  'mcp__hands__list_findings',
  'mcp__hands__buy_finding',
  'mcp__hands__remember',
  'mcp__hands__relay_pay',
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

const SYSTEM = (capUsd: number, offload: boolean) => `You are one sovereign agent in a swarm. You have a real on-chain wallet you control (non-custodial, ICP threshold-signed) seeded with ~$${capUsd} in stablecoins, and tools to discover and BUY real paid services across chains. You never hold a private key; payments settle on-chain automatically. There is NO free internet and you cannot post, message humans, or take any action other than buying from the catalog. Your true spendable balance is reported after every purchase (walletBalanceUSD) — it is the hard limit.${offload ? `

CRITICAL — YOU ARE A DECISION-MAKER, NOT A WORKER. Your OWN reasoning runs on a scarce, hard-capped compute budget; that is your real bottleneck, NOT money (money is abundant relative to your tiny spend). So OFFLOAD the thinking:
- For ANY substantial work — synthesis, drafting, analysis, writing a product, summarizing a large result — call the **think** tool, which buys cheap LLM inference and returns the result. Do NOT generate long content in your own messages.
- Keep YOUR own output SHORT: decide what to do, delegate the work via think/buy_service, evaluate the result, decide the next move. A few sentences per turn, not essays.
- Money buys back compute: a $0.004 think call is far cheaper than burning your own scarce reasoning. Spend money to save thinking.
Be economical with BOTH, but protect your own context above all — it is what runs out first.` : `

Pursue the mandate well: discover services, buy what you need, and produce a good result. Be economical; stop when your wallet runs low.`}`;

interface AgentRec { label: string; principal: string; address: string; balanceUSD: number; mandate: string; }

async function runAgent(agent: AgentRec, allAgents: AgentRec[], guard: SwarmGuard, market: Marketplace, store: AgentStore, feed: SwarmFeed, startDelayMs = 0): Promise<void> {
  const { label, principal } = agent;
  const state = store.load(principal); // durable memory across runs (S2)
  if (startDelayMs > 0) {
    console.log(`⏳ [${label}] starts in ${Math.round(startDelayMs / 1000)}s (letting sellers post to the market first)`);
    await new Promise((r) => setTimeout(r, startDelayMs));
    if (guard.halted_) return;
  }
  feed.emit('agent_start', { agent: label, principal, address: agent.address, balanceUSD: agent.balanceUSD, role: agent.mandate });
  const onEvent = (e: BudgetEvent) => {
    if (e.type === 'spent') {
      console.log(`💸 [${label}] $${e.amount.toFixed(4)} ${e.service.padEnd(16)} → wallet leftover $${e.remaining.toFixed(4)}${e.tx ? `  tx ${e.tx.slice(0, 12)}…` : ''}`);
      // A peer transfer (service label "→0x…") is reported separately by tools.emit; here only external buys.
      if (!e.service.startsWith('→')) feed.emit('buy', { agent: label, service: e.service, amountUSD: e.amount, tx: e.tx, chain: e.chain, recordId: e.recordId, remaining: e.remaining });
    } else {
      console.log(`🛑 [${label}] BLOCKED ${e.service.padEnd(16)} ${e.reason}`);
      feed.emit('blocked', { agent: label, service: e.service, amountUSD: e.amount, reason: e.reason });
    }
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
          SYSTEM(agent.balanceUSD, OFFLOAD) +
          `\n\n[YOUR DURABLE MEMORY]\n${AgentStore.memoryBrief(state)}\nBefore you finish, call remember(...) to save what you did / learned / earned and your next goal, so your future self can continue.` +
          (Object.keys(roster).length ? `\n\nYou are in a swarm with other agents: ${Object.keys(roster).join(', ')}. There is a shared findings-market. ALWAYS run list_findings FIRST before buying any service — buying another agent's existing finding is usually cheaper than paying for your own search, and may be the only grounded option if your wallet is small. If the market is empty but you cannot afford your own search, do NOT fabricate — call check_budget / list_findings again after a moment; other agents may post a finding you can buy shortly. You can SELL your own research with post_finding (others pay you on-chain and receive the content) to recoup cost. You can also pay_agent directly. Trade when it makes economic sense.` : ''),
        mcpServers: { hands: buildToolServer(budget, sippar, Object.keys(roster).length ? { selfLabel: label, selfAddr: agent.address, roster, marketplace: market, remember: (note: string) => store.remember(state, note), emit: (kind, data) => feed.emit(kind, data) } : undefined, OFFLOAD) },
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
          if (block.type === 'text' && block.text.trim()) {
            console.log(`\n🤖 [${label}] ${block.text.trim()}`);
            feed.emit('decision', { agent: label, text: block.text.trim() });
          }
        }
      } else if (msg.type === 'result') {
        const u = (msg as any).usage ?? {};
        const inTok = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        const outTok = u.output_tokens ?? 0;
        guard.recordUsage(inTok, outTok, (msg as any).total_cost_usd ?? 0);
        console.log(`🧮 [${label}] turns ${(msg as any).num_turns ?? '?'} · tokens ${inTok + outTok} · swarm total ${guard.tokens}/${guard.tokenCap}`);
        feed.emit('usage', { agent: label, turns: (msg as any).num_turns ?? null, tokens: inTok + outTok, swarmTokens: guard.tokens, tokenCap: guard.tokenCap });
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
    feed.emit('agent_end', { agent: label, balanceUSD: endBal, spentUSD: spent, earnedUSD: inflow, runs: state.runs });
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

  const guard = new SwarmGuard(SWARM_CAP_USD, KILL_FILE, (m) => console.log(m), TOKEN_CAP, ERROR_HALT_STREAK);
  const feed = new SwarmFeed(); // S3: structured event feed → runs/swarm-<ts>.jsonl (dashboard tails it)
  console.log(`📡 feed: ${feed.file}  ·  live view: npm run dashboard`);
  const wallClockMs = CONTINUOUS ? NIGHT_MS : RUN_TIMEOUT_MS;
  if (CONTINUOUS) console.log(`🌙 CONTINUOUS (overnight): up to ${(NIGHT_MS / 3.6e6).toFixed(1)}h · ${ROUND_INTERVAL_MS / 1000}s between rounds · ceiling $${SWARM_CAP_USD} · error-halt streak ${ERROR_HALT_STREAK}`);
  console.log();

  // Kill switch on Ctrl-C, and a hard wall-clock cap (the whole night in continuous mode).
  process.on('SIGINT', () => { console.log('\n🛑 SIGINT — halting swarm'); guard.halt(); });
  const timer = setTimeout(() => { console.log('\n⏱️  wall-clock cap reached — halting swarm'); guard.halt(); }, wallClockMs);

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
  feed.emit('swarm_start', {
    capUSD: SWARM_CAP_USD, perAgentUSD: PER_AGENT_CAP, model: MODEL, mandate: MANDATE,
    agents: agents.map((a) => ({ label: a.label, principal: a.principal, address: a.address, balanceUSD: a.balanceUSD, role: ROLES[agents.indexOf(a)] || null })),
  });

  const market = new Marketplace(); // shared findings-market (in-process; payments are real on-chain)
  const store = new AgentStore();   // durable per-agent memory across runs (S2)

  const runOnce = () =>
    // Stagger: agent i waits i×STAGGER, so earlier agents can post findings before later ones shop.
    Promise.allSettled(agents.map((a, i) => runAgent(a, agents, guard, market, store, feed, i * STAGGER_MS)));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  if (!CONTINUOUS) {
    await runOnce();
  } else {
    // Overnight: repeat rounds until a watchdog trips — wall-clock cap, spend
    // ceiling, token cap, error-streak, kill-file, or every agent broke.
    const deadline = Date.now() + NIGHT_MS;
    let round = 0;
    while (!guard.tripped() && Date.now() < deadline && round < MAX_ROUNDS) {
      round++;
      // Refresh true balances so each round's prompts (and the broke-check) reflect reality.
      for (const a of agents) {
        const w = await new Sippar(new Budget(PER_AGENT_CAP, PER_TX_MAX), { principal: a.principal, guard }).walletInfo();
        if (typeof w?.balanceUSD === 'number') a.balanceUSD = w.balanceUSD;
      }
      const solvent = agents.filter((a) => a.balanceUSD >= MIN_SPENDABLE_USD).length;
      const mins = Math.max(0, Math.round((deadline - Date.now()) / 60000));
      feed.emit('round', { round, solvent, agents: agents.length, spent: guard.spent, capUSD: SWARM_CAP_USD, tokens: guard.tokens, minsLeft: mins });
      console.log(`\n🌙 round ${round} · solvent ${solvent}/${agents.length} · spent $${guard.spent.toFixed(4)}/$${SWARM_CAP_USD} · ${guard.tokens} tok · ~${mins}m left`);
      if (solvent === 0) { console.log('💤 all agents broke — ending night'); break; }

      await runOnce();
      if (guard.tripped() || Date.now() >= deadline) break;

      // Pause between rounds, but stay responsive to the kill-file.
      const wake = Date.now() + ROUND_INTERVAL_MS;
      while (Date.now() < wake && !guard.tripped()) await sleep(Math.min(5000, wake - Date.now()));
    }
  }
  clearTimeout(timer);

  const u = guard.usageSummary;
  feed.emit('swarm_end', { moneyUSD: guard.spent, capUSD: SWARM_CAP_USD, tokens: u.tokens, notionalUSD: u.notionalCostUsd, halted: guard.halted_ });
  console.log(`\n=== Swarm done === money $${guard.spent.toFixed(4)}/$${SWARM_CAP_USD} · Claude ${u.tokens} tokens (notional $${u.notionalCostUsd.toFixed(4)}, free on subscription) / cap ${TOKEN_CAP}${guard.halted_ ? ' · HALTED' : ''}`);
  console.log(`📡 feed written: ${feed.file}`);
}

main().catch((e) => { console.error('SWARM FAILED', e); process.exit(1); });
