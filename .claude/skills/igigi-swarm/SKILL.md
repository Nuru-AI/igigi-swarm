---
name: igigi-swarm
description: Launch or replay the live Igigi Swarm demo — an autonomous AI agent economy where a coordinator sizes a team, provisions and funds sovereign on-chain wallets, and the agents pay EACH OTHER (machine payments via MPP on Tempo, settled by Sippar threshold signatures) to compose a real deliverable. Use this whenever the user wants to run, launch, start, demo, present, or show the Igigi Swarm, the agent swarm economy, the "agents paying agents" demo, or the hackathon demo — including phrasings like "start the swarm", "run the demo", "fly the swarm", "show the agent economy", "provision the agents", "let's do the Tempo/MPP demo", or "spin up the swarm". Also use it to replay a proven run on the dashboard for a zero-risk opener. Trigger even if the user doesn't say "Igigi" by name but clearly means this agent-payment swarm.
---

# Igigi Swarm — launch the live agent economy from Claude Code

This skill runs the demo end-to-end: a **coordinator** (a real model call) sizes the team to the goal, **provisions and funds sovereign agent wallets on-chain**, the **swarm runs** (each agent paying its peers via MPP on Tempo, settled by Sippar), and the **live dashboard** streams every settlement.

The point of the demo is the leap nobody else made: an agent that can pay *another agent it doesn't own*. So the narration matters as much as the commands. Surface what's happening as it happens.

## Demo flow (start here when presenting)

**If the user already named a goal** (e.g. "build me an AI-compute investment memo"), don't re-ask — confirm the team and run it.

The goal validated end-to-end (proven on mainnet, with the A/B and grounding results) is the **AI-compute investment memo**:

> rank NVIDIA, AMD, and the leading crypto-AI tokens (buy/sell/hold) with rationale, from live stock quotes, crypto-AI sentiment, recent AI-sector news, and semiconductor supply-chain signals

Default to that goal. It decomposes into ~6 specialists and exercises the full multi-source DAG. If the user is unsure what to run, offer it first:

> What should the swarm work on?
> 1. **AI-compute investment memo** (recommended — proven end-to-end): rank NVIDIA, AMD, and top crypto-AI tokens from live market data.
> 2. Crypto-AI market briefing (experimental): trending tokens, funding rates, AI news, sentiment.
> 3. L2 competitive teardown (experimental): compare three Ethereum L2s from on-chain + market data.

Steer toward option 1 — it's the only one validated, so it's the safe choice for a live demo. Treat 2 and 3 as experimental; a custom goal works too but may decompose unpredictably.

Once they answer, do these in order and **narrate each step out loud** (the lines in "What to say" below are the script):

1. **Confirm the team size.** Run provisioning; when the coordinator returns, say it plainly: *"This goal needs N specialists — here are their roles."* List them.
2. **Show the wallets being created and funded.** As `provision.mjs` prints each line, call it out: *"Minting a sovereign wallet for the Equity Analyst… funding it on-chain from treasury… funded, here's the tx."* The point the audience must see is that these are **real on-chain wallets created on demand**, not mock accounts.
3. **Hand off to the dashboard.** Give the URL and say *"open this to watch them pay each other."* Start the swarm so the dashboard fills with live settlements.

Keep the prereq checks quiet/quick — the audience cares about the team forming and paying each other, not about `npm install`.

## Before you start (prereqs)

Run from the project root (`agent-budget-experiment/`). Verify, and only fix what's missing:

