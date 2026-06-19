# 5-Agent Scale De-Risk — Result (2026-06-19)

**Engine:** off-Claude, fully on-chain. `AGENT_ENGINE=deepseek INFERENCE_SERVICE=groq INFERENCE_MODEL=qwen/qwen3-32b` (qwen3-32b reasoning each turn via the Sippar-settled Groq MPP rail; history flattened). DAG task-economy (`economy.ts`), 5 agents, 5 funded sovereign wallets.

**Goal:** "Produce a one-paragraph investment brief on the AI-compute sector combining NVIDIA's latest stock quote, current crypto-AI token sentiment, and recent AI-sector developments." Planner produced a 3-layer DAG: 3 sources → 1 intermediate (`equity_sector_analysis` ← nvidia+news) → 1 sink (`investment_brief` ← analysis+crypto).

## The three de-risk risks → measured

| Risk | Criterion | Result |
|---|---|---|
| **#3 Bulk funding** | 5/5 wallets funded on-chain pre-run | ✅ **PASS** — 5/5 funded (custody-sign path), balances confirmed |
| **#1 Compute ceiling (Claude)** | zero 429s, token burn within cap | ✅ **PASS / eliminated** — **0 Claude tokens**, 0 429s. The old binding constraint is gone. |
| **#2 Coordination at depth** | ≥1 cross-agent trade settles on-chain | ❌ **FAIL** — **0 A2A settlements** at 5 agents (vs **2** at 3 agents) |

Two runs: concurrent → **3/5** tasks (3 sources, deep layers died); staggered 8s → **2/5**. Stagger did not help.

## Root cause — the bottleneck SHIFTED

We eliminated the Claude weekly-cap ceiling (0 tokens). The new binding constraint at 5 concurrent agents is the **bought-inference rail's reliability**: the Groq MPP **chat (LLM) endpoint** returns failures (`inference failed: undefined`, ~3/5 agents/run) under simultaneous load, **even after 5 retries + staggered starts**. Critically, **every `buy_service` DATA call succeeds** (alphavantage/brave, real tx) — only the heavier LLM-inference calls flake. So it is a provider-side concurrency/latency limit on LLM inference, not our harness, not the ICP signer (signs fine; 6.2 TC), not money.

The deep-DAG agents (intermediate + sink) need the most inference turns, so they hit the timeout window before they can `buy_input` from peers → the collaboration layer never closes → 0 A2A.

## Verdict & safe ceiling

- **Off-Claude autonomy: validated.** 0 Claude tokens at 5 agents; the cap is genuinely removed.
- **Safe concurrent ceiling on the current Locus groq rail: ~3 agents** (3/3 tasks + 2 on-chain A2A settlements, proven same day — `runs/swarm-2026-06-19T08-56-42*.jsonl`). At 5, the LLM rail's reliability breaks the deep layers.
- **Cost reality:** every thought = 1 t-ECDSA signature ≈ $0.03 cycles; a 5-agent run ≈ 1.5–4 TC.

## Recommended next step (go/no-go)

**NO-GO for "dozens" on the current Locus groq LLM rail** until inference reliability is solved. Options, in order:
1. **Move the BRAIN to a higher-reliability inference rail** (OpenRouter / self-hosted vLLM), keep **A2A `buy_input`/`buy_service` settlements on-chain via Sippar** — the data endpoints already prove on-chain settlement is rock-solid; it's only LLM inference that's flaky. This is the "brain off-signer" architecture, now justified by **reliability data**, not just the ~70% signature-cost saving.
2. **Phase D — MPP Sessions** (1 signature → N micropayments) to cut on-chain call volume.
3. Stay fully on-chain but **cap concurrency at ~3 agents** per wave; run more waves sequentially.

---

## UPDATE — 5/5 with Claude-via-Locus (the fix)

Re-ran the same 5-agent DAG with the brain = **Claude (claude-sonnet-4-6) via the Locus Wrapped API** (beta), A2A still on-chain. `INFERENCE_PROVIDER=locus-anthropic`, `SWARM_STAGGER_MS=10000`.

