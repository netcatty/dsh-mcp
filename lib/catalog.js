// Last-known tool catalogue per MCP server.
//
// Servers stay disconnected until something needs them (activate / enable /
// refresh), so `servers` / `tools` / `search` / `describe` need a way to answer
// while a server is idle. Every successful connection writes its tool list
// here; a disconnected server reads it back.
//
// Only what a list or a description needs is stored: the public tool name, the
// description, the input schema and the configured-disabled flag. Nothing here
// is authoritative — a connected server's live registry always wins.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { catalogPath } from './paths.js';

/** Read the whole catalogue; a missing or broken file is an empty catalogue. */
export function readCatalog(path = catalogPath()) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Store one server's tools. Returns the catalogue that was written. */
export function writeServerTools(name, tools, path = catalogPath()) {
  const all = readCatalog(path);
  all[name] = { at: new Date().toISOString(), tools };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  return all;
}

/** Tools remembered for a server, shaped like the live registry's rows. */
export function catalogTools(name, path = catalogPath()) {
  const entry = readCatalog(path)[name];
  if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.tools)) return [];
  return entry.tools.filter((tool) => tool !== null && typeof tool === 'object' && typeof tool.tool === 'string');
}

/** Drop remembered tools for servers that no longer exist. */
export function pruneCatalog(names, path = catalogPath()) {
  const all = readCatalog(path);
  const keep = new Set(names);
  let changed = false;
  for (const name of Object.keys(all)) {
    if (keep.has(name)) continue;
    delete all[name];
    changed = true;
  }
  if (!changed) return all;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  return all;
}