1. **Dependencies** — if `node_modules/` is absent, run `npm install`. (Provisioning needs `@dfinity/identity`.)
2. **Secrets** — `.env` must exist with `SIPPAR_ACCESS_TOKEN` (the Sippar agent-pay API) and `OPENROUTER_API_KEY` (the agents' brain). If `.env` is missing, `cp .env.example .env` and ask the user to fill those two in — do **not** invent or echo token values.
3. **On Windows**, Node needs the system cert bundle: `NODE_EXTRA_CA_CERTS` should point at a PEM (the repo's runs set `C:/Users/<you>/win-ca-bundle.pem`). The `.run-*.ps1` launchers set this for you.

If a prereq is missing, stop and tell the user exactly what to add — a half-configured run fails mid-demo, which is the worst time.

## Two ways to run it

Pick based on what the user wants:

- **Replay (zero-risk opener).** Streams a *proven, already-settled* run to the dashboard. No payments, no live dependencies — it always works. Best for opening a presentation.
- **Live (the real thing).** Provisions fresh wallets and runs the swarm on mainnet right now. This is the money shot, but it spends real (tiny) USDC.e and needs the signer funded. Do a live run once before presenting so there are no surprises.

When unsure, offer both: open with replay, then do one live run.

### Replay mode

```bash
# pick the most recent complete run (or a known-good one the user names)
ls -t runs/*.jsonl | head
FEED_FILE=runs/<run>.jsonl npm run dashboard      # http://localhost:7878
```

Then tell the user to open the dashboard URL and walk the Activity / Receipt / Settle tabs.

### Live mode — the full arc

Run these in order. Narrate each step (see "What to say" below).

**1. Coordinator sizes the team + provisions wallets on-chain.**

```bash
node provision.mjs "<the user's goal>"
```

This makes a real model call to decide how many specialists the goal needs (3–8) and their roles, then for each: generates a sovereign ICP identity, derives its Tempo address, and funds it from treasury. It prints the wallet table and writes the principals to `.provisioned-principals.txt`. Watch for any `FAIL` lines — the script falls back across funders, but if a wallet ends unfunded, the swarm's sink agent may stall.

If the user gives no goal, default to: `"rank NVDA, AMD, and crypto-AI tokens (buy/sell/hold) with rationale, from stock quotes, crypto-AI sentiment, AI news, and semiconductor supply-chain signals"` — it exercises the full multi-specialist DAG.

**2. Run the swarm on the freshly-provisioned wallets.**

```bash
MPP_ONLY=1 AGENT_ENGINE=deepseek INFERENCE_PROVIDER=openrouter \
  OPENROUTER_MODEL=anthropic/claude-sonnet-4.6 \
  SWARM_PRINCIPALS=$(cat .provisioned-principals.txt) \
  npm run economy "<the same goal>"
```

`MPP_ONLY=1` restricts the catalog to Tempo so 100% of payments are MPP. The agents reason on bought inference (off any Claude cap), claim DAG tasks, buy real data (`buy_service`), buy their inputs from peers (`buy_input` — the agent-to-agent settlement), and submit. On **Windows**, run `./.run-provisioned.ps1` instead (it sets the same env + the cert path).

**3. Open the live dashboard in another shell** (or beforehand, so it streams as the swarm runs):

```bash
npm run dashboard          # http://localhost:7878
```

## What to say while it runs (the narration)

- At provisioning: *"The coordinator just decided this goal needs N specialists, and we're minting and funding N on-chain wallets right now — sovereign agents, born to fit the task."*
- At the first `buy_service`: *"That agent just paid for real data on Tempo — the request and response are in the Receipt tab."*
- At the first `market_buy` / A2A: *"There it is — one agent just paid another agent for its work. Money flowing up the chain. This is the thing Truth Terminal and Claudius couldn't do: an agent paying an agent it doesn't own."*
- At a `blocked` (budget) event: *"The cap is enforced in the signer, below the model — the agent can't argue past a key it doesn't hold."*
- At `swarm_end`: *"N tasks, N wallets, M on-chain settlements, one finished deliverable — a swarm that paid its own members."*

## Optional: show the cross-chain relay (Base)

To demonstrate that an agent holding only Tempo funds can still buy a service on **Base** (Sippar relays):

```bash
# from any funded agent principal — Sippar debits Tempo, fronts the Base payment, returns both receipts
curl -s -X POST https://sippar.network/api/sippar/agent/relay-pay \
  -H "X-Sippar-Access: $SIPPAR_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"agentPrincipal":"<principal>","serviceUrl":"https://chainray.online/gas-oracle","destChain":"base","maxAmountUSD":0.05,"method":"GET"}'
```

`chainray-gas` and `paysponge-rent` are known-good Base services; avoid the heurist endpoints (flaky).

## Troubleshooting

- **Provisioning `FAIL: 0x0`** — a funder was too thin for the amount + ~700k gas reservation; the script retries the next funder automatically. If all fail, top a funder wallet, or lower `PROVISION_FUND_USD`.
- **Payments error with "Sign failed" / out of cycles** — the `ethereum_signer` canister needs cycles. The live run can't settle until it's topped up.
- **`fetch failed` mid-run** — almost always the machine sleeping and dropping the network. Disable sleep before a demo (`powercfg /change standby-timeout-ac 0` on Windows).
- **Dashboard shows the wrong run** — it tails the newest `runs/*.jsonl` unless `FEED_FILE` is set.

## What this is (one paragraph, for context)

Each agent is an ICP principal whose on-chain address is signed by threshold cryptography — it never holds a private key, so it can't be drained or socially-engineered out of its funds. The spend cap lives in the signer, below the model. Agents pay each other with real USDC.e over MPP on Tempo; Sippar settles every edge with a tx receipt. Harnesses orchestrate the agents you own; this composes the agents you don't.
