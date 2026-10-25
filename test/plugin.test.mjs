import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apply } from '../lib/index.js';

const here = dirname(fileURLToPath(import.meta.url));

test('plugin registers the router tool and /mcp command', async () => {
  let definition;
  const commands = [];
  const handlers = {};
  const ctx = {
    on: (name, fn) => {
      handlers[name] = fn;
    },
    tools: { register: (value) => { definition = value; } },
    get: (name) => name === 'commands' ? { register: (value) => { commands.push(value); } } : undefined,
    logger: { warn: () => {} },
  };
  apply(ctx, {
    settingsPath: join(mkdtempSync(join(tmpdir(), 'mcp-test-')), 'settings.json'),
    servers: [
      {
        name: 'fake',
        transport: 'stdio',
        command: process.execPath,
        args: [join(here, 'fake-server.mjs')],
      },
    ],
  });
  assert.equal(definition.name, 'mcp');
  const servers = await definition.execute({ action: 'servers' });
  assert.match(servers.text, /fake \[idle\]/);
  const tools = await definition.execute({ action: 'tools', server: 'fake' });
  assert.match(tools.text, /echo/);
  const described = await definition.execute({ action: 'describe', server: 'fake', tool: 'echo' });
  assert.equal(JSON.parse(described.text).name, 'echo');
  const called = await definition.execute({ action: 'call', server: 'fake', tool: 'echo', arguments: { text: 'yo' } });
  assert.equal(called.text, 'echo:yo');

  await new Promise((resolve) => setTimeout(resolve, 50));
  const command = commands.find((item) => item.name === 'mcp');
  assert.ok(command);
  const status = await command.handler({ rawInput: '' });
  assert.match(status.text, /fake \[connected\]/);
  const toolsOut = await command.handler({ rawInput: 'fake tools' });
  assert.match(toolsOut.text, /echo/);
  const callOut = await command.handler({ rawInput: 'fake call echo {"text":"cmd"}' });
  assert.equal(callOut.kind, 'success');
  assert.equal(callOut.text, 'echo:cmd');
  const missing = await command.handler({ rawInput: 'nope tools' });
  assert.equal(missing.kind, 'error');

  handlers.dispose();
});
