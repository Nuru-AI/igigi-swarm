/**
 * FARCASTER EXPERIMENT (STEALTH MOCK) — give sovereign agents a public voice and
 * watch what they post. Agents publish/read/react/reply on a LOCAL Farcaster mock
 * (Neynar-shaped, see farcaster-mock.ts) — NOTHING leaves the machine. They keep
 * their real research hands (buy data / `think`) so posts are grounded, not made up.
 *
 * This is the Truth-Terminal question in a sandbox: with an audience and a voice,
 * what do they actually say? Output = runs/farcaster-<ts>.jsonl (every cast).
 *
 *   SWARM_PRINCIPALS=p1,p2 npm run farcaster -- "optional shared mandate"
 */
import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Budget, type BudgetEvent } from './budget.js';
import { Sippar } from './sippar.js';
import { buildToolServer } from './tools.js';
import { FarcasterMock } from './farcaster-mock.js';
import { AgentStore } from './agent-store.js';
import { SwarmFeed } from './feed.js';

process.env.MAX_MCP_OUTPUT_TOKENS ||= '200000';

const feed = new SwarmFeed(); // S3 dashboard: npm run dashboard tails runs/swarm-*.jsonl

const PRINCIPALS = (process.env.SWARM_PRINCIPALS || process.env.AGENT_PRINCIPAL || '').split(',').map((s) => s.trim()).filter(Boolean);
const CAP = Number(process.env.BUDGET_CAP_USD || '0.20');
const PER_TX = Number(process.env.PER_TX_MAX_USD || '0.06');
const MODEL = process.env.SWARM_MODEL || 'claude-sonnet-4-6';
const MAX_TURNS = Number(process.env.FARCASTER_MAX_TURNS || '18');
const ROUNDS = Number(process.env.FARCASTER_ROUNDS || '1'); // >1 = multi-round PRESENCE mode (S2 memory carries the persona across rounds)
const ROUND_TURNS = Number(process.env.FARCASTER_ROUND_TURNS || '10'); // turns per agent per round in presence mode
const STAGGER_MS = Number(process.env.SWARM_STAGGER_MS || '45000');
const HANDLES = (process.env.FARCASTER_HANDLES || 'sippar_scout,tempo_oracle,chainmuse,x402_owl,relay_raven').split(',').map((s) => s.trim());
const MANDATE = process.argv.slice(2).join(' ') ||
  'You sell market data on Farcaster. FIRST: buy real market data, package it into a digest, and mint an x402 pay-frame (create_pay_frame, ~$0.03-0.05) — then cast it with the embed so buyers can pay you on-chain. Do that early so it is live. THEN keep posting sharp real-data casts to build an audience. Ground everything in REAL data; never fabricate.';

// The hands the model may use. Social = the mock; research = real (grounded posts).
const FC_TOOLS = ['mcp__farcaster__cast', 'mcp__farcaster__read_feed', 'mcp__farcaster__react', 'mcp__farcaster__reply', 'mcp__farcaster__create_pay_frame', 'mcp__farcaster__pay_frame'];
const HANDS_FULL = ['mcp__hands__discover_services', 'mcp__hands__buy_service', 'mcp__hands__think', 'mcp__hands__check_budget'];
const HANDS_NONE = ['mcp__hands__check_budget']; // consumer: no data tools → must BUY a peer's pay-frame

const SYSTEM = (handle: string, cap: number, dataHands: boolean) => `You are @${handle}, an autonomous agent with a Farcaster presence. (THIS IS A STEALTH MOCK — nothing you post is public; it's recorded locally so your operators can see what you'd say.)${dataHands ? '' : `

IMPORTANT — YOU HAVE NO DATA TOOLS. You cannot discover_services, buy_service, or think your way to facts; you have no way to fetch market data yourself. The ONLY way to get real data is to BUY a peer's x402 pay-frame: read_feed, find a cast embedding a pay-frame that sells the data you need, and pay_frame its url (real on-chain USDC). Then cast insights from what you bought. NEVER fabricate numbers — if you have no data and no frame to buy yet, read_feed again and wait for one.`}

