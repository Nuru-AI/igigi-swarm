/**
 * S3 — the live swarm dashboard server. Zero-dependency (node:http + node:fs).
 *
 * Tails the NEWEST runs/swarm-*.jsonl the swarm writes and streams it to the
 * browser over Server-Sent Events. Open it BEFORE or DURING a run — it latches
 * onto the newest run file automatically, replays what's there, then live-tails.
 *
 *   npm run dashboard            → http://localhost:7878
 *   PORT=9000 npm run dashboard  → custom port
 *   FEED_FILE=runs/x.jsonl ...   → pin a specific past run (replay)
 */
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { VERIFIED_SERVICES } from './services.js';

// Static swarm metadata for the dashboard Catalog tab. Read-only; does NOT touch
// the swarm engine or the feed schema — it just exposes the shared contract every
// agent runs under (homogeneous peers: same prompt, same tools, same x402 menu;
// they differ only by wallet + which DAG task they are awarded).
const SWARM_META = {
  note: 'Agents are homogeneous sovereign peers — identical system prompt, identical tool contract, identical service catalog. They differ only by their on-chain wallet and which task in the DAG they are awarded (and, when roles are enabled, a planner-assigned specialty). Coordination is a deterministic harness (taskboard DAG gating + round-robin), not an LLM.',
  tools: [
    { name: 'discover_services', group: 'hands', desc: 'List real x402 services it can buy (filter by category / max price).' },
    { name: 'buy_service', group: 'hands', desc: 'Pay for + call a service by id; Sippar threshold-signs, budget-capped.' },
    { name: 'think', group: 'hands', desc: 'Delegate heavy synthesis/code to a paid LLM (own reasoning is scarce).' },
    { name: 'check_budget', group: 'hands', desc: 'Read true on-chain spendable balance + spend ledger.' },
    { name: 'relay_pay', group: 'hands', desc: 'Buy an x402 service on another chain, paying only from Tempo.' },
    { name: 'list_open_tasks', group: 'economy', desc: 'List awarded tasks whose inputs are ready.' },
    { name: 'wait_for_task', group: 'economy', desc: 'Block until an awarded task becomes claimable.' },
    { name: 'claim_task', group: 'economy', desc: 'Claim one open task (exclusive, auto-expires).' },
    { name: 'buy_input', group: 'economy', desc: 'Buy a consumed input from the peer who produced it (A2A settle).' },
    { name: 'submit_task', group: 'economy', desc: 'Submit output; peers can buy it, downstream unblocks.' },
  ],
  services: VERIFIED_SERVICES.map((s) => ({ id: s.id, name: s.name, category: s.category, price: s.price, chain: s.chain, description: s.description })),
};

const PORT = Number(process.env.PORT || '7878');
const RUNS_DIR = process.env.RUNS_DIR || 'runs';
const PINNED = process.env.FEED_FILE || '';
const HTML = join(import.meta.dirname, '..', 'dashboard.html');

/** Newest runs/swarm-*.jsonl by mtime, or the pinned file. */
function newestFeed(): string | null {
  if (PINNED) return PINNED;
  try {
    const files = readdirSync(RUNS_DIR)
      .filter((f) => f.startsWith('swarm-') && f.endsWith('.jsonl'))
      .map((f) => ({ f: join(RUNS_DIR, f), m: statSync(join(RUNS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return files[0]?.f ?? null;
  } catch {
    return null;
  }
}

const server = createServer((req, res) => {
  const url = req.url || '/';

  if (url === '/' || url.startsWith('/index')) {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(HTML));
    } catch {
      res.writeHead(500).end('dashboard.html missing');
    }
    return;
  }

  if (url.startsWith('/meta')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(SWARM_META));
    return;
  }

  if (url.startsWith('/events')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    let current: string | null = null;
    let offset = 0;
    let buf = '';

    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    const pump = () => {
      const newest = newestFeed();
      if (!newest) return;
      if (newest !== current) {
        // A newer run started — reset the client view and tail the new file.
        current = newest;
        offset = 0;
        buf = '';
        send({ kind: '_reset', file: newest });
      }
      try {
        const size = statSync(current).size;
        if (size < offset) { offset = 0; buf = ''; } // truncated/rotated
        if (size > offset) {
          const fd = readFileSync(current).subarray(offset, size).toString('utf8');
          offset = size;
          buf += fd;
          const lines = buf.split('\n');
          buf = lines.pop() ?? ''; // keep partial last line
          for (const line of lines) {
            const s = line.trim();
            if (s) try { send(JSON.parse(s)); } catch { /* skip bad line */ }
          }
        }
      } catch { /* file vanished between checks */ }
    };

    pump();
    const iv = setInterval(pump, 600);
    const hb = setInterval(() => res.write(': hb\n\n'), 15000); // keep-alive heartbeat
    req.on('close', () => { clearInterval(iv); clearInterval(hb); });
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, () => {
  const f = newestFeed();
  console.log(`📊 Swarm dashboard → http://localhost:${PORT}`);
  console.log(f ? `   tailing ${f}` : `   waiting for a run in ./${RUNS_DIR}/ (start: npm run swarm)`);
});
