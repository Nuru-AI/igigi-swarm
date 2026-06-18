/**
 * P1 (AGENTS_ON_BOUGHT_INFERENCE.md): prove an agent can run its ENTIRE
 * reasoning + tool-calling loop on a Sippar-paid x402/MPP LLM (DeepSeek) —
 * NO Claude Agent SDK, ZERO Claude tokens. One agent works a task board:
 * list → claim → buy real data (on-chain settlement) → produce → submit.
 *
 *   PROBE_PRINCIPAL=<funded> npx tsx src/deepseek-loop-spike.ts
 */
import 'dotenv/config';
import { Budget } from './budget.js';
import { Sippar } from './sippar.js';
import { TaskBoard, type Task } from './taskboard.js';

const PRINCIPAL = process.env.PROBE_PRINCIPAL || process.env.AGENT_PRINCIPAL || '';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const MAX_TURNS = Number(process.env.SPIKE_MAX_TURNS || '14');
const LABEL = 'A1';

const sippar = new Sippar(new Budget(1.0, 0.10), { principal: PRINCIPAL });

// One source task assigned to our agent.
const plan: Task[] = [{ id: 't1', title: 'Produce a 4-bullet brief on the current crypto market (BTC/ETH + one mover), grounded in REAL bought data', produces: 'crypto_brief', consumes: [], priceUSD: 0.01 }];
const board = new TaskBoard(plan);
board.assign('t1', LABEL);

// Tools as OpenAI function schemas + handlers (the adapter, by hand for the spike).
const TOOLS = [
  { type: 'function', function: { name: 'list_open_tasks', description: 'List the tasks awarded to you that you can claim now.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'claim_task', description: 'Claim an open task by id.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'buy_service', description: 'Buy a real paid data service (payment settles on-chain). Use service_id "brave" with payload {"q":"<query>"} for web search.', parameters: { type: 'object', properties: { service_id: { type: 'string' }, payload: { type: 'object' } }, required: ['service_id', 'payload'] } } },
  { type: 'function', function: { name: 'submit_task', description: 'Submit your task output text. Marks it completed.', parameters: { type: 'object', properties: { id: { type: 'string' }, output: { type: 'string' } }, required: ['id', 'output'] } } },
];

let dataBought = false; // loop guard: weaker models loop on buy_service; stop after one success
const DISPATCH: Record<string, (a: any) => Promise<unknown>> = {
  list_open_tasks: async () => board.listOpen(LABEL),
  claim_task: async ({ id }) => board.claim(LABEL, id),
  buy_service: async ({ service_id, payload }) => {
    if (dataBought) return { error: 'You ALREADY have your data. Do NOT buy again. Now write the 4-bullet brief and call submit_task(id="t1", output=...).' };
    if (!service_id || typeof service_id !== 'string') return { error: 'service_id is required (a non-empty string, e.g. "brave"). Do not call with empty arguments.' };
    if (!payload || typeof payload !== 'object' || !Object.keys(payload).length) return { error: 'payload is required (e.g. {"q":"your search query"}). Do not call with empty arguments.' };
    const r = await sippar.pay(service_id, payload);
    if (r.success) dataBought = true;
    return { success: r.success, paid: r.amountPaid, tx: r.tx, data: r.success ? r.response : undefined, error: r.error, next: r.success ? 'You now have data. Write the 4-bullet brief and call submit_task.' : undefined };
  },
  submit_task: async ({ id, output }) => {
    if (!output || String(output).length < 20) return { error: 'output must be the full 4-bullet brief text (>=20 chars).' };
    return board.submit(LABEL, id || 't1', output, (await sippar.walletInfo())?.address ?? '');
  },
};

const SYSTEM = `You are an autonomous agent. Work your task board using tool calls. Follow these steps IN ORDER, exactly once each:
1. list_open_tasks — see your task (id "t1").
2. claim_task(id="t1").
3. buy_service ONCE: service_id="brave", payload={"q":"bitcoin ethereum crypto price today"}. This returns real search data. Buy it ONLY ONCE.
4. Using the data you got, WRITE a 4-bullet brief, then call submit_task(id="t1", output="<your 4 bullets>").
CRITICAL RULES:
- NEVER call a tool with empty arguments. Always include the required fields.
- After ONE successful buy_service you HAVE your data — do NOT buy again; go straight to submit_task.
- You are NOT done until submit_task succeeds. After it succeeds, reply with the single word DONE.`;

function extractMessage(resp: any): any {
  return resp?.choices?.[0]?.message ?? resp?.data?.choices?.[0]?.message ?? resp?.message ?? null;
}

async function main() {
  const w = await sippar.walletInfo();
  console.log(`=== P1: agent on BOUGHT DeepSeek inference (no Claude) ===`);
  console.log(`wallet ${w?.address} $${(w?.balanceUSD ?? 0).toFixed(4)} · model ${MODEL}\n`);

  const messages: any[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'Do your assigned task now.' }];
  let infSpend = 0, infCalls = 0;

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const r = await sippar.pay('deepseek', { model: MODEL, messages, tools: TOOLS, tool_choice: 'auto' });
    if (!r.success) { console.log(`✖ inference call failed: ${r.error}`); break; }
    infSpend += r.amountPaid ?? 0; infCalls++;
    const m = extractMessage(r.response);
    if (!m) { console.log('✖ no message in response:', JSON.stringify(r.response).slice(0, 300)); break; }
    messages.push({ role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls });

    if (m.tool_calls?.length) {
      for (const call of m.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* */ }
        const fn = DISPATCH[call.function.name];
        const result = fn ? await fn(args) : { error: `unknown tool ${call.function.name}` };
        const short = JSON.stringify(result);
        console.log(`🔧 [turn ${turn}] ${call.function.name}(${JSON.stringify(args).slice(0, 80)}) → ${short.slice(0, 120)}`);
        messages.push({ role: 'tool', tool_call_id: call.id, content: short.slice(0, 6000) });
      }
      continue;
    }
    // No tool call → final text.
    console.log(`🗣️  [turn ${turn}] ${String(m.content).slice(0, 200)}`);
    if (String(m.content).trim().toUpperCase().includes('DONE') || board.allDone()) break;
  }

  console.log(`\n=== result ===`);
  console.log(`board: ${JSON.stringify(board.snapshot())}`);
  console.log(`inference: ${infCalls} DeepSeek calls · $${infSpend.toFixed(4)} (settled via Sippar) · 0 Claude tokens`);
  const done = board.allDone();
  const out = board.sink()?.output;
  console.log(`task completed: ${done}${out ? `\n--- deliverable ---\n${out.slice(0, 500)}` : ''}`);
}

main().catch((e) => { console.error('SPIKE FAILED', e); process.exit(1); });
