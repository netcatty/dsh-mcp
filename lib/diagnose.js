// Cheap, honest diagnostics for one configured server. This never claims more
// than it observed: a reachable endpoint is not a working MCP session, and a
// found binary is not a running stdio server.

import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

/** Resolve a command the way a shell would, without running it. */
export function resolveCommand(command) {
  if (typeof command !== 'string' || command === '') return null;
  if (isAbsolute(command)) {
    try {
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }
  const path = process.env.PATH ?? '';
  for (const dir of path.split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function hintForCode(code) {
  switch (code) {
    case 'ECONNREFUSED': return '端口没有在监听——服务未启动，或地址写错了';
    case 'ENOTFOUND':
    case 'EAI_AGAIN': return '域名解析失败——检查网络或 DNS';
    case 'ECONNRESET': return '连接被重置——中间设备或服务端主动断开';
    case 'timeout': return '请求超时——服务可能卡住，或需要更长的超时';
    case 'bad-port': return '端口被 Node 的 fetch 禁止（如 1、7、9 等保留端口），换一个端口';
    case 'command-missing': return 'PATH 和绝对路径里都没找到这个命令；装好它或改成绝对路径';
    default: return undefined;
  }
}

/**
 * Probe one server.
 * @param {object} server - configured record.
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} options
 */
export async function diagnose(server, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (server.transport === 'stdio') {
    const found = resolveCommand(server.command);
    if (found === null) {
      return {
        ok: false,
        stage: 'command',
        code: 'command-missing',
        message: `找不到命令 "${server.command}"`,
        hint: hintForCode('command-missing'),
      };
    }
    return {
      ok: true,
      stage: 'command',
      code: 'command-found',
      message: `找到可执行文件：${found}`,
      hint: 'stdio 由 Host 启动，能否连通看工具数；启动失败看 DSH 日志',
    };
  }

  if (typeof server.url !== 'string' || server.url === '') {
    return { ok: false, stage: 'config', code: 'missing-url', message: 'streamable-http 缺少 url' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(server.url, {
      method: 'GET',
      headers: { accept: 'application/json, text/event-stream', ...(server.headers ?? {}) },
      signal: controller.signal,
    });
    const ms = Date.now() - started;
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        stage: 'auth',
        code: `http-${response.status}`,
        message: `HTTP ${response.status}（${ms}ms）`,
        hint: '凭据无效或过期：检查 headers / 重新 OAuth 登录',
      };
    }
    if (response.status === 404) {
      return {
        ok: false,
        stage: 'endpoint',
        code: 'http-404',
        message: `HTTP 404（${ms}ms）`,
        hint: '路径不对：确认 url 指向 MCP 端点（常见是 /mcp）',
      };
    }
    if (response.status >= 500) {
      return {
        ok: false,
        stage: 'server',
        code: `http-${response.status}`,
        message: `HTTP ${response.status}（${ms}ms）`,
        hint: '服务端报错，查看该服务自己的日志',
      };
    }
    return {
      ok: true,
      stage: 'reachable',
      code: 'reachable',
      message: `HTTP ${response.status}（${ms}ms）`,
      hint: '端点可达；会话是否建立仍看工具数',
    };
  } catch (error) {
    const nested = error?.cause?.errors?.[0]?.code;
    const text = `${error?.message ?? ''} ${error?.cause?.message ?? ''}`;
    const matched = /(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|CERT_[A-Z_]+|EPROTO)/.exec(text)?.[1];
    const code = error?.name === 'AbortError'
      ? 'timeout'
      : /bad port/i.test(text)
        ? 'bad-port'
        : (error?.code ?? error?.cause?.code ?? nested ?? matched ?? 'network');
    return {
      ok: false,
      stage: 'network',
      code,
      message: error instanceof Error ? error.message : String(error),
      hint: hintForCode(code),
    };
  } finally {
    clearTimeout(timer);
  }
}
