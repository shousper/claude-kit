#!/usr/bin/env node
// claude-mem-backfill.mjs — Backfill episodic memory from Claude Code session logs
// Node.js 18+ ESM, zero external dependencies

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, openSync, readSync, closeSync, createReadStream } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { createInterface } from 'node:readline';

// ── Constants ──────────────────────────────────────────────────────────────────

const HOME = homedir();
const DEFAULT_PROJECTS_DIR = join(HOME, '.claude', 'projects');
const STATE_PATH = join(HOME, '.claude-mem', 'backfill-state.json');
const SETTINGS_PATH = join(HOME, '.claude-mem', 'settings.json');
const DEFAULT_PORT = 37777;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SKIP_TOOLS = new Set([
  'ListMcpResourcesTool',
  'SlashCommand',
  'Skill',
  'TodoWrite',
  'AskUserQuestion',
]);

const META_TAG_PATTERNS = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<private>[\s\S]*?<\/private>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<command-message>[\s\S]*?<\/command-message>/g,
  /<command-name>[\s\S]*?<\/command-name>/g,
  /<command-args>[\s\S]*?<\/command-args>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
];

const SYSTEM_PROMPT_PREFIXES = [
  'Base directory for this skill:',
  'Launching skill:',
  'You are an agent for Claude Code',
  'Human turn was auto-submitted',
  '[Request interrupted by user',
  '# /van',
];

// ── Utility Functions ──────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripMetaTags(text) {
  if (!text) return text;
  for (const pat of META_TAG_PATTERNS) {
    text = text.replace(pat, '');
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n');
}

function isSessionMemoryOp(input) {
  if (!input) return false;
  const path = input.file_path || input.path || input.command || '';
  return typeof path === 'string' && path.includes('session-memory');
}

function isSystemPrompt(text) {
  if (!text) return false;
  const trimmed = text.trimStart();
  return SYSTEM_PROMPT_PREFIXES.some((p) => trimmed.startsWith(p));
}

// ── HTTP Client ────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const req = httpRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          if (res.statusCode >= 400) return reject(new HttpError(`${res.statusCode}: ${raw}`, res.statusCode));
          try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'GET',
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          if (res.statusCode >= 400) return reject(new HttpError(`${res.statusCode}: ${raw}`, res.statusCode));
          try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function httpPostWithRetry(url, body, maxRetries = 5) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await httpPost(url, body);
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 429 || attempt >= maxRetries) throw err;
      const delay = Math.min(1000 * 2 ** attempt, 30000);
      await sleep(delay);
    }
  }
}

const BACKFILL_MODEL = 'haiku';

function loadSettings() {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  const dir = dirname(SETTINGS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function configureForBackfill(concurrency) {
  const settings = loadSettings();
  const original = {
    CLAUDE_MEM_MODEL: settings.CLAUDE_MEM_MODEL,
    CLAUDE_MEM_MAX_CONCURRENT_AGENTS: settings.CLAUDE_MEM_MAX_CONCURRENT_AGENTS,
  };
  settings.CLAUDE_MEM_MODEL = BACKFILL_MODEL;
  settings.CLAUDE_MEM_MAX_CONCURRENT_AGENTS = String(concurrency);
  saveSettings(settings);
  return original;
}

function restoreSettings(original) {
  const settings = loadSettings();
  if (original.CLAUDE_MEM_MODEL !== undefined) {
    settings.CLAUDE_MEM_MODEL = original.CLAUDE_MEM_MODEL;
  }
  if (original.CLAUDE_MEM_MAX_CONCURRENT_AGENTS !== undefined) {
    settings.CLAUDE_MEM_MAX_CONCURRENT_AGENTS = original.CLAUDE_MEM_MAX_CONCURRENT_AGENTS;
  }
  saveSettings(settings);
}

function getWorkerBaseUrl() {
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    return `http://127.0.0.1:${settings.CLAUDE_MEM_WORKER_PORT || DEFAULT_PORT}`;
  } catch {
    return `http://127.0.0.1:${DEFAULT_PORT}`;
  }
}

async function checkWorkerHealth(baseUrl) {
  try {
    await httpGet(`${baseUrl}/health`);
    return true;
  } catch {
    return false;
  }
}

// ── State Management ───────────────────────────────────────────────────────────

function freshState() {
  return {
    version: 1,
    completed: [],
    failed: {},
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    stats: { processed: 0, skipped: 0, failed: 0, total: 0 },
  };
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return freshState();
  }
}

