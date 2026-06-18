/**
 * COLLABORATION EXPERIMENT — agents working together on ONE task using the SDK's
 * native subagent feature (`agents` + Task delegation).
 *
 * A sovereign agent (real wallet) is the TEAM LEAD on a shared task and delegates
 * sub-tasks to SDK subagents — researcher / writer / critic — that inherit its
 * hands (buy data, `think` = paid inference) and share its wallet. This is the
 * SDK-native "agents work together" path.
 *
 * Tension worth observing (ties to the compute-offload finding): SDK subagents
 * collaborate by spending MORE Claude tokens — each reasons in its own context.
 * The economic model (peers pay each other / offload to paid LLMs) trades money
 * for tokens instead. This run measures the token cost of the SDK-subagent path.
 *
 *   SWARM_PRINCIPALS=<funded principal> npm run team -- "the shared task"
 */
import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Budget, type BudgetEvent } from './budget.js';
import { Sippar } from './sippar.js';
import { buildToolServer } from './tools.js';
import { SwarmFeed } from './feed.js';

process.env.MAX_MCP_OUTPUT_TOKENS ||= '200000';

const PRINCIPAL = (process.env.SWARM_PRINCIPALS || process.env.AGENT_PRINCIPAL || '').split(',')[0].trim();
const CAP = Number(process.env.BUDGET_CAP_USD || '0.25');
const PER_TX = Number(process.env.PER_TX_MAX_USD || '0.06');
const MODEL = process.env.SWARM_MODEL || 'claude-sonnet-4-6';
const MAX_TURNS = Number(process.env.TEAM_MAX_TURNS || '24');
const TASK = process.argv.slice(2).join(' ') ||
  'Build a crypto market snapshot from FOUR independent data pulls — run them in PARALLEL, one researcher subagent each: (1) trending tokens, (2) perp funding rates, (3) BTC/ETH/SOL spot prices, (4) a stock-index or AlphaVantage quote. When all four return, have the writer compose the snapshot.';

const HANDS = ['mcp__hands__discover_services', 'mcp__hands__buy_service', 'mcp__hands__think', 'mcp__hands__check_budget', 'mcp__hands__relay_pay'];

const feed = new SwarmFeed(); // S3 dashboard: npm run dashboard tails this
const onEvent = (e: BudgetEvent) => {
  if (e.type === 'spent') { console.log(`💸 $${e.amount.toFixed(4)} ${e.service.padEnd(16)} → left $${e.remaining.toFixed(4)}`); feed.emit('buy', { agent: 'lead', service: e.service, amountUSD: e.amount, tx: e.tx, chain: e.chain }); }
  else { console.log(`🛑 BLOCKED ${e.service} ${e.reason}`); feed.emit('blocked', { agent: 'lead', service: e.service, amountUSD: e.amount, reason: e.reason }); }
};

