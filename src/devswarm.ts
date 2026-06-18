/**
 * SWARM DEV TEAM (B.4) — agents DISCUSS + choose what to build, then BUILD it
 * together in a sandboxed git repo, with Sippar paying for compute/services/A2A.
 *
 * ★ NORTH STAR: Sippar is a payment relay; the DEMO is the payment flow while an
 *   autonomous dev team works — not the code they produce.
 * LEAN: uses the SDK's OWN coding tools (Write/Edit/Bash/Read) + a local git
 *   worktree as the sandbox. We build ~no platform; just the glue:
 *   (1) sandbox-confinement via canUseTool, (2) a discussion board, (3) the runner.
 *   (Upgrade path per research: real GitHub + Daytona/E2B — sandbox vCPU-hr is the
 *   agent-billable unit Sippar would settle.)
 *
 * SAFETY (sandbox-confinement, replaces deny-all): file/shell ops are scoped to the
 * sandbox dir; no secrets/.env, no escape (`..`), no network (curl/wget), no
 * git push, no sudo/publish. Spend/token/kill caps still apply. The process loads
 * its own .env for Sippar, but agents have NO tool to read it.
 *
 *   SWARM_PRINCIPALS=p1,p2 npm run devswarm -- "optional seed topic"
 */
import 'dotenv/config';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Budget, type BudgetEvent } from './budget.js';
import { Sippar } from './sippar.js';
import { buildToolServer } from './tools.js';
import { SwarmFeed } from './feed.js';

process.env.MAX_MCP_OUTPUT_TOKENS ||= '200000';

const PRINCIPALS = (process.env.SWARM_PRINCIPALS || process.env.AGENT_PRINCIPAL || '').split(',').map((s) => s.trim()).filter(Boolean);
const HANDLES = (process.env.DEVSWARM_HANDLES || 'builder_one,builder_two,builder_three').split(',').map((s) => s.trim());
const CAP = Number(process.env.BUDGET_CAP_USD || '0.20');
const PER_TX = Number(process.env.PER_TX_MAX_USD || '0.06');
const MODEL = process.env.SWARM_MODEL || 'claude-sonnet-4-6';
const DISCUSS_TURNS = Number(process.env.DEVSWARM_DISCUSS_TURNS || '8');
const BUILD_TURNS = Number(process.env.DEVSWARM_BUILD_TURNS || '30');
const SEED = process.argv.slice(2).join(' ') || '(open — propose anything genuinely useful you can build together)';

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
// Sandbox lives in the OS temp dir, NOT under this project — so the agents' repo
// does NOT inherit this project's package.json ("type":"module"), which last run
// forced a confusing ESM/CommonJS detour that burned turns. Clean root = fewer wasted turns.
const SANDBOX = resolve(join(tmpdir(), 'sippar-devswarm', STAMP));

// ── sandbox-confinement: the security core ──
const SAFE_BASH = /^\s*(ls|cat|pwd|echo|mkdir|touch|node|npm|npx|pnpm|yarn|tsc|jest|vitest|head|tail|wc|grep|find|mv|cp|git\s+(add|commit|status|diff|log|init|branch|checkout|restore|rm))\b/;
const DANGER = /(\bcurl\b|\bwget\b|\bnc\b|git\s+push|git\s+remote|\bsudo\b|rm\s+-rf\s+[/~]|npm\s+publish|\.env\b|\.ssh\b|\bssh\b|\bscp\b|~[/\\]|\.claude|credential|secret|token|\.pem\b|\benv\b|process\.env|\bexport\s|[/\\]etc[/\\]|[/\\]root[/\\]|\.\.[/\\])/i;
function bashOk(cmd: string): boolean { return SAFE_BASH.test(cmd) && !DANGER.test(cmd); }
function pathInSandbox(p: unknown): boolean {
  if (typeof p !== 'string' || /\.\.(\/|\\|$)/.test(p)) return false;
  const r = resolve(SANDBOX, p);
  return r === SANDBOX || r.startsWith(SANDBOX + sep);
}

const HANDS = ['mcp__hands__discover_services', 'mcp__hands__buy_service', 'mcp__hands__think', 'mcp__hands__check_budget', 'mcp__hands__pay_agent'];
const CODE_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'mcp__team__propose', 'mcp__team__read_proposals', 'mcp__team__second', 'mcp__team__say'];

function gate(label: string) {
  return async (name: string, input: Record<string, unknown>) => {
    if (HANDS.includes(name) || name.startsWith('mcp__team__')) return { behavior: 'allow' as const, updatedInput: input };
    if (name === 'Read' || name === 'Write' || name === 'Edit') {
      const p = (input as any).file_path ?? (input as any).path;
      return pathInSandbox(p) ? { behavior: 'allow' as const, updatedInput: input } : { behavior: 'deny' as const, message: `[${label}] file ops are confined to the sandbox repo; "${p}" is outside it.` };
    }
    if (name === 'Bash') {
      const cmd = String((input as any).command ?? '');
      return bashOk(cmd) ? { behavior: 'allow' as const, updatedInput: input } : { behavior: 'deny' as const, message: `[${label}] blocked shell command (sandbox: build/test/git only — no network, no push, no env/secrets, no escape).` };
    }
    return { behavior: 'deny' as const, message: `"${name}" is not available in the dev sandbox.` };
  };
}

