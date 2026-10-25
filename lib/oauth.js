// OAuth 2.0 (authorization code + PKCE) for remote MCP servers.
// Flow: discovery → dynamic client registration → loopback callback → token
// exchange → refresh. Tokens live in ~/.dsh/mcp-oauth.json (mode 0600).

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

let storePath = `${homedir()}/.dsh/mcp-oauth.json`;

export function setStorePath(path) { storePath = path; }

function readStore() {
  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf8'));
    return parsed?.servers && typeof parsed.servers === 'object' ? parsed.servers : {};
  } catch {
    return {};
  }
}

function writeStore(servers) {
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify({ version: 1, servers }, null, 2)}\n`, { mode: 0o600 });
}

export function oauthRecord(server) {
  return readStore()[server] ?? undefined;
}

export function saveOauth(server, record) {
  const servers = readStore();
  servers[server] = record;
  writeStore(servers);
}

export function removeOauth(server) {
  const servers = readStore();
  delete servers[server];
  writeStore(servers);
}

export function normalizeUrl(url) {
  const value = String(url ?? '').trim().replace(/\/+$/, '');
  if (value === '') throw new Error('缺少服务器 URL');
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export async function discover(serverUrl, fetchImpl = fetch) {
  const base = normalizeUrl(serverUrl);
  for (const suffix of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
    try {
      const response = await fetchImpl(`${base}${suffix}`, { headers: { accept: 'application/json' } });
      if (!response.ok) continue;
      const body = await response.json();
      if (typeof body?.token_endpoint === 'string') return body;
    } catch {
      // try the next well-known path
    }
  }
  return undefined;
}

export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export async function register(metadata, redirectUri, fetchImpl = fetch) {
  if (typeof metadata?.registration_endpoint !== 'string') return undefined;
  const response = await fetchImpl(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'dsh-mcp',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!response.ok) throw new Error(`动态客户端注册失败（HTTP ${response.status}）`);
  const body = await response.json();
  if (typeof body?.client_id !== 'string') throw new Error('注册响应缺少 client_id');
  return body;
}

export function authorizationUrl(metadata, clientId, redirectUri, challenge, state) {
  if (typeof metadata?.authorization_endpoint !== 'string') throw new Error('发现文档缺少 authorization_endpoint');
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (Array.isArray(metadata.scopes_supported) && metadata.scopes_supported.length > 0) {
    url.searchParams.set('scope', metadata.scopes_supported.join(' '));
  }
  return url.toString();
}

/** One-shot loopback listener: `port` resolves on listen, `code` with the callback code. */
export function loopback(expectedState, timeoutMs = 300000) {
  let resolvePort;
  let rejectOuter;
  const port = new Promise((resolve, reject) => { resolvePort = resolve; rejectOuter = reject; });
  const code = new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('not found');
        return;
      }
      const error = url.searchParams.get('error');
      const state = url.searchParams.get('state');
      const value = url.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h2>dsh-mcp: 登录完成，可关闭此页</h2>');
      server.close();
      if (error !== null) return reject(new Error(`授权失败：${error}`));
      if (state !== expectedState) return reject(new Error('state 不匹配'));
      if (value === null) return reject(new Error('回调缺少 code'));
      resolve(value);
    });
    server.on('error', (error) => { reject(error); rejectOuter(error); });
    server.listen(0, '127.0.0.1', () => {
      server.unref?.();
      resolvePort(server.address().port);
    });
    const timer = setTimeout(() => {
      server.close();
      const error = new Error('OAuth 登录超时');
      reject(error);
      rejectOuter(error);
    }, timeoutMs);
    timer.unref?.();
  });
  return { port, code };
}

export async function exchange(metadata, clientId, code, verifier, redirectUri, fetchImpl = fetch) {
  const response = await fetchImpl(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`换取 token 失败：${body.error_description ?? body.error ?? response.status}`);
  return normalizeToken(body);
}

export async function refresh(metadata, clientId, record, fetchImpl = fetch) {
  const response = await fetchImpl(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: record.refresh_token,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`刷新 token 失败：${body.error_description ?? body.error ?? response.status}`);
  return normalizeToken(body, record);
}

function normalizeToken(body, previous = {}) {
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? previous.refresh_token,
    token_type: body.token_type ?? 'Bearer',
    expires_at: typeof body.expires_in === 'number' ? Date.now() + body.expires_in * 1000 : previous.expires_at,
    scope: body.scope ?? previous.scope,
  };
}

export function isExpired(record) {
  return typeof record?.expires_at === 'number' && Date.now() > record.expires_at - 60000;
}
