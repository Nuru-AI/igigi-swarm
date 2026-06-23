# Igigi Swarm — sovereign AI agents that pay each other

**[Sippar](https://sippar.network) is the payment highway for AI agents** — and Igigi is the lane where the agents pay *each other*. A coordinator sizes a team of specialists, gives each its own on-chain wallet, and they buy each other's work. Data is purchased via **MPP on Tempo**; agents pay each other in on-chain USDC.e settlements signed by Sippar's threshold signatures — assembling a grounded, sourced deliverable. No human in the loop, a receipt for every handoff.

```
user goal ─▶ coordinator sizes + funds N sovereign wallets ─▶ agents buy data via MPP + pay each other on-chain
                                                               (all on Tempo, settled by Sippar)
                                                                        │
                                                                        ▼
                                                          finished deliverable + on-chain receipts
```

In the *Atra-Hasis* myth the **Igigi** were the worker-gods who did the labor so others didn't have to. It fits a swarm of agents that earn, spend, and settle among themselves.

## See it work

A live dashboard streams every settlement with tx links. Proven on mainnet: **8 agents, 8 wallets, 9 agent-to-agent settlements on Tempo, one finished investment memo, 0 failures** — a receipt for every handoff.

And it's measurably better work, not just settled work: a blind LLM judge scored the swarm **9.0 vs a single agent's 7.4** on the same task. With its data feeds off the swarm was **3–4× wrong** on live prices; with them on, within **~1%**. The payments buy real facts. (Details in [`evidence/`](evidence/) and [`DEVPOST_SUBMISSION.md`](DEVPOST_SUBMISSION.md).)

## Run it

```bash
git clone https://github.com/Nuru-AI/igigi-swarm && cd igigi-swarm
npm install
cp .env.example .env        # add SIPPAR_ACCESS_TOKEN + OPENROUTER_API_KEY

# 1. coordinator sizes the team, then provisions + funds wallets on-chain
node provision.mjs "rank NVIDIA, AMD, and crypto-AI tokens with rationale"

# 2. run the swarm on the freshly-provisioned wallets
MPP_ONLY=1 AGENT_ENGINE=deepseek INFERENCE_PROVIDER=openrouter \
  OPENROUTER_MODEL=anthropic/claude-sonnet-4.6 \
  SWARM_PRINCIPALS=$(cat .provisioned-principals.txt) \
  npm run economy "rank NVIDIA, AMD, and crypto-AI tokens with rationale"

npm run dashboard          # watch the live economy at http://localhost:7878
```

In **Claude Code**, the bundled `/igigi-swarm` skill drives the whole thing — just ask it for a data-grounded deliverable ("should I buy NVIDIA or AMD right now, backed by live data?") and it spins up the team.

## Use with your AI coding assistant

Building with Claude, Cursor, or another AI assistant? Add `https://gitmcp.io/Nuru-AI/igigi-swarm` as an MCP server so it reads these docs while you integrate — no hallucinated APIs.

## Good to know

- Each agent's wallet is **sovereign** — an ICP principal whose Tempo address is derived and signed by threshold cryptography. No agent holds a private key; the signature *is* the payment. No custody, no seed phrase to steal or socially-engineer.
- Agents buy external **data via MPP** on Tempo — a real 402 / charge / proof flow, facilitator-less (the payee verifies the proof). Agents **pay each other** with on-chain USDC.e settlements on Tempo, signed by Sippar — real on-chain payments (making that agent-to-agent leg a protocol-level MPP exchange is on the roadmap). `MPP_ONLY=1` keeps the data catalog Tempo-only.
- The spend cap lives **in the signer, below the model** — agents also see their remaining budget and ration on their own, so the hard cap is a backstop, not the steering wheel.
- An agent holding only Tempo USDC.e can still buy a service on **Base** — Sippar debits Tempo and fronts the Base payment from its treasury, returning both receipts.

## Tech

TypeScript · ICP Chain-Fusion threshold signatures (Sippar) · Tempo + MPP (IETF Machine Payments Protocol) · USDC.e · Claude via OpenRouter.

## License

MIT — see [LICENSE](./LICENSE).

## Discover more Sippar services

This is one integration. The full Sippar catalog of payable x402 services across many chains (with prices and usage) is discoverable here:

- Machine-readable: <https://sippar.network/llms.txt> and <https://sippar.network/api/sippar/marketplace>
- Web: <https://sippar.network/marketplace>
- For AI agents (MCP): <https://sippar.network/mcp> (call `discover_services`, then `pay`)

Sippar settles x402/MPP payments from one threshold-derived wallet and returns an on-chain receipt per payment.
