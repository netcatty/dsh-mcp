import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffServers } from '../lib/diff.js';

const base = [
  { name: 'a', transport: 'stdio', command: 'node', args: ['x'] },
  { name: 'b', transport: 'stdio', command: 'node' },
];

test('identical lists produce an empty diff', () => {
  const diff = diffServers(base, structuredClone(base));
  assert.equal(diff.identical, true);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.changed, []);
});

test('added/removed are reported from the restore point of view', () => {
  const snapshot = [{ name: 'a', transport: 'stdio', command: 'node', args: ['x'] }, { name: 'c', transport: 'stdio', command: 'node' }];
  const diff = diffServers(base, snapshot);
  assert.deepEqual(diff.added, ['c']); // restoring brings c back
  assert.deepEqual(diff.removed, ['b']); // restoring drops b
  assert.equal(diff.identical, false);
});

test('changed fields are listed per server', () => {
  const snapshot = structuredClone(base);
  snapshot[0].args = ['y', 'z'];
  snapshot[1].enabled = false;
  const diff = diffServers(base, snapshot);
  assert.deepEqual(diff.changed, [
    { name: 'a', fields: ['args'] },
    { name: 'b', fields: ['enabled'] },
  ]);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
});

test('workspace scope and disabledTools differences are visible', () => {
  const current = [{ name: 'a', transport: 'stdio', command: 'node', workspaceIds: ['w1'], disabledTools: ['x'] }];
  const snapshot = [{ name: 'a', transport: 'stdio', command: 'node', workspaceIds: ['w1', 'w2'], disabledTools: [] }];
  const diff = diffServers(current, snapshot);
  assert.deepEqual(diff.changed, [{ name: 'a', fields: ['disabledTools', 'workspaceIds'] }]);
});
