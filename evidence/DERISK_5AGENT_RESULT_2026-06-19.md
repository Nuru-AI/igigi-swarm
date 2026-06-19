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
