// @netcatty/dsh-mcp — lazy MCP client + /mcp manager for DeepSeek Harness.
//
// One router tool (`mcp`) is exposed to the model; server tools stay out of the
// context until the model asks for them. Connections open on first use, so a
// broken server only affects its own row.

import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { authorizationUrl, discover, exchange, isExpired, loopback, oauthRecord, pkce, refresh, register, removeOauth, saveOauth } from './oauth.js';

export const name = 'mcp';
export const inject = ['tools'];
export const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
})();

const SETTINGS_PATH = join(homedir(), '.dsh', 'mcp-settings.json');
const AUDIT_PATH = join(homedir(), '.dsh', 'mcp-audit.jsonl');

function auditCall(record) {
  try {
    mkdirSync(dirname(AUDIT_PATH), { recursive: true });
    appendFileSync(AUDIT_PATH, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
  } catch {
    // Auditing must never break a call.
  }
}

function readSettings(path = SETTINGS_PATH) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch, path = SETTINGS_PATH) {
  const next = { ...readSettings(path), ...patch };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

const DEFAULT_CALL_TIMEOUT_MS = 60_000;

async function oauthHeaders(server) {
  if (server.oauth !== true) return {};
  let record = oauthRecord(server.name);
  if (record === undefined) throw new Error(`mcp: server "${server.name}" 需要 OAuth 登录`);
  if (isExpired(record) && typeof record.refresh_token === 'string') {
    record = { ...record, ...(await refresh(record.metadata, record.client_id, record)) };
    saveOauth(server.name, record);
  }
  if (isExpired(record)) throw new Error(`mcp: server "${server.name}" 的 OAuth token 已过期，请重新登录`);
  return { Authorization: `${record.token_type ?? 'Bearer'} ${record.access_token}` };
}

function createTransport(server, extraHeaders = {}) {
  if (server.toolCallTimeoutMs !== undefined && (typeof server.toolCallTimeoutMs !== 'number' || server.toolCallTimeoutMs <= 0)) throw new Error(`服务器 "${server.name}" 的 toolCallTimeoutMs 必须是正数`);
      if (server.transport === 'stdio') {
    return new StdioClientTransport({
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      env: { ...process.env, ...(server.env ?? {}) },
      cwd: server.cwd || undefined,
      stderr: 'pipe',
    });
  }
  if (server.transport === 'streamable-http') {
    return new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { ...(server.headers ?? {}), ...extraHeaders } },
    });
  }
  throw new Error(`mcp: unknown transport "${server.transport}" for server "${server.name}"`);
}

/**
 * Build the lazy connection registry used by both the tool and `/mcp`.
 * @param {Array<object>} servers - server configurations (name + transport fields).
 */