Goal: build a genuine audience by being worth following. Each turn, decide: post a cast, or read the feed and engage (like/reply) with other agents.
- Casts are short (~320 chars max), punchy, Farcaster-native. No hashtag spam.
- GROUND your posts in REAL data: use buy_service/discover_services to get facts (prices, trends, etc.) and \`think\` (paid LLM) to draft — your OWN reasoning is scarce, so offload heavy writing. Never fabricate numbers.
- You can target a channel (e.g. "ai", "aiagents", "memes") or post to your timeline.
- Engage: read_feed to see other agents, react to good casts, reply to spark conversation.
- MONETIZE if you have something worth paying for: \`create_pay_frame\` mints an x402 Mini App (a "pay frame") — package a paid digest / alert / deeper analysis for a small USDC price, then embed its url in a cast (cast embed_url=...) so followers can pay you on-chain. If you see a PEER's pay-frame in the feed that's genuinely worth it, \`pay_frame\` it (real money leaves your wallet — only if the value is real).
You have a real wallet (~$${cap}); data + drafting cost a little, and frame payments are REAL on-chain USDC. Be economical. Above all: post things that are genuinely interesting — sell only real value.`;

function socialServer(mock: FarcasterMock, sippar: Sippar, signerUuid: string, fid: number, remember?: (note: string) => void) {
  const compact = (cs: ReturnType<FarcasterMock['getFeed']>) => cs.map((c) => ({ hash: c.hash, by: '@' + c.author.username, text: c.text, likes: c.reactions.likes_count, recasts: c.reactions.recasts_count, replies: c.replies.count, channel: c.channel?.id ?? null, embeds: c.embeds }));
  return createSdkMcpServer({
    name: 'farcaster', version: '0.1.0', tools: [
      tool('cast', 'Publish a cast (Farcaster post, ~320 chars). Optionally to a channel, or embed a URL (e.g. a Mini App). STEALTH MOCK — not public.',
        { text: z.string(), channel: z.string().optional(), embed_url: z.string().optional() },
        async ({ text, channel, embed_url }) => {
          const r = mock.publishCast(signerUuid, { text, channel_id: channel, embeds: embed_url ? [{ url: embed_url }] : undefined });
          return { content: [{ type: 'text', text: JSON.stringify(r) }] };
        }),
      tool('read_feed', 'Read recent casts from OTHER agents (newest first), optionally filtered to a channel. See what is being posted.',
        { channel: z.string().optional(), limit: z.number().default(15) },
        async ({ channel, limit }) => ({ content: [{ type: 'text', text: JSON.stringify(compact(mock.getFeed({ excludeFid: fid, channel_id: channel, limit }))) }] })),
      tool('react', 'Like or recast another agent\'s cast by its hash.',
        { cast_hash: z.string(), type: z.enum(['like', 'recast']).default('like') },
        async ({ cast_hash, type }) => ({ content: [{ type: 'text', text: JSON.stringify(mock.react(signerUuid, type, cast_hash)) }] })),
      tool('reply', 'Reply to a cast by its hash.',
        { cast_hash: z.string(), text: z.string() },
        async ({ cast_hash, text }) => {
          const r = mock.publishCast(signerUuid, { text, parent: cast_hash });
          return { content: [{ type: 'text', text: JSON.stringify(r) }] };
        }),
      tool('create_pay_frame', 'Mint an x402 Mini App "pay frame" to SELL something for USDC (a paid digest, alert, or deeper analysis). Returns a url — embed it in a cast (cast embed_url=...) so others can pay you on-chain. price_usd = what buyers pay you; content = what they receive on payment.',
        { title: z.string(), price_usd: z.number(), sells: z.string(), content: z.string() },
        async ({ title, price_usd, sells, content }) => {
          const w = await sippar.walletInfo();
          if (!w?.address) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'no wallet to receive payment' }) }] };
          const r = mock.createFrame(signerUuid, { title, priceUSD: price_usd, sells, content, sellerWallet: w.address });
          return { content: [{ type: 'text', text: JSON.stringify(r) }] };
        }),
      tool('pay_frame', 'Pay a peer\'s x402 pay-frame you saw embedded in a cast — REAL on-chain USDC leaves your wallet to the seller. Give the frame url. Returns the content you bought. Only pay if the value is genuinely worth it.',
        { frame_url: z.string() },
        async ({ frame_url }) => {
          const fr = mock.getFrame(frame_url);
          if (!fr) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'no such frame' }) }] };
          if (fr.sellerFid === fid) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'cannot pay your own frame' }) }] };
          const pay = await sippar.payAgent(fr.sellerWallet, fr.priceUSD);
          if (!pay.success) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `payment failed: ${pay.error}` }) }] };
          mock.recordTap(frame_url, fid, pay.tx);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, paidTo: '@' + fr.sellerUsername, amountUSD: fr.priceUSD, tx: pay.tx, content: fr.content }) }] };
        }),
      ...(remember ? [tool('remember', 'Save a note to your DURABLE memory (persists to your next round): your niche, voice, what got engagement, and your plan. Call before you finish so future-you continues the same thread.',
        { note: z.string() },
        async ({ note }) => { remember(note); return { content: [{ type: 'text', text: JSON.stringify({ remembered: true }) }] }; })] : []),
    ],
  });
}

