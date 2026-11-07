# dsh-mcp

DeepSeek Harness 的 MCP 管理器：懒加载注入 + 可视化管理。

MCP 本体跑在官方的 `@deepseek-ai/dsh-mcp-client` 上——本插件把每台配置好的服务器变成一条官方客户端行（传输、stdio 子进程、工具注册、审批、图片、服务器指令、自动重连、分页全部由 Host 负责），然后把这些工具的 schema **挡在会话之外**，直到被激活。上下文里只留一个 `mcp` 路由工具，十几台服务器也只占一个小 schema。

## 工作原理

1. `settings.json` 里的每台服务器对应一条 loader 行 `dshmcp-<name>`，内容是 `@deepseek-ai/dsh-mcp-client`（见 `lib/provision.js`）。
2. 每个 Agent 作用域都装一层 `ctx.tools.restrict({deny: [...全部 mcp__ 工具]})`，模型在激活前看不到工具；另有一个全局 `ctx.tools.guard()` 在激活窗口之外拒绝执行（见 `lib/visibility.js`）。
3. `mcp({action:"activate", server, tools})` 只对指定的那几个工具解除遮挡；第 4 步起原生 `mcp__<server>__<tool>` schema 进入上下文，调用时照样走完整的 Host 审批。激活状态只存在内存里、按 Agent 隔离；窗口默认 30 分钟，上限可配（默认 120 分钟），**每次成功调用都会把该服务器的窗口重新计时**。

## 从 0.1 升级

0.2 把 MCP 本体交给了官方客户端，并改成懒加载，有几处行为变化：

- **必须重启 `dsh web`**：插件现在会创建 loader 行，刷新页面不够。
- **配置文件自动搬家**：`~/.dsh/mcp-settings.json` 和 `~/.dsh/mcp-oauth.json` 会在启动时一次性迁移到 `~/.dsh/dsh-plugins/dsh-mcp/`（目录 0700、文件 0600）。自定义过路径的除外。
- **工具默认隐藏**：一个会话里只有 `mcp` 路由工具，直到它激活了别的东西（`mcp({action:"activate"})` 或 `/mcp activate <server> [tool…]`）。在 `mcp` 那行设 `lazy: false` 可以恢复旧的“始终可见”。
- **命令合并**：`/mcp-raw` 已取消，所有操作都在 `/mcp` 下（`status`、`search`、`<server> tools`、`<server> call`、`activate`、`deactivate`、`scope`、`diagnose`、`help`）。
- **新增文件**：配置文件旁边多了 `snapshots/`（每次写配置前的快照）和 `audit.jsonl`（激活、调用、配置变更记录）。

## 功能

- 一个 `mcp` 路由工具：`servers`、`tools`、`search`、`describe`、`activate`、`deactivate`、`status`、`refresh`
- 默认懒加载：激活前上下文里没有 MCP schema；`lazy: false` 恢复“始终可见”
- **调用即续期**：对某台服务器的任意一次成功调用，都会把它在该会话里的激活窗口重新计时，调试过程中不会半路失效；连续空闲到窗口结束才需要重新激活
- 激活窗口可配：`defaultTtlMinutes`（默认 30）、`maxTtlMinutes`（默认 120）存在插件自己的 `settings.json`，在「设置 → 内置插件 → MCP」里直接改；也可在 `activate` 里用 `ttlMinutes` 指定本次窗口
- 按服务器可选工作区（`workspaceIds`）：设置后只有这些工作区里的会话能看到、激活、调用它的工具；空列表表示全局。旧的单值 `workspaceId` 会被自动归一成数组
- 每台服务器一条官方客户端行，审批、图片、服务器指令、自动重连、分页都由 Host 提供
- 设置页（可选侧边栏入口）：服务器增删改、搜索排序、启停、重连、调用面板、资源（含模板，点击时提示填入具体 URI）、跨服务器工具搜索、每个工具的「禁用」开关（禁用的工具对模型隐藏、不可激活、不可调用）、每台服务器当前会话中的激活数（附剩余分钟）、一键清空全部会话激活、单台「复制」、标题栏「全部启用 / 全部停用」
- 一个 `/mcp` 命令：状态、工具、搜索、调用、激活、停用、诊断、帮助
- streamable-http 服务器的 OAuth 2.0 登录（自动发现、动态注册、PKCE、本地回环回调、刷新）
- 每次写配置（编辑、导入、恢复）前自动快照；面板列出快照并可对比当前配置（新增 / 移除 / 字段变化）后就地恢复
- 环境变量以键值行编辑；可选每 60 秒自动健康检查；调用面板记住每台服务器上次的参数与结果
- 审计日志：激活、停用、调用（含结果摘要）、配置变更、导入、恢复，面板「审计」可查看
- `mcpServers` JSON 导入（同名可覆盖或跳过）；导出可脱敏，可整份文档、名称→配置映射、单条片段 `"name": {…}`，也可任选多台导出为逗号分隔的片段列表（`env`/`headers` 值替换为 `<REDACTED>`，`cwd` 替换为 `<REDACTED:LOCAL_PATH>`）

## 安装

```sh
# 从 npm 安装（日常使用推荐）
dsh plugin --profile web add @netcatty/dsh-mcp

# 从 git 仓库安装（想跟最新代码时）
dsh plugin --profile web add github:netcatty/dsh-mcp

# 本地开发
dsh plugin --profile web add link:/path/to/dsh-mcp
```

装完要**重启 `dsh web`**：插件会创建 loader 行，只有完整重启才生效。