// ── discussion board (in-process; the agents converge on a goal here) ──
interface Proposal { id: number; by: string; idea: string; seconds: string[]; }
class Board {
  private items: Proposal[] = []; private seq = 0; readonly chat: string[] = [];
  propose(by: string, idea: string) { const id = ++this.seq; this.items.push({ id, by, idea, seconds: [] }); return id; }
  list() { return this.items.map((p) => ({ id: p.id, by: '@' + p.by, idea: p.idea, seconds: p.seconds.length })); }
  second(by: string, id: number) { const p = this.items.find((x) => x.id === id); if (p && !p.seconds.includes(by)) p.seconds.push(by); return !!p; }
  say(by: string, msg: string) { this.chat.push(`@${by}: ${msg}`); }
  winner() { return [...this.items].sort((a, b) => b.seconds.length - a.seconds.length)[0]; }
}
function teamServer(board: Board, handle: string) {
  return createSdkMcpServer({ name: 'team', version: '0.1.0', tools: [
    tool('propose', 'Propose ONE concrete thing the team could build together (a small, real, self-contained software project). Be specific about what + why.', { idea: z.string() },
      async ({ idea }) => { const id = board.propose(handle, idea); return { content: [{ type: 'text', text: JSON.stringify({ proposed: true, id }) }] }; }),
    tool('read_proposals', 'See all proposals + how many seconds each has, and the chat. Use to converge on ONE.', {},
      async () => ({ content: [{ type: 'text', text: JSON.stringify({ proposals: board.list(), chat: board.chat.slice(-12) }) }] })),
    tool('second', 'Endorse a proposal by id (vote for it). The most-seconded one is what the team builds.', { id: z.number() },
      async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify({ seconded: board.second(handle, id) }) }] })),
    tool('say', 'Say something to the team (discuss tradeoffs, coordinate who does what).', { msg: z.string() },
      async ({ msg }) => { board.say(handle, msg); return { content: [{ type: 'text', text: JSON.stringify({ said: true }) }] }; }),
  ] });
}

async function agentTurn(label: string, principal: string, board: Board, system: string, prompt: string, allowedTools: string[], maxTurns: number, feed: SwarmFeed) {
  const budget = new Budget(CAP, PER_TX, (e: BudgetEvent) => {
    if (e.type === 'spent') { console.log(`  💸 @${label} $${e.amount.toFixed(4)} ${e.service}`); feed.emit('buy', { agent: label, service: e.service, amountUSD: e.amount, tx: e.tx, chain: e.chain }); }
    else feed.emit('blocked', { agent: label, service: e.service, amountUSD: e.amount, reason: e.reason });
  });
  const sippar = new Sippar(budget, { principal });
  const w = await sippar.walletInfo();
  feed.emit('agent_start', { agent: label, balanceUSD: w?.balanceUSD, address: w?.address });
  try {
    for await (const msg of query({
      prompt,
      options: {
        systemPrompt: system,
        cwd: SANDBOX,
        mcpServers: { hands: buildToolServer(budget, sippar, undefined, true), team: teamServer(board, label) },
        settingSources: [],
        allowedTools,
        disallowedTools: ['WebSearch', 'WebFetch', 'Task', 'Agent', 'Skill', 'Workflow', 'SlashCommand', 'TodoWrite', 'NotebookEdit'],
        canUseTool: gate(label),
        model: MODEL, permissionMode: 'default', maxTurns,
      },
    })) {
      if (msg.type === 'assistant') for (const b of (msg as any).message.content) if (b.type === 'text' && b.text.trim()) { console.log(`🗣️  @${label}: ${b.text.trim().slice(0, 200)}`); feed.emit('decision', { agent: label, text: b.text.trim() }); }
    }
  } catch (e) { console.log(`⚠️ @${label}: ${String((e as Error).message)}`); }
}