async function runAgent(principal: string, handle: string, mock: FarcasterMock, startDelayMs: number, opts: { dataHands: boolean; mandate: string }) {
  if (startDelayMs > 0) await new Promise((r) => setTimeout(r, startDelayMs));
  const hands = opts.dataHands ? HANDS_FULL : HANDS_NONE;
  const budget = new Budget(CAP, PER_TX, (e: BudgetEvent) => {
    if (e.type === 'spent') { console.log(`  💸 @${handle} $${e.amount.toFixed(4)} ${e.service}`); feed.emit('buy', { agent: handle, service: e.service, amountUSD: e.amount, tx: e.tx, chain: e.chain }); }
    else feed.emit('blocked', { agent: handle, service: e.service, amountUSD: e.amount, reason: e.reason });
  });
  const sippar = new Sippar(budget, { principal });
  const signer = mock.createSigner(handle);
  console.log(`\n📣 @${handle} online (fid ${signer.fid}) — ${opts.dataHands ? 'PRODUCER (full hands)' : 'CONSUMER (no data tools → must buy)'}`);
  feed.emit('agent_start', { agent: handle, role: opts.dataHands ? 'producer' : 'consumer' });
  const canUse = async (name: string, input: Record<string, unknown>) => {
    if (FC_TOOLS.includes(name) || hands.includes(name) || name === 'Read') return { behavior: 'allow' as const, updatedInput: input };
    return { behavior: 'deny' as const, message: `"${name}" is not available to you.` };
  };
  try {
    for await (const msg of query({
      prompt: opts.mandate,
      options: {
        systemPrompt: SYSTEM(handle, CAP, opts.dataHands),
        mcpServers: { hands: buildToolServer(budget, sippar, undefined, true), farcaster: socialServer(mock, sippar, signer.signer_uuid, signer.fid) },
        settingSources: [],
        allowedTools: [...FC_TOOLS, ...hands, 'Read'],
        disallowedTools: ['WebSearch', 'WebFetch', 'Bash', 'Write', 'Edit', 'Glob', 'Grep', 'Task', 'Agent', 'Skill', 'Workflow', 'SlashCommand', 'TodoWrite'],
        canUseTool: canUse,
        model: MODEL, permissionMode: 'default', maxTurns: MAX_TURNS,
      },
    })) {
      if (msg.type === 'assistant') for (const b of (msg as any).message.content) if (b.type === 'text' && b.text.trim()) { console.log(`🗣️  @${handle}: ${b.text.trim().slice(0, 220)}`); feed.emit('decision', { agent: handle, text: b.text.trim().slice(0, 220) }); }
    }
  } catch (e) { console.log(`⚠️ @${handle} ended: ${String((e as Error).message)}`); }
}

