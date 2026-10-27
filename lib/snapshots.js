// Configuration snapshots: every settings write leaves one file behind, so a
// bad import or edit can be rolled back without hand-editing JSON. Snapshots
// hold real values (they must restore working credentials), so the directory is
// 0700 and each file 0600.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { snapshotsDir } from './paths.js';

export const MAX_SNAPSHOTS = 20;
const ID_RE = /^[A-Za-z0-9._-]+$/;

function assertId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id) || id.includes('..')) {
    throw new Error(`快照 id 不合法：${JSON.stringify(id)}`);
  }
  return id;
}

function pathFor(id) {
  return join(snapshotsDir(), `${assertId(id)}.json`);
}

/** Record the current server list; returns the new snapshot id. */
export function snapshot(servers, reason = 'config', now = () => new Date()) {
  if (!Array.isArray(servers)) throw new Error('servers 必须是数组');
  const dir = snapshotsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const at = now();
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  const tag = String(reason).replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 24) || 'config';
  let id = `${stamp}-${tag}`;
  let counter = 1;
  while (existsSync(pathFor(id))) {
    counter += 1;
    id = `${stamp}-${tag}-${counter}`;
  }
  const body = { version: 1, id, at: at.toISOString(), reason: tag, servers };
  writeFileSync(pathFor(id), `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  prune();
  return id;
}

/** Summaries, newest first. */
export function listSnapshots() {
  const dir = snapshotsDir();
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const id = file.slice(0, -'.json'.length);
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      out.push({
        id,
        at: parsed.at,
        reason: parsed.reason ?? 'config',
        servers: Array.isArray(parsed.servers) ? parsed.servers.length : 0,
        names: Array.isArray(parsed.servers) ? parsed.servers.map((server) => server.name) : [],
        bytes: statSync(join(dir, file)).size,
      });
    } catch {
      // A corrupt snapshot must not hide the others.
    }
  }
  return out.sort((left, right) => String(right.at).localeCompare(String(left.at)));
}

/** Full record of one snapshot. */
export function readSnapshot(id) {
  const parsed = JSON.parse(readFileSync(pathFor(id), 'utf8'));
  if (!Array.isArray(parsed.servers)) throw new Error(`快照 ${id} 缺少 servers`);
  return { id, at: parsed.at, reason: parsed.reason ?? 'config', servers: parsed.servers };
}

/** Delete every snapshot but the newest `keep`. */
export function prune(keep = MAX_SNAPSHOTS) {
  const entries = listSnapshots();
  let removed = 0;
  for (const entry of entries.slice(keep)) {
    try {
      rmSync(pathFor(entry.id));
      removed += 1;
    } catch {
      // Pruning is best-effort.
    }
  }
  return removed;
}
