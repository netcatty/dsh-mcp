// @netcatty/dsh-mcp — per-Agent MCP tool visibility.
//
// The official client keeps every enabled server's tools registered; this
// controller keeps their schemas out of a session until the model or the user
// activates them. State is memory-only and keyed by the live Agent object, so
// it cannot leak into another conversation or survive a restart.

const MCP_PREFIX = 'mcp__';
export const DEFAULT_TTL_MINUTES = 30;
export const MAX_TTL_MINUTES = 30;

export function publicNameFor(server, tool) {
  return `${MCP_PREFIX}${server}__${tool}`;
}

export function isMcpToolName(value) {
  return typeof value === 'string' && value.startsWith(MCP_PREFIX);
}

/** Split `mcp__<server>__<tool>`; server names never contain `__` per validation. */
export function parsePublicName(name) {
  if (!isMcpToolName(name)) return null;
  const rest = name.slice(MCP_PREFIX.length);
  const index = rest.indexOf('__');
  if (index <= 0 || index === rest.length - 2) return null;
  return { server: rest.slice(0, index), tool: rest.slice(index + 2) };
}

/**
 * Read the Host tool surface without crossing into schema assembly.
 * Published Host exposes `view()`; older builds expose `definitions()`.
 */
export function hostTools(tools) {
  try {
    if (typeof tools?.definitions === 'function') {
      const list = tools.definitions();
      if (Array.isArray(list)) return new Map(list.map((item) => [item?.name, item]));
    }
    if (typeof tools?.view === 'function') {
      const view = tools.view();
      if (view?.visible instanceof Map) return view.visible;
    }
  } catch {
    // Fall through: callers treat an empty map as "nothing observed yet".
  }
  return new Map();
}

export function mcpToolDefinitions(tools) {
  const out = new Map();
  for (const [name, definition] of hostTools(tools)) {
    if (isMcpToolName(name)) out.set(name, definition ?? { name });
  }
  return out;
}

function uniqueNames(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.trim()))].sort();
}

