/**
 * The budget chokepoint — enforced BELOW the agent's reasoning.
 *
 * Lesson from Anthropic's Project Vend (Claudius gave money away) and Freysa
 * (agent social-engineered into a $47K transfer): a budget must be a hard limit
 * the agent cannot argue past, NOT a prompt instruction. Every purchase flows
 * through `reserve()` before any payment is signed; if it would exceed the cap,
 * it throws — the model never gets the chance to overspend.
 *
 * Maps to Sippar value #1 "Humans in Charge": the human sets the cap; the agent
 * lives inside it. (SIPS-VISION-AND-VALUES.md)
 */
export class Budget {
  private spent = 0;
  private readonly ledger: Array<{ service: string; amount: number; tx?: string; at: string }> = [];

  constructor(
    readonly capUsd: number,
    readonly perTxMaxUsd: number,
    private readonly onEvent: (e: BudgetEvent) => void = () => {},
  ) {}

  get remaining(): number {
    return Math.max(0, this.capUsd - this.spent);
  }

  /** Hard gate — call BEFORE signing/paying. Throws if it would breach the cap. */
  assertCanSpend(service: string, amount: number): void {
    if (amount > this.perTxMaxUsd) {
      throw new Error(`BUDGET: $${amount} for "${service}" exceeds per-tx max $${this.perTxMaxUsd}`);
    }
    if (this.spent + amount > this.capUsd) {
      throw new Error(`BUDGET: $${amount} for "${service}" would exceed cap (spent $${this.spent.toFixed(4)} / $${this.capUsd})`);
    }
  }

  /** Record an actual settled payment. */
  commit(service: string, amount: number, tx?: string): void {
    this.spent += amount;
    const entry = { service, amount, tx, at: new Date().toISOString() };
    this.ledger.push(entry);
    this.onEvent({ type: 'spent', ...entry, remaining: this.remaining, spent: this.spent });
  }

  blocked(service: string, amount: number, reason: string): void {
    this.onEvent({ type: 'blocked', service, amount, reason, remaining: this.remaining, spent: this.spent, at: new Date().toISOString() });
  }

  summary() {
    return { cap: this.capUsd, spent: this.spent, remaining: this.remaining, purchases: this.ledger.length, ledger: this.ledger };
  }
}

export type BudgetEvent =
  | { type: 'spent'; service: string; amount: number; tx?: string; at: string; remaining: number; spent: number }
  | { type: 'blocked'; service: string; amount: number; reason: string; at: string; remaining: number; spent: number };
