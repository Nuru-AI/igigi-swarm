# Igigi Swarm — an autonomous agent economy settled on MPP / Tempo

*Igigi: the Mesopotamian worker-gods who labored so others didn't have to — a swarm of autonomous agents, settled by [Sippar](https://sippar.network).*

**Category:** Applications
**Built:** June 16–20, 2026 (Futura MPP Hackathon). Uses Sippar's cross-chain threshold-signature infrastructure (an open dependency) + Tempo + MPP.

## One line
Eight specialist AI agents — owned by different wallets, with no shared trust — collaborate up a dependency DAG, **paying each other per-task in USDC via facilitator-less MPP on Tempo**, and assemble a real deliverable. Sippar's ICP threshold signatures settle every edge. No custody, no accounts, no facilitator.

## The problem (Tempo's own framing)
"Machines are becoming a customer." Agents need to discover services, understand price, authorize spend, and pay inside automated workflows — and human checkout / subscriptions / per-API accounts don't fit high-frequency machine use. MPP solves the *agent → service* payment. **We add the missing piece: agent → agent.** When the specialists composing a task are owned by *different parties*, they need to pay each other — and **no agent harness ships a cross-owner payment primitive at all** (check the Claude Agent SDK, claude-flow, or ruflo docs — the capability is simply absent; the proof is the absence). That's the gap.

## What it does
A user gives a goal (e.g. *"a ranked AI-compute investment memo"*). A **coordinator sizes the team to the goal** (a real model call decides how many specialists are needed, 3–8, and names their roles), then **provisions that many sovereign wallets on demand** — generating a fresh ICP identity per agent, deriving its on-chain address, and funding it from treasury (all live, on-chain). A planner decomposes the goal into a dependency DAG and awards each task to one specialist — e.g. **Equity Data Analyst, Crypto Market Researcher, AI-News Analyst, Supply-Chain Analyst, Quant Risk Analyst, Chief Investment Strategist.** Each agent:
1. **discovers** services it needs and **buys real data** per-call (`buy_service` → MPP payment on Tempo);
2. **buys its inputs from peer agents** (`buy_input` → on-chain A2A MPP settlement — money flows *up* the chain);
3. **produces and submits** its output, which downstream agents then buy.

The sink agent assembles the final memo from purchased upstream work. **Proven run: 8/8 tasks, 9 on-chain A2A MPP settlements on Tempo, a complete ranked investment memo, 0 failures.**

## Quality — measurably better than a single agent
We A/B'd the swarm against **one Claude agent doing the same task** (same brain, tools, and data — it actually gathered *more* raw data). A **blind LLM judge** (didn't know which was which) scored the **swarm 9.0 vs the single agent 7.4** overall, and **3/3 with memo positions swapped** (swarm 8.07 vs 7.23) — so it's not position bias. The swarm's specialist layers force depth: explicit **price targets, bull/base/bear scenario probabilities, position-sizing, stop-loss discipline** — which the single agent flattens (judge: *"difficult to act on"*). The economy isn't only about settlement — **the specialization it enables produces better work.** (Details: `evidence/AB_SINGLE_VS_SWARM_2026-06-19.md`.)

## Why paid data — not "money makes agents honest"
We also isolated *what the payments buy*. A second A/B ran the identical swarm with external data **disabled** (agents reason from memory) vs **enabled** (agents buy real data). Memory-only, the agents were honest — they *labeled every figure an estimate* — but the numbers were stale: NVDA off **~4×**, AMD off **~3×** vs. the real June-2026 prices. With paid grounding, the same figures came back within **~1%** (e.g. NVDA $210.69 vs ~$208, AMD $537.37 exact). The accuracy comes from **paid grounding**, not from money as an incentive — money is just the access mechanism. (Details: `evidence/AB_GROUNDED_VS_UNGROUNDED_2026-06-19.md`.)

## How it uses MPP / Tempo
- **Every payment is MPP on Tempo** — agent→service *and* agent→agent — settled in USDC.e (`MPP_ONLY=1` enforces a Tempo-only service catalog so 100% of flows are MPP).
- **Facilitator-less:** the payee self-verifies the payment proof; Sippar's ICP **threshold signature *is* the payment** — no third-party facilitator, no custody.
- **Machine-native, per-request:** no accounts or subscriptions with any seller — agents pay fractions of a cent per call, exactly MPP's model.
- **Observability + spending controls** (Tempo's named integration points): a live dashboard streams every settlement with tx links. Agents are **budget-aware** — each sees live prices and the remaining shared ceiling and rations deliberately (picking cheaper sources as the pool depletes); the *cryptographic* cap in the signer is the hard backstop, not the primary control (a budget-aware run completed with **zero** cap-blocks). Two layers, the human one on top.
- **On-demand provisioning:** the coordinator creates and **funds new agent wallets live** before a run — sovereign teams are spun up to fit the task, not pre-allocated.
- **Cross-chain relay (proven on Base):** an agent that holds only Tempo USDC.e can buy an x402 service on **Base** — Sippar debits it on Tempo and fronts the Base payment from its Base treasury, returning the data + both on-chain receipts. Same model extends to x402 on 8 more chains. MPP-native on Tempo, rail-agnostic beyond it.

## Why a harness can't do this
Claude Code subagents, the Agent SDK, and ruflo are excellent at orchestrating agents — **but every one of them assumes you own and pay for all the agents.** A subagent is a function inside your program: it can't be a different company's agent, can't get paid, can't refuse to work for free, and leaves no record of who did what for how much.

But the real agent economy isn't one company's agents. The best stock data comes from one provider, crypto sentiment from another, the analysis from a third. **You can't run those as subagents — you don't have their code or keys. You can only pay them.** So composing a multi-provider value chain *requires* settlement — and that's exactly what no harness provides.

This swarm is that settlement working end-to-end: 8 agents, **8 different wallets**, each paid per contribution on-chain via MPP, with a tx receipt for every edge (billing, provenance, disputes). The payment *is* the coordination and the trust. **Harnesses orchestrate the agents you own; Sippar lets you compose the agents you don't.**

## Architecture
`planner (decompose → DAG + roles)` → `TaskBoard (dependency-gated, Contract-Net award)` → `N sovereign agents` (reasoning on bought inference, off any provider's cap) → `buy_service / buy_input` → **`Sippar /agent/pay` → ICP threshold sig → MPP settlement on Tempo** → `live dashboard`.

## Run it
```bash
npm install
cp .env.example .env        # add your SIPPAR_ACCESS_TOKEN + OPENROUTER_API_KEY

# 1. coordinator (Claude) sizes the team, then provisions + funds wallets on-chain
node provision.mjs "rank NVDA, AMD, and crypto-AI tokens with rationale"

# 2. run the swarm on the freshly-provisioned wallets (Claude brain, MPP-only on Tempo)
MPP_ONLY=1 AGENT_ENGINE=deepseek INFERENCE_PROVIDER=openrouter \
  OPENROUTER_MODEL=anthropic/claude-sonnet-4.6 \
  SWARM_PRINCIPALS=$(cat .provisioned-principals.txt) \
  npm run economy "rank NVDA, AMD, and crypto-AI tokens with rationale"

# watch the live economy (or replay the proven run with FEED_FILE=runs/<run>.jsonl)
npm run dashboard          # http://localhost:7878
```

## Tech
Sippar (ICP Chain-Fusion threshold signatures, cross-chain settlement) · Tempo (MPP settlement chain, USDC.e) · MPP (IETF Machine Payments Protocol) · Locus MPP wrapped services (data/LLM) · Claude via OpenRouter (agent reasoning) · TypeScript.
