import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeServers, parseMcpServers, toMcpServers } from '../lib/translate.js';

const DOC = JSON.stringify({
  mcpServers: {
    files: { command: 'npx', args: ['-y', 'fs-server', '/work'], env: { TOKEN: 'secret' } },
    remote: { url: 'https://example.test/mcp', headers: { Authorization: 'Bearer t' } },
    off: { command: 'node', enabled: false },
  },
});

test('parseMcpServers maps stdio and http entries', () => {
  const servers = parseMcpServers(DOC);
  assert.deepEqual(servers.map((server) => server.name), ['files', 'remote', 'off']);
  assert.equal(servers[0].transport, 'stdio');
  assert.deepEqual(servers[0].args, ['-y', 'fs-server', '/work']);
  assert.deepEqual(servers[0].env, { TOKEN: 'secret' });
  assert.equal(servers[1].transport, 'streamable-http');
  assert.equal(servers[1].headers.Authorization, 'Bearer t');
  assert.equal(servers[2].enabled, false);
});

test('parseMcpServers rejects shapes it cannot apply', () => {
  assert.throws(() => parseMcpServers('not json'), /JSON 解析失败/);
  assert.throws(() => parseMcpServers('{"mcpServers":{}}'), /没有任何服务器/);
  assert.throws(() => parseMcpServers('{"mcpServers":{"a__b":{"command":"x"}}}'), /不合法/);
  assert.throws(() => parseMcpServers('{"mcpServers":{"a":{}}}'), /需要 command/);
  assert.throws(() => parseMcpServers('{"mcpServers":{"a":{"command":"x","args":"y"}}}'), /字符串数组/);
});

test('mergeServers upserts by name and reports what happened', () => {
  const current = [{ name: 'files', transport: 'stdio', command: 'old' }];
  const incoming = parseMcpServers(DOC);
  const merged = mergeServers(current, incoming);
  assert.deepEqual(merged.added, ['remote', 'off']);
  assert.deepEqual(merged.updated, ['files']);
  assert.equal(merged.servers.length, 3);
  assert.equal(merged.servers[0].command, 'npx');
});

test('toMcpServers redacts secrets by default and can be asked not to', () => {
  const servers = parseMcpServers(DOC);
  const redacted = toMcpServers(servers);
  assert.equal(redacted.mcpServers.files.env.TOKEN, '<REDACTED>');
  assert.equal(redacted.mcpServers.remote.headers.Authorization, '<REDACTED>');
  assert.equal(redacted.mcpServers.off.enabled, false);

  const plain = toMcpServers(servers, { redact: false });
  assert.equal(plain.mcpServers.files.env.TOKEN, 'secret');
});

test('a redacted export imports back with placeholders', () => {
  const servers = parseMcpServers(DOC);
  const roundTrip = parseMcpServers(JSON.stringify(toMcpServers(servers)));
  assert.deepEqual(roundTrip.map((server) => server.name), ['files', 'remote', 'off']);
  assert.equal(roundTrip[0].env.TOKEN, '<REDACTED>');
});
