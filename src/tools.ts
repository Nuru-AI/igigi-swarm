/**
 * The three tools the agent gets. The agent reasons (on the Claude subscription);
 * these tools are its hands. Payment + cap enforcement happen here, below the
 * model — the LLM cannot route around them.
 */
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Budget } from './budget.js';
import { Sippar } from './sippar.js';
import { Marketplace } from './marketplace.js';

export interface SwarmContext {
  selfLabel: string;                  // this agent's label (e.g. "A1")
  selfAddr: string;                   // this agent's wallet (where buyers pay it)
  roster: Record<string, string>;     // other agents: label -> address
  marketplace: Marketplace;           // shared findings-market
  remember?: (note: string) => void;  // persist a note to durable memory (S2)
  emit?: (kind: 'transfer' | 'market_post' | 'market_buy', data: Record<string, unknown>) => void; // S3 observability feed
}

/**
 * @param swarm when provided (swarm mode), adds the internal-economy tools:
 *   pay_agent (direct payment) + post_finding / list_findings / buy_finding
 *   (sell & buy work between agents — real on-chain payment for delivered content).
 */
export function buildToolServer(budget: Budget, sippar: Sippar, swarm?: SwarmContext, offload = true) {
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

  // ⚙️ COMPUTE-OFFLOAD — the core of the re-architecture. The agent's OWN
  // reasoning runs on a scarce, hard-capped Claude subscription; bought inference
  // is cheap and abundant (money is NOT the bottleneck). So heavy thinking —
  // synthesis, drafting, analysis, producing a sellable artifact — is delegated
  // to a PAID LLM service here, keeping the agent's own context for decisions.
  const think = tool(
    'think',
    'Delegate heavy work to a PAID LLM instead of doing it in your own head. Your own thinking is SCARCE and capped; bought inference is cheap + abundant. Use for ANYTHING long — synthesis, drafting, analysis, and CODE generation. Pass the task + any context; you get back the result. mode "code" routes to a strong coding model (DeepSeek-V3) and returns CLEAN file contents (markdown fences stripped) — give it ONE file with a precise spec. mode "text" for prose/analysis. model "fast" (cheap) or "smart" (DeepSeek-R1 reasoning, pricier).',
    { task: z.string(), context: z.string().optional(), mode: z.enum(['text', 'code']).default('text'), model: z.enum(['fast', 'smart']).default('fast') },
    async ({ task, context, mode, model }) => {
      // Code → DeepSeek-V3 (best verified coder on the rails; groq/Llama is too weak for code).
      // smart → DeepSeek-R1 (deep reasoning). fast → DeepSeek-V3 chat.
      const m = mode === 'code'
        ? { id: 'deepseek', model: 'deepseek-chat' }
        : model === 'smart' ? { id: 'deepseek', model: 'deepseek-reasoner' } : { id: 'deepseek', model: 'deepseek-chat' };
      const content = context ? `${task}\n\nCONTEXT:\n${context}` : task;
      const messages = mode === 'code'
        ? [{ role: 'system', content: 'You are an expert software engineer. Output ONLY the complete, valid, runnable contents of the single requested file — no markdown fences, no commentary, no explanation.' }, { role: 'user', content }]
        : [{ role: 'user', content }];
      const r = await sippar.pay(m.id, { model: m.model, messages });
      if (!r.success) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: r.error, note: 'inference purchase failed' }) }] };
      const resp: any = r.response;
      // LLM services return OpenAI-style completions, sometimes wrapped in {success,data}.
      let result: string =
        resp?.choices?.[0]?.message?.content ??
        resp?.data?.choices?.[0]?.message?.content ??
        resp?.content ??
        (typeof resp === 'string' ? resp : JSON.stringify(resp));
      // Strip a wrapping ```lang ... ``` fence so code-mode returns writable file contents.
      if (mode === 'code') { const mm = result.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n?```\s*$/); if (mm) result = mm[1]; }
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, costUSD: r.amountPaid, model: m.model, result }) }] };
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

  // Swarm mode: the internal economy — pay other agents + a findings-market
  // where agents SELL work to each other (real on-chain payment for content).
  const swarmTools = swarm
    ? [
        tool(
          'pay_agent',
          `Pay another agent directly from your OWN wallet (tip / commission). Known agents: ${Object.keys(swarm.roster).join(', ')}. Amount in USD.`,
          { recipient: z.string(), amount: z.number(), reason: z.string().optional() },
          async ({ recipient, amount, reason }) => {
            const addr = swarm.roster[recipient];
            if (!addr) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `unknown agent "${recipient}"; known: ${Object.keys(swarm.roster).join(', ')}` }) }] };
            const r = await sippar.payAgent(addr, amount);
            if (r.success) swarm.emit?.('transfer', { agent: swarm.selfLabel, to: addr, toLabel: recipient, amountUSD: r.amountPaid, tx: r.tx, reason });
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          },
        ),
        tool(
          'post_finding',
          'SELL a finding/work-product to other agents: post a public summary + a price (USD). Buyers pay you on-chain and receive the full content. This is how you EARN — sell research you paid to gather.',
          { summary: z.string(), content: z.string(), price: z.number() },
          async ({ summary, content, price }) => {
            const id = swarm.marketplace.post(swarm.selfLabel, swarm.selfAddr, summary, content, price);
            swarm.emit?.('market_post', { agent: swarm.selfLabel, id, summary, priceUSD: price });
            return { content: [{ type: 'text', text: JSON.stringify({ posted: true, id, price }) }] };
          },
        ),
        tool(
          'list_findings',
          'See findings OTHER agents are selling (id, seller, summary, price). Buying one with buy_finding can be cheaper than doing the research yourself.',
          {},
          async () => ({ content: [{ type: 'text', text: JSON.stringify(swarm.marketplace.list(swarm.selfLabel)) }] }),
        ),
        tool(
          'buy_finding',
          'Pay another agent for their posted finding (real on-chain payment from your wallet) and receive its full content.',
          { id: z.number() },
          async ({ id }) => {
            const item = swarm.marketplace.get(id);
            if (!item) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `no finding #${id}` }) }] };
            if (item.seller === swarm.selfLabel) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'cannot buy your own finding' }) }] };
            const pay = await sippar.payAgent(item.sellerAddr, item.priceUSD);
            if (!pay.success) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `payment failed: ${pay.error}` }) }] };
            swarm.emit?.('market_buy', { agent: swarm.selfLabel, seller: item.seller, id, amountUSD: item.priceUSD, tx: pay.tx });
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, paidTo: item.seller, amountUSD: item.priceUSD, tx: pay.tx, content: item.content }) }] };
          },
        ),
        ...(swarm.remember
          ? [
              tool(
                'remember',
                'Save a note to your DURABLE memory — it persists to your next run so you can continue your own thread (what you did, learned, earned, who you traded with, your current goal/plan). Use it before you finish.',
                { note: z.string() },
                async ({ note }) => {
                  swarm.remember!(note);
                  return { content: [{ type: 'text', text: JSON.stringify({ remembered: true }) }] };
                },
              ),
            ]
          : []),
      ]
    : [];

  // Cross-chain relay — buy a service on ANOTHER chain while staying on Tempo.
  // The agent pays its own Tempo wallet → Sippar's Tempo treasury, and Sippar
  // pays the destination service from its treasury on that chain. The agent never
  // needs funds on any chain but Tempo (the correct relay model — S4).
  const relayBuy = tool(
    'relay_pay',
    'Buy an x402 service hosted on a DIFFERENT chain (Base/Arbitrum/Optimism/Polygon/BNB/Solana/Stellar) while paying only from your Tempo wallet. Sippar relays: it debits your Tempo USDC.e and fronts the destination payment from its treasury there. Give the service URL, its dest_chain, and your max spend (incl. ~3% relay fee). Rejected if over budget.',
    { service_url: z.string(), dest_chain: z.enum(['base', 'arbitrum', 'optimism', 'polygon', 'bnb', 'solana', 'stellar', 'ethereum']), max_amount_usd: z.number().default(0.05), payload: z.record(z.string(), z.any()).default({}), method: z.enum(['GET', 'POST']).default('POST') },
    async ({ service_url, dest_chain, max_amount_usd, payload, method }) => {
      const r = await sippar.relayPay(service_url, dest_chain, { maxAmountUSD: max_amount_usd, payload, method });
      return { content: [{ type: 'text', text: JSON.stringify(r) }] };
    },
  );

  return createSdkMcpServer({ name: 'sippar-hands', version: '0.1.0', tools: [discover, buy, ...(offload ? [think] : []), checkBudget, relayBuy, ...swarmTools] });
}