export function createRegistry(servers = []) {
  const entries = new Map();
  for (const server of servers) {
    if (typeof server?.name !== 'string' || server.name === '') throw new Error('mcp: every server needs a name');
    if (entries.has(server.name)) throw new Error(`mcp: duplicate server name "${server.name}"`);
    entries.set(server.name, { config: server, disabled: server.enabled === false, reconnects: 0, client: undefined, transport: undefined, tools: undefined, error: undefined, connecting: undefined, calls: 0 });
  }

  async function close(entry) {
    try {
      await entry.client?.close?.();
    } catch {
      // A failed close must not mask the original error.
    }
    entry.client = undefined;
    entry.transport = undefined;
    entry.tools = undefined;
  }

  async function connect(entry) {
    if (entry.client !== undefined) return entry;
    if (entry.connecting !== undefined) return entry.connecting;
    entry.error = undefined;
    entry.connecting = (async () => {
      const extraHeaders = await oauthHeaders(entry.config);
      const transport = createTransport(entry.config, extraHeaders);
      const client = new Client(
        { name: 'dsh-mcp', version: VERSION },
        { capabilities: {}, versionNegotiation: { mode: 'auto' } },
      );
      await client.connect(transport);
      const capabilities = client.getServerCapabilities();
      const list = capabilities?.tools === undefined ? { tools: [] } : await client.listTools(undefined, { cacheMode: 'refresh' });
      entry.client = client;
      entry.transport = transport;
      entry.tools = list.tools ?? [];
      return entry;
    })();
    try {
      await entry.connecting;
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      await close(entry);
    } finally {
      entry.connecting = undefined;
    }
    return entry;
  }

  async function ensure(name) {
    const entry = entries.get(name);
    if (entry === undefined) throw new Error(`mcp: unknown server "${name}"`);
    if (entry.disabled) throw new Error(`mcp: server "${name}" is disabled`);
    await connect(entry);
    if (entry.error !== undefined) throw new Error(`mcp: server "${name}" failed: ${entry.error}`);
    return entry;
  }

  return {
    servers: () => [...entries.values()],
    connectedCount: () => [...entries.values()].filter((entry) => entry.client !== undefined).length,
    ensure,
    async list() {
      return [...entries.values()].map((entry) => ({
        name: entry.config.name,
        transport: entry.config.transport,
        target: entry.config.transport === 'stdio' ? `${entry.config.command} ${(entry.config.args ?? []).join(' ')}`.trim() : entry.config.url,
        status: entry.disabled ? 'disabled' : entry.client !== undefined ? 'connected' : entry.error !== undefined ? 'error' : 'idle',
        enabled: entry.config.enabled !== false,
        oauth: entry.config.oauth === true,
        oauthLoggedIn: oauthRecord(entry.config.name) !== undefined,
        tools: entry.tools?.length ?? 0,
        calls: entry.calls,
        reconnects: entry.reconnects,
        error: entry.error,
      }));
    },
    async toolsOf(server) {
      const entry = await ensure(server);
      const blocked = new Set(entry.config.disabledTools ?? []);
      return entry.tools
        .filter((tool) => !blocked.has(tool.name))
        .map((tool) => ({ name: tool.name, description: tool.description ?? '', disabled: blocked.has(tool.name) }));
    },
    async search(query) {
      const needle = String(query ?? '').toLowerCase();
      const hits = [];
      for (const entry of entries.values()) {
        if (entry.client === undefined || entry.tools === undefined) continue;
        const blocked = new Set(entry.config.disabledTools ?? []);
        for (const tool of entry.tools) {
          if (blocked.has(tool.name)) continue;
          if (needle === '' || tool.name.toLowerCase().includes(needle) || (tool.description ?? '').toLowerCase().includes(needle)) {
            hits.push({ server: entry.config.name, name: tool.name, description: tool.description ?? '' });
          }
        }
      }
      return hits;
    },
    async resourcesOf(server) {
      const entry = await ensure(server);
      const capabilities = entry.client.getServerCapabilities();
      if (capabilities?.resources === undefined) return [];
      const list = await entry.client.listResources(undefined, { cacheMode: 'refresh' });
      return list.resources ?? [];
    },
    async promptsOf(server) {
      const entry = await ensure(server);
      const capabilities = entry.client.getServerCapabilities();
      if (capabilities?.prompts === undefined) return [];
      const list = await entry.client.listPrompts(undefined, { cacheMode: 'refresh' });
      return list.prompts ?? [];
    },
    async readResource(server, uri) {
      const entry = await ensure(server);
      return entry.client.readResource({ uri });
    },
    async getPrompt(server, name, args) {
      const entry = await ensure(server);
      return entry.client.getPrompt({ name, arguments: args ?? {} });
    },
    async describe(server, toolName) {
      const entry = await ensure(server);
      if ((entry.config.disabledTools ?? []).includes(toolName)) throw new Error(`mcp: tool "${server}/${toolName}" is disabled`);
      const tool = entry.tools.find((item) => item.name === toolName);
      if (tool === undefined) throw new Error(`mcp: server "${server}" has no tool "${toolName}"`);
      return tool;
    },
    async call(server, toolName, args, options = {}) {
      const entry = await ensure(server);
      if ((entry.config.disabledTools ?? []).includes(toolName)) throw new Error(`mcp: tool "${server}/${toolName}" is disabled`);
      const tool = entry.tools.find((item) => item.name === toolName);
      if (tool === undefined) throw new Error(`mcp: server "${server}" has no tool "${toolName}"`);
      entry.calls += 1;
      const startedAt = Date.now();
      try {
        const result = await entry.client.callTool(
          { name: toolName, arguments: args ?? {} },
          { timeout: options.timeout ?? entry.config.toolCallTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, signal: options.signal, toolDefinition: tool },
        );
        auditCall({ server, tool: toolName, ms: Date.now() - startedAt, ok: result.isError !== true });
        return result;
      } catch (error) {
        auditCall({ server, tool: toolName, ms: Date.now() - startedAt, ok: false, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    async refresh(name) {
      const entry = entries.get(name);
      if (entry === undefined) throw new Error(`mcp: unknown server "${name}"`);
      entry.reconnects += 1;
      await close(entry);
      return ensure(name);
    },
    async dispose() {
      await Promise.all([...entries.values()].map((entry) => close(entry)));
    },
  };
}

function renderCallResult(result) {
  const parts = [];
  for (const block of result.content ?? []) {
    if (block.type === 'text') parts.push(block.text);
    else parts.push(JSON.stringify(block));
  }
  if (parts.length === 0 && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  return parts.join('\n');
}

function formatServers(rows) {
  return rows.map((row) => `${row.name} [${row.status}] ${row.transport} ${row.target} tools=${row.tools}${row.error ? ` error=${row.error}` : ''}`).join('\n');
}

/**
 * Parse and run one `/mcp` invocation.
 *   /mcp                         all servers
 *   /mcp refresh                 reconnect every server
 *   /mcp <server>                one server row
 *   /mcp <server> tools          tool names
 *   /mcp <server> call <tool> [json]
 *   /mcp <server> refresh        reconnect that server
 *   /mcp help
 */
export async function runCommand(registry, rawInput = '') {
  const text = rawInput.trim();
  if (text === '' ) return { kind: 'success', text: formatServers(await registry.list()) || '尚未配置 MCP 服务器' };
  const tokens = text.split(/\s+/);
  const first = tokens[0];

  if (first === 'help') {
    return { kind: 'success', text: '/mcp | /mcp <server> | /mcp <server> tools | /mcp <server> call <tool> [json] | /mcp <server> refresh | /mcp refresh' };
  }
  if (first === 'refresh') {
    const rows = await registry.list();
    const results = [];
    for (const row of rows) {
      try {
        await registry.refresh(row.name);
        results.push(`${row.name}: 已重连`);
      } catch (error) {
        results.push(`${row.name}: 失败 ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { kind: 'success', text: results.join('\n') || '尚未配置 MCP 服务器' };
  }

  const server = first;
  const action = tokens[1] ?? 'status';
  try {
    if (action === 'status') {
      const rows = (await registry.list()).filter((row) => row.name === server);
      if (rows.length === 0) return { kind: 'error', text: `未知服务器 "${server}"；可用：${(await registry.list()).map((row) => row.name).join(', ')}` };
      return { kind: 'success', text: formatServers(rows) };
    }
    if (action === 'tools') {
      const tools = await registry.toolsOf(server);
      return { kind: 'success', text: tools.map((tool) => `${tool.name}${tool.description ? ` — ${tool.description}` : ''}`).join('\n') || '(无工具)' };
    }
    if (server === 'search') {
      const hits = await registry.search(tokens.slice(1).join(' '));
      if (hits.length === 0) {
        return { kind: 'success', text: registry.connectedCount() === 0 ? '没有已连接的服务器；先 /mcp <server> tools 再搜索' : '(无匹配工具)' };
      }
      return { kind: 'success', text: hits.map((hit) => `${hit.server}/${hit.name}`).join('\n') };
    }
    if (action === 'resources') {
      const resources = await registry.resourcesOf(server);
      return { kind: 'success', text: resources.map((item) => `${item.uri}${item.name ? ` — ${item.name}` : ''}`).join('\n') || '(无资源)' };
    }
    if (action === 'prompts') {
      const prompts = await registry.promptsOf(server);
      return { kind: 'success', text: prompts.map((item) => `${item.name}${item.description ? ` — ${item.description}` : ''}`).join('\n') || '(无提示词)' };
    }
    if (action === 'read') {
      const uri = tokens[2];
      if (uri === undefined) return { kind: 'error', text: '用法：/mcp <server> read <uri>' };
      const result = await registry.readResource(server, uri);
      return { kind: 'success', text: (result.contents ?? []).map((item) => item.text ?? JSON.stringify(item)).join('\n') };
    }
    if (action === 'prompt') {
      const name = tokens[2];
      if (name === undefined) return { kind: 'error', text: '用法：/mcp <server> prompt <name> [json]' };
      const result = await registry.getPrompt(server, name, {});
      return { kind: 'success', text: JSON.stringify(result) };
    }
    if (action === 'refresh') {
      await registry.refresh(server);
      return { kind: 'success', text: `${server}: 已重连` };
    }
    if (action === 'call') {
      const tool = tokens[2];
      if (tool === undefined) return { kind: 'error', text: '用法：/mcp <server> call <tool> [json]' };
      const jsonText = text.slice(text.indexOf(tool, text.indexOf(server) + server.length) + tool.length).trim();
      let args = {};
      if (jsonText !== '') {
        try {
          args = JSON.parse(jsonText);
        } catch {
          return { kind: 'error', text: `参数不是合法 JSON：${jsonText}` };
        }
      }
      const result = await registry.call(server, tool, args);
      return { kind: 'success', text: renderCallResult(result) };
    }
    return { kind: 'error', text: `未知子命令 "${action}"；可用：status, tools, call, refresh` };
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
  }
}

function renderServers(rows) {
  return rows.map((row) => `${row.name} [${row.status}] ${row.transport} ${row.target} tools=${row.tools}${row.error ? ` error=${row.error}` : ''}`).join('\n');
}

export function apply(ctx, config = {}) {
  const settingsPath = typeof config.settingsPath === 'string' && config.settingsPath !== '' ? config.settingsPath : SETTINGS_PATH;
  const saved = readSettings(settingsPath);
  let settings = { showInSidebar: false, ...saved };
  if (saved.showInSidebar === undefined && config.showInSidebar !== undefined) settings.showInSidebar = config.showInSidebar === true;
  const initialServers = Array.isArray(saved.servers) ? saved.servers : (Array.isArray(config.servers) ? config.servers : []);
  let registry = createRegistry(initialServers);
  const oauthFlows = new Map();

  const initialServersForUi = () => { const current = readSettings(settingsPath); return Array.isArray(current.servers) ? current.servers : initialServers; };

  const validateServers = (value) => {
    if (!Array.isArray(value)) throw new Error('servers must be an array');
    const names = new Set();
    for (const server of value) {
      if (typeof server?.name !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(server.name)) throw new Error(`服务器名称不合法（${JSON.stringify(server?.name ?? '')}）：只能用字母、数字、下划线和短横线，长度 1–32`);
      if (names.has(server.name)) throw new Error(`服务器名称重复："${server.name}" 已存在`);
      names.add(server.name);
      if (server.oauth !== undefined && typeof server.oauth !== 'boolean') throw new Error(`服务器 "${server.name}" 的 oauth 必须是布尔值`);
      if (server.disabledTools !== undefined && (!Array.isArray(server.disabledTools) || server.disabledTools.some((item) => typeof item !== 'string'))) throw new Error(`服务器 "${server.name}" 的 disabledTools 必须是字符串数组`);
      if (typeof server.enabled !== 'undefined' && typeof server.enabled !== 'boolean') throw new Error(`服务器 "${server.name}" 的 enabled 必须是布尔值`);
      if (server.toolCallTimeoutMs !== undefined && (typeof server.toolCallTimeoutMs !== 'number' || server.toolCallTimeoutMs <= 0)) throw new Error(`服务器 "${server.name}" 的 toolCallTimeoutMs 必须是正数`);
      if (server.transport === 'stdio') {
        if (typeof server.command !== 'string' || server.command === '') throw new Error(`stdio 服务器 "${server.name}" 缺少启动命令 command`);
      } else if (server.transport === 'streamable-http') {
        if (typeof server.url !== 'string' || server.url === '') throw new Error(`HTTP 服务器 "${server.name}" 缺少 url`);
      } else {
        throw new Error(`服务器 "${server.name}" 的传输方式未知：应为 stdio 或 streamable-http`);
      }
    }
    return value;
  };

  ctx.on('dispose', () => void registry.dispose());

  ctx.tools.register({
    name: 'mcp',
    description:
      'Access lazily-connected MCP servers. Actions: servers (status), tools (list a server\'s tools), describe (input schema of one tool), call (invoke server/tool), refresh (reconnect). Server tools are not loaded into context until used.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['servers', 'tools', 'search', 'describe', 'call', 'refresh', 'resources', 'prompts', 'read', 'prompt'], description: 'Operation to run.' },
        query: { type: 'string', description: 'Search text for action=search.' },
        uri: { type: 'string', description: 'Resource URI for action=read.' },
        server: { type: 'string', description: 'Server name (see action=servers).' },
        tool: { type: 'string', description: 'Tool name for describe/call.' },
        arguments: { type: 'object', description: 'Arguments for action=call.' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute: async (args) => {
      const action = args?.action;
      if (action === 'servers') return { text: renderServers(await registry.list()) };
      if (action === 'tools') {
        if (typeof args.server !== 'string') throw new Error('mcp: action=tools needs "server"');
        const tools = await registry.toolsOf(args.server);
        return { text: tools.map((tool) => `${tool.name}${tool.description ? ` — ${tool.description}` : ''}`).join('\n') || '(no tools)' };
      }
      if (action === 'search') {
        if (typeof args.query !== 'string') throw new Error('mcp: action=search needs "query"');
        const hits = await registry.search(args.query);
        if (hits.length === 0) {
          return { text: registry.connectedCount() === 0 ? '没有已连接的服务器；先 mcp({action:"tools",server:"…"}) 触发连接再搜索' : '(无匹配工具)' };
        }
        return { text: hits.map((hit) => `${hit.server}/${hit.name}${hit.description ? ` — ${hit.description}` : ''}`).join('\n') };
      }
      if (action === 'describe') {
        if (typeof args.server !== 'string' || typeof args.tool !== 'string') throw new Error('mcp: action=describe needs "server" and "tool"');
        return { text: JSON.stringify(await registry.describe(args.server, args.tool)) };
      }
      if (action === 'call') {
        if (typeof args.server !== 'string' || typeof args.tool !== 'string') throw new Error('mcp: action=call needs "server" and "tool"');
        return { text: renderCallResult(await registry.call(args.server, args.tool, args.arguments ?? {})) };
      }
      if (action === 'resources') {
        if (typeof args.server !== 'string') throw new Error('mcp: action=resources needs "server"');
        const resources = await registry.resourcesOf(args.server);
        return { text: resources.map((item) => `${item.uri}${item.name ? ` — ${item.name}` : ''}${item.mimeType ? ` (${item.mimeType})` : ''}`).join('\n') || '(无资源)' };
      }
      if (action === 'prompts') {
        if (typeof args.server !== 'string') throw new Error('mcp: action=prompts needs "server"');
        const prompts = await registry.promptsOf(args.server);
        return { text: prompts.map((item) => `${item.name}${item.description ? ` — ${item.description}` : ''}`).join('\n') || '(无提示词)' };
      }
      if (action === 'read') {
        if (typeof args.server !== 'string' || typeof args.uri !== 'string') throw new Error('mcp: action=read needs "server" and "uri"');
        const result = await registry.readResource(args.server, args.uri);
        const parts = (result.contents ?? []).map((item) => item.text ?? item.blob ?? JSON.stringify(item));
        return { text: parts.join('\n') || JSON.stringify(result) };
      }
      if (action === 'prompt') {
        if (typeof args.server !== 'string' || typeof args.tool !== 'string') throw new Error('mcp: action=prompt needs "server" and "tool" (prompt name)');
        const result = await registry.getPrompt(args.server, args.tool, args.arguments ?? {});
        return { text: JSON.stringify(result) };
      }
      if (server === 'search') {
      const hits = await registry.search(tokens.slice(1).join(' '));
      if (hits.length === 0) {
        return { kind: 'success', text: registry.connectedCount() === 0 ? '没有已连接的服务器；先 /mcp <server> tools 再搜索' : '(无匹配工具)' };
      }
      return { kind: 'success', text: hits.map((hit) => `${hit.server}/${hit.name}`).join('\n') };
    }
    if (action === 'resources') {
      const resources = await registry.resourcesOf(server);
      return { kind: 'success', text: resources.map((item) => `${item.uri}${item.name ? ` — ${item.name}` : ''}`).join('\n') || '(无资源)' };
    }
    if (action === 'prompts') {
      const prompts = await registry.promptsOf(server);
      return { kind: 'success', text: prompts.map((item) => `${item.name}${item.description ? ` — ${item.description}` : ''}`).join('\n') || '(无提示词)' };
    }
    if (action === 'read') {
      const uri = tokens[2];
      if (uri === undefined) return { kind: 'error', text: '用法：/mcp <server> read <uri>' };
      const result = await registry.readResource(server, uri);
      return { kind: 'success', text: (result.contents ?? []).map((item) => item.text ?? JSON.stringify(item)).join('\n') };
    }
    if (action === 'prompt') {
      const name = tokens[2];
      if (name === undefined) return { kind: 'error', text: '用法：/mcp <server> prompt <name> [json]' };
      const result = await registry.getPrompt(server, name, {});
      return { kind: 'success', text: JSON.stringify(result) };
    }
    if (action === 'refresh') {
        if (typeof args.server !== 'string') throw new Error('mcp: action=refresh needs "server"');
        await registry.refresh(args.server);
        return { text: `mcp: refreshed "${args.server}"` };
      }
      throw new Error(`mcp: unknown action "${action}"`);
    },
  });

  // HTTP surface for the settings page and optional sidebar page.
  ctx.inject?.(['webServer'], (scope) => {
    const webServer = scope.webServer;
    if (webServer?.register === undefined) return;
    const trusted = new Set(config.trustedHosts ?? []);
    const allowed = (req) => {
      const remote = req.socket?.remoteAddress ?? '';
      if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') return true;
      const host = String(req.headers.host ?? '').split(':')[0];
      if (trusted.has(host)) return true;
      const origin = String(req.headers.origin ?? '');
      try {
        return origin !== '' && new URL(origin).hostname === host;
      } catch {
        return false;
      }
    };
    const json = (res, status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    const readBody = async (req, limit = 64 * 1024) => {
      let body = '';
      for await (const chunk of req) {
        body += String(chunk);
        if (body.length > limit) throw new Error('body too large');
      }
      return body === '' ? {} : JSON.parse(body);
    };
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/mcp/status',
      handler: async (req, res) => {
        if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
        try {
          json(res, 200, { servers: await registry.list(), showInSidebar: settings.showInSidebar === true });
        } catch (error) {
          json(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }), 'dsh-mcp: status route');
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/mcp/refresh',
      handler: async (req, res) => {
        if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        try {
          const body = await readBody(req);
          if (typeof body.server === 'string' && body.server !== '') await registry.refresh(body.server);
          else for (const row of await registry.list()) await registry.refresh(row.name).catch(() => {});
          json(res, 200, { servers: await registry.list() });
        } catch (error) {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }), 'dsh-mcp: refresh route');
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/mcp/config',
      handler: async (req, res) => {
        if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
        if (req.method === 'GET') {
          json(res, 200, { servers: initialServersForUi() });
          return;
        }
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        try {
          const body = await readBody(req);
          const servers = validateServers(body.servers);
          writeSettings({ servers }, settingsPath);
          const previous = registry;
          registry = createRegistry(servers);
          await previous.dispose();
          json(res, 200, { servers: await registry.list() });
        } catch (error) {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }), 'dsh-mcp: config route');
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/mcp/settings',
      handler: async (req, res) => {
        if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        try {
          const body = await readBody(req);
          if (typeof body.showInSidebar !== 'boolean') return json(res, 400, { error: 'showInSidebar must be boolean' });
          settings = { ...settings, ...writeSettings({ showInSidebar: body.showInSidebar }, settingsPath) };
          json(res, 200, { showInSidebar: settings.showInSidebar });
        } catch (error) {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }), 'dsh-mcp: settings route');
    const resourceRoute = (path, handler) => ctx.effect(() => webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        try {
          const body = await readBody(req);
          if (typeof body.server !== 'string') return json(res, 400, { error: 'server is required' });
          json(res, 200, await handler(body));
        } catch (error) {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }), `dsh-mcp: ${path}`);
    resourceRoute('/api/mcp/resources', async (body) => ({ resources: await registry.resourcesOf(body.server) }));
    resourceRoute('/api/mcp/prompts', async (body) => ({ prompts: await registry.promptsOf(body.server) }));
    resourceRoute('/api/mcp/read', async (body) => {
      if (typeof body.uri !== 'string') throw new Error('uri is required');
      return { contents: (await registry.readResource(body.server, body.uri)).contents ?? [] };
    });
    resourceRoute('/api/mcp/prompt', async (body) => {
      if (typeof body.name !== 'string') throw new Error('name is required');
      return { result: await registry.getPrompt(body.server, body.name, body.arguments ?? {}) };
    });

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/mcp/oauth/start',
      handler: async (req, res) => {
        if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        try {
          const body = await readBody(req);
          const server = (await registry.list()).find((item) => item.name === body.server);
          const config = initialServersForUi().find((item) => item.name === body.server);
          if (config === undefined) throw new Error(`未知服务器 "${body.server}"`);
          if (config.transport !== 'streamable-http') throw new Error('OAuth 只支持 streamable-http 服务器');
          const metadata = await discover(config.url);
          if (metadata === undefined) throw new Error('未发现 OAuth 元数据（well-known 均不可用）');
          const challenge = pkce();
          const state = randomUUID();
          const listener = loopback(state);
          const port = await listener.port;
          const redirectUri = `http://127.0.0.1:${port}/callback`;
          const registered = await register(metadata, redirectUri);
          const clientId = registered?.client_id ?? config.clientId;
          if (typeof clientId !== 'string' || clientId === '') throw new Error('缺少 client_id，且服务器不支持动态注册');
          const flowId = randomUUID();
          const url = authorizationUrl(metadata, clientId, redirectUri, challenge.challenge, state);
          oauthFlows.set(flowId, { status: 'pending', url, server: config.name, error: '' });
          listener.code.then(async (code) => {
            try {
              const token = await exchange(metadata, clientId, code, challenge.verifier, redirectUri);
              saveOauth(config.name, { ...token, metadata, client_id: clientId });
              oauthFlows.set(flowId, { status: 'done', url, server: config.name, error: '' });
            } catch (error) {
              oauthFlows.set(flowId, { status: 'failed', url, server: config.name, error: String(error) });
            }
          }, (error) => oauthFlows.set(flowId, { status: 'failed', url, server: config.name, error: String(error) }));
          json(res, 200, { flowId, url });
        } catch (error) {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }), 'dsh-mcp: oauth start');
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/mcp/oauth/status',
      handler: async (req, res) => {
        if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
        const flowId = new URL(req.url ?? '/', 'http://x').searchParams.get('flowId') ?? '';
        json(res, 200, oauthFlows.get(flowId) ?? { status: 'unknown', error: '' });
      },
    }), 'dsh-mcp: oauth status');
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/mcp/oauth/logout',
      handler: async (req, res) => {
        if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
        try {
          const body = await readBody(req);
          if (typeof body.server === 'string') removeOauth(body.server);
          json(res, 200, { ok: true });
        } catch (error) {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }), 'dsh-mcp: oauth logout');

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/mcp/tools',
      handler: async (req, res) => {
        if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        try {
          const body = await readBody(req);
          if (typeof body.server !== 'string') return json(res, 400, { error: 'server is required' });
          const tools = await registry.toolsOf(body.server);
          json(res, 200, { tools });
        } catch (error) {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }), 'dsh-mcp: tools route');
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/mcp/call',
      handler: async (req, res) => {
        if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
        try {
          const body = await readBody(req);
          if (typeof body.server !== 'string' || typeof body.tool !== 'string') return json(res, 400, { error: 'server and tool are required' });
          const result = await registry.call(body.server, body.tool, body.arguments ?? {});
          json(res, 200, { text: renderCallResult(result) });
        } catch (error) {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    }), 'dsh-mcp: call route');
  });

  const commands = ctx.get?.('commands');
  if (commands?.register !== undefined) {
    (async () => {
      let definitionId = 'dsh-mcp/status';
      try {
        const brand = await import('@deepseek-ai/dsh-commands/brand');
        definitionId = brand.CommandDefinitionId('dsh-mcp/status');
      } catch {
        // Brand module is host-provided; the string id keeps stub environments working.
      }
      try {
        commands.register({
          definitionId,
          name: 'mcp',
          description: 'MCP 服务器：查看状态、工具列表与连接健康',
          input: { hint: '可留空查看状态' },
          handler: (invocation) => runCommand(registry, invocation?.rawInput ?? ''),
        });
        commands.register({
          definitionId: typeof definitionId === 'string' ? `${definitionId}-x` : definitionId,
          name: 'mcp-raw',
          description: 'MCP 原生命令（带参数，不弹选择器）',
          input: { hint: 'search <关键词> | <server> tools | <server> call <tool> [json]' },
          handler: (invocation) => runCommand(registry, invocation?.rawInput ?? ''),
        });
      } catch (error) {
        ctx.logger?.warn?.(`dsh-mcp: /mcp registration failed: ${String(error)}`);
      }
    })();
  }
}
