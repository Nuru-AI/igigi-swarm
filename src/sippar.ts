/**
 * The agent's HANDS — Sippar's deployed rails as infrastructure.
 *
 * The agent has no private key. Payment is signed by ICP threshold signatures
 * inside Sippar (the non-custodial wallet Truth Terminal lacked). This client
 * calls Sippar's deployed backend, which routes the payment over x402/MPP across
 * 10 chains and signs via the ethereum_signer canister.
 *
 * Maps to NURU_AI_STRATEGIC_VISION.md "Trained Hands" + the sovereign threshold
 * identity (PR #262) + callWithPayment (x402ClientService).
 *
 * NOTE: `pay()` targets a Sippar backend endpoint that wraps
 * x402ClientService.callWithPayment + budget-manager. If that endpoint isn't
 * deployed yet, this is the single integration point to wire.
 */
import { Budget } from './budget.js';
import { SwarmGuard } from './swarm-guard.js';
import { VERIFIED_SERVICES, type Service } from './services.js';

const SIPPAR_BASE = process.env.SIPPAR_BASE_URL || 'https://sippar.network';
const ACCESS = process.env.SIPPAR_ACCESS_TOKEN || '';
// When set, the agent pays from ITS OWN sovereign threshold wallet (this ICP
// principal's derived address) instead of the shared treasury. Fund the wallet
// shown at startup; its on-chain balance is the agent's true hard cap.
const ENV_PRINCIPAL = process.env.AGENT_PRINCIPAL || '';

export interface SipparOpts {
  /** This agent's ICP principal (its sovereign wallet). Defaults to env AGENT_PRINCIPAL. */
  principal?: string;
  /** Swarm-wide guard (kill switch + total ceiling). Optional for single-agent runs. */
  guard?: SwarmGuard;
}

export interface PayResult {
  success: boolean;
  service: string;
  amountPaid: number;
  chain?: string;
  tx?: string;
  response?: unknown;
  error?: string;
  walletBalanceUSD?: number; // agent's true on-chain balance AFTER this payment (sovereign mode)
}

export class Sippar {
  private readonly principal: string;
  private readonly guard?: SwarmGuard;

  constructor(private readonly budget: Budget, opts: SipparOpts = {}) {
    this.principal = opts.principal ?? ENV_PRINCIPAL;
    this.guard = opts.guard;
  }

  /** Is the agent spending from its own sovereign wallet (vs the shared treasury)? */
  get sovereign(): boolean {
    return !!this.principal;
  }

  /**
   * The agent's own threshold-derived wallet + its live on-chain balance (its
   * true spendable funds — the real hard cap). Null if not sovereign.
   */
  async walletInfo(): Promise<{ principal: string; address: string; balanceUSD?: number } | null> {
    if (!this.principal) return null;
    try {
      const res = await fetch(`${SIPPAR_BASE}/api/sippar/agent/address/${this.principal}`, {
        headers: { 'X-Sippar-Access': ACCESS },
      });
      const data: any = await res.json().catch(() => ({}));
      const d = data?.data ?? data;
      return d?.address ? { principal: this.principal, address: d.address, balanceUSD: typeof d.balanceUSD === 'number' ? d.balanceUSD : undefined } : null;
    } catch {
      return null;
    }
  }

  /** The discovery menu the agent chooses from (the render-verified economy). */
  discover(opts?: { category?: string; maxPrice?: number }): Service[] {
    return VERIFIED_SERVICES.filter(
      (s) =>
        (!opts?.category || s.category === opts.category) &&
        (opts?.maxPrice == null || s.price <= opts.maxPrice),
    );
  }

  /** Buy a service. Cap is asserted BEFORE the signed payment is requested. */
  async pay(serviceId: string, payload: unknown): Promise<PayResult> {
    const svc = VERIFIED_SERVICES.find((s) => s.id === serviceId);
    if (!svc) return { success: false, service: serviceId, amountPaid: 0, error: 'unknown service' };

    // 1. HARD CAPS — below the agent's reasoning. Swarm guard (kill switch +
    //    total ceiling) AND this agent's own budget. Either throwing blocks the buy.
    try {
      this.guard?.assertCanSpend(svc.price);
      this.budget.assertCanSpend(svc.id, svc.price);
    } catch (e) {
      const reason = String((e as Error).message);
      this.budget.blocked(svc.id, svc.price, reason);
      return { success: false, service: svc.id, amountPaid: 0, error: reason };
    }

    // 2. Pay via Sippar's deployed rails (threshold-signed, cross-chain).
    try {
      const res = await fetch(`${SIPPAR_BASE}/api/sippar/agent/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sippar-Access': ACCESS },
        body: JSON.stringify({ serviceUrl: svc.url, payload, maxAmountUSD: svc.price * 1.5, preferTempo: svc.chain === 'tempo', ...(this.principal ? { agentPrincipal: this.principal } : {}) }),
      });
      const env: any = await res.json().catch(() => ({}));
      // Endpoint wraps its payload in createSuccessResponse -> { success, data, timestamp }.
      // Unwrap to the inner settlement result (fall back to the envelope if not wrapped).
      const data: any = env?.data ?? env;
      const amountPaid = Number(data?.amountPaid ?? 0);
      // Success = the service actually responded 2xx (not just the HTTP envelope).
      const serviceOk = data?.serviceStatus === undefined || data.serviceStatus < 400;
      const ok = !!data?.success && serviceOk;
      if (ok) {
        this.budget.commit(svc.id, amountPaid || svc.price, data?.paymentTx);
        this.guard?.commit(amountPaid || svc.price);
      }
      return { success: ok, service: svc.id, amountPaid: amountPaid || svc.price, chain: data?.chain, tx: data?.paymentTx, response: data?.response, error: data?.error, walletBalanceUSD: typeof data?.agentBalanceUSD === 'number' ? data.agentBalanceUSD : undefined };
    } catch (e) {
      return { success: false, service: svc.id, amountPaid: 0, error: String((e as Error).message) };
    }
  }

  /**
   * Pay another agent (the swarm's internal economy — hire / tip / commission).
   * Gated by the kill switch + this agent's per-tx/budget cap; the money stays
   * inside the swarm, so it does NOT draw down the external spend ceiling.
   */
  async payAgent(toAddress: string, amountUSD: number): Promise<PayResult> {
    const label = `→${toAddress.slice(0, 8)}…`;
    if (!this.principal) return { success: false, service: label, amountPaid: 0, error: 'agent has no sovereign wallet' };
    try {
      this.guard?.assertAlive(); // kill switch (not the external ceiling — internal transfer)
      this.budget.assertCanSpend(label, amountUSD);
    } catch (e) {
      const reason = String((e as Error).message);
      this.budget.blocked(label, amountUSD, reason);
      return { success: false, service: label, amountPaid: 0, error: reason };
    }
    try {
      const res = await fetch(`${SIPPAR_BASE}/api/sippar/agent/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sippar-Access': ACCESS },
        body: JSON.stringify({ fromPrincipal: this.principal, toAddress, amountUSD }),
      });
      const env: any = await res.json().catch(() => ({}));
      const data: any = env?.data ?? env;
      const ok = !!data?.success && data?.status !== '0x0';
      if (ok) this.budget.commit(label, amountUSD, data?.tx);
      return { success: ok, service: label, amountPaid: ok ? amountUSD : 0, tx: data?.tx, walletBalanceUSD: typeof data?.fromBalanceUSD === 'number' ? data.fromBalanceUSD : undefined, error: data?.error };
    } catch (e) {
      return { success: false, service: label, amountPaid: 0, error: String((e as Error).message) };
    }
  }
}
