// Translate between the Claude-Desktop-style `mcpServers` document and this
// plugin's server records. Pure functions: validation of names/uniqueness stays
// in the plugin's own `validateServers`.

const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const REDACTED = '<REDACTED>';
const LOCAL_PATH = '<REDACTED:LOCAL_PATH>';

function assertName(name) {
  if (!NAME_RE.test(name) || name.includes('__')) {
    throw new Error(`服务器名称不合法（${JSON.stringify(name)}）：只能用字母、数字、下划线和短横线，长度 1–32，且不能包含 "__"`);
  }
}

function asStringArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} 必须是字符串数组`);
  }
  return [...value];
}

function asStringMap(value, label) {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error(`${label}.${key} 必须是字符串`);
    out[key] = item;
  }
  return out;
}

/** Parse a `{"mcpServers": {...}}` (or bare map) document into server records. */
function parseDocument(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    // A single entry copied out of a document (`"name": { ... }`) is not valid
    // JSON on its own; wrap it once and retry before reporting the failure.
    if (raw.trim().startsWith('"')) {
      try {
        return JSON.parse(`{${raw}}`);
      } catch {
        // Fall through to the original, more precise error.
      }
    }
    throw new Error(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseMcpServers(text) {
  const doc = parseDocument(String(text ?? ''));
  const map = doc?.mcpServers ?? doc?.servers ?? doc;
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    throw new Error('需要 {"mcpServers": {"名称": {...}}} 形式的对象');
  }
  const out = [];
  for (const [rawName, rawConfig] of Object.entries(map)) {
    const name = String(rawName);
    assertName(name);
    if (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig)) {
      throw new Error(`服务器 "${name}" 的配置必须是对象`);
    }
    const config = rawConfig;
    const server = { name };
    if (typeof config.url === 'string' && config.url !== '') {
      server.transport = 'streamable-http';
      server.url = config.url;
      const headers = asStringMap(config.headers, `${name}.headers`);
      if (headers !== undefined) server.headers = headers;
      if (config.oauth === true) server.oauth = true;
    } else {
      if (typeof config.command !== 'string' || config.command === '') {
        throw new Error(`服务器 "${name}" 需要 command（stdio）或 url（streamable-http）`);
      }
      server.transport = 'stdio';
      server.command = config.command;
      server.args = asStringArray(config.args, `${name}.args`);
      const env = asStringMap(config.env, `${name}.env`);
      if (env !== undefined) server.env = env;
      if (typeof config.cwd === 'string' && config.cwd !== '') server.cwd = config.cwd;
    }
    if (config.enabled === false) server.enabled = false;
    if (typeof config.workspaceId === 'string' && config.workspaceId !== '') server.workspaceId = config.workspaceId;
    if (typeof config.toolCallTimeoutMs === 'number' && config.toolCallTimeoutMs > 0) {
      server.toolCallTimeoutMs = config.toolCallTimeoutMs;
    }
    out.push(server);
  }
  if (out.length === 0) throw new Error('文档里没有任何服务器');
  return out;
}

/** Upsert incoming records by name; order is kept, later entries win. */
export function mergeServers(current, incoming) {
  const byName = new Map(current.map((server) => [server.name, server]));
  const added = [];
  const updated = [];
  for (const server of incoming) {
    if (byName.has(server.name)) updated.push(server.name);
    else added.push(server.name);
    byName.set(server.name, server);
  }
  return { servers: [...byName.values()], added, updated };
}

function redactValues(map, placeholder) {
  const out = {};
  for (const key of Object.keys(map)) out[key] = placeholder;
  return out;
}

/** Project one record to its `mcpServers` entry object. */
export function toMcpEntry(server, { redact = true } = {}) {
  return toMcpServers([server], { redact }).mcpServers[server.name];
}

/**
 * Render one server as a pasteable fragment: `"name": { ... }` without the
 * surrounding braces, matching the shape a document entry has.
 */
export function renderEntryText(server, { redact = true } = {}) {
  const lines = JSON.stringify({ [server.name]: toMcpEntry(server, { redact }) }, null, 2)
    .split('\n')
    .slice(1, -1);
  return lines.map((line) => (line.startsWith('  ') ? line.slice(2) : line)).join('\n');
}

/** Render several servers as one brace-less fragment list, comma separated. */
export function renderEntriesText(servers, { redact = true } = {}) {
  return servers.map((server) => renderEntryText(server, { redact })).join(',\n');
}

/** Project records back to the `mcpServers` document shape. */
export function toMcpServers(servers, { redact = true } = {}) {
  const map = {};
  for (const server of servers) {
    const entry = server.transport === 'stdio'
      ? {
        command: server.command,
        args: [...(server.args ?? [])],
        ...(server.env === undefined ? {} : { env: redact ? redactValues(server.env, REDACTED) : { ...server.env } }),
        ...(server.cwd === undefined ? {} : { cwd: redact ? LOCAL_PATH : server.cwd }),
      }
      : {
        url: server.url,
        ...(server.headers === undefined ? {} : { headers: redact ? redactValues(server.headers, REDACTED) : { ...server.headers } }),
        ...(server.oauth === true ? { oauth: true } : {}),
      };
    if (server.enabled === false) entry.enabled = false;
    if (server.workspaceId !== undefined) entry.workspaceId = server.workspaceId;
    if (typeof server.toolCallTimeoutMs === 'number') entry.toolCallTimeoutMs = server.toolCallTimeoutMs;
    map[server.name] = entry;
  }
  return { mcpServers: map };
}
