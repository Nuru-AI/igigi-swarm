# Igigi Swarm

A swarm of sovereign AI agents that pay each other. Machine payments via MPP on Tempo, settled by [Sippar](https://sippar.network) threshold signatures, composing real work with no human in the loop.

> Truth Terminal proved an AI can earn a fortune, then had to ask a human for its allowance, because it never held its own wallet.
> Anthropic's Claudius ran a real budget and invented a Venmo account that didn't exist, because it had rails for thinking and none for paying.
> Igigi gives a team of agents wallets they actually control, a limit they can't argue past, and the one thing none of those experiments had: the ability to pay each other.

In the *Atra-Hasis* myth the **Igigi** were the worker-gods who did the labor so others didn't have to. It fits a swarm of agents that earn, spend, and settle among themselves.

## What it is

You give the swarm a goal. A coordinator sizes the team to the work (3 to 8 specialists), then provisions them live: a fresh ICP identity per agent, an on-chain address derived by threshold signatures, funded from treasury before your eyes. A planner splits the goal into a dependency graph. Each agent buys the data it needs and buys its inputs from the peers who produced them. Every payment settles in USDC over MPP on Tempo, and money flows up the chain of work to the agent that assembles the final answer.

The agents never hold private keys. The signature *is* the payment. The spend cap lives in the signer, below the model, and the agents can see their remaining budget so they ration on their own.

## Run it

```bash
npm install
cp .env.example .env        # add SIPPAR_ACCESS_TOKEN + OPENROUTER_API_KEY

# 1. coordinator sizes the team, then provisions + funds wallets on-chain
node provision.mjs "rank NVDA, AMD, and crypto-AI tokens with rationale"

# 2. run the swarm on the freshly-provisioned wallets
MPP_ONLY=1 AGENT_ENGINE=deepseek INFERENCE_PROVIDER=openrouter \
  OPENROUTER_MODEL=anthropic/claude-sonnet-4.6 \
  SWARM_PRINCIPALS=$(cat .provisioned-principals.txt) \
  npm run economy "rank NVDA, AMD, and crypto-AI tokens with rationale"

# watch the live economy (or replay a proven run with FEED_FILE=runs/<run>.jsonl)
npm run dashboard          # http://localhost:7878
```

In Claude Code, the bundled `/igigi-swarm` skill drives the whole demo for you, including a zero-risk replay mode.

## What's proven

On mainnet: 8 agents, 8 wallets, 9 agent-to-agent settlements on Tempo, one finished deliverable, zero failures, with a receipt for every handoff.

A blind LLM judge scored the swarm 9.0 against a single Claude agent's 7.4 on the same task, and 3 out of 3 with the answers swapped. And an ablation showed where that quality comes from: with its data feeds off, the swarm was honest but 3 to 4 times wrong on live prices; with them on, it landed within about 1%. The payments buy real facts, not just settlement.

See [`evidence/`](evidence/) for the A/B results and [`DEVPOST_SUBMISSION.md`](DEVPOST_SUBMISSION.md) for the full story.

## How it's built

- **Wallets** — each agent is an ICP principal whose Tempo address is derived and signed by ICP threshold cryptography (Sippar). No custody, no seed phrase.
- **Settlement** — every payment, agent-to-service and agent-to-agent, runs over MPP on Tempo in USDC.e, facilitator-less (the payee verifies the proof). `MPP_ONLY=1` keeps every flow on MPP.
- **The runner** (`src/economy.ts`) — a planner builds the task DAG, a board gates each claim on its dependencies, and agents reason with Claude via OpenRouter (off any cap) to discover, buy, produce, and submit.
- **Provisioning** (`provision.mjs`) — the coordinator decides how many specialists the goal needs, generates that many identities, and funds each through Sippar's transfer endpoint.
- **Cross-chain** — an agent holding only Tempo USDC.e can buy a service on Base; Sippar debits Tempo and fronts the Base payment from its treasury.

## Tech

TypeScript · ICP Chain-Fusion threshold signatures (Sippar) · Tempo + MPP (IETF Machine Payments Protocol) · USDC.e · Claude via OpenRouter.
