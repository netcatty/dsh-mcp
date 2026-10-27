import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditPath, MAX_BYTES, recent, record } from '../lib/audit.js';

function home() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-audit-'));
  process.env.DSH_HOME = dir;
  return dir;
}

test('events append as JSONL and come back newest first', () => {
  home();
  record({ action: 'activate', server: 'a', agent: 'session-1', detail: 'mcp__a__x' });
  record({ action: 'call', tool: 'mcp__a__x', ok: true });

  const events = recent();
  assert.equal(events.length, 2);
  assert.equal(events[0].action, 'call');
  assert.equal(events[1].server, 'a');
  assert.ok(events[1].at);
  assert.equal(statSync(auditPath()).mode & 0o777, 0o600);
});

test('filters by server and action, and honours the limit', () => {
  home();
  record({ action: 'activate', server: 'a' });
  record({ action: 'activate', server: 'b' });
  record({ action: 'call', server: 'a', tool: 'x' });

  assert.equal(recent({ server: 'a' }).length, 2);
  assert.equal(recent({ action: 'call' }).length, 1);
  assert.equal(recent({ limit: 1 }).length, 1);
});

test('a torn line is skipped instead of failing the read', () => {
  home();
  record({ action: 'activate', server: 'a' });
  appendFileSync(auditPath(), '{"action": "call", broken\n');
  const events = recent();
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'activate');
});

test('the file rotates once it grows past the budget', () => {
  home();
  record({ action: 'activate', server: 'a' }, { maxBytes: 1 });
  record({ action: 'call', tool: 'x', ok: true }, { maxBytes: 1 });
  assert.ok(existsSync(`${auditPath()}.1`));
  const events = recent();
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'call');
  assert.ok(MAX_BYTES > 1024);
});
