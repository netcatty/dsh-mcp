# dsh-mcp

Lazy MCP management for DeepSeek Harness.

MCP itself runs on the official `@deepseek-ai/dsh-mcp-client`: this plugin turns
every configured server into one official client row (transport, stdio
processes, tool registration, approvals, images, instructions, reconnect and
pagination stay with the Host), then keeps those tools' schemas **out of the
session** until they are activated. One `mcp` router tool stays in context, so a
dozen servers cost one small schema instead of forty.

## How it works

1. Each server in `settings.json` becomes loader row `dshmcp-<name>` running
   `@deepseek-ai/dsh-mcp-client` (`lib/provision.js`).
2. Every Agent scope gets `ctx.tools.restrict({deny: [...all mcp__ tools]})`, so
   the model sees the tool names only after activation; a global
   `ctx.tools.guard()` refuses execution outside the activation window
   (`lib/visibility.js`).
3. `mcp({action:"activate", server, tools})` lifts the mask for those exact
   tools; the native `mcp__<server>__<tool>` schema enters context from the next
   turn and is callable with full Host approval. Activations are memory-only,
   per Agent, TTL 1–30 minutes (default 30).

## Features

- one `mcp` router tool: `servers`, `tools`, `search`, `describe`, `activate`,
  `deactivate`, `status`, `refresh`
- default-lazy: no MCP schema in context until activated; `lazy: false` restores
  always-on tools
- official client rows provisioned per server, so approvals, images, server
  instructions, auto-reconnect and pagination come from the Host
- settings page and optional sidebar entry: server CRUD, search/sort,
  enable/disable, reconnect, call panel, resources, a per-server count of tools
  currently activated in live sessions, and one button that clears every
  session's activations
- one `/mcp` command (status, tools, search, call, activate, deactivate)
- OAuth 2.0 login (discovery, dynamic registration, PKCE, loopback callback,
  refresh) for streamable-http servers
- `mcpServers` JSON import from the settings page: a full document
  (`{"mcpServers": {…}}`), a bare name→config map, or a single entry pasted as
  `"name": {…}`; and an export of the whole document or any subset of servers in
  that same fragment shape (several selected servers become a comma-separated
  fragment list), with `env`/`headers` values replaced by `<REDACTED>` and `cwd`
  by `<REDACTED:LOCAL_PATH>`

## Install

```sh
dsh plugin --profile web add link:/path/to/dsh-mcp
```

Restart `dsh web` afterwards: the plugin now creates loader rows, which only
take effect on a full restart.

## Configure

Every file this plugin owns lives in one directory,
`$DSH_HOME/dsh-plugins/dsh-mcp/` (default `~/.dsh/dsh-plugins/dsh-mcp/`, dir
0700, files 0600): `settings.json` for servers and the sidebar flag,
`oauth.json` for OAuth grants. `$DSH_HOME/storages/` belongs to the storage
backend (`dsh-storage-json`), so this author's plugins share one namespace
instead: `$DSH_HOME/dsh-plugins/<plugin>/`. Files written by earlier versions
(`~/.dsh/mcp-settings.json`, `~/.dsh/mcp-oauth.json`, `~/.dsh/dsh-mcp/`) are
moved there once on the next start.

The bundle patch inserts one `mcp` row. Edit it in the profile patch by id, or
use the settings page (writes `settings.json`, which wins over the patch once
present):

```yaml
- id: mcp
  name: '@netcatty/dsh-mcp'
  config:
    lazy: true              # false = every MCP tool always visible
    defaultTtlMinutes: 30   # activation lifetime, 1-30
    servers:
      - name: files
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/me/work']
        # optional: enabled, env, cwd, toolCallTimeoutMs: 60000
      - name: remote
        transport: streamable-http
        url: https://mcp.example.com/mcp
        headers:
          Authorization: Bearer ${TOKEN}
        # optional: oauth: true, clientId: <id when the server has no dynamic registration>
```

Do not add hand-written `@deepseek-ai/dsh-mcp-client` rows for the same
servers: this plugin owns the `mcp-*` prefix and removes stale rows on reload.

## Model workflow

```
mcp({action:"servers"})                        # which servers, how many tools
mcp({action:"tools", server:"files"})          # tool names
mcp({action:"describe", server:"files", tool:"read_file"})
mcp({action:"search", query:"screenshot"})     # across every enabled server
mcp({action:"activate", server:"files", tools:["read_file"]})
# next turn: mcp__files__read_file is callable as a normal tool
mcp({action:"deactivate", server:"files"})     # drop it again
```

## Commands

```
/mcp                                  every server row
/mcp search <query>               search registered MCP tools
/mcp <server>                     one server's row
/mcp <server> tools               tool names
/mcp <server> call <tool> [json]  call through the official pipeline
/mcp activate <server> [tool…]    activate tools for the receiving session
/mcp deactivate <server>          hide that server's tools again
/mcp deactivate                   hide everything in this session
```

The command is read-only apart from activate/deactivate; the settings page is
what edits configuration.

### Sidebar entry

Toggle「在侧边栏显示」in the settings page (stored in `settings.json` above),
or set `showInSidebar: true` on the `mcp` row. The
settings section and the 内置插件 tab are always registered.

## OAuth

Set `oauth: true` on a streamable-http server, restart, then click「登录」on its
card. The browser walks the authorization-code flow; the callback lands on a
one-shot `127.0.0.1` listener. Tokens are stored in
`$DSH_HOME/dsh-plugins/dsh-mcp/oauth.json` (mode 0600) and refreshed
automatically; the access token is injected as the
`Authorization` header on the provisioned client row. `clientId` is only needed
when the server does not support dynamic client registration.

## Known limits

- activation is per Agent and memory-only: a new session starts with everything
  hidden, and a plugin restart clears activations
- the model must call `mcp` before it can use a server's tools; a tool it never
  activates is never visible
- MCP prompt templates are not supported (the official client does not expose
  them); resources are reachable through `@deepseek-ai/dsh-mcp-resources`
- panel trials carry no Agent: a tool that needs approval (`ask`) is refused by
  the Host. Activate it in a session and let the model call it instead
- no project-level (per-cwd) server sets; configuration is global
- OAuth was verified against a mock authorization server only; connecting such a
  server's MCP endpoint with the Bearer token has not been exercised against a
  real deployment
