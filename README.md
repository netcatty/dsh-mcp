# dsh-mcp

Lazy MCP client and management surface for DeepSeek Harness.

Instead of injecting every server's tool schemas into each request, dsh-mcp
keeps one router tool (`mcp`) in context, connects to a server only when the
model or a human asks for it, and exposes the same operations through a settings
page, a sidebar entry and slash commands.

## Features

- one `mcp` router tool: `servers`, `tools`, `search`, `describe`, `call`,
  `refresh`, `resources`, `prompts`, `read`, `prompt`
- lazy stdio and streamable-http connections; a broken server only marks its own
  row
- settings section (also a tab under 内置插件), optional sidebar page
- server CRUD, search/sort, per-server enable/disable, per-tool disable
- tool call panel with a JSON argument box; resources and prompts with
  click-to-read (prompts accept JSON arguments)
- `/mcp` popup picker, `/mcp-raw` plain command for argument-heavy use
- call audit at `~/.dsh/mcp-audit.jsonl`, per-server `toolCallTimeoutMs`
- OAuth 2.0 login (discovery, dynamic registration, PKCE, loopback callback,
  refresh) for streamable-http servers

## Install

```sh
dsh plugin --profile web add link:/path/to/dsh-mcp
```

Or from npm once published: `dsh plugin --profile web add @netcatty/dsh-mcp`.

## Configure

The bundle patch inserts one `mcp` row. Edit it in the profile patch by id, or
use the settings page (writes `~/.dsh/mcp-settings.json`, which wins over the
patch once present):

```yaml
- id: mcp
  name: '@netcatty/dsh-mcp'
  config:
    servers:
      - name: files
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/me/work']
        # optional: enabled: true, disabledTools: [write_file], toolCallTimeoutMs: 60000
      - name: remote
        transport: streamable-http
        url: https://mcp.example.com/mcp
        headers:
          Authorization: Bearer ${TOKEN}
        # optional: oauth: true, clientId: <id when the server has no dynamic registration>
```

Disable the official `mcp-client` rows for the same servers; otherwise their
tools load directly and defeat the lazy path.

## Commands

```
/mcp                                  popup: server → tools / reconnect / enable / disable
/mcp-raw                              all server rows
/mcp-raw refresh                      reconnect every server
/mcp-raw <server>                     one server's row
/mcp-raw <server> tools               tool names + descriptions
/mcp-raw search <query>               search tools of connected servers
/mcp-raw <server> call <tool> [json]  call with JSON arguments
/mcp-raw <server> resources|prompts   list resources / prompts
/mcp-raw <server> read <uri>          read a resource
/mcp-raw <server> prompt <name> [json] get a prompt
```

Both commands are read-only; the settings page is what edits configuration.

### Sidebar entry

Toggle「在侧边栏显示」in the settings page (stored in
`~/.dsh/mcp-settings.json`), or set `showInSidebar: true` on the `mcp` row. The
settings section and the 内置插件 tab are always registered.

## OAuth

Set `oauth: true` on a streamable-http server, restart, then click「登录」on its
card. The browser walks the authorization-code flow; the callback lands on a
one-shot `127.0.0.1` listener. Tokens are stored in `~/.dsh/mcp-oauth.json`
(mode 0600) and refreshed automatically. `clientId` is only needed when the
server does not support dynamic client registration.

## Known limits

- tool search only covers tools already cached by a connected server
- `/mcp` is a one-shot grouped picker; a nested server → tool → arguments menu
  needs a custom composer overlay and is not implemented
- OAuth was verified against a mock authorization server only; connecting such a
  server's MCP endpoint with the Bearer token has not been exercised against a
  real deployment
- no project-level (per-cwd) server sets; configuration is global
