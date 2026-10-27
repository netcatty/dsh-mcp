// Shared fake Host for the plugin tests: a tool registry, a loader, one Agent
// scope with `tools.restrict`, and command registration. Tests assert against
// the same seams the real Host exposes.

export function createFakeHost({ tools = [], agents: agentCount = 1 } = {}) {
  const registered = new Map();
  const hostTools = new Map(tools.map((tool) => [tool.name, tool]));
  const guards = [];
  const restrictions = new Map();
  const handlers = {};
  const commands = [];
  const effects = [];
  const loaderStore = {};
  const loaderCalls = [];

  const agentLayers = new Map();
  const squash = (layers) => {
    if (layers.length === 0) return undefined;
    let deny = layers[0];
    for (const layer of layers.slice(1)) deny = deny.filter((name) => layer.includes(name));
    return [...deny];
  };
  const agents = Array.from({ length: agentCount }, (_, index) => {
    const agent = { id: `agent-${index + 1}` };
    agent.ctx = {
      tools: {
        restrict(filter) {
          const deny = [...(filter.deny ?? [])];
          const layers = agentLayers.get(agent) ?? [];
          layers.push(deny);
          agentLayers.set(agent, layers);
          restrictions.set(agent, squash(layers));
          return () => {
            const at = layers.indexOf(deny);
            if (at >= 0) layers.splice(at, 1);
            const next = squash(layers);
            if (next === undefined) restrictions.delete(agent);
            else restrictions.set(agent, next);
          };
        },
      },
    };
    return agent;
  });

  const agentCtx = {
    agents: { list: () => agents },
    on: () => () => {},
  };

  const ctx = {
    on(name, fn) { handlers[name] = fn; },
    effect(fn) {
      const dispose = fn();
      effects.push(dispose);
      return dispose;
    },
    inject(deps, callback) {
      if (Array.isArray(deps) && deps.includes('agents')) callback(agentCtx);
    },
    get(name) {
      return name === 'commands' ? { register: (value) => { commands.push(value); } } : undefined;
    },
    logger: { warn: () => {} },
    tools: {
      register(definition) {
        registered.set(definition.name, definition);
        return () => registered.delete(definition.name);
      },
      guard(fn) {
        guards.push(fn);
        return () => {
          const index = guards.indexOf(fn);
          if (index >= 0) guards.splice(index, 1);
        };
      },
      view() {
        return { visible: new Map(hostTools), knownNames: new Set(hostTools.keys()), restrictableNames: new Set(hostTools.keys()) };
      },
      async execute({ name, arguments: args, signal }) {
        // The real registry reads exec.signal and crashes without it; keep that
        // contract in the fake so a caller that forgets one fails here.
        if (signal === undefined) throw new Error("Cannot read properties of undefined (reading 'aborted')");
        return { content: [{ type: 'text', text: `${name} ${JSON.stringify(args)}` }], value: null };
      },
    },
    loader: {
      store: loaderStore,
      async create(entry) {
        loaderCalls.push(['create', entry.id, entry]);
        loaderStore[entry.id] = { options: { name: entry.name, config: entry.config, disabled: entry.disabled === true } };
        return entry.id;
      },
      async update(id, patch) {
        loaderCalls.push(['update', id, patch]);
        const current = loaderStore[id];
        if (current === undefined) throw new Error(`no entry ${id}`);
        loaderStore[id] = {
          options: {
            ...current.options,
            ...(patch.config === undefined ? {} : { config: patch.config }),
            ...(patch.disabled === undefined ? {} : { disabled: patch.disabled }),
          },
        };
      },
      resolve(id) {
        const entry = loaderStore[id];
        if (entry === undefined) throw new Error(`no entry ${id}`);
        return entry;
      },
      remove(id) {
        loaderCalls.push(['remove', id]);
        delete loaderStore[id];
      },
    },
  };

  return {
    ctx,
    agents,
    hostTools,
    registered,
    guards,
    restrictions,
    commands,
    loaderCalls,
    handlers,
    dispose() {
      for (const dispose of effects) dispose?.();
      handlers.dispose?.();
    },
  };
}
