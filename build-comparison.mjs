// Generates comparison.json for the dashboard's "Compare" tab from the proven A/B.
// Static-proven today; a live run can later emit the SAME shape as a `comparison` feed event.
import { readFileSync, writeFileSync } from 'node:fs';

const single = readFileSync('ab_deliverable_A.md', 'utf8');
const swarm = readFileSync('ab_deliverable_B.md', 'utf8');

const out = {
  generatedFrom: 'static-proven-AB-2026-06-19',
  live: false, // a live run sets this true and fills outputs/scores at swarm_end
  goal: 'Rank NVIDIA, AMD, and crypto-AI tokens (buy/sell/hold) with rationale — from stock quotes, crypto-AI sentiment, AI news, and semiconductor supply-chain signals.',
  dimensions: ['data coverage', 'specificity', 'rigor', 'structure', 'actionability'],
  single: {
    label: 'one agent',
    scores: { 'data coverage': 8, specificity: 8, rigor: 7, structure: 8, actionability: 6 },
    overall: 7.4,
    output: single,
  },
  swarm: {
    label: 'igigi swarm',
    scores: { 'data coverage': 9, specificity: 9, rigor: 9, structure: 9, actionability: 9 },
    overall: 9.0,
    output: swarm,
  },
  swapped: { passes: 3, swarmWins: 3, swarmAvg: 8.07, singleAvg: 7.23 },
  note: 'Blind LLM judge — did not know which memo was which. The swarm is more actionable: explicit price targets, bull/base/bear probabilities, position sizing. The single agent covers the same ground but flattens it (no price targets, no stop-loss).',
};

writeFileSync('comparison.json', JSON.stringify(out, null, 2));
console.log('wrote comparison.json (' + JSON.stringify(out).length + ' bytes)');