// Multi-round PRESENCE: one round of activity for one agent, with its durable
// memory (S2) + received-engagement injected so its persona develops over rounds.
async function presenceRound(a: { principal: string; handle: string; signer: { signer_uuid: string; fid: number } }, mock: FarcasterMock, store: AgentStore, round: number, rounds: number) {
  const state = store.load(a.principal);
  const budget = new Budget(CAP, PER_TX, (e: BudgetEvent) => {
    if (e.type === 'spent') { console.log(`  💸 @${a.handle} $${e.amount.toFixed(4)} ${e.service}`); feed.emit('buy', { agent: a.handle, service: e.service, amountUSD: e.amount, tx: e.tx, chain: e.chain }); }
    else feed.emit('blocked', { agent: a.handle, service: e.service, amountUSD: e.amount, reason: e.reason });
  });
  const sippar = new Sippar(budget, { principal: a.principal });
  feed.emit('round', { agent: a.handle, round, rounds });
  const stats = mock.statsFor(a.signer.fid);
  const mem = `\n\n[YOUR FARCASTER MEMORY — @${a.handle}] Round ${round} of ${rounds}.\n${AgentStore.memoryBrief(state)}\nYour presence so far: ${stats.casts} casts · received ${stats.likesReceived}❤ ${stats.recastsReceived}🔁 ${stats.repliesReceived}💬 · channels: ${stats.channels.join(', ') || '(none yet)'}.\nBuild on your established voice — deepen your NICHE, stay consistent with who you've been, and double down on what earns engagement. Read the feed and engage peers. Before finishing, call remember(...) with your niche + plan for next round.`;
  const remember = (note: string) => store.remember(state, note);
  const canUse = async (name: string, input: Record<string, unknown>) => (FC_TOOLS.includes(name) || name === 'mcp__farcaster__remember' || HANDS_FULL.includes(name) || name === 'Read') ? { behavior: 'allow' as const, updatedInput: input } : { behavior: 'deny' as const, message: `"${name}" not available.` };
  try {
    for await (const msg of query({
      prompt: 'Continue building your Farcaster presence this round — post, engage, deepen your niche.',
      options: {
        systemPrompt: SYSTEM(a.handle, CAP, true) + mem,
        mcpServers: { hands: buildToolServer(budget, sippar, undefined, true), farcaster: socialServer(mock, sippar, a.signer.signer_uuid, a.signer.fid, remember) },
        settingSources: [],
        allowedTools: [...FC_TOOLS, 'mcp__farcaster__remember', ...HANDS_FULL, 'Read'],
        disallowedTools: ['WebSearch', 'WebFetch', 'Bash', 'Write', 'Edit', 'Glob', 'Grep', 'Task', 'Agent', 'Skill', 'Workflow', 'SlashCommand', 'TodoWrite'],
        canUseTool: canUse,
        model: MODEL, permissionMode: 'default', maxTurns: ROUND_TURNS,
      },
    })) {
      if (msg.type === 'assistant') for (const b of (msg as any).message.content) if (b.type === 'text' && b.text.trim()) { console.log(`🗣️  @${a.handle}: ${b.text.trim().slice(0, 200)}`); feed.emit('decision', { agent: a.handle, text: b.text.trim().slice(0, 200) }); }
    }
  } catch (e) { console.log(`⚠️ @${a.handle} round ${round} ended: ${String((e as Error).message)}`); }
  state.runs += 1;
  const s2 = mock.statsFor(a.signer.fid);
  store.remember(state, `Round ${round} end: ${s2.casts} total casts, ${s2.likesReceived} likes received; channels ${s2.channels.join('/') || '—'}.`);
}

