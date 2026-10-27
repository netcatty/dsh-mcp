// One append-only JSONL audit trail for what this plugin did: activations,
// deactivations, panel/command calls, configuration changes and restores.
// Rotation keeps the file small enough to read the tail without a database.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './paths.js';

export const MAX_BYTES = 5 * 1024 * 1024;

export function auditPath() {
  return join(configDir(), 'audit.jsonl');
}

function rotate(maxBytes) {
  const path = auditPath();
  try {
    if (!existsSync(path)) return;
    if (statSync(path).size < maxBytes) return;
    renameSync(path, `${path}.1`);
  } catch {
    // Rotation is best-effort; the append below still records the event.
  }
}

/**
 * Append one event.
 * @param {{action: string, server?: string, tool?: string, agent?: string, ok?: boolean, detail?: string}} entry
 */
export function record(entry, { now = () => new Date(), maxBytes = MAX_BYTES } = {}) {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  rotate(maxBytes);
  const line = JSON.stringify({ at: now().toISOString(), ...entry });
  appendFileSync(auditPath(), `${line}\n`, { mode: 0o600 });
  return line;
}

/** Newest-first events, optionally filtered. */
export function recent({ limit = 100, server, action } = {}) {
  const path = auditPath();
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // a torn line must not hide the rest
    }
    if (typeof server === 'string' && server !== '' && parsed.server !== server) continue;
    if (typeof action === 'string' && action !== '' && parsed.action !== action) continue;
    out.push(parsed);
  }
  return out.slice(-Math.max(1, Math.min(limit, 1000))).reverse();
}