function sameNames(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function normalizeTtl(minutes, fallback) {
  if (minutes === undefined || minutes === null) return fallback;
  const value = Number(minutes);
  if (!Number.isFinite(value) || value < 1 || value > MAX_TTL_MINUTES) {
    throw new Error(`ttlMinutes 必须是 1 到 ${MAX_TTL_MINUTES} 之间的数字`);
  }
  return value;
}

export function createVisibility(ctx, { lazy = true, defaultTtlMinutes = DEFAULT_TTL_MINUTES, now = () => Date.now(), log } = {}) {
  let disposed = false;
  let mounted = null;
  let expiryTimer = null;
  let syncing = false;
  const restrictions = new Map();
  const states = new Map();

  const agents = () => {
    try {
      const list = mounted?.agents?.list?.();
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };

  function stateFor(agent, create = false) {
    let state = states.get(agent);
    if (state === undefined && create) {
      state = { revision: 0, activations: new Map() };
      states.set(agent, state);
    }
    return state;
  }

  function isActive(agent, name, at = now()) {
    const record = stateFor(agent)?.activations.get(name);
    return record !== undefined && record.expiresAt > at;
  }

  function observed() {
    return [...mcpToolDefinitions(ctx.tools).keys()].sort();
  }

  function purge(agent, names, at = now()) {
    const state = stateFor(agent);
    if (state === undefined) return false;
    const known = new Set(names);
    let changed = false;
    for (const [name, record] of [...state.activations]) {
      if (record.expiresAt <= at || !known.has(name)) {
        state.activations.delete(name);
        changed = true;
      }
    }
    if (changed) state.revision += 1;
    return changed;
  }

  function install(agent, deny) {
    const previous = restrictions.get(agent);
    if (previous !== undefined && sameNames(previous.deny, deny)) return;
    if (deny.length === 0) {
      previous?.dispose?.();
      restrictions.delete(agent);
      return;
    }
    try {
      // Install the new, equally-or-more-current mask before releasing the old
      // one so a racing tool change never exposes a schema.
      const dispose = agent.ctx.tools.restrict({ deny });
      restrictions.set(agent, { deny, dispose });
      previous?.dispose?.();
    } catch (error) {
      log?.(`dsh-mcp: 隐藏会话工具失败（${agent?.id ?? 'agent'}）：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    expiryTimer = null;
    if (disposed) return;
    let next = Number.POSITIVE_INFINITY;
    for (const state of states.values()) {
      for (const record of state.activations.values()) next = Math.min(next, record.expiresAt);
    }
    if (!Number.isFinite(next)) return;
    expiryTimer = setTimeout(refresh, Math.max(0, next - now()) + 1);
    expiryTimer.unref?.();
  }

  function refresh() {
    if (disposed || mounted === null || syncing) return;
    syncing = true;
    try {
      const names = lazy ? observed() : [];
      const live = agents();
      const liveSet = new Set(live);
      for (const agent of live) {
        purge(agent, names);
        const deny = names.filter((name) => !isActive(agent, name));
        install(agent, deny);
      }
      for (const agent of [...restrictions.keys()]) {
        if (liveSet.has(agent)) continue;
        restrictions.get(agent)?.dispose?.();
        restrictions.delete(agent);
      }
      for (const agent of [...states.keys()]) if (!liveSet.has(agent)) states.delete(agent);
      scheduleExpiry();
    } finally {
      syncing = false;
    }
  }

  function mount(agentCtx) {
    mounted = agentCtx;
    const offs = [
      agentCtx.on?.('agent/created', refresh),
      agentCtx.on?.('agent/disposed', ({ agent }) => {
        restrictions.get(agent)?.dispose?.();
        restrictions.delete(agent);
        states.delete(agent);
        scheduleExpiry();
      }),
      agentCtx.on?.('tools/change', refresh),
    ];
    refresh();
    return () => {
      for (const off of offs) off?.();
      if (mounted === agentCtx) mounted = null;
      for (const entry of restrictions.values()) entry.dispose?.();
      restrictions.clear();
      states.clear();
      clearTimeout(expiryTimer);
      expiryTimer = null;
    };
  }

  function resolveNames(server, tools) {
    const observedNames = observed();
    const known = new Set(observedNames);
    const own = observedNames.filter((name) => parsePublicName(name)?.server === server);
    const requested = uniqueNames(tools);
    // A server whose tools have not reached the Host yet (still connecting, or
    // not running) must say so instead of naming one missing tool.
    if (own.length === 0) {
      throw new Error(`服务器 "${server}" 尚未连接完成（Host 还没注册它的工具），稍后重试或先 mcp refresh`);
    }
    if (requested.length === 0) return own;
    return requested.map((tool) => {
      const name = tool.startsWith(MCP_PREFIX) ? tool : publicNameFor(server, tool);
      if (!known.has(name)) throw new Error(`Host 尚未注册工具 "${name}"`);
      const parsed = parsePublicName(name);
      if (parsed === null || parsed.server !== server) throw new Error(`工具 "${name}" 不属于服务器 "${server}"`);
      return name;
    });
  }

  function status(agent) {
    const names = observed();
    purge(agent, names);
    const state = stateFor(agent);
    const active = [...(state?.activations ?? new Map()).entries()]
      .map(([name, record]) => ({ name, server: record.server, expiresAt: record.expiresAt }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const activeSet = new Set(active.map((item) => item.name));
    return {
      agentId: String(agent?.id ?? 'unknown'),
      lazy,
      revision: state?.revision ?? 0,
      active,
      hidden: names.filter((name) => !activeSet.has(name)),
      observed: names.length,
      ttlMinutes: defaultTtlMinutes,
    };
  }

  /** Active tools across every live Agent — what the panel shows (no Agent). */
  function summary() {
    const live = new Set(agents());
    const at = now();
    const byServer = {};
    const tools = [];
    let agentsActive = 0;
    for (const [agent, state] of states) {
      if (!live.has(agent)) continue;
      let touched = false;
      for (const [name, record] of state.activations) {
        if (record.expiresAt <= at) continue;
        byServer[record.server] = (byServer[record.server] ?? 0) + 1;
        tools.push({ name, server: record.server, expiresAt: record.expiresAt });
        touched = true;
      }
      if (touched) agentsActive += 1;
    }
    tools.sort((left, right) => left.name.localeCompare(right.name));
    return { agents: agentsActive, byServer, tools, total: tools.length };
  }

  function activate(agent, input = {}) {
    if (agent === undefined || agent === null) throw new Error('缺少会话上下文，无法激活 MCP 工具');
    if (typeof input.server !== 'string' || input.server === '') throw new Error('缺少 server');
    if (!lazy) throw new Error('当前 lazy=false；MCP 工具始终可见，无需激活');
    const names = resolveNames(input.server, input.tools);
    const ttlMinutes = normalizeTtl(input.ttlMinutes, defaultTtlMinutes);
    const state = stateFor(agent, true);
    const expiresAt = now() + ttlMinutes * 60_000;
    for (const name of names) {
      state.activations.set(name, { server: input.server, activatedAt: now(), expiresAt });
    }
    state.revision += 1;
    refresh();
    return { ...status(agent), activated: names, expiresAt };
  }

  /** Drop every Agent's activations that belong to one server. */
  function forgetServer(server) {
    let cleared = 0;
    for (const state of states.values()) {
      let touched = false;
      for (const [name, record] of [...state.activations]) {
        if (record.server !== server) continue;
        state.activations.delete(name);
        cleared += 1;
        touched = true;
      }
      if (touched) state.revision += 1;
    }
    if (cleared > 0) refresh();
    return cleared;
  }

  /** Drop activations: one Agent's, or every live Agent's when omitted. */
  function clear(agent) {
    const targets = agent === undefined ? [...states.values()] : [states.get(agent)];
    let cleared = 0;
    for (const state of targets) {
      if (state === undefined) continue;
      cleared += state.activations.size;
      state.activations.clear();
      state.revision += 1;
    }
    if (agent === undefined) states.clear();
    refresh();
    return cleared;
  }

  function deactivate(agent, input = {}) {
    const state = stateFor(agent);
    if (state === undefined) return { ...status(agent), deactivated: [] };
    const deactivated = [];
    for (const [name, record] of [...state.activations]) {
      const serverHit = typeof input.server === 'string' && input.server !== '' && record.server === input.server;
      const nameHit = typeof input.tool === 'string'
        && (input.tool === name || name === publicNameFor(record.server, input.tool));
      if (serverHit || nameHit) {
        state.activations.delete(name);
        deactivated.push(name);
      }
    }
    if (deactivated.length > 0) state.revision += 1;
    refresh();
    return { ...status(agent), deactivated };
  }

  const disposeGuard = typeof ctx.tools?.guard === 'function'
    ? ctx.tools.guard((execution) => {
        if (!lazy) return undefined;
        const name = execution?.name;
        if (!isMcpToolName(name)) return undefined;
        // Calls from the settings page or /mcp carry no Agent; they already
        // passed the Host approval pipeline and must not be blocked here.
        if (execution.agent === undefined) return undefined;
        if (isActive(execution.agent, name)) return undefined;
        return `MCP 工具 ${name} 未在当前会话激活；先调用 mcp({"action":"activate","server":"…"})`;
      })
    : undefined;

  return {
    mount,
    refresh,
    status,
    summary,
    activate,
    deactivate,
    clear,
    forgetServer,
    isActive,
    observed,
    capabilities: () => ({
      lazy,
      guard: disposeGuard !== undefined,
      restriction: typeof ctx.tools?.restrict === 'function',
      agents: agents().length,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      mounted = null;
      disposeGuard?.();
      for (const entry of restrictions.values()) entry.dispose?.();
      restrictions.clear();
      states.clear();
      clearTimeout(expiryTimer);
    },
  };
}
