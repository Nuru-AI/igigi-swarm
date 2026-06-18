/**
 * SPIKE: does the SDK's NATIVE memory fire in a headless, confined `query()` — so
 * we could drop our hand-rolled AgentStore?
 *
 * Finding from the types: `memory: 'user'|'project'|'local'` is an **AgentDefinition**
 * (subagent) field (auto-loads .claude/agent-memory[-local]/<agentType>/), NOT a
 * top-level query option. Auto-memory (~/.claude/projects/<cwd>/memory + the
 * recall supervisor) is settings-level. So this spike tests the two real paths:
 *   A) plain headless query — does auto-memory / a memory_recall message fire?
 *   B) a subagent with `memory:'local'` — does it create/read an agent-memory dir?
 * Watching for: SDKMemoryRecallMessage, any memory tool_use, new memory files.
 *
 *   npm run memory-spike
 */
import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const MEM_DIRS = ['.claude/agent-memory-local', '.claude/agent-memory', HOME && join(HOME, '.claude', 'agent-memory'), HOME && join(HOME, '.claude', 'projects')].filter(Boolean) as string[];

function dumpMem(tag: string) {
  console.log(`\n── memory dirs ${tag} ──`);
  for (const d of MEM_DIRS) { try { if (existsSync(d)) console.log(`  ${d} → ${readdirSync(d).slice(0, 15).join(', ') || '(empty)'}`); else console.log(`  ${d} → (absent)`); } catch { /* */ } }
}

async function drain(label: string, opts: Record<string, unknown>, prompt: string) {
  console.log(`\n────── ${label} ──────`);
  const seen = new Set<string>(); let recall = 0, memTool = 0;
  try {
    for await (const msg of query({ prompt, options: { permissionMode: 'bypassPermissions', maxTurns: 6, ...opts } as any })) {
      const m: any = msg;
      seen.add(m.type + (m.subtype ? ':' + m.subtype : ''));
      if (m.subtype === 'memory_recall') { recall++; console.log('  🧠 MEMORY RECALL:', JSON.stringify(m).slice(0, 500)); }
      if (m.type === 'system') console.log('  [system]', JSON.stringify(m).slice(0, 300));
      if (m.type === 'assistant') for (const b of m.message.content) {
        if (b.type === 'text' && b.text.trim()) console.log('  💬', b.text.trim().slice(0, 220));
        if (b.type === 'tool_use') { if (/memory|Agent|Task/i.test(b.name)) memTool++; console.log('  🔧', b.name, JSON.stringify(b.input).slice(0, 140)); }
      }
    }
  } catch (e) { console.log('  ⚠️', String((e as Error).message)); }
  console.log(`  → types: ${[...seen].join(', ')}`);
  console.log(`  → memory_recall: ${recall} · memory/agent tool_use: ${memTool}`);
}

async function main() {
  console.log('=== SDK NATIVE MEMORY SPIKE ===');
  dumpMem('(before)');

  // A) Plain headless query — does auto-memory / recall supervisor fire under confinement?
  await drain('A-WRITE (plain, settingSources:[])', { settingSources: [] }, 'Remember for future sessions: my favorite blockchain is Tempo; my niche is perp funding rates. Save it to memory if you can.');
  dumpMem('(after A-WRITE)');
  await drain('A-RECALL (plain, settingSources:[])', { settingSources: [] }, 'From memory only: what is my favorite blockchain and my niche?');

  // B) Subagent with memory:'local' — the native per-agent-type memory path.
  const agents = { archivist: { description: 'Saves and recalls durable notes. Use to remember or recall facts across sessions.', prompt: 'You persist facts to your memory and recall them. Save/recall exactly what is asked.', tools: ['Read'], memory: 'local' as const } };
  await drain('B-WRITE (subagent memory:local)', { settingSources: ['project'], agents, allowedTools: ['Task', 'Agent'] }, 'Use the archivist subagent to REMEMBER: my favorite blockchain is Tempo, niche is perp funding rates.');
  dumpMem('(after B-WRITE)');
  await drain('B-RECALL (subagent memory:local)', { settingSources: ['project'], agents, allowedTools: ['Task', 'Agent'] }, 'Use the archivist subagent to RECALL my favorite blockchain and niche.');
  dumpMem('(final)');

  console.log('\n=== VERDICT ===');
  console.log('Native memory is usable here only if we saw memory_recall messages and/or NEW files under an agent-memory/projects dir. Note the keying: AgentDefinition.memory is per-agentTYPE (.../<agentType>/), auto-memory is per-cwd — neither is per-sovereign-PRINCIPAL, which is what our swarm needs.');
}
main();