function saveState(state) {
  state.lastUpdated = new Date().toISOString();
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function markCompleted(state, uuid) {
  state.completed.push(uuid);
  state.stats.processed++;
  delete state.failed[uuid];
}

function markFailed(state, uuid, error) {
  state.failed[uuid] = { error: String(error), failedAt: new Date().toISOString() };
  state.stats.failed++;
}

// ── JSONL Parser ───────────────────────────────────────────────────────────────

function processSessionLine(line, state) {
  let entry;
  try { entry = JSON.parse(line); } catch { return; }

  const msg = entry.message;
  if (!msg) return;

  const cwd = entry.cwd || '';
  const sessionId = entry.sessionId || '';
  const gitBranch = entry.gitBranch || '';
  const timestamp = entry.timestamp || '';

  if (entry.type === 'user' && msg.role === 'user') {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type !== 'tool_result' || !block.tool_use_id) continue;
        const pending = state.pendingToolUses.get(block.tool_use_id);
        if (!pending) continue;
        state.pendingToolUses.delete(block.tool_use_id);
        if (isSessionMemoryOp(pending.toolInput)) continue;
        state.toolPairs.push({
          toolName: pending.toolName,
          toolInput: pending.toolInput,
          toolResponse: extractText(block.content) || (block.is_error ? 'Error' : ''),
          timestamp: pending.timestamp,
          cwd: pending.cwd,
        });
      }
      const text = stripMetaTags(extractText(msg.content));
      if (text && !isSystemPrompt(text) && !entry.isMeta) {
        state.prompts.push({ text, timestamp, cwd, sessionId, gitBranch });
      }
      return;
    }
    const text = stripMetaTags(typeof msg.content === 'string' ? msg.content : '');
    if (text && !isSystemPrompt(text)) {
      state.prompts.push({ text, timestamp, cwd, sessionId, gitBranch });
    }
    return;
  }

  if (entry.type === 'assistant' && msg.role === 'assistant' && Array.isArray(msg.content)) {
    let assistantText = '';
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) assistantText += block.text + '\n';
      if (block.type === 'tool_use' && block.id && block.name) {
        if (SKIP_TOOLS.has(block.name)) continue;
        state.pendingToolUses.set(block.id, {
          toolName: block.name,
          toolInput: block.input || {},
          timestamp,
          cwd,
        });
      }
    }
    if (assistantText.trim()) state.lastAssistantText = assistantText.trim();
  }
}

async function parseSession(filePath) {
  const state = { prompts: [], toolPairs: [], lastAssistantText: '', pendingToolUses: new Map() };
  try {
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      if (line) processSessionLine(line, state);
    }
  } catch (err) {
    if (!err.message?.includes('Cannot create a string longer than')) throw err;
    return parseSessionStreaming(filePath);
  }
  return { prompts: state.prompts, toolPairs: state.toolPairs, lastAssistantText: state.lastAssistantText };
}

function parseSessionStreaming(filePath) {
  return new Promise((resolve, reject) => {
    const state = { prompts: [], toolPairs: [], lastAssistantText: '', pendingToolUses: new Map() };
    const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
    rl.on('line', (line) => { if (line) processSessionLine(line, state); });
    rl.on('close', () => resolve({ prompts: state.prompts, toolPairs: state.toolPairs, lastAssistantText: state.lastAssistantText }));
    rl.on('error', reject);
  });
}

// ── Discovery Functions ────────────────────────────────────────────────────────

function quickScan(filePath, minTools, afterDate) {
  const CHUNK = 8 * 1024 * 1024; // 8MB
  let fd;
  try { fd = openSync(filePath, 'r'); } catch { return null; }

  const buf = Buffer.allocUnsafe(CHUNK);
  let toolCount = 0;
  let timestamp = null;
  let position = 0;

  try {
    let bytesRead;
    while ((bytesRead = readSync(fd, buf, 0, CHUNK, position)) > 0) {
      const chunk = buf.toString('utf8', 0, bytesRead);
      let idx = 0;
      while ((idx = chunk.indexOf('"tool_use"', idx)) !== -1) { toolCount++; idx += 10; }
      if (!timestamp) {
        const m = chunk.match(/"timestamp"\s*:\s*"([^"]+)"/);
        if (m) timestamp = m[1];
      }
      position += bytesRead;
      if (bytesRead < CHUNK) break;
    }
  } finally {
    closeSync(fd);
  }

  if (toolCount < minTools) return null;
  if (afterDate && timestamp && timestamp.slice(0, 10) < afterDate) return null;
  return { toolCount, timestamp };
}

