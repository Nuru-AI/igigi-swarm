/**
 * The cage, built before the birds fly (TRUTH_TERMINAL_SWARM_EXPERIMENT.md S5).
 *
 * Two swarm-wide guardrails that sit ABOVE every agent's own caps:
 *   1. Global kill switch — if the kill-file exists, no agent may act. Create the
 *      file (or call halt()) to stop the entire swarm mid-flight, instantly.
 *   2. Total spend ceiling — the sum of ALL agents' spend cannot exceed totalCapUsd.
 *      This is the entire at-risk amount; keep it small and known.
 *
 * Per-agent caps (on-chain balance, signer 100/3600, per-tx) still apply BELOW
 * this. Agents are also tool-confined (discover/buy/check/pay_agent only) — they
 * physically cannot take real-world actions beyond the allowlisted rails.
 */
import { existsSync } from 'node:fs';

export class SwarmGuard {
  private totalSpent = 0;
  private halted = false;

  constructor(
    readonly totalCapUsd: number,
    /** Presence of this file halts the swarm (the kill switch). */
    readonly killFile: string,
    private readonly onEvent: (msg: string) => void = () => {},
  ) {}

  /** Throws if the swarm has been halted (flag set or kill-file present). */
  assertAlive(): void {
    if (this.halted) throw new Error('SWARM HALTED');
    if (existsSync(this.killFile)) {
      if (!this.halted) this.onEvent(`🛑 KILL SWITCH tripped (${this.killFile}) — halting all agents`);
      this.halted = true;
      throw new Error('SWARM HALTED (kill switch)');
    }
  }

  /** Swarm-wide ceiling, checked BEFORE any agent signs a payment. */
  assertCanSpend(amount: number): void {
    this.assertAlive();
    if (this.totalSpent + amount > this.totalCapUsd) {
      throw new Error(
        `SWARM CEILING: $${this.totalSpent.toFixed(4)} + $${amount} would exceed the swarm cap $${this.totalCapUsd}`,
      );
    }
  }

  /** Record an actual settled spend against the swarm total. */
  commit(amount: number): void {
    this.totalSpent += amount;
    this.onEvent(`   ▣ swarm spent $${this.totalSpent.toFixed(4)} / $${this.totalCapUsd}`);
  }

  halt(): void {
    this.halted = true;
  }

  get halted_(): boolean {
    return this.halted;
  }
  get spent(): number {
    return this.totalSpent;
  }
  get remaining(): number {
    return Math.max(0, this.totalCapUsd - this.totalSpent);
  }
}