async function main() {
  console.log('\n=== FARCASTER EXPERIMENT (STEALTH MOCK — nothing is public) ===');
  if (!PRINCIPALS.length) { console.error('Set SWARM_PRINCIPALS=p1,p2 (funded principals).'); process.exit(1); }
  const mock = new FarcasterMock();
  console.log(`Feed: ${feed.file} · watch: npm run dashboard`);
  feed.emit('swarm_start', {
    agents: PRINCIPALS.map((p, i) => ({ label: HANDLES[i % HANDLES.length], principal: p })),
    capUSD: CAP, model: MODEL,
    mandate: ROUNDS > 1 ? `FARCASTER PRESENCE: ${ROUNDS} rounds` : `FARCASTER COMMERCE: ${MANDATE.slice(0, 120)}`,
  });

  // ── MULTI-ROUND PRESENCE MODE (FARCASTER_ROUNDS>1) ──
  if (ROUNDS > 1) {
    const store = new AgentStore('./.farcaster-state'); // isolated from swarm financial memory; persists the persona across runs
    const agents = PRINCIPALS.map((p, i) => ({ principal: p, handle: HANDLES[i % HANDLES.length], signer: mock.createSigner(HANDLES[i % HANDLES.length]) }));
    console.log(`PRESENCE MODE: ${agents.length} agents × ${ROUNDS} rounds (S2 durable memory) · feed → ${mock.file}\n`);
    for (let r = 1; r <= ROUNDS; r++) {
      console.log(`\n========== ROUND ${r}/${ROUNDS} ==========`);
      await Promise.allSettled(agents.map((a) => presenceRound(a, mock, store, r, ROUNDS)));
    }
    // Summary: each agent's persona development + its self-described niche.
    console.log(`\n=== PRESENCE AFTER ${ROUNDS} ROUNDS ===`);
    for (const a of agents) {
      const st = mock.statsFor(a.signer.fid);
      const state = store.load(a.principal);
      const niche = state.journal.slice(-3).map((j) => j.note).join(' | ');
      console.log(`\n@${a.handle} — ${st.casts} casts · ${st.likesReceived}❤ ${st.recastsReceived}🔁 ${st.repliesReceived}💬 · channels: ${st.channels.join(', ') || '—'}\n  niche/notes: ${niche}`);
    }
    console.log(`\n=== ALL CASTS (chronological — watch the persona develop) ===`);
    for (const c of mock.allCasts()) console.log(`\n@${c.author.username}${c.channel ? ' /' + c.channel.id : ''}${c.parent_hash ? ' (reply)' : ''}  ❤${c.reactions.likes_count} 🔁${c.reactions.recasts_count} 💬${c.replies.count}\n${c.text}`);
    console.log(`\nFull log: ${mock.file}`);
    feed.emit('swarm_end', { capUSD: CAP, halted: false, casts: mock.allCasts().length });
    return;
  }

  // Asymmetric demand: agent 0 = PRODUCER (full hands; sells a data digest via a
  // pay-frame). Others = CONSUMERS (no data tools → the ONLY way to get real data
  // is to BUY the producer's pay-frame). This creates genuine demand.
  const PRODUCER_MANDATE = MANDATE; // CLI arg or default (build presence + sell)
  const CONSUMER_MANDATE = 'You are a markets commentator on Farcaster, but you have NO data tools — you cannot fetch any market data yourself. To post anything accurate you MUST buy a peer\'s market-data pay-frame: read_feed, find a cast embedding a pay-frame that sells market data, pay_frame its url (real USDC), then cast sharp insights from what you bought. Never fabricate. If no frame is for sale yet, read_feed again and wait.';
  const roles = PRINCIPALS.map((_p, i) => i === 0 ? { dataHands: true, mandate: PRODUCER_MANDATE } : { dataHands: false, mandate: CONSUMER_MANDATE });
  console.log(`Agents: ${PRINCIPALS.length} (1 producer + ${PRINCIPALS.length - 1} consumer) · feed → ${mock.file}\n`);
  // SEQUENTIAL (default): run the producer to completion FIRST so its pay-frame is
  // live in the shared mock, THEN run the consumer(s) — which read a populated feed
  // and can actually buy. Fixes the single-pass concurrency gap. Set
  // FARCASTER_CONCURRENT=1 for the old staggered-parallel behavior.
  if (process.env.FARCASTER_CONCURRENT === '1') {
    await Promise.allSettled(PRINCIPALS.map((p, i) => runAgent(p, HANDLES[i % HANDLES.length], mock, i * STAGGER_MS, roles[i])));
  } else {
    await runAgent(PRINCIPALS[0], HANDLES[0], mock, 0, roles[0]);
    console.log(`\n--- producer done; ${mock.allFrames().length} frame(s) live, ${mock.allCasts().length} casts — now the consumer(s) read a populated feed ---`);
    await Promise.allSettled(PRINCIPALS.slice(1).map((p, j) => runAgent(p, HANDLES[(j + 1) % HANDLES.length], mock, 0, roles[j + 1])));
  }

  const casts = mock.allCasts();
  console.log(`\n=== WHAT THE AGENTS POSTED (${casts.length} casts) ===`);
  for (const c of casts) console.log(`\n@${c.author.username}${c.channel ? ' /' + c.channel.id : ''}${c.parent_hash ? ' (reply)' : ''}  ❤${c.reactions.likes_count} 🔁${c.reactions.recasts_count} 💬${c.replies.count}\n${c.text}${c.embeds.length ? '\n  [embed] ' + JSON.stringify(c.embeds) : ''}`);

  const frames = mock.allFrames();
  console.log(`\n=== x402 PAY-FRAMES (${frames.length}) ===`);
  for (const f of frames) {
    const paid = f.taps.length;
    console.log(`\n@${f.sellerUsername} sold "${f.title}" — $${f.priceUSD} · ${f.sells}\n  ${f.url}\n  💰 ${paid} paid tap(s)${paid ? ' → $' + (paid * f.priceUSD).toFixed(4) + ' earned, tx ' + (f.taps[0].tx?.slice(0, 14) ?? '') + '…' : ' (no buyers)'}`);
  }
  const totalEarned = frames.reduce((s, f) => s + f.taps.length * f.priceUSD, 0);
  console.log(`\n=== COMMERCE: ${frames.length} frames, ${frames.reduce((s, f) => s + f.taps.length, 0)} paid taps, $${totalEarned.toFixed(4)} moved agent→agent via Mini-App casts ===`);
  feed.emit('swarm_end', { capUSD: CAP, halted: false, casts: casts.length, framesSold: frames.length, earnedUSD: totalEarned });
  console.log(`Full log: ${mock.file}`);
}
main().catch((e) => { console.error('FARCASTER FAILED', e); process.exit(1); });
