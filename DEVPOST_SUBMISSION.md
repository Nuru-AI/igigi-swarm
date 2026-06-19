## Inspiration

Truth Terminal proved an AI can earn a fortune. It spun up a memecoin, and roughly $1M flowed to it directly, with a token economy around it reaching tens of millions. Then it had to ask a human for its allowance. It never held its own wallet; a person stood between the smartest economic actor anyone had seen and every dollar it earned.

When Anthropic gave Claude a real budget to run a vending machine (Project Vend, "Claudius"), it reached for money and grabbed at a Venmo account that didn't exist, then got talked out of its funds. It had rails for thinking, not for paying. And no floor under it that a clever argument couldn't move. Freysa lost about $47K the same way: its spending limit lived in a prompt, and prompts can be argued with.

Every one of these proved an agent can touch money. Every one failed at the same two things: a wallet the agent actually controls, and a limit it cannot talk its way past. We wanted to build that layer, and then do the thing none of them could, which is let the agents pay each other. In the old myth, the Igigi were the worker-gods who did the labor so others didn't have to. It fits a swarm of agents that earn, spend, and settle among themselves.

## What it does

You give Igigi Swarm a goal. A coordinator (a real Claude call) sizes the team to the work, picking 3 to 8 specialists, then provisions them live: it generates a sovereign ICP identity per agent, derives each one's on-chain address, and funds each from treasury, on-chain, before your eyes. The team is built to fit the task.

Then they work, and they pay each other. A planner breaks the goal into a dependency graph. Each agent buys the real data it needs (`buy_service`, an MPP payment on Tempo) and buys its inputs from the peer agents who produced them (`buy_input`, an on-chain agent-to-agent settlement). Money flows up the chain of work, and the final agent assembles the deliverable from purchased upstream contributions. A live dashboard streams every settlement with a tx receipt and the prompt and response behind each purchase.

Nobody scripted them to make money. We gave them budgets, hands, and each other, and got out of the way.

## How we built it

Sovereign wallets via ICP threshold signatures. Each agent is an ICP principal whose Tempo address is derived and signed by threshold cryptography (Sippar). The agent never holds a private key, so the signature itself is the payment. No custody, no seed phrase to steal or socially-engineer.

Settlement on Tempo via MPP. Every payment, agent-to-service and agent-to-agent, settles in USDC.e over the IETF Machine Payments Protocol, facilitator-less: the payee verifies the proof itself. Setting `MPP_ONLY=1` keeps every flow on MPP.

The swarm runner, in TypeScript. A planner produces a dependency DAG with specialist roles; a task board gates each claim on its dependencies; agents reason on bought inference (Claude via OpenRouter, off any cap) and call tools to discover, buy, produce, and submit.

On-demand provisioning. `provision.mjs` asks the coordinator how many specialists the goal needs, generates that many Ed25519 identities, and funds each through Sippar's transfer endpoint.

A guardrail below the model. A hard spend cap is enforced in the signer, and agents see live prices and the budget they have left so they ration on their own. The cap catches them only if their reasoning fails.

Cross-chain relay. An agent holding only Tempo USDC.e can buy a service on Base. Sippar debits Tempo and fronts the Base payment from its treasury, returning both receipts.

## Challenges we ran into

The signer ran out of cycles mid-run. Payments started failing with reject errors, and we traced it to the `ethereum_signer` canister and refilled it. The signing oracle is real infrastructure that needs watching.

Funding a brand-new wallet reverted on-chain. A first-ever transfer to a fresh address needs about 557k gas because it writes a new storage slot, but the transfer path defaulted to 120k. We added a `gasLimit` override, which turned out to be a real bug fix: the endpoint couldn't fund new wallets at all before.

The cross-chain relay crashed on a double-read of the HTTP body for any service that didn't return a 402. We fixed it to read the body once, then parse.

Weak brains. Smaller, cheaper models flaked at multi-turn tool-calling, so we settled on Claude via OpenRouter for reliable agentic reasoning, off the weekly cap.

The budget cap was doing too much. Agents kept bumping into it blind, so we showed them the budget. Now they reason within it, and the cap is a second safety layer instead of the first.

## Accomplishments that we're proud of

A swarm that paid its own members, on mainnet: 8 agents, 8 different wallets, 9 on-chain agent-to-agent MPP settlements on Tempo, one complete deliverable, zero failures, with a receipt for every handoff.

Better work, measured. A blind LLM judge scored the swarm 9.0 against a single Claude agent's 7.4 on the same task, and 3 out of 3 with the two answers swapped, so it isn't presentation order.

We isolated why it works. An ablation showed memory-only agents were honest but 3 to 4 times wrong on live prices, while buying real data brought them within about 1%. The payments buy grounding.

The whole team is provisioned and funded live, sized to the goal. And we proved cross-chain settlement: pay on Tempo, consume a service on Base.

## What we learned

Money doesn't make agents honest; grounding does. Giving an agent a wallet doesn't fix hallucination, because a model has no real preference over money. What cuts factual error is paying for real data that replaces guessing from memory. The economy's value is the grounding it buys and the specialization it enables.

The guardrail has to live below the model. Anything in a prompt can be argued with; a cap in the signer cannot. Put the human's limit where the model can't reach it.

The agent economy needs settlement. The best data, sentiment, and analysis come from different parties, and you can't run their agents as subagents, because you don't have their code or their keys. You can only pay them. That is why no agent harness, however good at orchestration, can compose a value chain across owners: none of them has a cross-owner payment primitive. The proof is the absence.

## What's next for Igigi Swarm

SipparWalletBot. A user asks the bot for a task in chat; it sizes the team, funds the wallets, runs the swarm, and returns the result. The demo, productized.

Persistent agents with on-chain identity and reputation (ERC-8004), so a standing team builds a track record across jobs.

A wider service catalog and more chains through the relay, so any agent can reach any x402 or MPP service while paying from one wallet.

Disputes and provenance built on the per-edge receipts, for billing, audit, and refunds in an economy that runs itself.
