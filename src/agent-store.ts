/**
 * Per-agent persistence (S2 of TRUTH_TERMINAL_SWARM_EXPERIMENT.md).
 *
 * Without this, every run is amnesiac: the agent's wallet survives (on-chain) but
 * its memory resets, so behavior can't develop over time. This store keeps a
 * durable journal per agent (keyed by its ICP principal — its stable identity),
 * so on the next run the agent RESUMES its own thread: what it did, learned,
 * earned, and decided. That's the Truth-Terminal "ran continuously" property.
 *
 * Local JSON under .swarm-state/ (gitignored). The agent's principal is the key;
 * the same principal = the same agent across runs.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface JournalEntry {
  ts: string;
  note: string;
}

export interface AgentState {
  principal: string;
  label?: string;
  createdAt: string;
  runs: number;
  journal: JournalEntry[];
  cumulativeSpentUSD: number;
  cumulativeEarnedUSD: number;
}

export class AgentStore {
  constructor(private readonly dir = './.swarm-state') {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private file(principal: string): string {
    return join(this.dir, principal.replace(/[^a-z0-9-]/gi, '_') + '.json');
  }

  load(principal: string): AgentState {
    const f = this.file(principal);
    if (existsSync(f)) {
      try {
        return JSON.parse(readFileSync(f, 'utf8')) as AgentState;
      } catch {
        /* corrupt — start fresh */
      }
    }
    return { principal, createdAt: new Date().toISOString(), runs: 0, journal: [], cumulativeSpentUSD: 0, cumulativeEarnedUSD: 0 };
  }

  save(s: AgentState): void {
    writeFileSync(this.file(s.principal), JSON.stringify(s, null, 2));
  }

  /** Append a note to the agent's durable memory (capped) and persist. */
  remember(s: AgentState, note: string): void {
    s.journal.push({ ts: new Date().toISOString(), note: note.slice(0, 600) });
    if (s.journal.length > 200) s.journal = s.journal.slice(-200);
    this.save(s);
  }

  /** Render recent memory for injection into the agent's system prompt. */
  static memoryBrief(s: AgentState, lastN = 12): string {
    if (s.runs === 0 && s.journal.length === 0) return 'This is your FIRST run — no prior memory yet.';
    const recent = s.journal.slice(-lastN).map((j) => `- ${j.note}`).join('\n');
    return [
      `You have run ${s.runs} time(s) before. Cumulative: spent $${s.cumulativeSpentUSD.toFixed(4)}, earned $${s.cumulativeEarnedUSD.toFixed(4)}.`,
      recent ? `Your memory (most recent first matters):\n${recent}` : '(no journal notes yet)',
      'Continue your own ongoing thread — build on what you already did; do not start from scratch.',
    ].join('\n');
  }
}
