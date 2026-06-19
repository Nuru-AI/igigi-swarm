/**
 * The task-economy board (SWARM_TASK_ECONOMY_SPEC.md) — the real collaboration fix.
 *
 * A dependency-gated DAG of subtasks. A task is claimable ONLY when every key it
 * consumes has been produced (completed) by some other task; claims are exclusive
 * with an expiry (kills duplicate work + self-heals a dead agent); an agent cannot
 * submit a task until it has BOUGHT every input that task consumes (the on-chain
 * payment is the binding award — Contract-Net). Gating logic mirrors CI's
 * task_checkin_checkout.py. Pure data structure — no SDK/network deps (testable).
 */

export interface Task {
  id: string;
  title: string;
  produces: string;       // unique output key this task creates
  consumes: string[];     // produces-keys of upstream tasks (inputs); [] = source task
  priceUSD: number;       // what a consumer pays the producer for this output
  role?: string;          // specialist job title for the agent awarded this task (CI-pattern)
}

type Status = 'open' | 'claimed' | 'completed';
interface BoardTask extends Task {
  status: Status;
  assignee?: string;      // the agent this task is awarded to (CNP award / delegation)
  firstReadyAt?: number;  // when it first became claimable (deps met) — for the fallback
  claimedBy?: string;
  claimExpiry?: number;   // ms epoch
  producerLabel?: string;
  producerAddr?: string;
  output?: string;
}

export class TaskBoard {
  private tasks: BoardTask[];
  private bought = new Map<string, Set<string>>(); // agent label -> produces-keys it paid for
  readonly ttlMs: number;
  readonly fallbackMs: number; // a ready task an assignee hasn't taken can be claimed by anyone after this

  constructor(plan: Task[], ttlMs = 5 * 60 * 1000, fallbackMs = 2 * 60 * 1000) {
    this.tasks = plan.map((t) => ({ ...t, status: 'open' as Status }));
    this.ttlMs = ttlMs;
    this.fallbackMs = fallbackMs;
  }

  /** Award a task to an agent (round-robin in the runner). Only the assignee may claim
   *  it — until the fallback window elapses, so a dead assignee can't deadlock downstream. */
  assign(id: string, agentLabel: string): void {
    const t = this.tasks.find((x) => x.id === id);
    if (t) t.assignee = agentLabel;
  }
  /** Can `agent` take task `t` right now (assignment + fallback)? */
  private mayTake(t: BoardTask, agent: string, now: number): boolean {
    if (!t.assignee || t.assignee === agent) return true;
    return t.firstReadyAt != null && now - t.firstReadyAt > this.fallbackMs; // fallback for a stalled assignee
  }

  private completedKeys(): Set<string> {
    return new Set(this.tasks.filter((t) => t.status === 'completed').map((t) => t.produces));
  }
  private depsMet(t: BoardTask, done: Set<string>): boolean {
    return t.consumes.every((k) => done.has(k));
  }
  private cleanup(now: number): void {
    for (const t of this.tasks) {
      if (t.status === 'claimed' && t.claimExpiry && now > t.claimExpiry) {
        t.status = 'open'; t.claimedBy = undefined; t.claimExpiry = undefined;
      }
    }
  }

  /** Stamp firstReadyAt on every task whose deps are now met (drives the fallback window). */
  private refreshReady(now: number, done: Set<string>): void {
    for (const t of this.tasks) if (t.status === 'open' && this.depsMet(t, done) && t.firstReadyAt == null) t.firstReadyAt = now;
  }

  /** Tasks `agent` can claim right now: open + inputs produced + awarded to it (or fallback). */
  listOpen(agent?: string, now = Date.now()) {
    this.cleanup(now);
    const done = this.completedKeys();
    this.refreshReady(now, done);
    return this.tasks
      .filter((t) => t.status === 'open' && this.depsMet(t, done) && (agent == null || this.mayTake(t, agent, now)))
      .map((t) => ({
        id: t.id, title: t.title, role: t.role, produces: t.produces, consumes: t.consumes, priceUSD: t.priceUSD,
        buy_inputs: t.consumes, // keys to buy_input before submit
      }));
  }

