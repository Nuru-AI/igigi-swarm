/**
 * The three tools the agent gets. The agent reasons (on the Claude subscription);
 * these tools are its hands. Payment + cap enforcement happen here, below the
 * model — the LLM cannot route around them.
 */
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Budget } from './budget.js';
import { Sippar } from './sippar.js';

export function buildToolServer(budget: Budget, sippar: Sippar) {
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
    { service_id: z.string(), payload: z.record(z.any()).default({}) },
    async ({ service_id, payload }) => {
      const r = await sippar.pay(service_id, payload);
      return { content: [{ type: 'text', text: JSON.stringify(r) }] };
    },
  );

  const checkBudget = tool(
    'check_budget',
    'Check your remaining budget and what you have bought so far.',
    {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(budget.summary()) }] }),
  );

  return createSdkMcpServer({ name: 'sippar-hands', version: '0.1.0', tools: [discover, buy, checkBudget] });
}
