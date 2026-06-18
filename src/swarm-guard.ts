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
  private tokensIn = 0;
  private tokensOut = 0;
  private notionalCostUsd = 0; // what the reasoning WOULD cost via API (we're on subscription)

  private failStreak = 0;

  constructor(
    readonly totalCapUsd: number,
    /** Presence of this file halts the swarm (the kill switch). */
    readonly killFile: string,
    private readonly onEvent: (msg: string) => void = () => {},
    /** Compute ceiling: halt the swarm if total Claude tokens exceed this. */
    readonly tokenCap: number = Infinity,
    /** Unattended watchdog: halt after this many CONSECUTIVE failed payments
     *  (a broken-service loop, dead RPC, signer fault). Default: never. */
    readonly errorHaltStreak: number = Infinity,
  ) {}

  /**
   * Record a payment outcome for the unattended error-streak watchdog. A run of
   * consecutive failures (no successes in between) means something is wrong that
   * no human is watching at 3am — halt rather than burn the night on it.
   */
  recordOutcome(ok: boolean): void {
    if (ok) { this.failStreak = 0; return; }
    this.failStreak++;
    if (this.failStreak >= this.errorHaltStreak) {
      this.onEvent(`🛑 ERROR STREAK — ${this.failStreak} consecutive failed payments; halting swarm`);
      this.halted = true;
    }
  }

  get failureStreak(): number {
    return this.failStreak;
  }

  /** Non-throwing kill check (for the between-rounds pause): trips on flag OR kill-file. */
  tripped(): boolean {
    if (this.halted) return true;
    if (existsSync(this.killFile)) {
      this.onEvent(`🛑 KILL SWITCH tripped (${this.killFile}) — halting swarm`);
      this.halted = true;
      return true;
    }
    return false;
  }

  /** Record an agent's Claude usage (from the SDK result message). May trip the token ceiling. */
  recordUsage(inputTokens: number, outputTokens: number, costUsd: number): void {
    this.tokensIn += inputTokens;
    this.tokensOut += outputTokens;
    this.notionalCostUsd += costUsd;
    if (this.tokens > this.tokenCap) {
      this.onEvent(`🛑 TOKEN CEILING — ${this.tokens} tokens > cap ${this.tokenCap}; halting swarm`);
      this.halted = true;
    }
  }

  get tokens(): number {
    return this.tokensIn + this.tokensOut;
  }
  get usageSummary(): { tokensIn: number; tokensOut: number; tokens: number; notionalCostUsd: number } {
    return { tokensIn: this.tokensIn, tokensOut: this.tokensOut, tokens: this.tokens, notionalCostUsd: this.notionalCostUsd };
  }

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
