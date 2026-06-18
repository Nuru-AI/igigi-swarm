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
