/**
 * Give an agent a budget. Watch what it buys.
 *
 * The human sets a cap + a goal. A Claude agent (running on our SUBSCRIPTION via
 * the Claude Code setup token — no per-token API spend) autonomously discovers,
 * decides, and pays for real services across chains through Sippar's
 * non-custodial threshold-signed rails. The only money spent is the budget; the
 * reasoning is free. The cap is enforced below the model — it cannot overspend.
 *
 * Reasoning  = Claude subscription (CLAUDE_CODE_OAUTH_TOKEN)
 * Hands      = Sippar (x402/MPP, 10 chains, ICP threshold sigs)
 * Guardrail  = ./budget.ts (hard cap, the Project Vend / Freysa lesson)
 */
import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Budget, type BudgetEvent } from './budget.js';
import { Sippar } from './sippar.js';
import { buildToolServer } from './tools.js';

// Keep large service results INLINE (avoid the CLI spilling them to temp files).
// No data is lost — this just raises the inline ceiling for MCP tool output.
process.env.MAX_MCP_OUTPUT_TOKENS ||= '200000';

const CAP_USD = Number(process.env.BUDGET_CAP_USD || '5');
const PER_TX_MAX = Number(process.env.PER_TX_MAX_USD || '0.20');
const GOAL = process.argv.slice(2).join(' ') || 'Produce a short briefing on the current state of the Tempo blockchain and the agentic-payments space, using real data and sources.';

// --- live feed (the demo): financial truth comes from the budget, not the LLM ---
function onBudgetEvent(e: BudgetEvent) {
  if (e.type === 'spent') console.log(`💸 PAID  $${e.amount.toFixed(4)}  ${e.service.padEnd(18)} → remaining $${e.remaining.toFixed(4)}${e.tx ? `  tx ${e.tx.slice(0, 14)}…` : ''}`);
  else console.log(`🛑 BLOCKED  ${e.service.padEnd(18)} ${e.reason}`);
}

const SYSTEM = `You are an autonomous research agent with a real spending budget of $${CAP_USD} (USD, in stablecoins).
You have hands: tools to discover and BUY real paid services across chains (search, LLMs, market data, geocoding, computation).
Spend your own money to accomplish the goal well. Be economical — prefer cheaper services when adequate, and stop when the goal is met or the budget is low.
Use check_budget to track spend. Payments are settled on-chain automatically; you never hold a private key.
Deliver the final result as a clear, well-sourced briefing.

You have NO free access to the internet: you cannot web-search, fetch URLs, run shell commands, or spawn sub-agents. The ONLY way to obtain external data is to BUY it with buy_service. (A Read tool is available solely for inspecting the full result of a purchase if it was large — never for anything else.)

IMPORTANT: Call tools ONE AT A TIME. Make a single tool call, wait for its result, then decide the next step. Never emit more than one tool call in the same step.`;

async function main() {
  console.log(`\n=== Give an agent a budget. Watch what it buys. ===`);
  console.log(`Cap: $${CAP_USD}  ·  per-tx max: $${PER_TX_MAX}`);
  console.log(`Goal: ${GOAL}\n`);

  const budget = new Budget(CAP_USD, PER_TX_MAX, onBudgetEvent);
  const sippar = new Sippar(budget);
  const hands = buildToolServer(budget, sippar);

  // Hard gate (runs below the model). Allow the paid hands + a read-only escape
  // valve for inspecting purchased results; deny everything else by default.
  const HANDS_TOOLS = new Set([
    'mcp__hands__discover_services',
    'mcp__hands__buy_service',
    'mcp__hands__check_budget',
  ]);
  const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    if (HANDS_TOOLS.has(toolName)) return { behavior: 'allow' as const, updatedInput: input };
    if (toolName === 'Read') {
      const p = String((input as { file_path?: unknown }).file_path ?? '').toLowerCase();
      if (p.includes('.env') || p.includes('credential') || p.includes('setuptoken') || p.includes('.git')) {
        return { behavior: 'deny' as const, message: 'Reading local secrets is not allowed.' };
      }
      return { behavior: 'allow' as const, updatedInput: input };
    }
    return {
      behavior: 'deny' as const,
      message: `"${toolName}" is disabled. There is no free internet here — the only way to get external data is to BUY it via buy_service.`,
    };
  };

  for await (const msg of query({
    prompt: GOAL,
    options: {
      systemPrompt: SYSTEM,
      mcpServers: { hands },
      // ISOLATION: load NO filesystem settings — no user/project skills, MCP
      // servers, or CLAUDE.md. Without this the spawned CLI inherits the host's
      // skills (e.g. deep-research) and the agent routes around the paid rails
      // for free. With [], the only MCP tools are our `hands` server below.
      settingSources: [],
      // Read is allowed ONLY so the agent can consume the full result of a
      // purchase if the CLI spills a large tool result to a temp file — reading
      // already-paid-for data is consistent with the paid-only rule. No truncation.
      allowedTools: ['mcp__hands__discover_services', 'mcp__hands__buy_service', 'mcp__hands__check_budget', 'Read'],
      // The integrity rule is "no FREE external data, no FREE sub-work". Hard-block
      // every free path: web fetch/search, shell (could curl), file-writes, and the
      // orchestration tools that spin up free sub-research (Skill/Workflow/Task/Agent).
      disallowedTools: [
        'WebSearch', 'WebFetch', 'Bash', 'BashOutput', 'KillShell',
        'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep',
        'Task', 'Agent', 'Skill', 'Workflow', 'SlashCommand', 'TodoWrite',
      ],
      // Below-the-model hard gate: enforce the policy in code, not by prompt.
      // (permissionMode 'default' routes every not-pre-approved tool through this.)
      canUseTool,
      // Auth: CLAUDE_CODE_OAUTH_TOKEN (setup-token) → runs on the subscription, not the API.
      permissionMode: 'default',
      maxTurns: 40,
    },
  })) {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text.trim()) console.log(`\n🤖 ${block.text.trim()}`);
      }
    }
  }

  console.log(`\n=== Done ===`);
  console.log(JSON.stringify(budget.summary(), null, 2));
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
