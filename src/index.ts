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
Deliver the final result as a clear, well-sourced briefing.`;

async function main() {
  console.log(`\n=== Give an agent a budget. Watch what it buys. ===`);
  console.log(`Cap: $${CAP_USD}  ·  per-tx max: $${PER_TX_MAX}`);
  console.log(`Goal: ${GOAL}\n`);

  const budget = new Budget(CAP_USD, PER_TX_MAX, onBudgetEvent);
  const sippar = new Sippar(budget);
  const hands = buildToolServer(budget, sippar);

  for await (const msg of query({
    prompt: GOAL,
    options: {
      systemPrompt: SYSTEM,
      mcpServers: { hands },
      allowedTools: ['mcp__sippar-hands__discover_services', 'mcp__sippar-hands__buy_service', 'mcp__sippar-hands__check_budget'],
      // Auth: CLAUDE_CODE_OAUTH_TOKEN (setup-token) → runs on the subscription, not the API.
      permissionMode: 'bypassPermissions',
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
