// One directory for every file this plugin owns:
//   $DSH_HOME/dsh-plugins/dsh-mcp/settings.json   server list + sidebar flag
//   $DSH_HOME/dsh-plugins/dsh-mcp/oauth.json      OAuth grants
//
// `$DSH_HOME/storages/` belongs to the storage backend and the home root belongs
// to the platform, so all of this author's plugins share one namespace:
// `$DSH_HOME/dsh-plugins/<plugin>/`. `migrateLegacy` moves files written by
// earlier versions: `mcp-settings.json` / `mcp-oauth.json` from the home root,
// a transient `storages/dsh-mcp/` from 0.2.0-rc, and `dsh-mcp/` from 0.2.0.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const PLUGINS_DIR = 'dsh-plugins';
export const APP_DIR = 'dsh-mcp';
export const SETTINGS_FILE = 'settings.json';
export const OAUTH_FILE = 'oauth.json';

export function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  return typeof fromEnv === 'string' && fromEnv !== '' ? fromEnv : join(homedir(), '.dsh');
}

export function configDir() {
  return join(dshHome(), PLUGINS_DIR, APP_DIR);
}

export function settingsPath() {
  return join(configDir(), SETTINGS_FILE);
}

export function oauthPath() {
  return join(configDir(), OAUTH_FILE);
}

/** Configuration snapshots taken before every write. */
export function snapshotsDir() {
  return join(configDir(), 'snapshots');
}

/** Earlier locations, newest first. */
export function legacyPaths() {
  const home = dshHome();
  return {
    settings: [
      join(home, APP_DIR, SETTINGS_FILE),
      join(home, 'storages', APP_DIR, SETTINGS_FILE),
      join(home, 'mcp-settings.json'),
    ],
    oauth: [
      join(home, APP_DIR, OAUTH_FILE),
      join(home, 'storages', APP_DIR, OAUTH_FILE),
      join(home, 'mcp-oauth.json'),
    ],
    staleDirs: [join(home, APP_DIR), join(home, 'storages', APP_DIR)],
  };
}

function moveFirst(sources, to) {
  if (existsSync(to)) return null;
  const from = sources.find((candidate) => existsSync(candidate));
  if (from === undefined) return null;
  mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
  copyFileSync(from, to);
  try {
    // Keep the owner bits but never wider than 0600: both files can hold tokens.
    chmodSync(to, (statSync(from).mode & 0o700) | 0o600);
  } catch {
    // Mode tightening is best-effort; the write path sets 0600 anyway.
  }
  try {
    rmSync(from);
  } catch {
    // Leaving the old file behind is harmless: the new one wins.
  }
  return from;
}

/** Move earlier files into the app directory. Returns the sources that moved. */
export function migrateLegacy(log) {
  const legacy = legacyPaths();
  const moved = [];
  const settings = moveFirst(legacy.settings, settingsPath());
  if (settings !== null) moved.push(settings);
  const oauth = moveFirst(legacy.oauth, oauthPath());
  if (oauth !== null) moved.push(oauth);

  // Drop earlier directories once nothing is left in them.
  for (const stale of legacy.staleDirs) {
    try {
      if (existsSync(stale) && readdirSync(stale).length === 0) rmSync(stale, { recursive: true });
    } catch {
      // Cleanup is cosmetic.
    }
  }

  if (moved.length > 0) log?.(`dsh-mcp: 已迁移 ${moved.length} 个配置文件到 ${configDir()}`);
  return moved;
}