function deriveProjectName(dirName) {
  // dirName encodes paths: / → -, . → - (so /.foo → --foo)
  const homePrefix = HOME.replace(/\//g, '-').replace(/^-/, '');
  if (dirName.startsWith('-' + homePrefix + '-')) {
    const remainder = dirName.slice(homePrefix.length + 2);
    // Leading - after prefix = dot-prefixed dir at home root (e.g., .openclaw)
    // Interior -- = path separator + dot-prefixed dir (e.g., /.worktrees)
    return '~/' + remainder.replace(/^-/, '.').replace(/--/g, '/.').replace(/-/g, '/');
  }
  if (dirName.startsWith('-' + homePrefix)) {
    return '~/';
  }
  return dirName.replace(/--/g, '/.').replace(/-/g, '/').replace(/^\//, '');
}

function discoverSessions(dirs, minTools, afterDate) {
  const seen = new Set();
  const sessions = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }

    for (const projectDir of entries) {
      const projectPath = join(dir, projectDir);
      let stat;
      try { stat = statSync(projectPath); } catch { continue; }
      if (!stat.isDirectory()) continue;

      let files;
      try { files = readdirSync(projectPath); } catch { continue; }

      for (const file of files) {
        if (!file.endsWith('.jsonl') || file.startsWith('agent-')) continue;
        const uuid = basename(file, '.jsonl');
        if (!UUID_RE.test(uuid) || seen.has(uuid)) continue;
        seen.add(uuid);

        const filePath = join(projectPath, file);
        const scan = quickScan(filePath, minTools, afterDate);
        if (!scan) continue;

        sessions.push({
          uuid,
          filePath,
          projectDir,
          projectName: deriveProjectName(projectDir),
          toolCount: scan.toolCount,
          timestamp: scan.timestamp,
        });
      }
    }
  }

  // Sort oldest first
  sessions.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  return sessions;
}

function printSessionList(sessions) {
  const grouped = new Map();
  for (const s of sessions) {
    if (!grouped.has(s.projectName)) grouped.set(s.projectName, []);
    grouped.get(s.projectName).push(s);
  }

  console.log(`\nFound ${sessions.length} session(s) across ${grouped.size} project(s):\n`);
  for (const [project, items] of grouped) {
    console.log(`  ${project} (${items.length} session${items.length === 1 ? '' : 's'})`);
    for (const s of items) {
      const date = s.timestamp ? s.timestamp.slice(0, 10) : 'unknown';
      console.log(`    ${s.uuid}  tools:${s.toolCount}  date:${date}`);
    }
  }
  console.log('');
}

// ── CLI Parsing ────────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`Usage: node claude-mem-backfill.mjs [options]

Options:
  --dir <path>        Project directory to scan (repeatable, default: ~/.claude/projects/)
                      For superpowers archive: ~/.config/superpowers/conversation-archive/
  --min-tools <n>     Minimum tool_use count to include session (default: 1)
  --concurrency <n>   Max parallel session replays (default: 5)
  --after <YYYY-MM-DD> Only include sessions after this date
  --session <uuid>    Process a single session by UUID
  --dry-run           Show what would be processed without sending
  --list              List discovered sessions and exit
  --verbose, -v       Verbose output
  --help, -h          Show this help

Notes:
  Automatically sets CLAUDE_MEM_MODEL to haiku and CLAUDE_MEM_MAX_CONCURRENT_AGENTS
  to match --concurrency for the duration of the backfill, then restores originals.
  Failed sessions are automatically retried on subsequent runs.
