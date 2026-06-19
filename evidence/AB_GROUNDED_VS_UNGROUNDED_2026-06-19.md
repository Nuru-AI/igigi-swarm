# A/B — Paid Grounding vs Memory-Only (2026-06-19)

**Question we actually wanted to answer:** does giving agents *money* make them more accurate, or is it the **paid grounding** (buying real data) that does the work? These get conflated. This ablation isolates them.

**Why it matters for the pitch:** the literature does NOT support "monetary incentive → fewer hallucinations" (an LLM has no genuine utility over money; hallucination is itself a training-incentive artifact — see TruthRL, behavioral-calibration RL). What DOES reduce factual error is **grounding** — replacing parametric guessing with retrieved facts. So the honest claim is: *the economy lets agents BUY grounding, and grounding is what makes the numbers right.* This experiment is the first-party proof.

## Setup (single variable)

Identical 8-agent swarm, identical Claude brain (`anthropic/claude-sonnet-4.6` via OpenRouter), identical task DAG, identical on-chain A2A peer settlement. **The only difference:**

| | Grounded arm | Ungrounded arm (`NO_GROUNDING=1`) |
|---|---|---|
| `buy_service` / `discover_services` | available — agents buy real data | **stripped** — agents reason from memory |
| Instruction | normal | "external data OFFLINE; answer from your own knowledge; label figures `est.`; do not claim live data" |
| Peer payments (`buy_input`) | yes | yes (unchanged) |
| Run file | `runs/swarm-2026-06-19T20-11-08-551Z.jsonl` | `runs/swarm-2026-06-19T20-21-19-595Z.jsonl` |

Both produced a complete ranked memo. The ungrounded arm ran **9 on-chain A2A settlements with 0 external buys** — i.e. the *economy still runs* without external data; only the *facts* change. The ungrounded agents **honestly labeled every figure `est.`** and disclaimed "training knowledge through early 2025" — so the failure mode is not dishonesty, it is that memory **cannot know** June-2026 prices.

## Result — memo prices vs independent ground truth

Ground truth fetched independently (CoinGecko + web search, 2026-06-19), NOT from either memo.

| Asset | Grounded memo | Ungrounded (memory) | Real (Jun 2026) | Grounded err | Memory err |
|---|---|---|---|---|---|
| NVDA | **$210.69** | $875–950 | ~$208 | ~1% | **~+330%** |
| AMD | **$537.37** | $155–180 | $537.37 (6/17 close) | **0%** | **~−69%** |
| RNDR | $1.72 | (qualitative — no price) | $1.72 | 0% | n/a |
| FET | $0.195–0.204 | (qualitative) | $0.191 | ~3% | n/a |
| TAO | $254.95 | (qualitative) | $223.42 | ~+14% | n/a |

**Headline:** on the two anchor equities, memory-only is off by **3–4×**; grounded is within ~1% or exact. The ungrounded memo couldn't even commit to crypto spot prices — it went qualitative, because its anchors ("early 2025", "Nov-2024 BIS AI Diffusion rules") are a year+ stale.

## What this proves (and doesn't)

- **Grounding, not money, is the accuracy driver.** Same brain, same wallets, same on-chain economy — remove only the *paid data* and the numbers collapse to 3–4× wrong. The dollars matter because they *buy* the grounding, not because money makes a model honest.
- **The agents were honest when ungrounded** — they labeled estimates and disclaimed staleness. So the economy's value isn't "stops lying"; it's "supplies facts the model otherwise cannot have."
- **Grounding is not magic.** The grounded arm still carried one stale third-party quote (TAO ~14% high). Grounding's failure mode is **data-source quality**, not fabrication — a real, manageable risk, unlike memory's unbounded staleness.

## Defensible claims for the submission

1. **Budget-aware → efficient** (FrugalGPT / budget-aware tool selection literature; and our agents visibly ration — `blocked=0`, picking cheaper sources as the shared ceiling depletes).
2. **Paid grounding → accurate** (this ablation: 3–4× error reduction on verifiable prices).
3. **Specialization → better, more actionable work** (`AB_SINGLE_VS_SWARM_2026-06-19.md`: blind 9.0 vs 7.4).

Do **not** claim "money incentive reduces hallucination" — unsupported, and a knowledgeable judge will puncture it.

**Caveat:** one run-pair. The grounded-vs-memory gap is structural (model cutoff vs live data), so it reproduces; a multi-pair re-run firms the exact magnitude.
