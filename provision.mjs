/**
 * Live wallet provisioning for the swarm demo.
 *   1. COORDINATOR (real Claude call) reads the goal and decides how many specialists + roles.
 *   2. Generate that many sovereign ICP identities (Ed25519).
 *   3. Sippar derives each one's Tempo address; fund each from the agent treasury pool
 *      (gasLimit 700000 — a first-ever transfer to a fresh address needs ~557k gas).
 *   4. Write the principals to .provisioned-principals.txt for the swarm launcher.
 *
 * Usage:  NODE_EXTRA_CA_CERTS=... node provision.mjs "<goal>"
 */
import { Ed25519KeyIdentity } from '@dfinity/identity';
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const TOK = env.SIPPAR_ACCESS_TOKEN;
const OR_KEY = env.OPENROUTER_API_KEY;
const BASE = process.env.SIPPAR_BASE_URL || 'https://sippar.network';
const MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.6';
const FUND_USD = Number(process.env.PROVISION_FUND_USD || '0.08');
const GOAL = process.argv.slice(2).join(' ') ||
  'Produce a comprehensive AI-compute sector investment memo that combines NVIDIA and AMD stock quotes, current crypto-AI token market sentiment, recent AI-sector news, and semiconductor supply-chain signals into a ranked buy/sell recommendation with rationale.';

// Existing funded agent wallets act as the treasury pool (round-robin, each used once for N<=8).
const FUNDERS = [
  'gzoxh-t7djy-acg3a-uuf24-yfpwi-vo73s-3befg-5olep-c443w-4bqxd-jqe',
  'dxmkx-lkjme-7jsr6-b7gta-zu242-4natm-za56v-aovgv-x7tkb-vgzuk-fae',
  'jpwwc-3ttte-qfjp7-5mqt4-ga2an-pwvbo-fsjv4-pjsod-brmat-t4uix-kqe',
  'kvytr-a5sng-mzfgu-hesln-yighl-wvngr-tpb2d-44i5n-yqdtw-4dmyg-4ae',
  'vnxlm-pehng-igtol-o6mka-tg2ty-st6xp-4a44s-i4rtl-jvhhs-cw6z6-oqe',
  'vwyxt-eomgx-yjpke-jzldt-3nafp-xzt6i-3xkwo-ymf5g-bkpii-3euri-mqe',
  'esia2-kvkro-ql3wi-jyeb4-qe6v3-xksqp-6wtiv-ouivr-mn644-gowwu-eqe',
  'bp23b-xx4d3-xibxd-kjypf-gwh4c-3zfqx-7i7lb-5wqr7-bpgfm-wzb6q-6ae',
];

const addr = async (p) => { const r = await fetch(`${BASE}/api/sippar/agent/address/${p}`, { headers: { 'X-Sippar-Access': TOK } }); const j = await r.json(); return j.data ?? j; };
const fund = async (fromPrincipal, toAddress, usd) => { const r = await fetch(`${BASE}/api/sippar/agent/transfer`, { method: 'POST', headers: { 'X-Sippar-Access': TOK, 'Content-Type': 'application/json' }, body: JSON.stringify({ fromPrincipal, toAddress, amountUSD: usd, gasLimit: 700000 }) }); const j = await r.json(); return j.data ?? j; };

// A funder can revert (status 0x0) if it's too thin for the amount + ~700k gas reservation.
// Advance through the pool until one succeeds; the cursor persists so a thin funder is skipped next time too.
let fi = 0;
async function fundWithFallback(toAddress, usd) {
  let last = '';
  for (let attempt = 0; attempt < FUNDERS.length; attempt++) {
    const funder = FUNDERS[fi % FUNDERS.length]; fi++;
    const f = await fund(funder, toAddress, usd);
    if (f.success) return f;
    last = f.error || f.status || 'unknown';
  }
  return { success: false, error: `all funders failed (last: ${last})` };
}

async function sizeTeam(goal) {
  const sys = 'You are the coordinator of an autonomous AI agent swarm whose members each hold their own on-chain wallet and pay each other for sub-tasks. Given a goal, decide how many specialist agents (between 3 and 8) should collaborate and name each distinct specialist role. Favor more specialists when the goal spans several independent data domains; fewer when it is narrow. Return ONLY JSON: {"count": <int 3-8>, "roles": ["Role A", ...]} with exactly count role names.';
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + OR_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, max_tokens: 600, messages: [{ role: 'system', content: sys }, { role: 'user', content: 'GOAL: ' + goal }] }) });
  const j = await r.json();
  const t = j.choices?.[0]?.message?.content ?? '';
  const parsed = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  let count = Math.max(3, Math.min(8, Number(parsed.count) || 5));
  const roles = (parsed.roles || []).map(String).slice(0, count);
  while (roles.length < count) roles.push('Specialist ' + (roles.length + 1));
  return { count, roles };
}

console.log(`\n=== COORDINATOR (Claude) sizing the team for the goal ===\n${GOAL}\n`);
const { count, roles } = await sizeTeam(GOAL);
console.log(`Coordinator decided: ${count} specialist agents`);
roles.forEach((r, i) => console.log(`   ${i + 1}. ${r}`));

console.log(`\n=== PROVISIONING ${count} sovereign on-chain wallets ===`);
const principals = [];
for (let i = 0; i < count; i++) {
  const principal = Ed25519KeyIdentity.generate().getPrincipal().toText();
  const d = await addr(principal);
  const f = await fundWithFallback(d.address, FUND_USD);
  console.log(`   A${i + 1}  ${roles[i].slice(0, 26).padEnd(26)}  ${d.address}  +$${FUND_USD}  ${f.success ? 'FUNDED' : 'FAIL: ' + (f.error || f.status)}${f.tx ? '  tx ' + f.tx.slice(0, 12) + '…' : ''}`);
  principals.push(principal);
}
writeFileSync('.provisioned-principals.txt', principals.join(','));
console.log(`\nWrote ${principals.length} principals to .provisioned-principals.txt`);
console.log('Next: run the swarm on the freshly-provisioned wallets.\n');
