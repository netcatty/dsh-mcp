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
import { mergeServers, parseMcpServers, renderEntriesText, renderEntryText, toMcpServers } from './translate.js';
import { diagnose } from './diagnose.js';
import { listSnapshots, readSnapshot, snapshot } from './snapshots.js';
import { recent as recentAudit, record as recordAudit } from './audit.js';
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

/** Collapse the legacy single `workspaceId` into the `workspaceIds` list. */
function normalizeWorkspaceScope(server) {
  const list = [];
  if (Array.isArray(server.workspaceIds)) list.push(...server.workspaceIds);
  if (typeof server.workspaceId === 'string' && server.workspaceId !== '') list.push(server.workspaceId);
  delete server.workspaceId;
  const unique = [...new Set(list.map((id) => String(id)).filter((id) => id !== ''))];
  if (unique.length === 0) delete server.workspaceIds;
  else server.workspaceIds = unique;
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
    if (server.workspaceId !== undefined && (typeof server.workspaceId !== 'string' || server.workspaceId === '')) {
      throw new Error(`服务器 "${server.name}" 的 workspaceId 必须是非空字符串`);
    }
    if (server.disabledTools !== undefined) {
      if (!Array.isArray(server.disabledTools) || server.disabledTools.some((name) => typeof name !== 'string' || name === '')) {
        throw new Error(`服务器 "${server.name}" 的 disabledTools 必须是非空字符串数组`);
      }
    }
    if (server.workspaceIds !== undefined) {
      if (!Array.isArray(server.workspaceIds) || server.workspaceIds.some((id) => typeof id !== 'string' || id === '')) {
        throw new Error(`服务器 "${server.name}" 的 workspaceIds 必须是非空字符串数组`);
      }
    }
    normalizeWorkspaceScope(server);
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

  let workspaceRegistry;
  ctx.inject?.(['workspaceRegistry'], (scope) => {
    workspaceRegistry = scope.workspaceRegistry;
  });

  function workspaceOf(agent) {
    if (agent === undefined || agent === null || workspaceRegistry === undefined) return undefined;
    const sessionId = String(agent.id);
    for (const workspace of workspaceRegistry.list()) {
      if ((workspace.sessionIds ?? []).some((id) => String(id) === sessionId)) return String(workspace.id);
    }
    return undefined;
  }

  function serverInScope(server, agent) {
    if (server.workspaceIds === undefined || server.workspaceIds.length === 0) return true;
    const workspace = workspaceOf(agent);
    return workspace !== undefined && server.workspaceIds.includes(workspace);
  }

  function serverOfTool(toolName, agent) {
    const parsed = parsePublicName(toolName);
    if (parsed === null) return undefined;
    const server = serverByName(parsed.server);
    if (server === undefined || !serverInScope(server, agent)) return undefined;
    // A tool disabled in the configuration is never visible, activated or callable.
    if ((server.disabledTools ?? []).includes(parsed.tool)) return undefined;
    return server;
  }

  const visibility = createVisibility(ctx, {
    lazy,
    defaultTtlMinutes,
    isToolVisible: (toolName, agent) => agent === undefined ? true : serverOfTool(toolName, agent) !== undefined,
    log,
  });
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

  /** Activations for a server that is gone or disabled would outlive its tools. */
  function forgetStaleActivations(next) {
    const live = new Set(next.filter((server) => server.enabled !== false).map((server) => server.name));
    for (const server of servers) {
      if (!live.has(server.name)) visibility.forgetServer(server.name);
    }
  }

  function audit(entry) {
    try {
      recordAudit(entry);
    } catch (error) {
      log(`dsh-mcp: 审计写入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function diagnoseServer(server) {
    const withAuth = { ...server, headers: { ...(server.headers ?? {}), ...(await headersFor(server)) } };
    return diagnose(withAuth);
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
      out.push({
        name: toolName,
        tool: parsed.tool,
        description: definition?.description ?? '',
        disabled: (serverByName(serverName)?.disabledTools ?? []).includes(parsed.tool),
      });
    }
    return out.sort((left, right) => left.tool.localeCompare(right.tool));
  }

  async function callHostTool(toolName, args) {
    if (typeof ctx.tools?.execute !== 'function') throw new Error('当前 Host 不支持通过官方管线执行工具');
    // Deliberately agent-less: a bound Agent cannot dispatch a restricted tool,
    // and widening the mask for one call does not reach the dispatch path.
    try {
      const result = await ctx.tools.execute({
        callId: `dsh-mcp-${randomUUID()}`,
        name: toolName,
        arguments: args ?? {},
        // The registry reads exec.signal; a caller without one crashes the pipeline.
        signal: AbortSignal.timeout(120_000),
      });
      if (result?.isError === true) throw new Error(renderResultText(result) || '工具调用失败');
      const parsed = parsePublicName(toolName);
      const text = renderResultText(result);
      audit({
        action: 'call',
        server: parsed?.server,
        tool: parsed?.tool ?? toolName,
        ok: true,
        detail: text.length > 200 ? `${text.slice(0, 200)}…` : text,
      });
      return result;
    } catch (error) {
      const parsed = parsePublicName(toolName);
      audit({ action: 'call', server: parsed?.server, tool: parsed?.tool ?? toolName, ok: false, detail: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  function serversView(agent) {
    // A bound Agent sees its own activations; the settings page has no Agent and
    // shows the totals across every live session.
    const summary = agent === undefined ? visibility.summary() : null;
    const entries = summary === null ? visibility.status(agent).active : summary.tools;
    const counts = {};
    const expiry = {};
    for (const item of entries) {
      counts[item.server] = (counts[item.server] ?? 0) + 1;
      expiry[item.server] = Math.min(expiry[item.server] ?? Number.POSITIVE_INFINITY, item.expiresAt);
    }
    return servers.filter((server) => agent === undefined || serverInScope(server, agent)).map((server) => {
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
        ...(counts[server.name] === undefined ? {} : { expiresAt: expiry[server.name] }),
        calls: 0,
        reconnects: 0,
        status: server.enabled === false ? 'disabled' : tools.length > 0 ? 'connected' : 'pending',
        ...(server.workspaceIds === undefined ? {} : { workspaceIds: server.workspaceIds }),
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
            .map((row) => `${row.name} [${row.status}] ${row.transport} ${row.target} tools=${row.tools}${row.active > 0 ? ` active=${row.active}` : ''}${row.workspaceIds === undefined ? '' : ' · 仅限指定工作区'}`)
            .join('\n'),
        };
      }
      if (action === 'tools') {
        if (typeof args.server !== 'string') throw new Error('mcp: action=tools 需要 server');
        if (serverByName(args.server) === undefined) throw new Error(`mcp: 未知服务器 "${args.server}"`);
        if (!serverInScope(serverByName(args.server), agent)) throw new Error(`服务器 "${args.server}" 不属于当前工作区`);
        const tools = toolsOf(args.server).filter((tool) => tool.disabled !== true);
        if (tools.length === 0) return { text: `服务器 "${args.server}" 没有可用工具（未启用、连接失败或全部被禁用）` };
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
        if (serverByName(args.server) === undefined) throw new Error(`mcp: 未知服务器 "${args.server}"`);
        for (const tool of args.tools ?? []) {
          if ((serverByName(args.server).disabledTools ?? []).includes(String(tool))) {
            throw new Error(`工具 "${args.server}/${tool}" 已被配置禁用`);
          }
        }
        if (!serverInScope(serverByName(args.server), agent)) throw new Error(`服务器 "${args.server}" 不属于当前工作区`);
        const result = visibility.activate(agent, { server: args.server, tools: args.tools, ttlMinutes: args.ttlMinutes });
        audit({ action: 'activate', server: args.server, agent: String(agent?.id ?? ''), detail: result.activated.join(', ') });
        return { text: `已激活：${result.activated.join(', ')}（${result.ttlMinutes} 分钟）` };
      }
      if (action === 'deactivate') {
        const result = visibility.deactivate(agent, { server: args.server, tool: args.tool });
        if (result.deactivated.length > 0) audit({ action: 'deactivate', server: args.server, agent: String(agent?.id ?? ''), detail: result.deactivated.join(', ') });
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

  async function runCommand(rawInput = '', agent) {
    const tokens = String(rawInput).trim().split(/\s+/).filter((token) => token !== '');
    const action = tokens[0] ?? 'status';
    const rows = serversView(undefined);

    if (action === 'help' || action === '-h' || action === '--help') {
      return {
        kind: 'success',
        text: [
          '/mcp                                全部服务器状态与懒加载汇总',
          '/mcp search <关键词>                 按名称/描述搜已注册的 MCP 工具',
          '/mcp <server> tools                 列出该服务器的工具',
          '/mcp <server> call <tool> [json]    经官方管线调用一次',
          '/mcp diagnose [<server>]            探测命令/端点（省略则检查全部）',
          '/mcp activate <server> [tool…]      为当前会话激活（省略 tool 就整台）',
          '/mcp deactivate [<server>]          收回当前会话的激活（省略就全部）',
          '/mcp scope <server> global|here|id,id  改可见范围（here = 当前工作区）',
        ].join('\n'),
      };
    }

    if (action === 'scope') {
      const target = serverByName(tokens[1] ?? '');
      if (target === undefined) return { kind: 'error', text: `未知服务器 "${tokens[1] ?? ''}"` };
      const wanted = tokens[2];
      if (wanted === undefined) return { kind: 'error', text: '用法：/mcp scope <server> global|here' };
      let workspaceIds;
      if (wanted === 'global') workspaceIds = undefined;
      else if (wanted === 'here') {
        const here = workspaceOf(agent);
        if (here === undefined) return { kind: 'error', text: '当前会话不属于任何工作区，无法用 here' };
        workspaceIds = [here];
      } else workspaceIds = wanted.split(',').map((id) => id.trim()).filter((id) => id !== '');
      const next = servers.map((server) => {
        if (server.name !== target.name) return server;
        const copy = { ...server };
        delete copy.workspaceId;
        if (workspaceIds === undefined || workspaceIds.length === 0) delete copy.workspaceIds;
        else copy.workspaceIds = [...new Set(workspaceIds)];
        return copy;
      });
      try {
        servers = validateServers(next);
        snapshot(servers, 'scope');
        writeSettings({ servers }, settingsPath);
        audit({ action: 'scope', server: target.name, agent: String(agent?.id ?? ''), detail: workspaceIds === undefined || workspaceIds.length === 0 ? 'global' : workspaceIds.join(',') });
        await reconcile();
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
      }
      return { kind: 'success', text: `${target.name} 的可见范围：${workspaceIds === undefined || workspaceIds.length === 0 ? '全局' : workspaceIds.join(', ')}` };
    }

    if (action === 'diagnose') {
      if (tokens[1] === undefined) {
        const results = await Promise.all(servers.map(async (server) => ({ server, result: await diagnoseServer(server) })));
        const failed = results.filter((item) => !item.result.ok);
        const lines = results.map((item) => `${item.server.name}: ${item.result.ok ? '通过' : '失败'} [${item.result.code}] ${item.result.message}`);
        lines.unshift(failed.length === 0 ? `全部通过（${results.length} 台）` : `${failed.length} 台异常`);
        return { kind: failed.length === 0 ? 'success' : 'error', text: lines.join('\n') };
      }
      const target = serverByName(tokens[1]);
      if (target === undefined) return { kind: 'error', text: `未知服务器 "${tokens[1]}"` };
      const result = await diagnoseServer(target);
      return {
        kind: result.ok ? 'success' : 'error',
        text: `${target.name}: ${result.ok ? '通过' : '失败'} [${result.code}] ${result.message}${result.hint ? `\n建议：${result.hint}` : ''}`,
      };
    }

    if (action === 'activate') {
      const server = tokens[1];
      if (server === undefined) return { kind: 'error', text: '用法：/mcp activate <server> [tool…]' };
      try {
        const result = visibility.activate(agent, { server, tools: tokens.slice(2) });
        audit({ action: 'activate', server, agent: String(agent?.id ?? ''), detail: result.activated.join(', ') });
        return { kind: 'success', text: `已激活 ${result.activated.join(', ')}（${result.ttlMinutes} 分钟）` };
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
      }
    }
    if (action === 'deactivate') {
      const server = tokens[1];
      if (server === undefined) {
        const cleared = visibility.clear(agent);
        if (cleared > 0) audit({ action: 'clear', agent: String(agent?.id ?? ''), detail: `cleared ${cleared}` });
        return { kind: 'success', text: cleared > 0 ? `已清空 ${cleared} 个激活` : '当前会话没有激活的工具' };
      }
      try {
        const result = visibility.deactivate(agent, { server });
        if (result.deactivated.length > 0) audit({ action: 'deactivate', server, agent: String(agent?.id ?? ''), detail: result.deactivated.join(', ') });
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
      try {
        const result = await callHostTool(publicNameFor(server.name, tool), parsedArgs);
        return { kind: 'success', text: renderResultText(result) };
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
      }
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

    route('/api/mcp/search', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      try {
        const url = new URL(req.url ?? '/', 'http://x');
        const needles = (url.searchParams.get('q') ?? '').toLowerCase().split(/\s+/).filter((token) => token !== '');
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const definitions = hostTools();
        const activeNames = new Set(visibility.summary().tools.map((tool) => tool.name));
        const hits = [];
        for (const server of servers) {
          for (const tool of toolsOf(server.name)) {
            const haystack = `${tool.name} ${tool.description}`.toLowerCase();
            if (!needles.every((needle) => haystack.includes(needle))) continue;
            hits.push({
              server: server.name,
              tool: tool.tool,
              publicName: tool.name,
              description: tool.description,
              active: activeNames.has(tool.name),
              disabled: tool.disabled === true,
              inputSchema: definitions.get(tool.name)?.parameters ?? {},
            });
            if (hits.length >= (Number.isFinite(limit) ? limit : 50)) break;
          }
          if (hits.length >= (Number.isFinite(limit) ? limit : 50)) break;
        }
        json(res, 200, { hits });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, 'dsh-mcp: search route');

    route('/api/mcp/workspaces', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      try {
        const list = workspaceRegistry?.list?.() ?? [];
        json(res, 200, { workspaces: list.map((workspace) => ({ id: String(workspace.id), title: workspace.title, path: workspace.path })) });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, 'dsh-mcp: workspaces route');

    route('/api/mcp/audit', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      try {
        const url = new URL(req.url ?? '/', 'http://x');
        const limit = Number(url.searchParams.get('limit') ?? 100);
        json(res, 200, {
          events: recentAudit({
            limit: Number.isFinite(limit) ? limit : 100,
            server: url.searchParams.get('server') ?? undefined,
            action: url.searchParams.get('action') ?? undefined,
          }),
        });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, 'dsh-mcp: audit route');

    route('/api/mcp/snapshots', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      try {
        json(res, 200, { snapshots: listSnapshots() });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, 'dsh-mcp: snapshots route');

    route('/api/mcp/restore', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      try {
        const body = await readBody(req);
        if (typeof body.id !== 'string' || body.id === '') return json(res, 400, { error: 'id is required' });
        const record = readSnapshot(body.id);
        const next = validateServers(record.servers);
        try {
          snapshot(servers, 'before-restore');
        } catch (error) {
          log(`dsh-mcp: 恢复前快照失败：${error instanceof Error ? error.message : String(error)}`);
        }
        writeSettings({ servers: next }, settingsPath);
        forgetStaleActivations(next);
        servers = next;
        audit({ action: 'restore', detail: record.id });
        await reconcile();
        json(res, 200, { servers: serversView(undefined), restored: record.id, at: record.at });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, 'dsh-mcp: restore route');

    route('/api/mcp/diagnose', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      try {
        const body = await readBody(req);
        if (typeof body.server !== 'string' || body.server === '') {
          const results = await Promise.all(servers.map(async (server) => ({ server: server.name, result: await diagnoseServer(server) })));
          return json(res, 200, { results });
        }
        const target = serverByName(body.server);
        if (target === undefined) return json(res, 404, { error: `未知服务器 "${body.server}"` });
        json(res, 200, { server: target.name, result: await diagnoseServer(target) });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, 'dsh-mcp: diagnose route');

    route('/api/mcp/export', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      const url = new URL(req.url ?? '/', 'http://x');
      const redact = url.searchParams.get('redact') !== '0';
      const single = url.searchParams.get('server');
      const listed = (url.searchParams.get('servers') ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
      const requested = listed.length > 0 ? listed : (single === null || single === '' ? [] : [single]);
      if (requested.length > 0) {
        const selected = [];
        for (const name of requested) {
          const target = serverByName(name);
          if (target === undefined) return json(res, 404, { error: `未知服务器 "${name}"` });
          selected.push(target);
        }
        const text = url.searchParams.get('format') === 'entry'
          ? renderEntriesText(selected, { redact })
          : JSON.stringify(toMcpServers(selected, { redact }), null, 2);
        json(res, 200, { json: text, servers: selected.map((server) => server.name) });
        return;
      }
      json(res, 200, { json: JSON.stringify(toMcpServers(servers, { redact }), null, 2) });
    }, 'dsh-mcp: export route');

    route('/api/mcp/import', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      try {
        const body = await readBody(req);
        if (typeof body.text !== 'string' || body.text.trim() === '') return json(res, 400, { error: 'text is required' });
        const incoming = parseMcpServers(body.text);
        const merged = mergeServers(servers, incoming);
        const next = validateServers(merged.servers);
        try {
          snapshot(servers, 'import');
        } catch (error) {
          log(`dsh-mcp: 写入前快照失败：${error instanceof Error ? error.message : String(error)}`);
        }
        writeSettings({ servers: next }, settingsPath);
        forgetStaleActivations(next);
        servers = next;
        audit({ action: 'import', detail: `新增 ${merged.added.join(',') || '-'}；更新 ${merged.updated.join(',') || '-'}` });
        await reconcile();
        json(res, 200, { servers: serversView(undefined), added: merged.added, updated: merged.updated });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }, 'dsh-mcp: import route');

    route('/api/mcp/deactivate', async (req, res) => {
      if (!allowed(req)) return json(res, 403, { error: 'forbidden' });
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      const cleared = visibility.clear(undefined);
      if (cleared > 0) audit({ action: 'clear', agent: 'panel', detail: `cleared ${cleared}` });
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
        try {
          snapshot(servers, 'config');
        } catch (error) {
          log(`dsh-mcp: 写入前快照失败：${error instanceof Error ? error.message : String(error)}`);
        }
        writeSettings({ servers: next }, settingsPath);
        forgetStaleActivations(next);
        servers = next;
        audit({ action: 'config', detail: `${next.length} 台服务器` });
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
          disabled: tool.disabled === true,
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
    postRoute('/api/mcp/resource-templates', async (body) => {
      const result = await callHostTool('list_mcp_resource_templates', { server: body.server });
      return { templates: result?.value?.resourceTemplates ?? result?.value?.templates ?? [] };
    }, 'dsh-mcp: resource templates route');
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
