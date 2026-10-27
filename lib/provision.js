// @netcatty/dsh-mcp — provision official @deepseek-ai/dsh-mcp-client rows.
//
// The plugin no longer speaks MCP itself: each configured server becomes one
// loader row owned by the official client, so transport, tool registration,
// approval, images, instructions, reconnect and pagination stay with the Host.
// Our router tool only discovers and toggles visibility.

const CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client';
// Distinct from hand-written profile rows (`mcp-<server>`), so reconciliation
// can never delete a row this plugin did not create.
const ENTRY_PREFIX = 'dshmcp-';

export function entryIdFor(server) {
  return `${ENTRY_PREFIX}${server.name}`;
}

/** Build the official client's config for one server record. */
export function buildEntryConfig(server, extraHeaders = {}) {
  const shared = {};
  if (typeof server.toolCallTimeoutMs === 'number' && server.toolCallTimeoutMs > 0) {
    shared.toolCallTimeoutMs = server.toolCallTimeoutMs;
  }
  if (server.failOnStartupError === true) shared.failOnStartupError = true;

  if (server.transport === 'stdio') {
    const config = {
      serverName: server.name,
      transport: 'stdio',
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      ...shared,
    };
    if (server.env !== undefined && Object.keys(server.env).length > 0) config.env = { ...server.env };
    if (typeof server.cwd === 'string' && server.cwd !== '') config.cwd = server.cwd;
    return config;
  }

  const headers = { ...(server.headers ?? {}), ...extraHeaders };
  const config = { serverName: server.name, transport: 'streamable-http', url: server.url, ...shared };
  if (Object.keys(headers).length > 0) config.headers = headers;
  return config;
}

function hasEntry(ctx, id) {
  try {
    return ctx.loader.resolve(id) !== undefined;
  } catch {
    return false;
  }
}

function assertLoader(ctx) {
  if (ctx.loader === undefined || typeof ctx.loader.create !== 'function' || typeof ctx.loader.update !== 'function') {
    throw new Error('dsh-mcp: 当前 Host 没有 loader 服务，无法挂载官方 MCP 客户端条目');
  }
}

/** Create or update one official client row (idempotent; serverName keeps tool names stable). */
export async function provision(ctx, server, { headers = {}, log } = {}) {
  assertLoader(ctx);
  const id = entryIdFor(server);
  const config = buildEntryConfig(server, headers);
  const disabled = server.enabled === false;
  try {
    if (hasEntry(ctx, id)) {
      const existing = ctx.loader.resolve(id);
      const previous = existing?.options?.config ?? {};
      const next = previous.transport && previous.transport !== config.transport
        ? config
        : { ...previous, ...config };
      await ctx.loader.update(id, { config: next, disabled });
    } else {
      await ctx.loader.create({ id, name: CLIENT_PACKAGE, config, disabled });
    }
  } catch (error) {
    log?.(`dsh-mcp: 挂载服务器 "${server.name}" 失败：${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
  return id;
}

/** Remove one official client row. */
export async function unprovision(ctx, name) {
  if (ctx.loader === undefined) return;
  const id = `${ENTRY_PREFIX}${name}`;
  if (!hasEntry(ctx, id)) return;
  try {
    ctx.loader.remove(id);
  } catch {
    // A missing row is already the desired state.
  }
}

/** Rows this plugin owns, as { id, serverName } pairs. */
export function ownedEntries(ctx) {
  const store = ctx.loader?.store;
  if (store === undefined || store === null) return [];
  const out = [];
  for (const [id, entry] of Object.entries(store)) {
    if (!id.startsWith(ENTRY_PREFIX)) continue;
    const name = entry?.options?.name;
    if (name !== CLIENT_PACKAGE) continue;
    out.push({ id, serverName: entry?.options?.config?.serverName ?? id.slice(ENTRY_PREFIX.length) });
  }
  return out;
}

/** Reconcile the loader with the configured server list. */
export async function sync(ctx, servers, { headersFor, log } = {}) {
  assertLoader(ctx);
  const wanted = new Set(servers.map((server) => server.name));
  for (const server of servers) {
    const headers = headersFor === undefined ? {} : await headersFor(server);
    await provision(ctx, server, { headers, log });
  }
  for (const entry of ownedEntries(ctx)) {
    if (wanted.has(entry.serverName)) continue;
    await unprovision(ctx, entry.serverName);
  }
}
