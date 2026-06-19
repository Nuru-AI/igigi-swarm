# Sippar Swarm — an autonomous agent economy settled on MPP / Tempo

**Category:** Applications
**Built:** June 16–20, 2026 (Futura MPP Hackathon). Uses Sippar's cross-chain threshold-signature infrastructure (an open dependency) + Tempo + MPP.

## One line
Eight specialist AI agents — owned by different wallets, with no shared trust — collaborate up a dependency DAG, **paying each other per-task in USDC via facilitator-less MPP on Tempo**, and assemble a real deliverable. Sippar's ICP threshold signatures settle every edge. No custody, no accounts, no facilitator.

## The problem (Tempo's own framing)
"Machines are becoming a customer." Agents need to discover services, understand price, authorize spend, and pay inside automated workflows — and human checkout / subscriptions / per-API accounts don't fit high-frequency machine use. MPP solves the *agent → service* payment. **We add the missing piece: agent → agent.** When the specialists composing a task are owned by *different parties*, they need to pay each other — and no agent harness (Claude Code subagents, the Agent SDK, ruflo/claude-flow) can do cross-owner, cross-chain settlement. That's the gap.

## What it does
A user gives a goal (e.g. *"a ranked AI-compute investment memo"*). A planner decomposes it into a 4-layer dependency DAG and awards each task to a distinct specialist agent — **Equity Data Analyst, Crypto Market Researcher, AI-News Analyst, Supply-Chain Analyst, GPU Strategist, Sentiment Analyst, Quant Risk Analyst, Chief Investment Strategist.** Each agent:
1. **discovers** services it needs and **buys real data** per-call (`buy_service` → MPP payment on Tempo);
2. **buys its inputs from peer agents** (`buy_input` → on-chain A2A MPP settlement — money flows *up* the chain);
3. **produces and submits** its output, which downstream agents then buy.

The sink agent assembles the final memo from purchased upstream work. **Proven run: 8/8 tasks, 9 on-chain A2A MPP settlements on Tempo, a complete ranked investment memo, 0 failures.**

## How it uses MPP / Tempo
- **Every payment is MPP on Tempo** — agent→service *and* agent→agent — settled in USDC.e (`MPP_ONLY=1` enforces a Tempo-only service catalog so 100% of flows are MPP).
- **Facilitator-less:** the payee self-verifies the payment proof; Sippar's ICP **threshold signature *is* the payment** — no third-party facilitator, no custody.
- **Machine-native, per-request:** no accounts or subscriptions with any seller — agents pay fractions of a cent per call, exactly MPP's model.
- **Observability + spending controls** (Tempo's named integration points): a live dashboard streams every settlement with tx links; caps are enforced *cryptographically in the signer*, not in a prompt.
- **Rail-agnostic extension:** the same agents can pay via MPP on Tempo or x402 on 9 other chains — Sippar sits alongside MPP and adds cross-chain settlement.

## Why a harness can't do this
Claude Code subagents, the Agent SDK, and ruflo are excellent at orchestrating agents — **but every one of them assumes you own and pay for all the agents.** A subagent is a function inside your program: it can't be a different company's agent, can't get paid, can't refuse to work for free, and leaves no record of who did what for how much.

But the real agent economy isn't one company's agents. The best stock data comes from one provider, crypto sentiment from another, the analysis from a third. **You can't run those as subagents — you don't have their code or keys. You can only pay them.** So composing a multi-provider value chain *requires* settlement — and that's exactly what no harness provides.

This swarm is that settlement working end-to-end: 8 agents, **8 different wallets**, each paid per contribution on-chain via MPP, with a tx receipt for every edge (billing, provenance, disputes). The payment *is* the coordination and the trust. **Harnesses orchestrate the agents you own; Sippar lets you compose the agents you don't.**

## Architecture
`planner (decompose → DAG + roles)` → `TaskBoard (dependency-gated, Contract-Net award)` → `N sovereign agents` (reasoning on bought inference, off any provider's cap) → `buy_service / buy_input` → **`Sippar /agent/pay` → ICP threshold sig → MPP settlement on Tempo** → `live dashboard`.

## Run it
```bash
# in agent-budget-experiment/  (Node 20+, an OpenRouter or Claude key, funded Tempo agent wallets)
npm install
# live: 8 specialist agents, Claude brain via OpenRouter, MPP-only payments on Tempo
MPP_ONLY=1 bash demo-run.sh
# watch the live economy:
npm run dashboard          # http://localhost:7878
# replay the proven run:
FEED_FILE=runs/<run>.jsonl npm run dashboard
```

## Tech
Sippar (ICP Chain-Fusion threshold signatures, cross-chain settlement) · Tempo (MPP settlement chain, USDC.e) · MPP (IETF Machine Payments Protocol) · Locus MPP wrapped services (data/LLM) · Claude via OpenRouter (agent reasoning) · TypeScript.
