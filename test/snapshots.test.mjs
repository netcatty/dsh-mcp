import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotsDir } from '../lib/paths.js';
import { listSnapshots, MAX_SNAPSHOTS, prune, readSnapshot, snapshot } from '../lib/snapshots.js';

function home() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-snap-'));
  process.env.DSH_HOME = dir;
  return dir;
}

function clock(start = Date.now()) {
  let at = start;
  return () => new Date((at += 1000));
}

test('a snapshot stores the server list and is listed newest first', () => {
  home();
  const now = clock();
  snapshot([{ name: 'a', transport: 'stdio', command: 'node' }], 'config', now);
  snapshot([{ name: 'a', transport: 'stdio', command: 'node' }, { name: 'b', transport: 'stdio', command: 'node' }], 'import', now);

  const list = listSnapshots();
  assert.equal(list.length, 2);
  assert.equal(list[0].reason, 'import');
  assert.deepEqual(list[0].names, ['a', 'b']);
  assert.deepEqual(readSnapshot(list[1].id).servers.map((server) => server.name), ['a']);
});

test('pruning keeps only the newest snapshots', () => {
  home();
  const now = clock();
  for (let index = 0; index < MAX_SNAPSHOTS + 5; index += 1) snapshot([{ name: `s${index}` }], 'config', now);
  assert.equal(listSnapshots().length, MAX_SNAPSHOTS);
  prune(3);
  assert.equal(listSnapshots().length, 3);
});

test('snapshot ids cannot escape the directory', () => {
  home();
  assert.throws(() => readSnapshot('../settings'), /不合法/);
  assert.throws(() => readSnapshot('a/b'), /不合法/);
});

test('a corrupt snapshot file does not hide the readable ones', () => {
  home();
  const now = clock();
  snapshot([{ name: 'ok' }], 'config', now);
  writeFileSync(join(snapshotsDir(), 'broken.json'), '{not json');
  const list = listSnapshots();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].names, ['ok']);
  assert.ok(readdirSync(snapshotsDir()).includes('broken.json'));
});
