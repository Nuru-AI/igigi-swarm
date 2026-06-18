/**
 * S3 — swarm observability. A structured, append-only event feed of EVERYTHING
 * the swarm does: per-agent balances, every buy + counterparty + on-chain tx,
 * every transfer, every market post/buy, every decision rationale, blocks, usage.
 *
 * The swarm process WRITES this (one JSON object per line) to runs/swarm-<ts>.jsonl.
 * The dashboard server (dashboard-server.ts) TAILS the newest run file and streams
 * it to the live dashboard over SSE — so one screen shows all agents draining +
 * their buys/transfers streaming with explorer links (the Project-Vend appeal).
 *
 * File-only + decoupled on purpose: the viewer can attach mid-run or replay a past
 * run, and a viewer crash never touches the swarm.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type FeedKind =
  | 'swarm_start' | 'agent_start' | 'decision' | 'buy' | 'blocked'
  | 'transfer' | 'market_post' | 'market_buy' | 'usage' | 'agent_end' | 'swarm_end'
  | 'round';

export interface FeedEvent {
  seq: number;
  t: string;            // ISO timestamp
  kind: FeedKind;
  agent?: string;       // agent label (e.g. "A1"), when agent-scoped
  [k: string]: unknown;
}

export class SwarmFeed {
  readonly file: string;
  private seq = 0;

  constructor(dir = 'runs', stamp = new Date().toISOString().replace(/[:.]/g, '-')) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `swarm-${stamp}.jsonl`);
    writeFileSync(this.file, ''); // create empty so the tailer can latch on
  }

  emit(kind: FeedKind, data: Record<string, unknown> = {}): void {
    const ev: FeedEvent = { seq: this.seq++, t: new Date().toISOString(), kind, ...data };
    try {
      appendFileSync(this.file, JSON.stringify(ev) + '\n');
    } catch {
      /* feed is observability only — never let it break the swarm */
    }
  }
}
