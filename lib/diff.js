// Compare the live server list with a snapshot before restoring it.

function indexByName(servers) {
  const map = new Map();
  for (const server of servers) map.set(server.name, server);
  return map;
}

function changedFields(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed = [];
  for (const key of keys) {
    if (key === 'name') continue;
    const left = JSON.stringify(before?.[key]);
    const right = JSON.stringify(after?.[key]);
    if (left !== right) changed.push(key);
  }
  return changed.sort();
}

/**
 * @param {Array<object>} current - live servers.
 * @param {Array<object>} snapshot - servers recorded in the snapshot.
 */
export function diffServers(current, snapshot) {
  const now = indexByName(current);
  const then = indexByName(snapshot);
  const added = [];
  const removed = [];
  const changed = [];
  for (const name of then.keys()) {
    if (!now.has(name)) {
      added.push(name); // restoring brings it back
      continue;
    }
    const fields = changedFields(now.get(name), then.get(name));
    if (fields.length > 0) changed.push({ name, fields });
  }
  for (const name of now.keys()) {
    if (!then.has(name)) removed.push(name); // restoring drops it
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort((left, right) => left.name.localeCompare(right.name)),
    identical: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}
