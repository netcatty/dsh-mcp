import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '../lib/index.js';

const here = dirname(fileURLToPath(import.meta.url));

function fakeRegistry() {
  return createRegistry([
    {
      name: 'fake',
      transport: 'stdio',
      command: process.execPath,
      args: [join(here, 'fake-server.mjs')],
    },
  ]);
}

test('lazy registry connects only when used and lists tools', async () => {
  const registry = fakeRegistry();
  const before = await registry.list();
  assert.equal(before[0].status, 'idle');
  const tools = await registry.toolsOf('fake');
  assert.deepEqual(tools.map((tool) => tool.name), ['echo', 'sum']);
  const after = await registry.list();
  assert.equal(after[0].status, 'connected');
  assert.equal(after[0].tools, 2);
  await registry.dispose();
});

test('describe returns the input schema and call returns content', async () => {
  const registry = fakeRegistry();
  const schema = await registry.describe('fake', 'echo');
  assert.equal(schema.inputSchema.properties.text.type, 'string');
  const result = await registry.call('fake', 'echo', { text: 'hi' });
  assert.equal(result.content[0].text, 'echo:hi');
  const sum = await registry.call('fake', 'sum', { a: 2, b: 3 });
  assert.equal(sum.content[0].text, '5');
  await registry.dispose();
});

test('unknown server and tool produce actionable errors', async () => {
  const registry = fakeRegistry();
  await assert.rejects(() => registry.toolsOf('nope'), /unknown server/);
  await assert.rejects(() => registry.call('fake', 'nope', {}), /no tool/);
  await registry.dispose();
});
