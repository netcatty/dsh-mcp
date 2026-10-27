import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configDir, migrateLegacy, oauthPath, settingsPath } from '../lib/paths.js';

function home() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-home-'));
  process.env.DSH_HOME = dir;
  return dir;
}

test('every file lives under $DSH_HOME/dsh-plugins/dsh-mcp', () => {
  const dir = home();
  assert.equal(configDir(), join(dir, 'dsh-plugins', 'dsh-mcp'));
  assert.equal(settingsPath(), join(dir, 'dsh-plugins', 'dsh-mcp', 'settings.json'));
  assert.equal(oauthPath(), join(dir, 'dsh-plugins', 'dsh-mcp', 'oauth.json'));
});

test('home-root files move into the app directory once', () => {
  const dir = home();
  writeFileSync(join(dir, 'mcp-settings.json'), '{"servers":[]}');
  writeFileSync(join(dir, 'mcp-oauth.json'), '{"servers":{}}');

  const moved = migrateLegacy();
  assert.equal(moved.length, 2);
  assert.equal(readFileSync(settingsPath(), 'utf8'), '{"servers":[]}');
  assert.equal(readFileSync(oauthPath(), 'utf8'), '{"servers":{}}');
  assert.equal(existsSync(join(dir, 'mcp-settings.json')), false);
  assert.equal(existsSync(join(dir, 'mcp-oauth.json')), false);

  // Idempotent: a second run has nothing left to move.
  assert.deepEqual(migrateLegacy(), []);
  assert.equal(statSync(settingsPath()).mode & 0o777, 0o600);
});

test('a 0.2.0 dsh-mcp directory is drained and removed', () => {
  const dir = home();
  mkdirSync(join(dir, 'dsh-mcp'), { recursive: true });
  writeFileSync(join(dir, 'dsh-mcp', 'settings.json'), '{"servers":[{"name":"app-dir"}]}');

  migrateLegacy();
  assert.match(readFileSync(settingsPath(), 'utf8'), /app-dir/);
  assert.equal(existsSync(join(dir, 'dsh-mcp')), false);
});

test('a transient storages/dsh-mcp directory is drained and removed', () => {
  const dir = home();
  mkdirSync(join(dir, 'storages', 'dsh-mcp'), { recursive: true });
  writeFileSync(join(dir, 'storages', 'dsh-mcp', 'settings.json'), '{"servers":[{"name":"from-storages"}]}');

  migrateLegacy();
  assert.match(readFileSync(settingsPath(), 'utf8'), /from-storages/);
  assert.equal(existsSync(join(dir, 'storages', 'dsh-mcp')), false);
});

test('the newest legacy copy wins', () => {
  const dir = home();
  mkdirSync(join(dir, 'dsh-mcp'), { recursive: true });
  writeFileSync(join(dir, 'dsh-mcp', 'settings.json'), '{"servers":[{"name":"app-dir"}]}');
  mkdirSync(join(dir, 'storages', 'dsh-mcp'), { recursive: true });
  writeFileSync(join(dir, 'storages', 'dsh-mcp', 'settings.json'), '{"servers":[{"name":"from-storages"}]}');
  writeFileSync(join(dir, 'mcp-settings.json'), '{"servers":[{"name":"legacy"}]}');

  migrateLegacy();
  assert.match(readFileSync(settingsPath(), 'utf8'), /app-dir/);
});

test('an existing new file is never overwritten by a stale old one', () => {
  const dir = home();
  mkdirSync(join(dir, 'dsh-plugins', 'dsh-mcp'), { recursive: true });
  writeFileSync(join(dir, 'dsh-plugins', 'dsh-mcp', 'settings.json'), '{"servers":[{"name":"new"}]}');
  writeFileSync(join(dir, 'mcp-settings.json'), '{"servers":[{"name":"old"}]}');

  migrateLegacy();
  assert.match(readFileSync(settingsPath(), 'utf8'), /new/);
});