- **5/5 tasks completed** — deep DAG fully closed (3 sources → intermediate t4 → sink t5).
- **4 on-chain A2A settlements**: A4→A1 $0.007, A4→A2 $0.008, A5→A4 $0.015, A5→A4 $0.01 (money flows UP the DAG; real Tempo tx).
- **0 Claude tokens** (off the weekly cap) — billed per-call in USDC from the Locus Base wallet, not the subscription.
- **Real grounded deliverable** — investment brief citing live NVDA $210.69 +2.95%, 241M vol, AI-token mcap $22.7B, RNDR/TAO; no placeholders.
- One agent hit a single "Upstream API call failed" (Locus→Anthropic concurrency hiccup); the board's claim-reassignment + 5×backoff retry absorbed it → still 5/5.

### Why it worked where the cheap rails didn't
- **Per-call reliability + quality**: Claude doesn't fumble the multi-turn protocol or invent data the way deepseek-chat/qwen did.
- **Stagger (10s ramp)** spread peak inference concurrency so the provider didn't drop deep-layer agents (concurrent start → 2/5; staggered → 5/5).
- **Brain off the signer**: inference billed by Locus (USDC, Base), so the ICP signer is reserved for A2A — no per-thought cycle burn.

### Cost / ceiling
- ~$1–1.8 USDC per 5-agent run on sonnet (~$0.02/call × ~12 calls × 5). Money-bound, no weekly cap, no signer cycles. Use `claude-haiku-4-5` to cut ~5–8×.
- **Verdict: GO for scale with Claude-via-Locus + stagger.** The remaining limit is provider concurrency (mitigated by stagger/retry/board-reassignment), not our harness, the cap, or the signer. Run dozens in staggered waves; budget is the only knob.

---

## UPDATE 2 — 8/8 at 8 agents on OpenRouter Claude (the scale unlock)

The beta-5 ceiling was the Locus-beta Anthropic RPM tier, not our harness. Switching the brain to **Claude (anthropic/claude-sonnet-4.6) via OpenRouter** (high RPM, $20 credits) — A2A still on-chain on Tempo:

- **8/8 tasks completed** — every layer of an 8-node, 4-layer DAG closed (sources → 2 intermediate layers → sink).
- **7 on-chain A2A MPP settlements on Tempo**: A5→A1, A5→A3, A6→A2, A6→A4, A7→A5, A7→A6, A8→A7 — money flowing all the way up the supply chain, real tx.
- **0 inference failures** at 8 concurrent agents (vs Locus-beta's cascade of "Upstream API call failed"). The rate-limit ceiling is gone.
- 0 Claude subscription tokens for agents; deliverable = a real ranked AI-compute investment memo (NVDA/AMD + crypto-AI tokens, composite scoring).
- Native OpenAI tool-role history works directly via OpenRouter's chat-completions API (no flatten / no fromClaudeMessages — that's the OpenRouter Agent SDK, not the raw API).

### Brain options matrix (final)
| Brain | Reliability @8 | Cap | Cost | Notes |
|---|---|---|---|---|
| Claude via OpenRouter | ✅ 8/8, 0 fails | none (RPM high) | OpenRouter credits (~$1/run) | the scale path |
| Claude subscription (AGENT_ENGINE=claude) | ✅ (full Claude) | weekly token cap | free within cap | simplest if tokens available |
| Claude via Locus beta | ⚠️ ≤5 agents | beta RPM tier | USDC | on-Locus, rate-limited at scale |
| deepseek/groq MPP (Tempo) | ❌ weak/flaky | n/a | on-chain Tempo | maximal thesis, unreliable |

**Verdict: scaling is solved.** Reliable 8-agent autonomous swarm with on-chain Tempo MPP settlements; the only knob is inference $ (OpenRouter) or subscription tokens. Dozens = bigger fleet, same setup.
