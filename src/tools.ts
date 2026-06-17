/**
 * The three tools the agent gets. The agent reasons (on the Claude subscription);
 * these tools are its hands. Payment + cap enforcement happen here, below the
 * model — the LLM cannot route around them.
 */
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Budget } from './budget.js';
import { Sippar } from './sippar.js';

/**
 * @param roster other agents this agent can pay, as { label: address }. When
 *   provided (swarm mode), a `pay_agent` tool is added — the internal economy.
 */
export function buildToolServer(budget: Budget, sippar: Sippar, roster?: Record<string, string>) {
  const discover = tool(
    'discover_services',
    'List real services you can buy, optionally filtered by category and max price. Returns id, name, category, price (USD), chain, and the input shape.',
    { category: z.string().optional(), max_price: z.number().optional() },
    async ({ category, max_price }) => {
      const list = sippar.discover({ category, maxPrice: max_price });
      return { content: [{ type: 'text', text: JSON.stringify(list, null, 1) }] };
    },
  );

  const buy = tool(
    'buy_service',
    'Pay for and call a service by id with a JSON payload (match its input shape). Payment is threshold-signed by Sippar across chains; it is rejected automatically if it would exceed your budget. Returns the service response.',
    { service_id: z.string(), payload: z.record(z.string(), z.any()).default({}) },
    async ({ service_id, payload }) => {
      const r = await sippar.pay(service_id, payload);
      // Return the FULL service response — no truncation. If the CLI spills a
      // large result to a temp file, the agent reads it with the allowed Read
      // tool (reading already-paid-for data is consistent with the paid-only rule).
      return { content: [{ type: 'text', text: JSON.stringify(r) }] };
    },
  );

  const checkBudget = tool(
    'check_budget',
    'Check your real spendable funds: your on-chain wallet balance (the true hard cap) plus the local spend ledger. Spend against walletBalanceUSD when present — it is ground truth.',
    {},
    async () => {
      const summary: any = budget.summary();
      const w = await sippar.walletInfo();
      if (w?.balanceUSD != null) {
        summary.walletBalanceUSD = w.balanceUSD;
        summary.walletAddress = w.address;
        summary.note = 'walletBalanceUSD is your TRUE on-chain spendable balance — you cannot spend more than this regardless of the cap.';
      }
      return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
    },
  );

  // Swarm mode: let this agent pay other agents (hire/tip/commission).
  const swarmTools = roster && Object.keys(roster).length > 0
    ? [
        tool(
          'pay_agent',
          `Pay another agent in the swarm from your OWN wallet — hire, tip, or commission them to do part of your work. Known agents: ${Object.keys(roster).join(', ')}. Amount in USD.`,
          { recipient: z.string(), amount: z.number(), reason: z.string().optional() },
          async ({ recipient, amount }) => {
            const addr = roster[recipient];
            if (!addr) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `unknown agent "${recipient}"; known: ${Object.keys(roster).join(', ')}` }) }] };
            const r = await sippar.payAgent(addr, amount);
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          },
        ),
      ]
    : [];

  return createSdkMcpServer({ name: 'sippar-hands', version: '0.1.0', tools: [discover, buy, checkBudget, ...swarmTools] });
}