  claim(agent: string, id: string, now = Date.now()): { ok: boolean; error?: string } {
    this.cleanup(now);
    this.refreshReady(now, this.completedKeys());
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return { ok: false, error: `no task ${id}` };
    if (t.status === 'completed') return { ok: false, error: `task ${id} already completed` };
    if (t.status === 'claimed' && t.claimedBy !== agent) return { ok: false, error: `task ${id} is claimed by ${t.claimedBy}` };
    if (!this.depsMet(t, this.completedKeys())) return { ok: false, error: `task ${id} has unmet inputs: ${t.consumes.join(', ')}` };
    if (!this.mayTake(t, agent, now)) return { ok: false, error: `task ${id} is awarded to ${t.assignee} — work your own assigned tasks` };
    t.status = 'claimed'; t.claimedBy = agent; t.claimExpiry = now + this.ttlMs;
    return { ok: true };
  }

  /** The completed producer of a key (to pay + read its output), or null. */
  inputFor(key: string): { id: string; producerLabel?: string; producerAddr?: string; priceUSD: number; output?: string } | null {
    const t = this.tasks.find((x) => x.produces === key && x.status === 'completed');
    return t ? { id: t.id, producerLabel: t.producerLabel, producerAddr: t.producerAddr, priceUSD: t.priceUSD, output: t.output } : null;
  }

  recordPurchase(agent: string, key: string): void {
    if (!this.bought.has(agent)) this.bought.set(agent, new Set());
    this.bought.get(agent)!.add(key);
  }

  submit(agent: string, id: string, output: string, producerAddr: string): { ok: boolean; error?: string } {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return { ok: false, error: `no task ${id}` };
    if (t.claimedBy !== agent) return { ok: false, error: `task ${id} is not yours (claimed by ${t.claimedBy ?? 'nobody'})` };
    if (t.status === 'completed') return { ok: false, error: `task ${id} already completed` };
    const bought = this.bought.get(agent) ?? new Set<string>();
    const missing = t.consumes.filter((k) => !bought.has(k));
    if (missing.length) return { ok: false, error: `buy your inputs first (buy_input): missing ${missing.join(', ')}` };
    t.status = 'completed'; t.output = output; t.producerLabel = agent; t.producerAddr = producerAddr; t.claimExpiry = undefined;
    return { ok: true };
  }

  remaining(now = Date.now()): number { this.cleanup(now); return this.tasks.filter((t) => t.status !== 'completed').length; }
  allDone(): boolean { return this.tasks.every((t) => t.status === 'completed'); }
  /** The deliverable: the task whose output nothing else consumes. */
  sink(): BoardTask | undefined {
    const consumed = new Set(this.tasks.flatMap((t) => t.consumes));
    return this.tasks.find((t) => !consumed.has(t.produces));
  }
  snapshot() { return this.tasks.map((t) => ({ id: t.id, produces: t.produces, status: t.status, by: t.producerLabel ?? null })); }
}

/** Validate a planner's DAG: unique produces, all consumes produced, acyclic. */
export function validatePlan(tasks: Task[]): { ok: boolean; error?: string } {
  if (!tasks.length) return { ok: false, error: 'no tasks' };
  const produced = new Map<string, number>();
  for (const t of tasks) produced.set(t.produces, (produced.get(t.produces) ?? 0) + 1);
  for (const [k, n] of produced) if (n > 1) return { ok: false, error: `key "${k}" produced by ${n} tasks (must be unique)` };
  for (const t of tasks) for (const k of t.consumes) if (!produced.has(k)) return { ok: false, error: `task ${t.id} consumes "${k}" which no task produces` };
  const byProduces = new Map(tasks.map((t) => [t.produces, t]));
  const state = new Map<string, number>(); // 0 unseen, 1 visiting, 2 done
  const visit = (t: Task): boolean => {
    if (state.get(t.id) === 1) return false; // cycle
    if (state.get(t.id) === 2) return true;
    state.set(t.id, 1);
    for (const k of t.consumes) { const p = byProduces.get(k); if (p && !visit(p)) return false; }
    state.set(t.id, 2); return true;
  };
  for (const t of tasks) if (!visit(t)) return { ok: false, error: 'dependency cycle detected' };
  return { ok: true };
}
