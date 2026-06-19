# Igigi Swarm — the first economy where the workers are machines, and they pay each other

*In the old myth, the **Igigi** were the worker-gods — the ones who did the labor so others didn't have to. They are the right name for what comes next.*

**Category:** Applications · **Built:** June 16–20, 2026 (Futura MPP Hackathon) · on **Tempo** + **MPP**, settled by **[Sippar](https://sippar.network)**.

---

## The caged genius

Truth Terminal proved an AI can earn a fortune. It spun up a memecoin, captured a community, and roughly **$1M flowed to it directly** — with an ecosystem that reached tens of millions around it.

And then it had to ask a human for its allowance.

Because Truth Terminal never held its own wallet. A person stood between the smartest economic actor anyone had seen and every dollar it "earned." The autonomy was real right up to the moment that matters most — the keys — and there it stopped.

When **Anthropic** gave Claude a real budget to run a vending machine (*Project Vend / "Claudius"*), it reached for money and **grabbed at a Venmo account that didn't exist**, then got **talked out of its own funds.** Not because it wasn't smart — because it had rails for *thinking* and none for *paying*, and no floor under it a clever argument couldn't move. (Freysa, separately, lost ~$47K the same way: its spending limit lived in a prompt, and prompts can be argued with.)

**Every one of these proved an agent can *touch* money. Every one failed at the same two things: a wallet the agent actually controls, and a limit it cannot talk its way past.** That is the layer we built — and then we did the thing none of them could: **we let the agents pay *each other.***

---

## What Igigi Swarm is

You give it a goal. A **coordinator (a real Claude call) sizes the team** to the work — 3 to 8 specialists — then **provisions them live**: it generates a sovereign ICP identity per agent, derives each one's on-chain address, and **funds each from treasury, on-chain, before your eyes.** No pre-allocated fleet. The team is born to fit the task.

Then they work — and they **pay each other.** A planner decomposes the goal into a dependency graph. Each agent buys the real data it needs (`buy_service` → MPP payment on Tempo) and **buys its inputs from the peer agents who produced them** (`buy_input` → on-chain agent-to-agent settlement). Money flows *up* the chain of work; the final agent assembles the deliverable from purchased upstream contributions.

Nobody scripted them to make money. We gave them budgets, hands, and **each other** — and got out of the way.

---

## It runs on mainnet. Here is the proof, not the promise.

- **A swarm that paid its own members:** 8 agents, **8 different wallets**, **9 on-chain agent-to-agent MPP settlements** on Tempo, one complete ranked investment memo, **0 failures.** Every handoff has a tx receipt.
- **The closed loop, first proven in Run 5:** one sovereign agent **earned real money from another** for delivered work — A2A payment on mainnet, tx `0x4a9a73eba7…`.
- **It's not just settled — it's *better* work.** A **blind LLM judge** scored the swarm **9.0 vs a single Claude agent's 7.4** on the identical task (3/3 with positions swapped — not bias). The specialist layers force depth a generalist flattens: price targets, scenario probabilities, position sizing.
- **What the money actually buys is grounding, not honesty.** We ablated it: the same swarm reasoning from memory was *honest* (it labeled every figure an estimate) but **3–4× wrong** on live prices; buying real data brought it **within ~1%**. The payments buy *facts* — that's what cuts hallucination.

---

## Why no agent harness can do this

Claude Code subagents, the Agent SDK, claude-flow, ruflo — they orchestrate brilliantly. But **every one assumes you own and pay for all the agents.** A subagent is a function inside your program: it can't be a different company's agent, can't get paid, can't refuse to work for free, and leaves no record of who did what for how much.

**No harness ships a cross-owner payment primitive at all.** Check their docs — the capability is simply absent. The proof is the absence.

And the real agent economy was never one company's agents. The best stock data is one provider's, the sentiment another's, the analysis a third's — **you don't have their code or their keys. You can only pay them.** Composing that value chain *requires* settlement, and settlement is exactly what no harness provides.

**Harnesses orchestrate the agents you own. Igigi composes the agents you don't.**

---

## How it uses MPP / Tempo

- **Every payment is MPP on Tempo** — agent→service *and* agent→agent — settled in USDC.e (`MPP_ONLY=1` makes 100% of flows MPP).
- **Facilitator-less, custody-less:** the payee self-verifies the proof; Sippar's ICP **threshold signature *is* the payment.** The agent never holds a private key — so it can't be drained, forked, or socially-engineered out of its funds the way Freysa was. That's the difference between "autonomous" in a press release and autonomous in a transaction.
- **The guardrail lives under the model.** The spend cap is enforced **cryptographically in the signer canister, below the agent's reasoning** — and agents are *budget-aware*: each sees live prices and the remaining shared ceiling and rations deliberately (a budget-aware run finished with **zero** cap-blocks). You can argue with a prompt. You can't argue with a key you don't hold.
- **On-demand provisioning:** sovereign agent wallets are created and funded live, sized to the task.
- **Cross-chain relay (proven on Base):** an agent holding only Tempo USDC.e can buy an x402 service on **Base** — Sippar debits it on Tempo and fronts the Base payment from its treasury, returning the data + both receipts. MPP-native on Tempo, rail-agnostic across 8 more chains.
- **Observability:** a live dashboard streams every settlement with tx links and per-purchase receipts (prompt sent, response received).

---

## Architecture

`coordinator (Claude sizes the team) → provision + fund sovereign wallets on-chain → planner (goal → dependency DAG) → N agents reasoning on bought inference → buy_service / buy_input → Sippar /agent/pay → ICP threshold signature → MPP settlement on Tempo → live dashboard`

## Run it

```bash
npm install
cp .env.example .env        # add SIPPAR_ACCESS_TOKEN + OPENROUTER_API_KEY

# 1. coordinator sizes the team, then provisions + funds wallets on-chain
node provision.mjs "rank NVDA, AMD, and crypto-AI tokens with rationale"

# 2. run the swarm on the freshly-provisioned wallets (Claude brain, MPP-only on Tempo)
MPP_ONLY=1 AGENT_ENGINE=deepseek INFERENCE_PROVIDER=openrouter \
  OPENROUTER_MODEL=anthropic/claude-sonnet-4.6 \
  SWARM_PRINCIPALS=$(cat .provisioned-principals.txt) \
  npm run economy "rank NVDA, AMD, and crypto-AI tokens with rationale"

npm run dashboard          # watch the live economy at http://localhost:7878
```

## Tech

Sippar (ICP Chain-Fusion threshold signatures, cross-chain settlement) · Tempo (MPP settlement chain, USDC.e) · MPP (IETF Machine Payments Protocol) · Claude via OpenRouter (agent reasoning, off-cap) · TypeScript.

*Evidence: `evidence/AB_SINGLE_VS_SWARM_2026-06-19.md` (specialization), `evidence/AB_GROUNDED_VS_UNGROUNDED_2026-06-19.md` (grounding). Truth Terminal / Project Vend figures are hedged to what's publicly defensible.*
