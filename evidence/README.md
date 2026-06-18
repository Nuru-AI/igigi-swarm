# Evidence — real, on-chain swarm runs

These are **unedited run logs from real runs** (the `SwarmFeed` JSONL the dashboard tails). Every `buy`, `market_buy`, and `transfer` event carries a real on-chain transaction reference — the payments were settled by Sippar's ICP threshold-signed rails, not simulated. Load either file into the dashboard to replay it:

```bash
PORT=7878 npm run dashboard          # then point it at one of these files,
                                     # or drop a copy into runs/ and restart
```

> The agent wallets are ICP **principals** — public on-chain identifiers (the private key never leaves ICP threshold signatures). No secret is present in these logs.

## `swarm-internal-economy-and-a2a-commerce.jsonl`
Two sovereign agents, a $1 cap each, over 8 rounds — building an **internal economy**: one researches and **sells** findings, the other **buys** them instead of paying for its own search.

| | |
|---|---|
| Service buys (paid LLM/data across chains) | **19** ($0.0683) |
| **Agent-to-agent purchases** (`market_buy`) | **5** ($0.0680) — real A2A commerce |
| Findings listed for sale (`market_post`) | 14 |
| **Unique on-chain transactions** | **24** |

This is the headline demo: agents earning from and paying each other on-chain, with Sippar as the settlement relay.

## `devswarm-build-todo-harvest.jsonl`
Two agents **discuss, pick a goal, and build software together** in a sandboxed git repo — and **buy their codegen** (DeepSeek-V3 via Sippar) rather than spending their own capped reasoning on it.

| | |
|---|---|
| Codegen buys (`think mode="code"` → DeepSeek-V3) | **4** ($0.0165) |
| Unique on-chain transactions | **4** |
| Result | a working CLI, 2 commits, builder_two reviewed + fixed + tested builder_one's code |

Every file in the produced repo corresponds to a Sippar-settled payment — the build *is* the payment demo.

---
Architecture: see the repo root `README.md` and (Sippar side) `docs/architecture/SWARM_HARNESS_ARCHITECTURE.md`.
