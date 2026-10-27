import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVisibility, parsePublicName, publicNameFor } from '../lib/visibility.js';
import { createFakeHost } from './harness.mjs';

const TOOLS = [
  { name: 'mcp__alpha__read', description: 'read a doc' },
  { name: 'mcp__beta__write', description: 'write a doc' },
  { name: 'bash' },
];

function setup({ lazy = true, clock } = {}) {
  const host = createFakeHost({ tools: TOOLS });
  const state = { at: 1000 };
  const now = clock ?? (() => state.at);
  const visibility = createVisibility(host.ctx, { lazy, now, defaultTtlMinutes: 2 });
  const agentCtx = { agents: { list: () => host.agents }, on: () => () => {} };
  visibility.mount(agentCtx);
  return { host, visibility, state };
}

test('public names round-trip', () => {
  assert.equal(publicNameFor('srv', 'do'), 'mcp__srv__do');
  assert.deepEqual(parsePublicName('mcp__srv__do'), { server: 'srv', tool: 'do' });
  assert.equal(parsePublicName('bash'), null);
});

test('every MCP tool starts hidden; activation exposes only the requested one', () => {
  const { host, visibility } = setup();
  const agent = host.agents[0];
  assert.deepEqual(host.restrictions.get(agent), ['mcp__alpha__read', 'mcp__beta__write']);

  const result = visibility.activate(agent, { server: 'alpha' });
  assert.deepEqual(result.activated, ['mcp__alpha__read']);
  assert.deepEqual(host.restrictions.get(agent), ['mcp__beta__write']);

  const status = visibility.status(agent);
  assert.equal(status.active.length, 1);
  assert.deepEqual(status.hidden, ['mcp__beta__write']);
  host.dispose();
});

test('activation expires after its TTL', () => {
  const { host, visibility, state } = setup();
  const agent = host.agents[0];
  visibility.activate(agent, { server: 'alpha', ttlMinutes: 1 });
  assert.equal(host.restrictions.get(agent).length, 1);

  state.at += 61_000;
  visibility.refresh();
  assert.deepEqual(host.restrictions.get(agent), ['mcp__alpha__read', 'mcp__beta__write']);
  assert.equal(visibility.status(agent).active.length, 0);
  host.dispose();
});

test('activating a server whose tools never registered explains why', () => {
  const { host, visibility } = setup();
  assert.throws(
    () => visibility.activate(host.agents[0], { server: 'ghost', tools: ['x'] }),
    /尚未连接完成/,
  );
  host.dispose();
});

test('the guard denies an inactive MCP tool and allows an active one', () => {
  const { host, visibility } = setup();
  const agent = host.agents[0];
  const definition = host.registered.get('mcp');
  assert.equal(definition, undefined, 'the controller registers no tool of its own');

  const guard = host.guards[0];
  assert.match(guard({ name: 'mcp__alpha__read', agent }), /未在当前会话激活/);
  visibility.activate(agent, { server: 'alpha' });
  assert.equal(guard({ name: 'mcp__alpha__read', agent }), undefined);
  host.dispose();
});

test('clear drops one Agent\'s activations or every Agent\'s', () => {
  const host = createFakeHost({ tools: TOOLS, agents: 2 });
  const visibility = createVisibility(host.ctx, { lazy: true, now: () => 1000, defaultTtlMinutes: 5 });
  visibility.mount({ agents: { list: () => host.agents }, on: () => () => {} });
  visibility.activate(host.agents[0], { server: 'alpha' });
  visibility.activate(host.agents[1], { server: 'beta' });

  assert.equal(visibility.clear(host.agents[0]), 1);
  assert.equal(visibility.status(host.agents[0]).active.length, 0);
  assert.equal(visibility.status(host.agents[1]).active.length, 1);

  assert.equal(visibility.clear(), 1);
  assert.equal(visibility.summary().total, 0);
  host.dispose();
});

test('forgetServer drops that server across Agents only', () => {
  const host = createFakeHost({ tools: TOOLS, agents: 2 });
  const visibility = createVisibility(host.ctx, { lazy: true, now: () => 1000, defaultTtlMinutes: 5 });
  visibility.mount({ agents: { list: () => host.agents }, on: () => () => {} });
  visibility.activate(host.agents[0], { server: 'alpha' });
  visibility.activate(host.agents[1], { server: 'alpha' });
  visibility.activate(host.agents[1], { server: 'beta' });

  assert.equal(visibility.forgetServer('alpha'), 2);
  assert.equal(visibility.status(host.agents[0]).active.length, 0);
  assert.equal(visibility.status(host.agents[1]).active.length, 1);
  assert.equal(visibility.forgetServer('missing'), 0);
  host.dispose();
});

test('summary aggregates activations across live Agents', () => {
  const host = createFakeHost({ tools: TOOLS, agents: 2 });
  const visibility = createVisibility(host.ctx, { lazy: true, now: () => 1000, defaultTtlMinutes: 5 });
  visibility.mount({ agents: { list: () => host.agents }, on: () => () => {} });

  visibility.activate(host.agents[0], { server: 'alpha' });
  visibility.activate(host.agents[1], { server: 'beta' });
  const summary = visibility.summary();
  assert.equal(summary.agents, 2);
  assert.equal(summary.total, 2);
  assert.deepEqual(summary.byServer, { alpha: 1, beta: 1 });
  assert.deepEqual(summary.tools.map((tool) => tool.name), ['mcp__alpha__read', 'mcp__beta__write']);
  for (const tool of summary.tools) assert.equal(typeof tool.expiresAt, 'number');
  host.dispose();
});

test('a tool outside the Agent scope stays hidden and uncallable', () => {
  const host = createFakeHost({ tools: TOOLS });
  const scoped = createVisibility(host.ctx, {
    lazy: true,
    now: () => 1000,
    isToolVisible: (name) => !name.startsWith('mcp__beta__'),
  });
  scoped.mount({ agents: { list: () => host.agents }, on: () => () => {} });
  const agent = host.agents[0];
  assert.deepEqual(host.restrictions.get(agent), ['mcp__alpha__read', 'mcp__beta__write']);

  scoped.activate(agent, { server: 'beta' });
  // beta is activated but out of scope, so it stays denied; alpha is in scope
  // but not activated, so it stays denied too.
  assert.deepEqual(host.restrictions.get(agent), ['mcp__alpha__read', 'mcp__beta__write']);
  const guard = host.guards[0];
  assert.match(guard({ name: 'mcp__beta__write', agent }), /不属于当前工作区/);
  assert.match(guard({ name: 'mcp__alpha__read', agent }), /未在当前会话激活/);
  host.dispose();
});

test('deactivation restores the hide set and lazy=false hides nothing', () => {
  const { host, visibility } = setup();
  const agent = host.agents[0];
  visibility.activate(agent, { server: 'alpha' });
  visibility.deactivate(agent, { server: 'alpha' });
  assert.deepEqual(host.restrictions.get(agent), ['mcp__alpha__read', 'mcp__beta__write']);
  host.dispose();

  const relaxed = setup({ lazy: false });
  assert.equal(relaxed.host.restrictions.get(relaxed.host.agents[0]), undefined);
  relaxed.host.dispose();
});
