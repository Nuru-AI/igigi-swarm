/**
 * STEALTH-SAFE local mock of Farcaster publishing (Neynar-shaped).
 *
 * Lets swarm agents "publish" so we can observe WHAT they post — and NOTHING
 * leaves the machine. No network calls, no real account, no public exposure.
 * Shapes mirror the official docs (docs.neynar.com publish-cast / fetch-bulk-casts
 * / publish-reaction + miniapps.farcaster.xyz) so swapping in the real Neynar API
 * later is a one-line change (point the tool at https://api.neynar.com instead).
 *
 * Casts + reactions are kept in-process AND appended to runs/farcaster-<ts>.jsonl
 * for review (the experiment's real output: the agents' public voice, sandboxed).
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MockUser {
  object: 'user';
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  follower_count: number;
  following_count: number;
}

export interface MockCast {
  object: 'cast';
  hash: string;
  thread_hash: string;
  parent_hash: string | null;
  parent_url: string | null;
  author: MockUser;
  text: string;
  timestamp: string;
  embeds: Array<{ url: string } | { cast_id: { hash: string; fid: number } }>;
  reactions: { likes_count: number; recasts_count: number; likes: Array<{ fid: number; fname: string }>; recasts: Array<{ fid: number; fname: string }> };
  replies: { count: number };
  channel: { object: 'channel'; id: string; name: string; url: string } | null;
}

export interface Signer { signer_uuid: string; fid: number; username: string; }

/** An x402 Mini App "pay frame" a seller agent embeds in a cast (fc:miniapp). */
export interface MockFrame {
  frameId: string;
  url: string;
  sellerFid: number;
  sellerUsername: string;
  sellerWallet: string;   // where buyers pay (the seller's Tempo address)
  priceUSD: number;
  title: string;
  sells: string;          // what the buyer gets
  content: string;        // delivered on payment
  taps: Array<{ buyerFid: number; tx?: string; at: string }>;
}

const CHANNEL_NAMES: Record<string, string> = { ai: 'AI', aiagents: 'AI Agents', agents: 'Agents', memes: 'Memes', sippar: 'Sippar' };

export class FarcasterMock {
  readonly file: string;
  private casts: MockCast[] = [];
  private byHash = new Map<string, MockCast>();
  private signers = new Map<string, Signer & { user: MockUser }>();
  private frames = new Map<string, MockFrame>();
  private fidSeq = 99000;
  private hashSeq = 0;
  private frameSeq = 0;

