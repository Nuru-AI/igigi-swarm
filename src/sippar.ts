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
import { VERIFIED_SERVICES, type Service } from './services.js';

const SIPPAR_BASE = process.env.SIPPAR_BASE_URL || 'https://sippar.network';
const ACCESS = process.env.SIPPAR_ACCESS_TOKEN || '';

export interface PayResult {
  success: boolean;
  service: string;
  amountPaid: number;
  chain?: string;
  tx?: string;
  response?: unknown;
  error?: string;
}

export class Sippar {
  constructor(private readonly budget: Budget) {}

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

    // 1. HARD CAP — below the agent's reasoning. Throws if it would breach.
    try {
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
        body: JSON.stringify({ serviceUrl: svc.url, payload, maxAmountUSD: svc.price * 1.5, preferTempo: svc.chain === 'tempo' }),
      });
      const data: any = await res.json().catch(() => ({}));
      const amountPaid = Number(data?.amountPaid ?? 0);
      const ok = !!data?.success;
      if (ok) this.budget.commit(svc.id, amountPaid || svc.price, data?.paymentTx);
      return { success: ok, service: svc.id, amountPaid: amountPaid || svc.price, chain: data?.chain, tx: data?.paymentTx, response: data?.response, error: data?.error };
    } catch (e) {
      return { success: false, service: svc.id, amountPaid: 0, error: String((e as Error).message) };
    }
  }
}