`);
}

function parseArgs(argv) {
  const args = {
    dirs: [],
    minTools: 1,
    concurrency: 5,
    after: null,
    dryRun: false,
    verbose: false,
    list: false,
    session: null,
    help: false,
  };

  const needsValue = new Set(['--dir', '--min-tools', '--concurrency', '--after', '--session']);

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (needsValue.has(flag) && (i + 1 >= argv.length || argv[i + 1]?.startsWith('--'))) {
      console.error(`Error: ${flag} requires a value`);
      process.exit(1);
    }
    switch (flag) {
      case '--dir':
        args.dirs.push(argv[++i]);
        break;
      case '--min-tools':
        args.minTools = parseInt(argv[++i], 10);
        break;
      case '--concurrency':
        args.concurrency = parseInt(argv[++i], 10);
        break;
      case '--after':
        args.after = argv[++i];
        if (!DATE_RE.test(args.after)) {
          console.error(`Error: --after must be YYYY-MM-DD, got "${args.after}"`);
          process.exit(1);
        }
        break;
      case '--session':
        args.session = argv[++i];
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        args.verbose = true;
        break;
      case '--list':
        args.list = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        console.error(`Error: unknown flag "${flag}"`);
        process.exit(1);
    }
  }

  if (args.dirs.length === 0) args.dirs.push(DEFAULT_PROJECTS_DIR);
  return args;
}

// ── Prompt-Tool Grouping ─────────────────────────────────────────────────────

function groupByPrompt(prompts, toolPairs) {
  if (prompts.length === 0) return [];
  if (prompts.length === 1) return [{ promptText: prompts[0].text, tools: toolPairs }];

  const groups = prompts.map(p => ({
    promptText: p.text,
    promptTime: new Date(p.timestamp).getTime() || 0,
    tools: [],
  }));

  for (const tool of toolPairs) {
    const toolTime = new Date(tool.timestamp).getTime() || 0;
    let bestIdx = 0;
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i].promptTime <= toolTime) { bestIdx = i; break; }
    }
    groups[bestIdx].tools.push(tool);
  }
  return groups;
}

// ── Queue Drain Polling ──────────────────────────────────────────────────────

async function waitForQueueDrain(baseUrl, sessionDbId, timeoutMs) {
  const start = Date.now();
  let lastQueueLength = -1;
  let stuckSince = null;
  let lastStatus = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const status = await httpGet(`${baseUrl}/sessions/${sessionDbId}/status`);
      lastStatus = status;
      if (status.status === 'not_found' || (status.queueLength || 0) === 0) return;

      if (status.queueLength === lastQueueLength) {
        if (!stuckSince) stuckSince = Date.now();
        const stuckFor = Date.now() - stuckSince;
        // If stuck at 1 item for 2 min, accept it — the worker likely dropped that observation
        if (status.queueLength <= 1 && stuckFor > 120_000) return;
        if (stuckFor > 300_000) {
          throw new Error(`Queue stuck for 5m at ${status.queueLength} — last status: ${JSON.stringify(status)}`);
        }
      } else {
        stuckSince = null;
        lastQueueLength = status.queueLength;
      }
    } catch (err) {
      if (err.message?.includes('Queue stuck')) throw err;
      return; // Session may have been cleaned up
    }
    await sleep(2000);
  }
  const elapsed = Math.round((Date.now() - start) / 1000);
  throw new Error(`Queue drain timeout after ${elapsed}s — last status: ${JSON.stringify(lastStatus)}`);
}

// ── Session Replay Pipeline ──────────────────────────────────────────────────

async function replaySession(baseUrl, session, verbose) {
  const { uuid, filePath, projectName } = session;
  const log = verbose ? (msg) => console.log(`\n  [${uuid.slice(0,8)}] ${msg}`) : () => {};
  const parsed = await parseSession(filePath);

  if (parsed.prompts.length === 0) return { status: 'skipped', reason: 'no_prompts' };

  const contentSessionId = parsed.prompts[0].sessionId || uuid;
  const cwd = parsed.prompts[0].cwd || '';
  const promptGroups = groupByPrompt(parsed.prompts, parsed.toolPairs);

  let sessionDbId = null;

  for (let i = 0; i < promptGroups.length; i++) {
    const group = promptGroups[i];
    log(`prompt ${i + 1}/${promptGroups.length} (${group.tools.length} tools)`);

    const initRes = await httpPostWithRetry(`${baseUrl}/api/sessions/init`, {
      contentSessionId,
      project: projectName,
      prompt: group.promptText,
    });

    sessionDbId = initRes.sessionDbId;
    if (initRes.skipped) { log(`skipped (already exists)`); continue; }

    await httpPostWithRetry(`${baseUrl}/sessions/${sessionDbId}/init`, {
      userPrompt: group.promptText,
      promptNumber: i + 1,
    });

    for (const tool of group.tools) {
      await httpPostWithRetry(`${baseUrl}/api/sessions/observations`, {
        contentSessionId,
        tool_name: tool.toolName,
        tool_input: tool.toolInput,
        tool_response: tool.toolResponse,
        cwd: tool.cwd || cwd,
      });
    }
    log(`sent ${group.tools.length} observations, dbId=${sessionDbId}`);
  }

  if (!sessionDbId) return { status: 'skipped', reason: 'init_failed' };

  log(`draining observation queue...`);
  await waitForQueueDrain(baseUrl, sessionDbId, 600_000);

  if (parsed.lastAssistantText) {
    log(`sending summary...`);
    await httpPostWithRetry(`${baseUrl}/api/sessions/summarize`, {
      contentSessionId,
      last_assistant_message: parsed.lastAssistantText.slice(0, 4000),
    });
    log(`draining summary queue...`);
    await waitForQueueDrain(baseUrl, sessionDbId, 300_000);
  }

  await httpPostWithRetry(`${baseUrl}/api/sessions/complete`, { contentSessionId });

  return { status: 'ok', tools: parsed.toolPairs.length, prompts: parsed.prompts.length };
}

// ── Concurrency Engine ───────────────────────────────────────────────────────

class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }
  async acquire() {
    if (this.current < this.max) { this.current++; return; }
    await new Promise(resolve => this.queue.push(resolve));
  }
  release() {
    if (this.queue.length > 0) {
      this.queue.shift()(); // transfer slot directly to waiter
    } else {
      this.current--;
    }
  }
}

// ── Progress Display ─────────────────────────────────────────────────────────

function printProgress(done, total, active, failed, startTime) {
  const pct = total > 0 ? done / total : 0;
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = elapsed > 0 ? done / elapsed : 0;
  const eta = rate > 0 ? Math.round((total - done) / rate) : 0;
  const etaStr = eta > 3600 ? `${Math.floor(eta / 3600)}h ${Math.floor((eta % 3600) / 60)}m`
    : eta > 60 ? `${Math.floor(eta / 60)}m ${eta % 60}s` : `${eta}s`;

  const barWidth = 30;
  const filled = Math.round(barWidth * pct);
  const bar = '='.repeat(filled) + (filled < barWidth ? '>' : '') + ' '.repeat(Math.max(0, barWidth - filled - 1));

  process.stdout.write(`\r[${bar}] ${done}/${total}  |  ${active} active  |  ${failed} failed  |  ETA: ${etaStr}   `);
}

// ── Process All Sessions ─────────────────────────────────────────────────────

let shuttingDown = false;

async function processAll(baseUrl, sessions, args, state) {
  const sem = new Semaphore(args.concurrency);
  const completedSet = new Set(state.completed);
  const remaining = sessions.filter(s => !completedSet.has(s.uuid));

  // Clear old failures — they'll be retried this run
  const prevFailed = Object.keys(state.failed).length;
  state.failed = {};
  state.stats.failed = 0;

  state.stats.total = sessions.length;
  console.log(`\nDiscovered ${sessions.length} qualifying sessions`);
  if (completedSet.size > 0 || prevFailed > 0)
    console.log(`Resuming: ${completedSet.size} completed, ${prevFailed} retrying, ${remaining.length - prevFailed} new`);
  console.log('');

  let active = 0;
  let done = completedSet.size;
  let failed = 0;
  const startTime = Date.now();
  let pendingFlush = 0;
  const retryQueue = [];

  async function runSession(session) {
    if (shuttingDown) return 'shutdown';
    await sem.acquire();
    if (shuttingDown) { sem.release(); return 'shutdown'; }
    active++;

    try {
      const result = await replaySession(baseUrl, session, args.verbose);
      if (result.status === 'ok') {
        markCompleted(state, session.uuid);
        done++;
      } else {
        state.stats.skipped++;
      }
      if (args.verbose)
        console.log(`\n  [OK] ${session.projectName}/${session.uuid} (${result.tools || 0} tools)`);
      return 'ok';
    } catch (err) {
      if (args.verbose)
        console.log(`\n  [FAIL] ${session.projectName}/${session.uuid}: ${err.message}`);
      return err.message;
    } finally {
      active--;
      sem.release();
      pendingFlush++;
      if (pendingFlush >= 10) { saveState(state); pendingFlush = 0; }
      printProgress(done, sessions.length, active, failed, startTime);
    }
  }

  // First pass
  await Promise.all(remaining.map(async (session) => {
    const result = await runSession(session);
    if (result !== 'ok' && result !== 'shutdown') retryQueue.push(session);
  }));

  // Retry pass — one-at-a-time with 10s delay between attempts
  if (retryQueue.length > 0 && !shuttingDown) {
    console.log(`\n\nRetrying ${retryQueue.length} failed session(s)...`);
    for (let ri = 0; ri < retryQueue.length; ri++) {
      if (shuttingDown) break;
      const session = retryQueue[ri];
      process.stdout.write(`\r  Retry ${ri + 1}/${retryQueue.length}: ${session.projectName} — waiting 10s...   `);
      await sleep(10_000);
      process.stdout.write(`\r  Retry ${ri + 1}/${retryQueue.length}: ${session.projectName} — processing...   `);
      const result = await runSession(session);
      if (result !== 'ok' && result !== 'shutdown') {
        markFailed(state, session.uuid, result);
        failed++;
      }
      printProgress(done, sessions.length, active, failed, startTime);
    }
  }

  saveState(state);
}

// ── Graceful Shutdown ────────────────────────────────────────────────────────

function setupShutdownHandlers(state, originalSettings) {
  const handler = (signal) => {
    if (shuttingDown) {
      console.log(`\nForce exit (${signal})`);
      saveState(state);
      restoreSettings(originalSettings);
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`\n${signal} received — finishing in-flight sessions, then saving state...`);
  };
  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const baseUrl = getWorkerBaseUrl();

  console.log('claude-mem backfill v1.0');
  console.log('\u2501'.repeat(24));
  console.log(`Source: ${args.dirs.join(', ')}`);
  console.log(`Min tools: ${args.minTools} | Concurrency: ${args.concurrency}`);

  const sessions = discoverSessions(args.dirs, args.minTools, args.after);

  // Single session mode
  if (args.session) {
    const match = sessions.find(s => s.uuid === args.session);
    if (!match) {
      console.error(`Session ${args.session} not found in qualifying sessions`);
      process.exit(1);
    }
    if (args.dryRun) {
      const parsed = await parseSession(match.filePath);
      console.log(`\nSession: ${match.uuid}`);
      console.log(`Project: ${match.projectName}`);
      console.log(`Prompts: ${parsed.prompts.length}`);
      console.log(`Tool pairs: ${parsed.toolPairs.length}`);
      console.log(`Last assistant text: ${parsed.lastAssistantText.length} chars`);
      return;
    }
    if (!await checkWorkerHealth(baseUrl)) {
      console.error(`Worker not responding at ${baseUrl}. Start claude-mem first.`);
      process.exit(1);
    }
    const result = await replaySession(baseUrl, match, true);
    console.log(`\nResult: ${JSON.stringify(result)}`);
    return;
  }

  // List mode
  if (args.list) {
    printSessionList(sessions);
    return;
  }

  if (sessions.length === 0) {
    console.log('\nNo qualifying sessions found.');
    return;
  }

  // Dry-run mode
  if (args.dryRun) {
    printSessionList(sessions);
    const totalTools = sessions.reduce((s, x) => s + x.toolCount, 0);
    console.log(`\nDry run summary: ${sessions.length} sessions, ${totalTools} tool calls`);
    console.log('Run without --dry-run to start backfill.');
    return;
  }

  // Health check
  if (!await checkWorkerHealth(baseUrl)) {
    console.error(`\nWorker not responding at ${baseUrl}. Start claude-mem first.`);
    process.exit(1);
  }
  console.log(`Worker: ${baseUrl} \u2713`);

  // Configure worker for backfill
  const originalSettings = configureForBackfill(args.concurrency);
  console.log(`Model: ${BACKFILL_MODEL} (was: ${originalSettings.CLAUDE_MEM_MODEL || 'default'})`);
  console.log(`Max agents: ${args.concurrency} (was: ${originalSettings.CLAUDE_MEM_MAX_CONCURRENT_AGENTS || 'default'})`);

  // Load state & run
  const state = loadState();
  setupShutdownHandlers(state, originalSettings);
  try {
    await processAll(baseUrl, sessions, args, state);
  } finally {
    restoreSettings(originalSettings);
    console.log('\nSettings restored.');
  }
  console.log('\nBackfill complete.');
  console.log(`Processed: ${state.stats.processed} | Skipped: ${state.stats.skipped} | Failed: ${state.stats.failed}`);
}

main().catch(err => { console.error(`Fatal: ${err.message}`); process.exit(1); });