  constructor(dir = 'runs', stamp = new Date().toISOString().replace(/[:.]/g, '-')) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `farcaster-${stamp}.jsonl`);
    writeFileSync(this.file, '');
  }

  /** Register a mock signer (≈ Neynar managed signer). Returns its signer_uuid + fid. */
  createSigner(username: string): Signer {
    const fid = ++this.fidSeq;
    const signer_uuid = `mock-signer-${fid}`;
    const user: MockUser = { object: 'user', fid, username, display_name: username, pfp_url: '', follower_count: 0, following_count: 0 };
    this.signers.set(signer_uuid, { signer_uuid, fid, username, user });
    this.append('signer_created', { signer_uuid, fid, username });
    return { signer_uuid, fid, username };
  }

  private nextHash(): string {
    return '0x' + (++this.hashSeq).toString(16).padStart(8, '0') + 'f'.repeat(32);
  }

  /** POST /v2/farcaster/cast — returns the SLIM response real Neynar returns. */
  publishCast(signer_uuid: string, body: { text?: string; embeds?: MockCast['embeds']; channel_id?: string; parent?: string }): { success: boolean; cast?: { hash: string; author: { fid: number }; text: string }; error?: string } {
    const s = this.signers.get(signer_uuid);
    if (!s) return { success: false, error: 'unknown signer_uuid' };
    const isReply = !!body.parent && body.parent.startsWith('0x');
    const channelId = body.channel_id || (body.parent && !isReply ? body.parent.split('/').pop() : undefined);
    const hash = this.nextHash();
    const cast: MockCast = {
      object: 'cast', hash,
      thread_hash: isReply ? (this.byHash.get(body.parent!)?.thread_hash ?? hash) : hash,
      parent_hash: isReply ? body.parent! : null,
      parent_url: channelId ? `https://warpcast.com/~/channel/${channelId}` : null,
      author: s.user,
      text: body.text ?? '',
      timestamp: new Date().toISOString(),
      embeds: (body.embeds ?? []).slice(0, 2),
      reactions: { likes_count: 0, recasts_count: 0, likes: [], recasts: [] },
      replies: { count: 0 },
      channel: channelId ? { object: 'channel', id: channelId, name: CHANNEL_NAMES[channelId] ?? channelId, url: `https://warpcast.com/~/channel/${channelId}` } : null,
    };
    if (isReply) { const t = this.byHash.get(body.parent!); if (t) t.replies.count++; }
    this.casts.push(cast); this.byHash.set(hash, cast);
    this.append('cast', { hash, fid: s.fid, username: s.username, channel: channelId ?? null, parent_hash: cast.parent_hash, text: cast.text, embeds: cast.embeds });
    return { success: true, cast: { hash, author: { fid: s.fid }, text: cast.text } };
  }

  /** Recent hydrated casts (newest first), optionally filtered. */
  getFeed(opts: { excludeFid?: number; channel_id?: string; limit?: number } = {}): MockCast[] {
    let out = [...this.casts].reverse();
    if (opts.excludeFid != null) out = out.filter((c) => c.author.fid !== opts.excludeFid);
    if (opts.channel_id) out = out.filter((c) => c.channel?.id === opts.channel_id);
    return out.slice(0, opts.limit ?? 25);
  }

  /** POST /v2/farcaster/reaction — mutates the target cast (real returns only {success,message}). */
  react(signer_uuid: string, reaction_type: 'like' | 'recast', target: string): { success: boolean; message: string } {
    const s = this.signers.get(signer_uuid);
    const c = this.byHash.get(target);
    if (!s || !c) return { success: false, message: '(mock) unknown signer or target' };
    if (reaction_type === 'like') { c.reactions.likes_count++; c.reactions.likes.push({ fid: s.fid, fname: s.username }); }
    else { c.reactions.recasts_count++; c.reactions.recasts.push({ fid: s.fid, fname: s.username }); }
    this.append('reaction', { by: s.username, type: reaction_type, target });
    return { success: true, message: `(mock) ${reaction_type} recorded` };
  }

  /** Mint an x402 Mini-App pay frame (fc:miniapp). Returns the embed URL + metadata. */
  createFrame(signer_uuid: string, f: { title: string; priceUSD: number; sells: string; content: string; sellerWallet: string }): { success: boolean; url?: string; frameId?: string; embed?: Record<string, unknown>; error?: string } {
    const s = this.signers.get(signer_uuid);
    if (!s) return { success: false, error: 'unknown signer_uuid' };
    const frameId = `frame${++this.frameSeq}`;
    const url = `https://miniapp.sippar.mock/pay/${frameId}`;
    this.frames.set(url, { frameId, url, sellerFid: s.fid, sellerUsername: s.username, sellerWallet: f.sellerWallet, priceUSD: f.priceUSD, title: f.title, sells: f.sells, content: f.content, taps: [] });
    this.append('frame_created', { frameId, url, seller: s.username, priceUSD: f.priceUSD, title: f.title, sells: f.sells });
    // The fc:miniapp embed metadata a real page would serve (docs: miniapps.farcaster.xyz/docs/specification)
    const embed = { version: '1', imageUrl: `${url}/og.png`, button: { title: `Pay $${f.priceUSD}`, action: { type: 'launch_miniapp', url, name: f.title.slice(0, 32) } } };
    return { success: true, url, frameId, embed };
  }

  getFrame(url: string): MockFrame | undefined { return this.frames.get(url); }

  /** Record a paid tap on a frame (the real on-chain payment is done by the caller). */
  recordTap(url: string, buyerFid: number, tx?: string): void {
    const fr = this.frames.get(url);
    if (fr) { fr.taps.push({ buyerFid, tx, at: new Date().toISOString() }); this.append('frame_tap', { url, buyerFid, tx, priceUSD: fr.priceUSD, seller: fr.sellerUsername }); }
  }

  /** An agent's received-engagement stats (for presence-building memory). */
  statsFor(fid: number): { casts: number; likesReceived: number; recastsReceived: number; repliesReceived: number; channels: string[] } {
    const mine = this.casts.filter((c) => c.author.fid === fid);
    return {
      casts: mine.length,
      likesReceived: mine.reduce((s, c) => s + c.reactions.likes_count, 0),
      recastsReceived: mine.reduce((s, c) => s + c.reactions.recasts_count, 0),
      repliesReceived: mine.reduce((s, c) => s + c.replies.count, 0),
      channels: [...new Set(mine.map((c) => c.channel?.id).filter(Boolean) as string[])],
    };
  }

  allFrames(): MockFrame[] { return [...this.frames.values()]; }
  allCasts(): MockCast[] { return this.casts; }

  private append(kind: string, data: Record<string, unknown>): void {
    try { appendFileSync(this.file, JSON.stringify({ t: new Date().toISOString(), kind, ...data }) + '\n'); } catch { /* observability only */ }
  }
}
