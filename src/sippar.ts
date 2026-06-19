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

// MPP_ONLY=1 restricts the agents' service menu to Tempo MPP services — so EVERY payment in the
// run (agent→service and agent→agent) settles on Tempo via MPP. Default: full cross-chain catalog.
const CATALOG: Service[] = process.env.MPP_ONLY === '1' ? VERIFIED_SERVICES.filter((s) => s.chain === 'tempo') : VERIFIED_SERVICES;

const SIPPAR_BASE = process.env.SIPPAR_BASE_URL || 'https://sippar.network';
const ACCESS = process.env.SIPPAR_ACCESS_TOKEN || '';
// When set, the agent pays from ITS OWN sovereign threshold wallet (this ICP
// principal's derived address) instead of the shared treasury. Fund the wallet
// shown at startup; its on-chain balance is the agent's true hard cap.
const ENV_PRINCIPAL = process.env.AGENT_PRINCIPAL || '';

/**
 * Search APIs return huge JSON that spills to a temp file the agent can't slice,
 * so it falls back to training memory and hallucinates (Run 1 failure mode).
 * Extract the REAL results (title/url/snippet) into a compact, consumable shape —
 * the actual sources a briefing needs — so synthesis is grounded in PAID data.
 * Handles Brave (data.web.results) and Tavily (data.results + answer).
 */
function compactSearchResponse(response: any): any {
  const d = response?.data ?? response;
  const raw = d?.results ?? d?.web?.results ?? [];
  const results = (Array.isArray(raw) ? raw : []).slice(0, 8).map((r: any) => ({
    title: r?.title,
    url: r?.url,
    snippet: String(r?.content ?? r?.description ?? r?.snippet ?? '').slice(0, 400),
  })).filter((r: any) => r.title || r.url);
  if (!results.length) return response; // unknown shape — leave as-is
  const out: any = { results };
  if (d?.answer) out.answer = d.answer; // Tavily's synthesized answer
  return out;
}

/** Pull human-readable text out of a service response for the dashboard Receipt tab. */
function extractResponseText(resp: any): string {
  if (resp == null) return '';
  const t = resp?.choices?.[0]?.message?.content ?? resp?.answer ?? resp?.data ?? resp;
  try { return typeof t === 'string' ? t : JSON.stringify(t); } catch { return String(t); }
}

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
  signingRecordId?: string;  // certified ICP threshold-signing record id (the "third receipt")
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
    return CATALOG.filter(
      (s) =>
        (!opts?.category || s.category === opts.category) &&
        (opts?.maxPrice == null || s.price <= opts.maxPrice),
    );
  }

  /** Buy a service. Cap is asserted BEFORE the signed payment is requested. */
  async pay(serviceId: string, payload: unknown): Promise<PayResult> {
    const svc = CATALOG.find((s) => s.id === serviceId);
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
        this.budget.commit(svc.id, amountPaid || svc.price, data?.paymentTx, data?.chain ?? svc.chain, data?.signingRecordId, {
          prompt: (() => { try { return JSON.stringify(payload).slice(0, 2000); } catch { return String(payload).slice(0, 2000); } })(),
          response: extractResponseText(data?.response).slice(0, 4000),
        });
        this.guard?.commit(amountPaid || svc.price);
      }
      this.guard?.recordOutcome(ok); // unattended error-streak watchdog
      const response = svc.category === 'search' ? compactSearchResponse(data?.response) : data?.response;
      return { success: ok, service: svc.id, amountPaid: amountPaid || svc.price, chain: data?.chain, tx: data?.paymentTx, response, error: data?.error, walletBalanceUSD: typeof data?.agentBalanceUSD === 'number' ? data.agentBalanceUSD : undefined, signingRecordId: data?.signingRecordId };
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
      if (ok) this.budget.commit(label, amountUSD, data?.tx, 'tempo');
      return { success: ok, service: label, amountPaid: ok ? amountUSD : 0, tx: data?.tx, walletBalanceUSD: typeof data?.fromBalanceUSD === 'number' ? data.fromBalanceUSD : undefined, error: data?.error };
    } catch (e) {
      return { success: false, service: label, amountPaid: 0, error: String((e as Error).message) };
    }
  }

  /**
   * Buy a service on ANOTHER chain via Sippar's cross-chain relay — the agent
   * stays 100% on Tempo. Sippar debits the agent's OWN Tempo wallet (USDC.e) to
   * the Sippar Tempo treasury, then pays the destination service from Sippar's
   * treasury on `destChain` (Base/Solana/Stellar/…). No funds on any other chain.
   * This is the correct relay model (S4) — pay local, Sippar fronts the dest.
   * Same caps as buy(); the relay's fee (~3%) is included in the debited amount.
   */
  async relayPay(
    serviceUrl: string,
    destChain: string,
    opts: { maxAmountUSD: number; payload?: unknown; method?: 'GET' | 'POST' },
  ): Promise<PayResult> {
    const label = `relay:${destChain}`;
    if (!this.principal) return { success: false, service: label, amountPaid: 0, error: 'agent has no sovereign wallet' };
    const maxAmountUSD = opts.maxAmountUSD || 0.05;
    try {
      this.guard?.assertCanSpend(maxAmountUSD);
      this.budget.assertCanSpend(label, maxAmountUSD);
    } catch (e) {
      const reason = String((e as Error).message);
      this.budget.blocked(label, maxAmountUSD, reason);
      return { success: false, service: label, amountPaid: 0, error: reason };
    }
    try {
      const res = await fetch(`${SIPPAR_BASE}/api/sippar/agent/relay-pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sippar-Access': ACCESS },
        body: JSON.stringify({
          agentPrincipal: this.principal,
          serviceUrl,
          destChain,
          maxAmountUSD,
          ...(opts.payload != null ? { payload: opts.payload } : {}),
          ...(opts.method ? { method: opts.method } : {}),
        }),
      });
      const env: any = await res.json().catch(() => ({}));
      const data: any = env?.data ?? env;
      const ok = !!data?.success && (data?.serviceStatus === undefined || data.serviceStatus < 400);
      // amountDebited = what left the agent's Tempo wallet (service cost + relay fee).
      const amt = Number(data?.amountDebitedUSD ?? data?.incomingAmountUSD ?? maxAmountUSD);
      const tx = data?.outgoingTx ?? data?.incomingTx; // dest-chain receipt preferred
      if (ok) {
        this.budget.commit(label, amt, tx, destChain, data?.signingRecordId);
        this.guard?.commit(amt);
      }
      this.guard?.recordOutcome(ok); // unattended error-streak watchdog
      return { success: ok, service: `relay:${destChain}`, amountPaid: ok ? amt : 0, chain: destChain, tx, response: data?.response, error: data?.error, walletBalanceUSD: typeof data?.agentBalanceUSD === 'number' ? data.agentBalanceUSD : undefined, signingRecordId: data?.signingRecordId };
    } catch (e) {
      return { success: false, service: label, amountPaid: 0, error: String((e as Error).message) };
    }
  }
}
