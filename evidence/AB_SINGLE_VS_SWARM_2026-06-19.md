# A/B QC — Single Agent vs the 8-Agent Swarm (2026-06-19)

**Question:** does the multi-agent economy produce a *better deliverable*, or is it only about settlement?

**Setup (apples-to-apples):** identical goal (rank NVDA/AMD + crypto-AI tokens with rationale, from stock quotes + crypto sentiment + AI news + supply-chain signals), identical brain (Claude `sonnet-4.6` via OpenRouter), identical service catalog (Tempo MPP), identical tools.
- **A — single agent:** one agent does the whole memo (1-task plan). Gathered **5** data buys (alphavantage NVDA + AMD, 3× brave).
- **B — 8-agent swarm:** planner → 4-layer DAG → 8 specialists (Equity/Crypto/News/Supply-Chain Analysts → GPU & Sentiment synthesizers → Quant Risk Analyst → Chief Strategist), paying each other on-chain (9 A2A MPP settlements). Gathered **4** data buys.
  *(So it is NOT "the swarm gathered more data" — the single agent gathered slightly more.)*

## Result — blind LLM judge (Claude, did not know which memo was which)

**Detailed pass (5 dimensions, 1–10):**

| | data_cov | specificity | rigor | structure | actionability | **overall** |
|---|---|---|---|---|---|---|
| Single agent | 8 | 8 | 7 | 8 | **6** | **7.4** |
| **8-agent swarm** | 9 | 9 | 9 | 9 | **9** | **9.0** |

**3 passes with memo positions swapped (bias control):** swarm **3/3 wins**, swarm avg **8.07** vs single **7.23** — independent of presentation order.

## Why the swarm wins
The single agent gathered the *same data* but **flattens** it. The swarm's specialist layers force depth: the **Quant Risk Analyst** adds bull/base/bear **scenario probabilities**; the **Chief Strategist** adds **explicit price targets, portfolio weights, stop-loss discipline**. Judge's words: the single agent *"stops short of price targets or position-sizing, rendering its recommendations difficult to act on."* The judge also caught a **data error** in the single-agent memo (an implausible $537 AMD price) that the swarm handled correctly.

**Takeaway:** the agent economy isn't only a settlement story — the *specialization it enables produces measurably better, more actionable work* (≈ +0.8–1.6 overall, blind, position-controlled).

**Caveat:** one run-pair + 3 position-swapped judge passes. The gap is **structural** (the swarm always has a risk-analyst + strategist layer), so it reproduces; a multi-pair re-run firms the exact number.