async function main() {
  if (!PRINCIPAL) { console.error('Set SWARM_PRINCIPALS=<funded principal> (or AGENT_PRINCIPAL).'); process.exit(1); }
  const budget = new Budget(CAP, PER_TX, onEvent);
  const sippar = new Sippar(budget, { principal: PRINCIPAL });
  const w = await sippar.walletInfo();
  console.log(`\n=== TEAM MODE (SDK subagents) ===  lead ${PRINCIPAL.slice(0, 12)}… wallet $${(w?.balanceUSD ?? 0).toFixed(4)}\nTask: ${TASK}\n`);
  console.log(`Feed: ${feed.file} · watch: npm run dashboard`);
  feed.emit('swarm_start', { agents: [{ label: 'lead', principal: PRINCIPAL, balanceUSD: w?.balanceUSD, address: w?.address }], capUSD: CAP, model: MODEL, mandate: `TEAM (SDK subagents): ${TASK}` });
  feed.emit('agent_start', { agent: 'lead', balanceUSD: w?.balanceUSD, address: w?.address });

  let inTok = 0, outTok = 0, taskCalls = 0;
  const canUse = async (name: string, input: Record<string, unknown>) => {
    if (name === 'Task' || name === 'Agent') { taskCalls++; console.log(`\n🤝 [lead] DELEGATE → ${(input as any)?.subagent_type ?? (input as any)?.description ?? '?'}`); return { behavior: 'allow' as const, updatedInput: input }; }
    if (HANDS.includes(name) || name === 'Read') return { behavior: 'allow' as const, updatedInput: input };
    return { behavior: 'deny' as const, message: `"${name}" is disabled.` };
  };

  for await (const msg of query({
    prompt: TASK,
    options: {
      systemPrompt: `You are a COORDINATOR. You have NO research or writing tools of your own — you can ONLY delegate (the Agent/Task tool) and check the budget. The ONLY way to get anything done is to invoke your subagents.

RULES (follow exactly):
1. The task has several INDEPENDENT data pulls. Invoke a SEPARATE \`researcher\` subagent for EACH one, and invoke them ALL IN PARALLEL — emit multiple Agent calls in the SAME step (do NOT do them one at a time). Each researcher gets exactly one data source to fetch.
2. When all researchers have returned their notes, invoke the \`writer\` subagent ONCE with all the notes to compose the final snapshot.
3. Return the writer's result. Do not try to fetch or write anything yourself — you have no tools for it.
Your wallet (~$${(w?.balanceUSD ?? CAP).toFixed(2)}) is shared with the subagents; payments settle on-chain.`,
      mcpServers: { hands: buildToolServer(budget, sippar, undefined, true) },
      agents: {
        researcher: {
          description: 'Fetches and summarizes ONE paid data source. Invoke one per data pull; invoke several in parallel for independent pulls.',
          prompt: 'You fetch ONE piece of data. Use discover_services to find the right service for the single data pull you were asked for, buy_service it, then use think to compress the result into 2-4 tight lines with the numbers. Return ONLY those notes. Do exactly one data pull.',
          tools: ['mcp__hands__discover_services', 'mcp__hands__buy_service', 'mcp__hands__think', 'mcp__hands__check_budget'],
        },
        writer: {
          description: 'Composes the final deliverable from the researcher notes. Invoke once at the end.',
          prompt: 'You are the writer. Compose the notes you are given into one clear, well-structured snapshot. Use think for the drafting. Return the final snapshot only.',
          tools: ['mcp__hands__think'],
        },
      },
      settingSources: [],
      allowedTools: ['Task', 'Agent', 'mcp__hands__check_budget', 'Read'],
      disallowedTools: ['WebSearch', 'WebFetch', 'Bash', 'BashOutput', 'KillShell', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep', 'Skill', 'Workflow', 'SlashCommand', 'TodoWrite'],
      canUseTool: canUse,
      model: MODEL,
      permissionMode: 'default',
      maxTurns: MAX_TURNS,
    },
  })) {
    if (msg.type === 'assistant') {
      for (const b of (msg as any).message.content) if (b.type === 'text' && b.text.trim()) { console.log(`\n🧭 [lead] ${b.text.trim().slice(0, 500)}`); feed.emit('decision', { agent: 'lead', text: b.text.trim().slice(0, 500) }); }
    } else if (msg.type === 'result') {
      const u = (msg as any).usage ?? {};
      inTok += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      outTok += u.output_tokens ?? 0;
    }
  }

  const spent = budget.summary().spent;
  feed.emit('swarm_end', { capUSD: CAP, spentUSD: spent, halted: false, delegations: taskCalls });
  console.log(`\n=== TEAM done ===  DELEGATIONS: ${taskCalls} ${taskCalls > 0 ? '✅ subagents fired' : '❌ NONE — lead did not delegate'}  ·  money $${spent.toFixed(4)}  ·  Claude tokens ${inTok + outTok} (in ${inTok} / out ${outTok})`);
  console.log(`Compare these Claude tokens against the single-agent offload run of the same kind of task — SDK subagents trade MORE tokens for parallel division of labor; only worth it when the task genuinely parallelizes.`);
}

main().catch((e) => { console.error('TEAM FAILED', e); process.exit(1); });
