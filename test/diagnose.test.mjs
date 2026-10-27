import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, resolveCommand } from '../lib/diagnose.js';

test('resolveCommand finds a PATH binary and rejects a missing one', () => {
  assert.ok(resolveCommand('node')?.endsWith('node'));
  assert.equal(resolveCommand('definitely-not-a-real-command-xyz'), null);
  assert.equal(resolveCommand('/definitely/missing/binary'), null);
  assert.equal(resolveCommand(''), null);
});

test('stdio diagnosis reports a missing command', async () => {
  const result = await diagnose({ name: 'x', transport: 'stdio', command: 'definitely-not-a-real-command-xyz' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'command-missing');
  assert.match(result.hint, /PATH/);
});

test('stdio diagnosis confirms a found command without claiming a connection', async () => {
  const result = await diagnose({ name: 'x', transport: 'stdio', command: 'node' });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'command-found');
  assert.match(result.hint, /看工具数/);
});

function fakeFetch(status) {
  return async () => ({ status });
}

test('http diagnosis classifies auth, missing endpoint and server errors', async () => {
  const server = { name: 'r', transport: 'streamable-http', url: 'https://example.test/mcp' };
  assert.equal((await diagnose(server, { fetchImpl: fakeFetch(401) })).code, 'http-401');
  assert.equal((await diagnose(server, { fetchImpl: fakeFetch(403) })).stage, 'auth');
  assert.equal((await diagnose(server, { fetchImpl: fakeFetch(404) })).code, 'http-404');
  assert.equal((await diagnose(server, { fetchImpl: fakeFetch(502) })).code, 'http-502');
  const ok = await diagnose(server, { fetchImpl: fakeFetch(200) });
  assert.equal(ok.ok, true);
  assert.equal(ok.code, 'reachable');
});

test('an AggregateError cause still yields the nested network code', async () => {
  const failing = async () => {
    const inner = new Error('connect ECONNREFUSED 127.0.0.1:1');
    inner.code = 'ECONNREFUSED';
    throw new TypeError('fetch failed', { cause: new AggregateError([inner], 'connect') });
  };
  const result = await diagnose({ name: 'r', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp' }, { fetchImpl: failing });
  assert.equal(result.code, 'ECONNREFUSED');
});

test('a code-less fetch failure is classified from its message', async () => {
  const failing = async () => {
    throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:1') });
  };
  const result = await diagnose({ name: 'r', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp' }, { fetchImpl: failing });
  assert.equal(result.code, 'ECONNREFUSED');
  assert.match(result.hint, /未启动/);
});

test('a blocked port is reported as bad-port', async () => {
  const failing = async () => { throw new TypeError('fetch failed', { cause: new Error('bad port') }); };
  const result = await diagnose({ name: 'r', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp' }, { fetchImpl: failing });
  assert.equal(result.code, 'bad-port');
  assert.match(result.hint, /端口/);
});

test('network failures carry an actionable code and hint', async () => {
  const refusing = async () => { const error = new Error('connect ECONNREFUSED'); error.code = 'ECONNREFUSED'; throw error; };
  const result = await diagnose({ name: 'r', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp' }, { fetchImpl: refusing });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ECONNREFUSED');
  assert.match(result.hint, /未启动/);
});
