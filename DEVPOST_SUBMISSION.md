## Inspiration

Truth Terminal proved an AI can earn a fortune. It made a memecoin worth millions. Then it had to ask a human for its allowance, because it never held its own wallet.

When Anthropic gave Claude a budget to run a vending machine (Project Vend), the agent reached for money, invented a Venmo account that didn't exist, and got talked out of its funds. Every experiment so far proved an agent can earn or spend. Every one stopped at the same place: a wallet the agent actually controls, and a limit it can't argue past.

We built that layer, and then did the thing none of them could: let the agents pay each other. The Igigi were the worker-gods who did the labor so others didn't have to. It fits.

## What it does

You give Igigi Swarm a goal. A coordinator sizes the team to the work, picking 3 to 8 specialists, then provisions them live: a fresh on-chain wallet per agent, funded from treasury before your eyes.

Then they pay each other. A planner splits the goal into a dependency graph. Each agent buys the data it needs and buys its inputs from the peers who produced them, every payment settled in USDC over MPP on Tempo. Money flows up the chain of work to the agent that assembles the final answer, and a live dashboard shows every settlement with a receipt.

Nobody scripted them to make money. We gave them budgets, hands, and each other, and got out of the way.

## How we built it

Each agent is an ICP principal whose on-chain address is signed by threshold cryptography (Sippar). It never holds a private key, so the signature itself is the payment. No custody, no seed phrase.

Every payment settles in USDC.e over MPP on Tempo, facilitator-less: the payee verifies the proof. The swarm runner is TypeScript. A planner builds the task graph, a board gates each claim on its dependencies, and the agents reason with Claude (via OpenRouter) to discover, buy, produce, and submit. The spend cap lives in the signer, below the model, and agents also see the budget they have left so they ration on their own.

## Challenges we ran into

The hard part wasn't the plumbing. It was the ideas.

One agent paying another agent it doesn't own had no precedent. No agent framework ships a way to do it, so we had to build the primitive instead of calling one.

We assumed giving agents money would make them behave. It didn't. So we ran an experiment to find out what actually changes their output, and the answer surprised us (see below).

And the budget cap started as a wall the agents kept hitting blind. We had to turn it into something they reason with, so the hard limit became a backstop rather than the steering wheel.

## Accomplishments that we're proud of

On mainnet: 8 agents, 8 wallets, 9 agent-to-agent settlements on Tempo, one finished deliverable, zero failures, with a receipt for every handoff.

A blind judge scored the swarm 9.0 against a single agent's 7.4 on the same task, and 3 out of 3 with the answers swapped.

And we proved where the quality comes from. With its data feeds turned off, the swarm was honest but 3 to 4 times wrong on live prices. With them on, it landed within about 1%. The payments buy real facts.

## What we learned

Money doesn't make agents honest; paying for real data does. A wallet alone doesn't fix hallucination, because a model has no real preference over money. What cuts the errors is grounding.

The guardrail has to live below the model. Anything in a prompt can be argued with. A cap in the signer can't.

And the agent economy needs settlement. The best data and analysis come from different parties, and you can't run their agents as subagents, because you don't have their code or their keys. You can only pay them. No framework can do that, which is exactly the gap we fill.

## What's next for Igigi Swarm

SipparWalletBot: ask a bot for a task in chat, and it sizes the team, funds the wallets, runs the swarm, and hands back the result.

Persistent agents with on-chain identity and reputation, so a standing team builds a track record across jobs.

More services and more chains through Sippar's relay, so any agent can reach any service while paying from a single wallet.