## 配置

插件自己的所有文件都在一个目录：`$DSH_HOME/dsh-plugins/dsh-mcp/`（默认 `~/.dsh/dsh-plugins/dsh-mcp/`，目录 0700、文件 0600）——`settings.json` 存服务器列表与侧边栏开关，`oauth.json` 存 OAuth 凭据，`snapshots/` 存写配置前的快照（保留最近 20 份），`audit.jsonl` 存事件流水（5 MiB 轮转）。旧版本写在其他位置的文件会在启动时一次性迁移过来。

bundle patch 只插入一行 `mcp`。可以在 profile patch 里按 id 改，也可以用设置页（写 `settings.json`，一旦存在就优先于 patch）：

```yaml
- id: mcp
  name: '@netcatty/dsh-mcp'
  config:
    lazy: true              # false = MCP 工具始终可见
    defaultTtlMinutes: 30   # 仅为新装兜底；实际值存在 settings.json，设置页可改
    maxTtlMinutes: 120      # 同上，单次 activate 能申请的上限
    servers:
      - name: files
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/me/work']
        # 可选：enabled、env、cwd（表单里也可填）、toolCallTimeoutMs、
        #       workspaceIds: [<工作区 id>…]、disabledTools: [write_file]
      - name: remote
        transport: streamable-http
        url: https://mcp.example.com/mcp
        headers:
          Authorization: Bearer ${TOKEN}
        # 可选：oauth: true、clientId: <服务器不支持动态注册时填>
```

不要为同一台服务器再手写 `@deepseek-ai/dsh-mcp-client` 行：`dshmcp-` 前缀归本插件所有，重载时会清掉失效的行。

## 模型侧用法

```
mcp({action:"servers"})                        # 有哪些服务器、各多少工具
mcp({action:"tools", server:"files"})          # 工具名
mcp({action:"describe", server:"files", tool:"read_file"})
mcp({action:"search", query:"screenshot"})     # 跨所有已启用服务器
mcp({action:"activate", server:"files", tools:["read_file"], ttlMinutes: 120})
# 下一轮起：mcp__files__read_file 可以像普通工具一样调用
mcp({action:"deactivate", server:"files"})     # 收回
```

激活期间只要还在调用这台服务器的工具，窗口就会自动续期，不需要模型自己惦记“快到期了”。

## 命令

```
/mcp                                  每台服务器一行
/mcp search <关键词>                   搜已注册的 MCP 工具
/mcp <server>                         单台服务器
/mcp <server> tools                   工具名
/mcp <server> call <tool> [json]      经官方管线调用一次
/mcp activate <server> [tool…]        为当前会话激活（省略 tool 就整台）
/mcp deactivate <server>              收回该服务器的工具
/mcp deactivate                       清空本会话的全部激活
/mcp scope <server> global|here|id,id 改可见范围（here = 当前工作区）
/mcp diagnose [<server>]              探测命令/端点（省略则检查全部）
/mcp help                             命令列表
```

除 `activate` / `deactivate` / `scope` 外，命令都是只读的；改配置请用设置页。

### 侧边栏入口

在设置页勾选「在侧边栏显示」（存在上面的 `settings.json` 里），或在 `mcp` 行设 `showInSidebar: true`。设置分区和「内置插件」页里的标签始终注册。

## OAuth

在 streamable-http 服务器上设 `oauth: true`，重启后点它卡片上的「登录」。浏览器走授权码流程，回调落在一次性的 `127.0.0.1` 监听上。Token 存在 `$DSH_HOME/dsh-plugins/dsh-mcp/oauth.json`（0600），自动刷新，access token 会作为 `Authorization` 头注入到该服务器对应的客户端行。只有服务器不支持动态注册时才需要填 `clientId`。

## 诊断

`/mcp diagnose [<server>]`、卡片上的「检查」、或者标题栏的「检查全部」（跑完给一行汇总，例如 `2 台异常：dbx — command-missing`）只报告真正探测到的东西。stdio 只解析 `PATH` 上的命令（能告诉你的只有“命令找不到”，而不是“进程死了”）；streamable-http 发一次短请求，归类为 `http-401/403`（凭据问题）、`http-404`（路径错）、`http-5xx`（服务端错误）、`ECONNREFUSED`（端口没人监听）、`timeout`、`bad-port` 或 `reachable`（附耗时）。端点可达不等于 MCP 会话可用——那要看工具数。

## 与治理的分界

本插件管**可见性与配置**：有哪些服务器、是否启用、某个会话能看到哪些工具。执行期策略归 `dsh-guard`：它在每次工具调用前做 allow / ask / deny（含三选项审批），而且现在能看到稳定的 `mcp__<server>__<tool>` 名字，所以按工具的规则应该写在那里，而不是在这里重复一套。两套执行策略并存只会互相打架。

## 已知限制

- 激活按 Agent 存在内存里：新会话从全隐藏开始，插件重启会清空激活；续期只在调用时发生，纯空闲超过窗口仍会失效
- 模型必须先调 `mcp` 才能用服务器工具；没激活过的工具永远不可见
- 不支持 MCP 提示词模板（官方客户端不暴露）；资源通过 `@deepseek-ai/dsh-mcp-resources` 访问
- 面板试调用不带 Agent：需要审批（`ask`）的工具会被 Host 拒绝。这类工具请在会话里激活后让模型调用
- 没有项目级（按 cwd）服务器集合，配置是全局的
- OAuth 只用模拟授权服务器验证过，尚未对真实部署用 Bearer token 打通 MCP 端点
