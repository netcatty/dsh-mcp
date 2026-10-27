import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { apply } from '../lib/index.js';
import { createFakeHost } from './harness.mjs';

const MCP_TOOLS = [
  { name: 'mcp__fake__echo', description: 'echo text back', parameters: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'mcp__fake__sum', description: 'add numbers', parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
  { name: 'bash', description: 'not an MCP tool' },
];

function settingsPath() {
  return join(mkdtempSync(join(tmpdir(), 'mcp-plugin-')), 'settings.json');
}

test('provisions one official client row per server and hides its tools by default', async () => {
  const host = createFakeHost({ tools: MCP_TOOLS });
  await apply(host.ctx, {
    settingsPath: settingsPath(),
    servers: [{ name: 'fake', transport: 'stdio', command: process.execPath, args: ['server.mjs'] }],
  });

  const create = host.loaderCalls.find((call) => call[0] === 'create');
  assert.ok(create, 'loader.create must be called');
  assert.equal(create[1], 'dshmcp-fake');
  assert.equal(create[2].name, '@deepseek-ai/dsh-mcp-client');
  assert.equal(create[2].config.serverName, 'fake');
  assert.equal(create[2].config.transport, 'stdio');
  assert.equal(create[2].config.command, process.execPath);

  assert.deepEqual(host.restrictions.get(host.agents[0]), ['mcp__fake__echo', 'mcp__fake__sum']);

  const definition = host.registered.get('mcp');
  const servers = await definition.execute({ action: 'servers' }, { agent: host.agents[0] });
  assert.match(servers.text, /fake \[connected\]/);
  assert.match(servers.text, /tools=2/);

  const tools = await definition.execute({ action: 'tools', server: 'fake' }, { agent: host.agents[0] });
  assert.match(tools.text, /echo/);
  assert.doesNotMatch(tools.text, /bash/);

  const described = await definition.execute({ action: 'describe', server: 'fake', tool: 'sum' }, { agent: host.agents[0] });
  assert.equal(JSON.parse(described.text).inputSchema.properties.a.type, 'number');

  const search = await definition.execute({ action: 'search', query: 'echo' }, { agent: host.agents[0] });
  assert.match(search.text, /fake\/echo/);
  host.dispose();
});

test('activation narrows the per-Agent restriction and the guard follows it', async () => {
  const host = createFakeHost({ tools: MCP_TOOLS });
  await apply(host.ctx, {
    settingsPath: settingsPath(),
    servers: [{ name: 'fake', transport: 'stdio', command: process.execPath }],
  });
  const agent = host.agents[0];
  const definition = host.registered.get('mcp');

  const guard = host.guards[0];
  assert.ok(guard, 'a global guard must be registered');
  assert.match(guard({ name: 'mcp__fake__echo', agent }), /未在当前会话激活/);
  assert.equal(guard({ name: 'bash', agent }), undefined);

  const activated = await definition.execute({ action: 'activate', server: 'fake', tools: ['echo'] }, { agent });
  assert.match(activated.text, /已激活/);
  assert.deepEqual(host.restrictions.get(agent), ['mcp__fake__sum']);
  assert.equal(guard({ name: 'mcp__fake__echo', agent }), undefined);

  const status = await definition.execute({ action: 'status' }, { agent });
  assert.match(status.text, /active mcp__fake__echo/);

  const deactivated = await definition.execute({ action: 'deactivate', server: 'fake' }, { agent });
  assert.match(deactivated.text, /已停用/);
  assert.deepEqual(host.restrictions.get(agent), ['mcp__fake__echo', 'mcp__fake__sum']);
  host.dispose();
});

test('lazy=false keeps every MCP tool visible and the guard inert', async () => {
  const host = createFakeHost({ tools: MCP_TOOLS });
  await apply(host.ctx, {
    settingsPath: settingsPath(),
    lazy: false,
    servers: [{ name: 'fake', transport: 'stdio', command: process.execPath }],
  });
  assert.equal(host.restrictions.get(host.agents[0]), undefined);
  const guard = host.guards[0];
  assert.equal(guard({ name: 'mcp__fake__echo', agent: host.agents[0] }), undefined);
  host.dispose();
});

test('/mcp reports servers and their tools', async () => {
  const host = createFakeHost({ tools: MCP_TOOLS });
  await apply(host.ctx, {
    settingsPath: settingsPath(),
    servers: [{ name: 'fake', transport: 'stdio', command: process.execPath }],
  });
  const command = host.commands.find((item) => item.name === 'mcp');
  assert.ok(command);
  assert.match((await command.handler({ rawInput: '' })).text, /fake \[connected\]/);
  assert.match((await command.handler({ rawInput: 'fake tools' })).text, /mcp__fake__echo/);
  const called = await command.handler({ rawInput: 'fake call echo {"text":"hi"}' });
  assert.equal(called.kind, 'success');
  assert.match(called.text, /mcp__fake__echo/);
  assert.equal((await command.handler({ rawInput: 'nope tools' })).kind, 'error');
  host.dispose();
});
