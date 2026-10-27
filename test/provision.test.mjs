import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntryConfig, provision, sync, unprovision } from '../lib/provision.js';
import { createFakeHost } from './harness.mjs';

test('stdio records become official client configs', () => {
  const config = buildEntryConfig({
    name: 'local',
    transport: 'stdio',
    command: 'node',
    args: ['server.mjs'],
    env: { TOKEN: 'x' },
    cwd: '/tmp/work',
    toolCallTimeoutMs: 5000,
  });
  assert.deepEqual(config, {
    serverName: 'local',
    transport: 'stdio',
    command: 'node',
    args: ['server.mjs'],
    toolCallTimeoutMs: 5000,
    env: { TOKEN: 'x' },
    cwd: '/tmp/work',
  });
});

test('http records merge static and dynamic headers', () => {
  const config = buildEntryConfig(
    { name: 'remote', transport: 'streamable-http', url: 'https://example.test/mcp', headers: { 'X-Static': '1' } },
    { Authorization: 'Bearer t' },
  );
  assert.deepEqual(config, {
    serverName: 'remote',
    transport: 'streamable-http',
    url: 'https://example.test/mcp',
    headers: { 'X-Static': '1', Authorization: 'Bearer t' },
  });
});

test('provision is idempotent and keeps the entry disabled when asked', async () => {
  const host = createFakeHost();
  const server = { name: 'local', transport: 'stdio', command: 'node' };

  await provision(host.ctx, server);
  assert.equal(Object.keys(host.ctx.loader.store).length, 1);
  await provision(host.ctx, { ...server, enabled: false });
  const entry = host.ctx.loader.store['dshmcp-local'];
  assert.equal(entry.options.disabled, true);
  assert.equal(entry.options.config.serverName, 'local');

  await unprovision(host.ctx, 'local');
  assert.equal(Object.keys(host.ctx.loader.store).length, 0);
  host.dispose();
});

test('sync adds configured servers and removes stale rows', async () => {
  const host = createFakeHost();
  await provision(host.ctx, { name: 'stale', transport: 'stdio', command: 'node' });

  await sync(host.ctx, [
    { name: 'alpha', transport: 'stdio', command: 'node' },
    { name: 'beta', transport: 'streamable-http', url: 'https://example.test/mcp' },
  ]);

  assert.deepEqual(Object.keys(host.ctx.loader.store).sort(), ['dshmcp-alpha', 'dshmcp-beta']);
  host.dispose();
});
