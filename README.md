# dsh-mcp

Lazy MCP client and `/mcp` manager for DeepSeek Harness.

MCP tools normally enter every request as full schemas. This plugin keeps one
router tool (`mcp`) in context and connects to servers only when the model asks
for them:

```
mcp({ action: "servers" })                      → configured servers + status
mcp({ action: "tools", server: "files" })       → tool names + one-line descriptions
mcp({ action: "describe", server, tool })       → exact input schema
mcp({ action: "call", server, tool, arguments } → invoke the tool
mcp({ action: "refresh", server })              → reconnect and re-list
```

`/mcp` prints the same status table for humans (registration is best-effort:
it is skipped when the host has no commands service).

## Install

```sh
dsh plugin --profile web add link:/path/to/dsh-mcp
```

Or from npm once published: `dsh plugin --profile web add @netcatty/dsh-mcp`.

## Configure

The bundle patch inserts one row; edit it in the profile patch by id:

```yaml
- id: mcp
  name: '@netcatty/dsh-mcp'
  config:
    servers:
      - name: files
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/me/work']
      - name: remote
        transport: streamable-http
        url: https://mcp.example.com/mcp
        headers:
          Authorization: Bearer ${TOKEN}
```

`transport` accepts `stdio` (`command`, `args`, `env`, `cwd`) and
`streamable-http` (`url`, `headers`). Disable the official `mcp-client` rows for
the same servers to avoid loading their tools directly.

## /mcp command

```
/mcp                                 all servers
/mcp refresh                         reconnect every server
/mcp <server>                        one server's row
/mcp <server> tools                  tool names + one-line descriptions
/mcp <server> call <tool> [json]     call with JSON arguments
/mcp <server> refresh                reconnect one server
/mcp help                            usage
```

The command is read-only: it never edits configuration. Errors come back as
command errors with the server/tool name in the message.

### Sidebar entry

Set `showInSidebar: true` on the `mcp` row (profile patch) to add an "MCP"
row to the sidebar and a matching main page. It is off by default; the settings
section and the 内置插件 tab are always registered.

## Behaviour

- connections are lazy: first `tools`/`describe`/`call`/`refresh` for a server
  opens it; a failed server only marks its own row as `error`
- tool lists are cached per connection; `refresh` reconnects and re-lists
- `call` forwards `content` and `structuredContent`; text blocks are joined
- disposal closes every connection
- only tools are exposed; MCP resources/prompts are not bridged yet
- OAuth flows are not implemented in the management surface yet

## Known limits

- one router tool means the model must know a server name; `servers` provides
  the list, so no extra discovery step is needed
- the plugin does not write configuration; `/mcp` is read-only
