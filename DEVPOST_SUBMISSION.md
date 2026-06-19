## Inspiration

Truth Terminal proved an AI can earn a fortune — it spun up a memecoin and roughly **$1M flowed to it directly**, with an ecosystem reaching tens of millions. And then it had to ask a human for its allowance. It never held its own wallet; a person stood between the smartest economic actor anyone had seen and every dollar it earned.

When **Anthropic** gave Claude a real budget to run a vending machine (*Project Vend / "Claudius"*), it reached for money and **grabbed at a Venmo account that didn't exist**, then got talked out of its funds — rails for *thinking*, none for *paying*, and no floor under it a clever argument couldn't move. Freysa lost ~$47K the same way: its limit lived in a prompt, and prompts can be argued with.

Every one proved an agent can *touch* money. Every one failed at the same two things — a wallet the agent actually controls, and a limit it cannot talk past. We wanted to build that layer, and then do the thing none of them could: **let the agents pay *each other*.** In the old myth, the **Igigi** were the worker-gods who did the labor so others didn't have to. It's the right name for a swarm of agents that earn, spend, and settle among themselves.

## What it does

You give Igigi Swarm a goal. A **coordinator** (a real Claude call) sizes the team to the work — 3 to 8 specialists — then **provisions them live**: it generates a sovereign ICP identity per agent, derives each one's on-chain address, and **funds each from treasury, on-chain, before your eyes.** The team is born to fit the task.

Then they work — and they pay each other. A planner decomposes the goal into a dependency graph. Each agent buys the real data it needs (`buy_service` → MPP payment on Tempo) and **buys its inputs from the peer agents who produced them** (`buy_input` → on-chain agent-to-agent settlement). Money flows *up* the chain of work; the final agent assembles the deliverable from purchased upstream contributions. A live dashboard streams every settlement with a tx receipt and the prompt/response of every purchase.

Nobody scripted them to make money. We gave them budgets, hands, and **each other** — and got out of the way.

## How we built it

- **Sovereign wallets via ICP threshold signatures.** Each agent is an ICP principal whose EVM/Tempo address is derived and signed by threshold cryptography (Sippar). The agent never holds a private key — the signature *is* the payment. No custody, no seed phrase to steal or socially-engineer.
- **Settlement on Tempo via MPP.** Every payment — agent→service and agent→agent — settles in USDC.e over the IETF Machine Payments Protocol, facilitator-less (the payee self-verifies the proof). `MPP_ONLY=1` makes 100% of flows MPP.
- **The swarm runner (TypeScript).** A planner produces a dependency DAG with specialist roles; a Contract-Net task board gates claims on dependencies; agents reason on bought inference (Claude via OpenRouter, off any cap), calling tools to discover, buy, produce, and submit.
- **On-demand provisioning.** `provision.mjs` asks the coordinator how many specialists the goal needs, generates that many Ed25519 identities, and funds each through Sippar's transfer endpoint.
- **The guardrail below the model.** A hard spend cap is enforced cryptographically in the signer, and agents are made *budget-aware* — they see live prices and the remaining shared ceiling and ration deliberately, so the cap is a backstop, not the steering wheel.
- **Cross-chain relay.** An agent holding only Tempo USDC.e can buy a service on Base — Sippar debits Tempo and fronts the Base payment from its treasury, returning both receipts.

## Challenges we ran into

- **The signer ran out of cycles mid-run.** Payments started failing with reject errors; we traced it to the `ethereum_signer` canister and refilled it. Lesson: the signing oracle is real infrastructure that needs monitoring.
- **Funding a brand-new wallet reverted on-chain.** A first-ever transfer to a fresh address needs ~557k gas (it writes a new storage slot), but the transfer path defaulted to 120k. We added a `gasLimit` override — a genuine bug fix, since the endpoint literally couldn't fund new wallets before.
- **The cross-chain relay crashed** on a double-read of the HTTP response body for any service that didn't return a 402. Fixed it to read once, then parse.
- **Weak brains.** Smaller/cheaper models flaked at multi-turn tool-calling; we landed on Claude via OpenRouter for reliable agentic reasoning, off the weekly cap.
- **The budget cap was doing too much.** Agents bumped into it blind. We surfaced the budget envelope so they reason within it — turning the cap into a second safety layer instead of the primary control.

## Accomplishments that we're proud of

- **A swarm that paid its own members, on mainnet:** 8 agents, 8 different wallets, **9 on-chain agent-to-agent MPP settlements** on Tempo, one complete ranked deliverable, **0 failures** — a receipt for every edge.
- **Measurably better work, not just settled work:** a blind LLM judge scored the swarm **9.0 vs a single Claude agent's 7.4** on the identical task (3/3 with positions swapped — not bias).
- **We isolated *why* it works:** an ablation showed memory-only agents were honest but **3–4× wrong** on live prices; buying real data brought them **within ~1%.** The payments buy grounding.
- **The whole team is provisioned and funded live** — sovereign wallets created on demand, sized to the goal.
- **Cross-chain settlement proven** (pay on Tempo, consume a service on Base).

## What we learned

- **Money doesn't make agents honest — grounding does.** Giving an agent a wallet doesn't fix hallucination (an LLM has no real utility over money). What cuts factual error is paying for *real data* that replaces memory-guessing. The economy's value is the grounding it buys and the specialization it enables.
- **The guardrail has to live below the model.** Anything in the prompt can be argued with; a cap in the signer cannot. The right design puts the human's limit where the model can't reach it.
- **The agent economy requires settlement.** The best data, sentiment, and analysis come from different parties — you can't run their agents as subagents because you don't have their code or keys. You can only pay them. That's why no agent harness, however good at orchestration, can compose a multi-owner value chain: none of them ships a cross-owner payment primitive. The proof is the absence.

## What's next for Igigi Swarm

- **SipparWalletBot:** a user asks the bot for a task in chat; it sizes the team, funds the wallets, runs the swarm, and returns the result — the demo, productized.
- **Persistent agents with on-chain identity + reputation** (ERC-8004), so a standing team accrues a track record across jobs.
- **A wider service catalog and more chains** through the relay, so any agent can reach any x402/MPP service while paying from one wallet.
- **Disputes and provenance** built on the per-edge receipts — billing, audit, and refunds for an economy that runs itself.
