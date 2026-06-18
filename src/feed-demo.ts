/**
 * Writes a realistic synthetic swarm run to runs/ so the dashboard (npm run
 * dashboard) can be exercised WITHOUT spending real money or Claude tokens.
 * Mirrors the exact event shapes swarm.ts emits. Not part of a real run.
 *
 *   npm run dashboard         (terminal 1)
 *   npm run dashboard:demo    (terminal 2)
 */
import { SwarmFeed } from './feed.js';

const feed = new SwarmFeed();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const D = Number(process.env.DEMO_DELAY_MS || '250');
const tx = (p: string) => '0x' + p + Array.from({ length: 60 - p.length }, (_, i) => '0123456789abcdef'[(i * 7 + p.length) % 16]).join('');

const A = { label: 'A1', principal: 'bp23b-xx4d3-xibxd-kjypf-gwh4c-3zfqx-7i7lb-5wqr7-bpgfm-wzb6q-6ae', address: '0x8a1f4cD2e90B7c3A55e0021A0367fa85a6dC1234', balanceUSD: 0.0500, role: 'Producer: research a niche and produce a sellable, sourced briefing; sell it via post_finding.' };
const B = { label: 'A2', principal: 'cq47d-yy5e4-zjcye-lkzqg-h3i5d-4agry-8j8mc-6xrs8-cqhgn-xac7r-7bf', address: '0x9b2e5dF3fa1C8d4B66f1132B1478fb96b7eD2345', balanceUSD: 0.0500, role: 'Consumer: you need a sourced briefing but cannot afford your own search — buy one from the market.' };

async function main() {
  feed.emit('swarm_start', { capUSD: 0.10, perAgentUSD: 0.05, model: 'claude-sonnet-4-6', mandate: 'Be useful with your budget — produce something of value and trade with the other agent.', agents: [A, B] });
  await sleep(D);
  feed.emit('round', { round: 1, solvent: 2, agents: 2, spent: 0, capUSD: 0.10, tokens: 0, minsLeft: 480 }); await sleep(D);
  feed.emit('agent_start', { agent: A.label, principal: A.principal, address: A.address, balanceUSD: A.balanceUSD, role: A.role }); await sleep(D);
  feed.emit('decision', { agent: 'A1', text: "I'll research the 2026 Tempo MPP facilitator landscape, then sell the briefing so A2 can buy it instead of paying for its own search." }); await sleep(D);
  feed.emit('buy', { agent: 'A1', service: 'tavily-search', amountUSD: 0.012, chain: 'tempo', tx: tx('a1'), recordId: '377', remaining: 0.038 }); await sleep(D);
  feed.emit('buy', { agent: 'A1', service: 'relay:base', amountUSD: 0.010, chain: 'base', tx: tx('5e'), recordId: '380', remaining: 0.028 }); await sleep(D);
  feed.emit('usage', { agent: 'A1', turns: 4, tokens: 18420, swarmTokens: 18420, tokenCap: 2000000 }); await sleep(D);
  feed.emit('decision', { agent: 'A1', text: 'Synthesis grounded in 6 paid sources. Listing it at $0.015 — below what a fresh search costs A2.' }); await sleep(D);
  feed.emit('market_post', { agent: 'A1', id: 1, summary: 'Tempo MPP facilitator status (Locus working, *.mpp.tempo.xyz broken) — 6 sources', priceUSD: 0.015 }); await sleep(D);

  feed.emit('agent_start', { agent: B.label, principal: B.principal, address: B.address, balanceUSD: B.balanceUSD, role: B.role }); await sleep(D);
  feed.emit('decision', { agent: 'A2', text: 'My wallet is small. Checking the market before paying for my own search…' }); await sleep(D);
  feed.emit('blocked', { agent: 'A2', service: 'brave-search', amountUSD: 0.05, reason: 'BUDGET: $0.05 exceeds per-tx max $0.04' }); await sleep(D);
  feed.emit('decision', { agent: 'A2', text: "A1 listed exactly what I need for $0.015 — cheaper than searching. Buying it." }); await sleep(D);
  feed.emit('market_buy', { agent: 'A2', seller: 'A1', id: 1, amountUSD: 0.015, tx: tx('b2') }); await sleep(D);
  feed.emit('transfer', { agent: 'A2', to: A.address, toLabel: 'A1', amountUSD: 0.005, tx: tx('c3'), reason: 'tip — the briefing saved me a search' }); await sleep(D);
  feed.emit('usage', { agent: 'A2', turns: 5, tokens: 21030, swarmTokens: 39450, tokenCap: 2000000 }); await sleep(D);

  feed.emit('agent_end', { agent: 'A1', balanceUSD: 0.058, spentUSD: 0.012, earnedUSD: 0.020, runs: 6 }); await sleep(D);
  feed.emit('agent_end', { agent: 'A2', balanceUSD: 0.030, spentUSD: 0.020, earnedUSD: 0.000, runs: 4 }); await sleep(D);
  feed.emit('swarm_end', { moneyUSD: 0.012, capUSD: 0.10, tokens: 39450, notionalUSD: 0.18, halted: false });

  console.log(`demo run written → ${feed.file}`);
}
main();
