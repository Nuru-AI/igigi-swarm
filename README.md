# Give an agent a budget. Watch what it buys.

An autonomous AI agent with **non-custodial, cross-chain hands** and a **cap it cannot exceed** — built on Sippar's threshold-signed payment rails.

> *Truth Terminal* proved an AI can create economic value — but humans held its wallet.
> Anthropic's *Claudius* ran a real budget — and hallucinated a fake Venmo because it had no real rails, and got talked out of its money.
> Here's the same autonomy, with a wallet the agent controls (no private key) and a cap it physically can't argue past.

## How it works

```
   human sets cap + goal
            │
            ▼
   ┌──────────────────┐   reasons on the Claude SUBSCRIPTION
   │  Claude agent    │   (setup token — no per-token API spend)
   │  (Agent SDK)     │
   └────────┬─────────┘
            │ tools: discover_services · buy_service · check_budget
            ▼
   ┌──────────────────┐   HARD CAP enforced here, below the model
   │  budget chokepoint│   (Project Vend / Freysa lesson)
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐   x402 / MPP across 10 chains,
   │  Sippar rails    │   signed by ICP threshold sigs.
   │  (deployed)      │   The agent never holds a key.
   └──────────────────┘
```

- **Reasoning = the Claude subscription** (`CLAUDE_CODE_OAUTH_TOKEN`). Free to think; money is only spent buying services.
- **Hands = Sippar** — `buy_service` settles real stablecoin payments across chains via Sippar's deployed rails (`src/sippar.ts`).
- **Guardrail = the budget chokepoint** (`src/budget.ts`) — every purchase is checked *before* it's signed; overspend throws. The agent cannot route around it.
- **Identity = already on-chain** — the paying address is a registered ERC-8004 agent (#9274) + Self Agent ID (#169), keyless (signed by ICP threshold). A verifiable economic actor across chains.
- **Economy = 21 render-verified services** (`src/services.ts`) — each confirmed paid-and-rendered on mainnet.

## Run

```bash
npm install
export CLAUDE_CODE_OAUTH_TOKEN=...        # claude setup-token (subscription auth)
export SIPPAR_ACCESS_TOKEN=...            # stealth-gate token
npm start "research the Tempo ecosystem and write a sourced briefing"
```

The agent discovers services, buys what it needs across chains, narrates each purchase + on-chain receipt, and a live `💸 PAID … → remaining $…` feed shows the budget draining. A `🛑 BLOCKED` line fires if it tries to overspend.

## Integration point

`src/sippar.ts` `pay()` posts to `POST /api/sippar/agent/pay` — a thin Sippar backend wrapper over `x402ClientService.callWithPayment` + `budget-manager`. That endpoint is the one server-side piece to confirm/deploy (the signing + 10-chain routing already exist).

## Vision

This is Sippar's documented thesis, made runnable: **"Trained Hands for Frontier Intelligence"** (`NURU_AI_STRATEGIC_VISION.md`), the Sips Economy's *"give an agent a budget, watch what it buys"* (`SIPS-ECONOMY-MANIFESTO-DRAFT.md`), and the *Humans in Charge* value — *"budget caps enforced cryptographically, not contractually"* (`SIPS-VISION-AND-VALUES.md`).
