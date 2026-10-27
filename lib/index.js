// @netcatty/dsh-mcp — MCP manager for DeepSeek Harness.
//
// MCP itself belongs to the official `@deepseek-ai/dsh-mcp-client` rows this
// plugin provisions; the plugin adds a lazy visibility layer (schemas stay out
// of a session until activated), one router tool, a settings page and the /mcp
// commands. Transport, approval, images, instructions, reconnect and pagination
// therefore stay with the Host.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { authorizationUrl, discover, exchange, isExpired, loopback, oauthRecord, pkce, refresh as refreshGrant, register, removeOauth, saveOauth, setStorePath } from './oauth.js';
import { migrateLegacy, oauthPath, settingsPath as defaultSettingsPath } from './paths.js';
import { entryIdFor, provision, sync as syncEntries, unprovision } from './provision.js';
import { createVisibility, mcpToolDefinitions, parsePublicName, publicNameFor } from './visibility.js';

export const name = 'mcp';
export const inject = ['tools'];
export const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
})();

const oauthFlows = new Map();

function readSettings(path = defaultSettingsPath()) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch, path = defaultSettingsPath()) {
  const next = { ...readSettings(path), ...patch };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

function validateServers(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('servers 必须是数组');
  const names = new Set();
  for (const server of value) {
    if (typeof server !== 'object' || server === null) throw new Error('servers 的每一项必须是对象');
    if (typeof server.name !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(server.name) || server.name.includes('__')) {
      throw new Error(`服务器名称不合法（${JSON.stringify(server?.name ?? '')}）：只能用字母、数字、下划线和短横线，长度 1–32`);
    }
    if (names.has(server.name)) throw new Error(`服务器名称重复："${server.name}" 已存在`);
    names.add(server.name);
    if (server.oauth !== undefined && typeof server.oauth !== 'boolean') throw new Error(`服务器 "${server.name}" 的 oauth 必须是布尔值`);
    if (server.enabled !== undefined && typeof server.enabled !== 'boolean') throw new Error(`服务器 "${server.name}" 的 enabled 必须是布尔值`);
    if (server.toolCallTimeoutMs !== undefined && (typeof server.toolCallTimeoutMs !== 'number' || server.toolCallTimeoutMs <= 0)) {
      throw new Error(`服务器 "${server.name}" 的 toolCallTimeoutMs 必须是正数`);
    }
    if (server.transport === 'stdio') {
      if (typeof server.command !== 'string' || server.command === '') throw new Error(`stdio 服务器 "${server.name}" 缺少启动命令 command`);
    } else if (server.transport === 'streamable-http') {
      if (typeof server.url !== 'string' || server.url === '') throw new Error(`HTTP 服务器 "${server.name}" 缺少 url`);
    } else {
      throw new Error(`服务器 "${server.name}" 的传输方式未知：应为 stdio 或 streamable-http`);
    }
  }
  return value;
}

function describeTarget(server) {
  if (server.transport !== 'stdio') return server.url;
  const args = Array.isArray(server.args) ? server.args : [];
  const command = [server.command, ...args].join(' ');
  return command.length > 120 ? `${command.slice(0, 119)}…` : command;
}

function firstLine(text, limit = 100) {
  if (typeof text !== 'string') return '';
  const line = text.split('\n')[0].trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

function renderResultText(result) {
  const parts = [];
  for (const block of result?.content ?? []) {
    if (block?.type === 'text') parts.push(block.text);
    else parts.push(JSON.stringify(block));
  }
  if (parts.length === 0 && result?.value !== undefined) parts.push(JSON.stringify(result.value));
  return parts.join('\n');
}

export function apply(ctx, config = {}) {
  const log = (message) => ctx.logger?.warn?.(message);
  // One-time move of pre-0.2 files into $DSH_HOME/storages/dsh-mcp. An explicit
  // settingsPath means a test or custom deployment: leave its home untouched.
  const customSettingsPath = typeof config.settingsPath === 'string' && config.settingsPath !== '';
  if (!customSettingsPath) migrateLegacy(log);
  setStorePath(oauthPath());

  const settingsPath = customSettingsPath ? config.settingsPath : defaultSettingsPath();
  let settings = readSettings(settingsPath);
  let servers = validateServers(settings.servers ?? config.servers ?? []);

  const lazy = config.lazy !== false;
  const defaultTtlMinutes = config.defaultTtlMinutes ?? 30;

  const visibility = createVisibility(ctx, { lazy, defaultTtlMinutes, log });
  const serverByName = (serverName) => servers.find((item) => item.name === serverName);

  function authHeaders(server) {
    if (server.oauth !== true) return {};
    let record = oauthRecord(server.name);
    if (record === undefined) throw new Error(`mcp: 服务器 "${server.name}" 需要 OAuth 登录`);
    if (isExpired(record) && typeof record.refresh_token === 'string') {
      record = { ...record, ...refreshGrant(record.metadata, record.client_id, record) };
      saveOauth(server.name, record);
    }
    if (isExpired(record)) throw new Error(`mcp: 服务器 "${server.name}" 的 OAuth token 已过期，请重新登录`);
    return { Authorization: `${record.token_type ?? 'Bearer'} ${record.access_token}` };
  }

  async function headersFor(server) {
    try {
      return authHeaders(server);
    } catch (error) {
      log(error instanceof Error ? error.message : String(error));
      return {};
    }
  }

  async function reconcile() {
    await syncEntries(ctx, servers, { headersFor, log });
    visibility.refresh();
  }

  function hostTools() {
    return mcpToolDefinitions(ctx.tools);
  }

  function toolsOf(serverName) {
    const out = [];
    for (const [toolName, definition] of hostTools()) {
      const parsed = parsePublicName(toolName);
      if (parsed === null || parsed.server !== serverName) continue;
      out.push({ name: toolName, tool: parsed.tool, description: definition?.description ?? '' });
    }
    return out.sort((left, right) => left.tool.localeCompare(right.tool));
  }

  async function callHostTool(toolName, args) {
    if (typeof ctx.tools?.execute !== 'function') throw new Error('当前 Host 不支持通过官方管线执行工具');
    // Deliberately agent-less: a bound Agent cannot dispatch a restricted tool,
    // and widening the mask for one call does not reach the dispatch path.
    const result = await ctx.tools.execute({
      callId: `dsh-mcp-${randomUUID()}`,
      name: toolName,
      arguments: args ?? {},
      // The registry reads exec.signal; a caller without one crashes the pipeline.
      signal: AbortSignal.timeout(120_000),
    });
    if (result?.isError === true) throw new Error(renderResultText(result) || '工具调用失败');
    return result;
  }

  function serversView(agent) {
    // A bound Agent sees its own activations; the settings page has no Agent and
    // shows the totals across every live session.
    const counts = agent === undefined
      ? visibility.summary().byServer
      : visibility.status(agent).active.reduce((acc, item) => {
        acc[item.server] = (acc[item.server] ?? 0) + 1;
        return acc;
      }, {});
    return servers.map((server) => {
      const tools = toolsOf(server.name);
      return {
        name: server.name,
        transport: server.transport,
        target: describeTarget(server),
        enabled: server.enabled !== false,
        oauth: server.oauth === true,
        oauthLoggedIn: oauthRecord(server.name) !== undefined,
        tools: tools.length,
        active: counts[server.name] ?? 0,
        calls: 0,
        reconnects: 0,
        status: server.enabled === false ? 'disabled' : tools.length > 0 ? 'connected' : 'pending',
      };
    });
  }

  async function reconnect(server) {
    // Re-creating the official client row is the only supported way to force a
    // fresh connection; serverName (and therefore every tool name) stays equal.
    await provision(ctx, server, { headers: await headersFor(server), log });
    try {
      await ctx.loader.update(entryIdFor(server), { disabled: true });
    } finally {
      await provision(ctx, server, { headers: await headersFor(server), log });
    }
    visibility.refresh();
  }

  ctx.on('dispose', () => {
    visibility.dispose();
    for (const server of servers) {
      Promise.resolve(unprovision(ctx, server.name)).catch(() => {});
    }
  });

  ctx.inject?.(['agents'], (agentCtx) => {
    ctx.effect(() => visibility.mount(agentCtx));
  });

  const ready = reconcile().catch((error) => log(`dsh-mcp: 初始化失败：${error instanceof Error ? error.message : String(error)}`));

  ctx.tools.register({
    name: 'mcp',
    description:
      'Browse and enable MCP tools. Their schemas stay out of context until activated: locate them with servers/tools/search, inspect with describe, then activate — the native tool is callable from the next turn. Actions: servers, tools, search, describe, activate, deactivate, status, refresh.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['servers', 'tools', 'search', 'describe', 'activate', 'deactivate', 'status', 'refresh'], description: 'Operation to run.' },
        server: { type: 'string', description: 'Server name (see action=servers).' },
        tool: { type: 'string', description: 'Tool name for describe/deactivate.' },
        tools: { type: 'array', items: { type: 'string' }, description: 'Tool names to activate; omit to activate every tool of the server.' },
        query: { type: 'string', description: 'Search text for action=search.' },
        ttlMinutes: { type: 'number', description: 'Activation lifetime in minutes (1-30, default 30).' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute: async (args, exec) => {
      const action = args?.action;
      const agent = exec?.agent;
      if (action === 'servers') {
        const rows = serversView(agent);
        if (rows.length === 0) return { text: '没有配置 MCP 服务器；在「设置 → MCP」里添加。' };
        return {
          text: rows
            .map((row) => `${row.name} [${row.status}] ${row.transport} ${row.target} tools=${row.tools}${row.active > 0 ? ` active=${row.active}` : ''}`)
            .join('\n'),
        };
      }
      if (action === 'tools') {
        if (typeof args.server !== 'string') throw new Error('mcp: action=tools 需要 server');
        const tools = toolsOf(args.server);
        if (tools.length === 0) return { text: `服务器 "${args.server}" 没有已注册的工具（未启用或连接失败）` };
        return { text: tools.map((tool) => `${tool.tool}${tool.description ? ` — ${firstLine(tool.description)}` : ''}`).join('\n') };
      }
      if (action === 'search') {
        if (typeof args.query !== 'string') throw new Error('mcp: action=search 需要 query');
        const needles = args.query.toLowerCase().split(/\s+/).filter((token) => token !== '');
        if (needles.length === 0) throw new Error('mcp: action=search 需要非空 query');
        const hits = [];
        for (const [toolName, definition] of hostTools()) {
          const parsed = parsePublicName(toolName);
          if (parsed === null) continue;
          const haystack = `${toolName} ${definition?.description ?? ''}`.toLowerCase();
          if (!needles.every((needle) => haystack.includes(needle))) continue;
          hits.push(`${parsed.server}/${parsed.tool}${definition?.description ? ` — ${firstLine(definition.description)}` : ''}`);
          if (hits.length >= 25) break;
        }
        return { text: hits.join('\n') || '(无匹配工具)' };
      }
      if (action === 'describe') {
        if (typeof args.server !== 'string' || typeof args.tool !== 'string') throw new Error('mcp: action=describe 需要 server 和 tool');
        const definition = hostTools().get(publicNameFor(args.server, args.tool));
        if (definition === undefined) throw new Error(`服务器 "${args.server}" 没有工具 "${args.tool}"`);
        return { text: JSON.stringify({ name: definition.name, description: definition.description ?? '', inputSchema: definition.parameters ?? {} }) };
      }
      if (action === 'activate') {
        if (typeof args.server !== 'string') throw new Error('mcp: action=activate 需要 server');
        const result = visibility.activate(agent, { server: args.server, tools: args.tools, ttlMinutes: args.ttlMinutes });
        return { text: `已激活：${result.activated.join(', ')}（${defaultTtlMinutes} 分钟）` };
      }
      if (action === 'deactivate') {
        const result = visibility.deactivate(agent, { server: args.server, tool: args.tool });
        return { text: result.deactivated.length > 0 ? `已停用：${result.deactivated.join(', ')}` : '没有需要停用的工具' };
      }
      if (action === 'status') {
        const status = visibility.status(agent);
        const lines = [`lazy=${status.lazy} observed=${status.observed} hidden=${status.hidden.length}`];
        for (const item of status.active) lines.push(`active ${item.name} 到期 ${new Date(item.expiresAt).toISOString()}`);
        return { text: lines.join('\n') };
      }
      if (action === 'refresh') {
        const target = typeof args.server === 'string' ? serverByName(args.server) : undefined;
        if (typeof args.server === 'string' && target === undefined) throw new Error(`mcp: 未知服务器 "${args.server}"`);
        if (target !== undefined) await reconnect(target);
        else for (const server of servers) await reconnect(server);
        return { text: `mcp: 已重连 ${target?.name ?? '全部服务器'}` };
      }
      throw new Error(`mcp: 未知 action "${action}"`);
    },
  });

  function runCommand(rawInput = '', agent) {
    const tokens = String(rawInput).trim().split(/\s+/).filter((token) => token !== '');
    const action = tokens[0] ?? 'status';
    const rows = serversView(undefined);

    if (action === 'activate') {
      const server = tokens[1];
      if (server === undefined) return { kind: 'error', text: '用法：/mcp activate <server> [tool…]' };
      try {
        const result = visibility.activate(agent, { server, tools: tokens.slice(2) });
        return { kind: 'success', text: `已激活 ${result.activated.join(', ')}（${defaultTtlMinutes} 分钟）` };
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
      }
    }
    if (action === 'deactivate') {
      const server = tokens[1];
      if (server === undefined) {
        const cleared = visibility.clear(agent);
        return { kind: 'success', text: cleared > 0 ? `已清空 ${cleared} 个激活` : '当前会话没有激活的工具' };
      }
      try {
        const result = visibility.deactivate(agent, { server });
        return {
          kind: 'success',
          text: result.deactivated.length > 0 ? `已停用 ${result.deactivated.join(', ')}` : '当前会话没有该服务器的激活工具',
        };
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
      }
    }
    if (action === 'status' || action === 'servers') {
      if (rows.length === 0) return { kind: 'success', text: '没有配置 MCP 服务器' };
      const lines = rows.map((row) => `${row.name} [${row.status}] ${row.transport} ${row.target} tools=${row.tools}${row.active > 0 ? ` active=${row.active}` : ''}`);
      if (agent !== undefined) {
        const status = visibility.status(agent);
        lines.unshift(`lazy=${status.lazy} observed=${status.observed} hidden=${status.hidden.length} active=${status.active.length}`);
      }
      return { kind: 'success', text: lines.join('\n') };
    }
    if (action === 'search') {
      const needles = tokens.slice(1).map((token) => token.toLowerCase()).filter((token) => token !== '');
      if (needles.length === 0) return { kind: 'error', text: '用法：/mcp search <关键词>' };
      const hits = [];
      for (const [toolName, definition] of hostTools()) {
        const parsed = parsePublicName(toolName);
        if (parsed === null) continue;
        const haystack = `${toolName} ${definition?.description ?? ''}`.toLowerCase();
        if (!needles.every((needle) => haystack.includes(needle))) continue;
        hits.push(`${parsed.server}/${parsed.tool}`);
      }
      return { kind: 'success', text: hits.join('\n') || '(无匹配工具)' };
    }
    const server = rows.find((row) => row.name === action);
    if (server === undefined) {
      return { kind: 'error', text: `未知服务器 "${action}"；可用：${rows.map((row) => row.name).join(', ') || '(无)'}` };
    }
    const sub = tokens[1] ?? 'tools';
    if (sub === 'tools') {
      const tools = toolsOf(server.name);
      return { kind: 'success', text: tools.map((tool) => tool.name).join('\n') || '(无工具)' };
    }
    if (sub === 'call') {
      const tool = tokens[2];
      if (tool === undefined) return { kind: 'error', text: '用法：/mcp <server> call <tool> [json]' };
      let parsedArgs = {};
      if (tokens[3] !== undefined) {
        try {
          parsedArgs = JSON.parse(tokens.slice(3).join(' '));
        } catch (error) {
          return { kind: 'error', text: `参数不是合法 JSON：${error instanceof Error ? error.message : String(error)}` };
        }
      }
      return callHostTool(publicNameFor(server.name, tool), parsedArgs).then(
        (result) => ({ kind: 'success', text: renderResultText(result) }),
        (error) => ({ kind: 'error', text: error instanceof Error ? error.message : String(error) }),
      );
    }
    return { kind: 'error', text: `未知子命令 "${sub}"；可用：tools, call` };
  }

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
    const route = (path, handler, label) => ctx.effect(() => webServer.register({ kind: 'exact', path, handler }), label);
    const postRoute = (path, handler, label) => route(path, async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      try {
        const body = await readBody(req);
        if (typeof body.server !== 'string' || body.server === '') return json(res, 400, { error: 'server is required' });
        json(res, 200, await handler(body));
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, label);

    route('/api/mcp/deactivate', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      const cleared = visibility.clear(undefined);
      json(res, 200, { cleared, servers: serversView(undefined) });
    }, 'dsh-mcp: deactivate route');

    route('/api/mcp/status', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      const rows = serversView(undefined);
      json(res, 200, {
        servers: rows,
        showInSidebar: settings.showInSidebar === true,
        lazy,
        activeTotal: rows.reduce((sum, row) => sum + row.active, 0),
      });
    }, 'dsh-mcp: status route');

    route('/api/mcp/refresh', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      try {
        const body = await readBody(req);
        const target = typeof body.server === 'string' ? serverByName(body.server) : undefined;
        if (target !== undefined) await reconnect(target);
        else for (const server of servers) await reconnect(server);
        json(res, 200, { servers: serversView(undefined) });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, 'dsh-mcp: refresh route');

    route('/api/mcp/config', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      if (req.method === 'GET') {
        json(res, 200, { servers, lazy });
        return;
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      try {
        const body = await readBody(req);
        const next = validateServers(body.servers);
        writeSettings({ servers: next }, settingsPath);
        servers = next;
        await reconcile();
        json(res, 200, { servers: serversView(undefined) });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, 'dsh-mcp: config route');

    route('/api/mcp/settings', async (req, res) => {
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
    }, 'dsh-mcp: settings route');

    route('/api/mcp/tools', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      try {
        const body = req.method === 'POST' ? await readBody(req) : {};
        if (typeof body.server !== 'string') return json(res, 400, { error: 'server is required' });
        const definitions = hostTools();
        const activeNames = new Set(visibility.summary().tools.map((tool) => tool.name));
        const tools = toolsOf(body.server).map((tool) => ({
          name: tool.tool,
          description: tool.description,
          inputSchema: definitions.get(tool.name)?.parameters ?? {},
          active: activeNames.has(tool.name),
        }));
        json(res, 200, { tools });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, 'dsh-mcp: tools route');

    route('/api/mcp/call', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      try {
        const body = await readBody(req);
        if (typeof body.server !== 'string' || typeof body.tool !== 'string') return json(res, 400, { error: 'server and tool are required' });
        const result = await callHostTool(publicNameFor(body.server, body.tool), body.arguments ?? {});
        json(res, 200, { text: renderResultText(result) });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, 'dsh-mcp: call route');

    postRoute('/api/mcp/resources', async (body) => {
      const result = await callHostTool('list_mcp_resources', { server: body.server });
      return { resources: result?.value?.resources ?? [] };
    }, 'dsh-mcp: resources route');
    postRoute('/api/mcp/read', async (body) => {
      if (typeof body.uri !== 'string') throw new Error('uri is required');
      const result = await callHostTool('read_mcp_resource', { server: body.server, uri: body.uri });
      return { contents: result?.value?.contents ?? [] };
    }, 'dsh-mcp: read route');
    postRoute('/api/mcp/prompts', async () => ({ prompts: [] }), 'dsh-mcp: prompts route');
    postRoute('/api/mcp/prompt', async () => {
      throw new Error('官方客户端不支持 MCP 提示词模板');
    }, 'dsh-mcp: prompt route');

    route('/api/mcp/oauth/start', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      try {
        const body = await readBody(req);
        const target = serverByName(body.server);
        if (target === undefined) throw new Error(`未知服务器 "${body.server}"`);
        if (target.transport !== 'streamable-http') throw new Error('OAuth 只支持 streamable-http 服务器');
        const metadata = await discover(target.url);
        if (metadata === undefined) throw new Error('未发现 OAuth 元数据（well-known 均不可用）');
        const challenge = pkce();
        const state = randomUUID();
        const listener = loopback(state);
        const port = await listener.port;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const registered = await register(metadata, redirectUri);
        const clientId = registered?.client_id ?? target.clientId;
        if (typeof clientId !== 'string' || clientId === '') throw new Error('缺少 client_id，且服务器不支持动态注册');
        const flowId = randomUUID();
        const url = authorizationUrl(metadata, clientId, redirectUri, challenge.challenge, state);
        oauthFlows.set(flowId, { status: 'pending', url, server: target.name, error: '' });
        listener.code.then(async (code) => {
          try {
            const token = await exchange(metadata, clientId, code, challenge.verifier, redirectUri);
            saveOauth(target.name, { ...token, metadata, client_id: clientId });
            oauthFlows.set(flowId, { status: 'done', url, server: target.name, error: '' });
            await reconcile();
          } catch (error) {
            oauthFlows.set(flowId, { status: 'failed', url, server: target.name, error: String(error) });
          }
        }, (error) => oauthFlows.set(flowId, { status: 'failed', url, server: target.name, error: String(error) }));
        json(res, 200, { flowId, url });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, 'dsh-mcp: oauth start');

    route('/api/mcp/oauth/status', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      const flowId = new URL(req.url ?? '/', 'http://x').searchParams.get('flowId') ?? '';
      json(res, 200, oauthFlows.get(flowId) ?? { status: 'unknown', error: '' });
    }, 'dsh-mcp: oauth status');

    route('/api/mcp/oauth/logout', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      try {
        const body = await readBody(req);
        if (typeof body.server === 'string') removeOauth(body.server);
        json(res, 200, { ok: true });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, 'dsh-mcp: oauth logout');
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
          description: 'MCP 服务器：状态、工具、激活与调用',
          input: { hint: '留空查看状态 | search <关键词> | <server> tools | <server> call <tool> [json] | activate <server> [tool…] | deactivate <server>' },
          handler: (invocation) => runCommand(invocation?.rawInput ?? '', invocation?.agent),
        });
      } catch (error) {
        ctx.logger?.warn?.(`dsh-mcp: /mcp registration failed: ${String(error)}`);
      }
    })();
  }
  return ready;
}