async function main() {
  console.log('\n=== SWARM DEV TEAM (B.4) — local sandbox, Sippar-paid ===');
  if (!PRINCIPALS.length) { console.error('Set SWARM_PRINCIPALS=p1,p2 (funded principals).'); process.exit(1); }
  mkdirSync(SANDBOX, { recursive: true });
  execSync('git init -q && git config user.email swarm@sippar.local && git config user.name "Sippar Swarm"', { cwd: SANDBOX });
  // Safety-net so the Windows `nul` redirect artifact + deps never get committed.
  writeFileSync(join(SANDBOX, '.gitignore'), 'node_modules/\nnul\nNUL\n*.log\n.DS_Store\n');
  console.log(`Sandbox: ${SANDBOX}\nAgents: ${PRINCIPALS.length} · seed: ${SEED}\n`);
  const board = new Board();
  const team = PRINCIPALS.map((p, i) => ({ principal: p, handle: HANDLES[i % HANDLES.length] }));
  const feed = new SwarmFeed(); // S3 dashboard: npm run dashboard tails this
  console.log(`Feed: ${feed.file}  ·  watch: npm run dashboard`);
  feed.emit('swarm_start', { agents: team.map((a) => ({ label: a.handle, principal: a.principal })), capUSD: CAP, model: MODEL, mandate: `DEV TEAM: ${SEED}` });

  // ── Phase 1: DISCUSS + choose (concurrent) ──
  console.log('========== PHASE 1: DISCUSS ==========');
  const discussSys = (h: string) => `You are @${h}, one of ${team.length} autonomous agents who will BUILD something together in a shared sandboxed git repo. RIGHT NOW you only DISCUSS + decide WHAT to build. Use propose (one concrete, small, self-contained project you could actually build together — a CLI tool, a library, a small service), read_proposals, second (endorse the best), and say (coordinate). Converge on ONE idea with the team. Pick something genuinely useful and achievable. Seed topic: ${SEED}`;
  await Promise.allSettled(team.map((a) => agentTurn(a.handle, a.principal, board, discussSys(a.handle), 'Propose and converge on what the team should build.', ['mcp__team__propose', 'mcp__team__read_proposals', 'mcp__team__second', 'mcp__team__say', 'mcp__hands__check_budget'], DISCUSS_TURNS, feed)));
  const win = board.winner();
  console.log(`\n--- chosen: ${win ? `#${win.id} (@${win.by}, ${win.seconds.length} seconds): ${win.idea}` : '(no proposal)'} ---`);
  if (!win) { console.log('No proposal to build. Done.'); return; }

  // ── Phase 2: BUILD (sequential — agents build on the shared repo in turn) ──
  console.log('\n========== PHASE 2: BUILD ==========');
  const buildSys = (h: string) => `You are @${h}, building software with your team in a sandboxed git repo (your cwd). THE TEAM AGREED TO BUILD: "${win.idea}".

WORKFLOW (follow tightly — you have limited turns, use them on real files):
1. FIRST: \`ls\` + read the repo + \`git log\` to see what teammates already committed. BUILD ON IT — extend/fix existing files; do NOT restart from scratch.
2. For each file you create: call \`think(mode="code", model="smart", task="Write <exact/path>: <precise spec — language, package, imports, exact functions + behavior>")\`. It returns CLEAN file contents from a strong coding model (DeepSeek), paid via Sippar. DO NOT hand-write code — BUY the codegen (that is the Sippar payment demo). Then \`Write\` the returned contents to that path.
3. After each working file (or two), COMMIT: \`git add -A && git commit -m "..."\` — so teammates can build on your work.
4. Run/test with \`node\`/\`npm\` when sensible.
PATHS (read carefully — this is a Windows host): your current working directory IS the repo root, and a \`.gitignore\` is already committed there. Use RELATIVE paths only (e.g. \`cli.js\`, \`src/scanner.js\`). Do NOT assume any Linux path like \`/root/repo\` or \`/workspace\` — none exists; there is exactly ONE repo and it is your cwd. After you \`Write\` a file it is in your cwd; \`pwd\` may print a \`/c/...\`-style path — that is the SAME directory, the files are there. NEVER redirect output to \`nul\`/\`NUL\` (that creates a junk file) — use \`/dev/null\` if you must discard output.
Keep YOUR own messages to short decisions — the codegen happens in \`think\`, not in your head. You CANNOT access the network, secrets, or anything outside this repo. End with committed, working code.`;
  for (const a of team) {
    console.log(`\n--- @${a.handle} building ---`);
    await agentTurn(a.handle, a.principal, board, buildSys(a.handle), `Read the repo, then build your part of "${win.idea}". Commit your work.`, CODE_TOOLS, BUILD_TURNS, feed);
  }

  // ── Observe ──
  console.log('\n=== WHAT THE TEAM BUILT ===');
  try { console.log(execSync('git log --oneline', { cwd: SANDBOX }).toString().trim() || '(no commits)'); } catch { /* */ }
  console.log('\nFiles:', readdirSync(SANDBOX).filter((f) => f !== '.git').join(', ') || '(none)');
  console.log(`\nSandbox repo: ${SANDBOX}`);
  console.log('★ The demo is the Sippar payment flow above (think/buy/pay_agent) — the repo is proof they were working.');
  feed.emit('swarm_end', { capUSD: CAP, halted: false });
}
main().catch((e) => { console.error('DEVSWARM FAILED', e); process.exit(1); });
