// Browser half of dsh-mcp: an "MCP" section in Settings (own nav row plus a tab
// inside 内置插件) and an optional sidebar page. Hand-written CJS wrapper so the
// repository needs no build step.

window.__ModuleLoader__.load({
  id: '@netcatty/dsh-mcp',
  factory: (require) => {
    const React = require('react');
    const e = React.createElement;

    const styles = {
      wrap: { padding: '4px 2px' },
      head: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
      title: { fontSize: 18, fontWeight: 600, color: 'var(--dsh-text-primary, #111827)', whiteSpace: 'nowrap' },
      hint: { color: 'var(--dsh-text-secondary, #6b7280)', fontSize: 12 },
      modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px', zIndex: 1000, overflowY: 'auto' },
      modalCard: { width: 'min(640px, 100%)', background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 20px 50px rgba(15,23,42,0.25)' },
      card: { border: '1px solid var(--dsh-border, #e5e7eb)', borderRadius: 10, padding: 14, marginBottom: 12, background: 'var(--dsh-surface, #fff)' },
      row: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      name: { fontWeight: 600, fontSize: 14 },
      target: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#6b7280', wordBreak: 'break-all' },
      button: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', padding: '4px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' },
      tools: { marginTop: 10, maxHeight: 240, overflow: 'auto', background: '#f9fafb', border: '1px solid #eceef1', borderRadius: 8, padding: 10, fontSize: 12, lineHeight: 1.6 },
      toolName: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 600, marginRight: 6 },
      error: { color: '#b3261e', fontSize: 12, marginTop: 8 },
    };

    function cleanMessage(error) {
      const text = error instanceof Error ? error.message : String(error);
      return text.replace(/^(Error|SyntaxError|TypeError):\s*/u, '');
    }

    function badge(status, busy, enabled) {
      if (enabled === false || status === 'disabled') return e('span', { style: { color: '#6b7280', background: '#f1f2f4', borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 } }, '已停用');
      if (busy) return e('span', { style: { color: '#8a5a00', background: '#fff4d6', borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 } }, '连接中');
      const map = {
        connected: { color: '#16794a', background: '#e7f6ee', text: '已连接' },
        idle: { color: '#6b7280', background: '#f1f2f4', text: '未连接' },
        disabled: { color: '#6b7280', background: '#f1f2f4', text: '已停用' },
        error: { color: '#b3261e', background: '#fdecea', text: '错误' },
      };
      const face = map[status] ?? map.idle;
      return e('span', { style: { color: face.color, background: face.background, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 } }, face.text);
    }

    let sidebarController = null;

    function useStatus() {
      const [state, setState] = React.useState({ loading: true, error: '', servers: [], showInSidebar: false, lazy: true, activeTotal: 0 });
      const load = React.useCallback(async () => {
        setState((prev) => ({ ...prev, loading: true, error: '' }));
        try {
          const response = await fetch('/api/mcp/status', { headers: { accept: 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          const rows = data.servers ?? [];
          setState({
            loading: false,
            error: '',
            servers: rows,
            showInSidebar: data.showInSidebar === true,
            lazy: data.lazy === true,
            activeTotal: typeof data.activeTotal === 'number' ? data.activeTotal : rows.reduce((sum, row) => sum + (row.active ?? 0), 0),
          });
        } catch (error) {
          setState({ loading: false, error: String(error), servers: [], showInSidebar: false, lazy: true, activeTotal: 0 });
        }
      }, []);
      React.useEffect(() => { load(); }, [load]);
      return [state, load];
    }

    function CallBox({ server, onChanged }) {
      const [tools, setTools] = React.useState(null);
      const [tool, setTool] = React.useState('');
      const [query, setQuery] = React.useState('');
      const [open, setOpen] = React.useState(false);
      const [active, setActive] = React.useState(0);
      const filtered = (tools ?? []).filter((item) => (item.name + ' ' + (item.description ?? '')).toLowerCase().includes(query.toLowerCase())).slice(0, 50);
      const [args, setArgs] = React.useState('{}');
      const [out, setOut] = React.useState('');
      const [busy, setBusy] = React.useState(false);

      React.useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const response = await fetch('/api/mcp/tools', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ server }),
            });
            const data = await response.json();
            if (cancelled) return;
            const list = response.ok ? (data.tools ?? []) : [];
            setTools(list);
          } catch {
            if (!cancelled) setTools([]);
          }
        })();
        return () => { cancelled = true; };
      }, [server]);

      const run = async (selectedTool) => {
        const target = typeof selectedTool === 'string' && selectedTool !== '' ? selectedTool : tool;
        if (target === '') return;
        setBusy(true);
        setOut('');
        try {
          let parsed = {};
          if (args.trim() !== '') parsed = JSON.parse(args);
          const response = await fetch('/api/mcp/call', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ server, tool: target, arguments: parsed }),
          });
          const data = await response.json();
          setOut(response.ok ? (data.text ?? '') : `错误：${data.error ?? response.status}`);
          if (response.ok) onChanged?.();
        } catch (error) {
          setOut(`错误：${String(error)}`);
        } finally {
          setBusy(false);
        }
      };

      const rows = [];
      rows.push(e('div', { key: 'tool', style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 } },
        e('div', { style: { position: 'relative', minWidth: 260 } },
          e('input', {
            style: { ...styles.button, width: '100%', boxSizing: 'border-box', textAlign: 'left' },
            value: query,
            placeholder: '搜索或选择工具…',
            disabled: busy,
            onChange: (ev) => {
              setQuery(ev.target.value);
              setTool('');
              setActive(0);
              setOpen(true);
            },
            onFocus: () => setOpen(true),
            onBlur: () => setTimeout(() => setOpen(false), 120),
            onKeyDown: (ev) => {
              if (ev.key === 'Escape') { setOpen(false); return; }
              if (ev.key === 'ArrowDown') {
                ev.preventDefault();
                setOpen(true);
                if (filtered.length > 0) setActive((index) => (index + 1) % filtered.length);
                return;
              }
              if (ev.key === 'ArrowUp') {
                ev.preventDefault();
                if (filtered.length > 0) setActive((index) => (index - 1 + filtered.length) % filtered.length);
                return;
              }
              if (ev.key === 'Enter') {
                ev.preventDefault();
                if (open) {
                  const picked = filtered[active] ?? filtered[0];
                  if (picked) {
                    setTool(picked.name);
                    setQuery(picked.name);
                    setOpen(false);
                  }
                  return;
                }
                if (tool !== '') run(tool);
              }
            },
          }),
          open
            ? e('div', {
              style: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4, background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.08)', maxHeight: 240, overflow: 'auto' },
            },
            filtered
              .map((item, index) => e('div', {
                key: item.name,
                onMouseDown: (ev) => {
                  ev.preventDefault();
                  setTool(item.name);
                  setQuery(item.name);
                  setOpen(false);
                },
                style: { padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid #f1f2f4', background: index === active ? '#eef2ff' : 'transparent' },
              },
              e('div', { style: { fontSize: 13, fontWeight: 600 } }, item.name),
              item.description ? e('div', { style: { fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, item.description) : null)))
            : null),
        e('button', { style: styles.button, onClick: () => run(), disabled: busy || tool === '' }, busy ? '执行中…' : '执行')));
      rows.push(e('textarea', {
        key: 'args',
        value: args,
        onChange: (ev) => setArgs(ev.target.value),
        onKeyDown: (ev) => {
          if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            if (!busy && tool !== '') run();
          }
        },
        spellCheck: false,
        style: { width: '100%', minHeight: 70, marginTop: 8, fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: 8, borderRadius: 8, border: '1px solid #d1d5db', boxSizing: 'border-box' },
      }));
      if (out !== '') rows.push(e('pre', { key: 'out', style: { ...styles.tools, marginTop: 8, whiteSpace: 'pre-wrap' } }, out));
      return e('div', null, rows);
    }

    /** One tool row; the parameter list is folded away until asked for. */
    function ToolRow({ tool }) {
      const schema = tool.inputSchema ?? {};
      const properties = schema.properties ?? {};
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      const names = Object.keys(properties);
      return e('div', { style: { marginBottom: 8 } },
        e('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          e('span', { style: styles.toolName }, tool.name),
          e('span', { style: { flex: 1 } }, tool.description ?? ''),
          e('span', { style: styles.hint }, tool.active === true ? '已激活' : '按需激活')),
        names.length === 0
          ? null
          : e('details', { style: { marginTop: 2 } },
            e('summary', { style: { ...styles.hint, cursor: 'pointer' } },
              `参数 ${names.length} 项${required.size > 0 ? ` · 必填 ${required.size}` : ''}`),
            e('div', { style: { marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 } },
              names.map((name) => {
                const property = properties[name] ?? {};
                const type = property.type ?? (property.oneOf === undefined ? 'any' : 'oneOf');
                return e('div', { key: name, style: { ...styles.hint, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } },
                  `${name}: ${type}${required.has(name) ? ' *' : ''}${property.description ? ` — ${property.description}` : ''}`);
              }))));
    }

    function ServerCard({ server, busy, tools, expanded, onToggle, onRefresh, onEdit, onDelete, onToggleEnabled, onToggleTool }) {
      const [callOpen, setCallOpen] = React.useState(false);
      const [extra, setExtra] = React.useState(null);
      const [extraBusy, setExtraBusy] = React.useState(false);

      const startOauth = async () => {
        try {
          const response = await fetch('/api/mcp/oauth/start', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ server: server.name }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          window.open(data.url, '_blank', 'noopener');
          for (let i = 0; i < 200; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const status = await fetch(`/api/mcp/oauth/status?flowId=${encodeURIComponent(data.flowId)}`).then((r) => r.json());
            if (status.status === 'done') { onRefresh?.(); return; }
            if (status.status === 'failed' || status.status === 'unknown') throw new Error(status.error || '登录失败');
          }
          throw new Error('登录超时');
        } catch (error) {
          alert(`OAuth 登录失败：${cleanMessage(error)}`);
        }
      };

      const logoutOauth = async () => {
        await fetch('/api/mcp/oauth/logout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ server: server.name }),
        });
        onRefresh?.();
      };
      const [promptArgs, setPromptArgs] = React.useState('{}');

      const loadExtra = async (kind) => {
        setExtraBusy(true);
        try {
          const response = await fetch(`/api/mcp/${kind}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ server: server.name }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          const items = kind === 'resources'
            ? (data.resources ?? []).map((item) => ({ id: item.uri, label: `${item.uri}${item.name ? ` — ${item.name}` : ''}` }))
            : (data.prompts ?? []).map((item) => ({ id: item.name, label: `${item.name}${item.description ? ` — ${item.description}` : ''}` }));
          setExtra({ kind, items, output: '' });
        } catch (error) {
          setExtra({ kind, items: [], output: cleanMessage(error) });
        } finally {
          setExtraBusy(false);
        }
      };

      const body = [];
      body.push(e('div', { key: 'head', style: styles.row },
        e('span', { style: styles.name }, server.name),
        badge(server.status, busy, server.enabled),
        e('span', { style: styles.hint }, `${server.transport} · ${server.tools} 个工具${server.active > 0 ? ` · 已激活 ${server.active}` : ''}${server.reconnects > 0 ? ` · 重连 ${server.reconnects} 次` : ''}`)));
      body.push(e('div', { key: 'target', style: { ...styles.target, marginTop: 6 } }, server.target));
      body.push(e('div', { key: 'actions', style: { ...styles.row, marginTop: 10 } },
        e('button', { style: styles.button, onClick: onToggle, disabled: busy || server.enabled === false }, expanded ? '收起工具' : '查看工具'),
        e('button', { style: styles.button, onClick: onRefresh, disabled: busy || server.enabled === false }, '重连'),
        e('button', { style: styles.button, onClick: () => setCallOpen(!callOpen), disabled: server.enabled === false }, callOpen ? '关闭调用' : '调用'),
        e('button', { style: styles.button, onClick: () => loadExtra('resources'), disabled: extraBusy || server.enabled === false }, '资源'),
        ...(server.oauth === true
          ? [e('button', {
            key: 'oauth',
            style: styles.button,
            onClick: server.oauthLoggedIn === true ? logoutOauth : startOauth,
          }, server.oauthLoggedIn === true ? '登出' : '登录')]
          : []),
        e('button', { style: styles.button, onClick: () => onToggleEnabled(server) }, server.enabled === false ? '启用' : '停用'),
        e('button', { style: styles.button, onClick: () => onEdit(server.name) }, '编辑'),
        e('button', { style: styles.button, onClick: () => onDelete(server.name) }, '删除')));
      if (server.error) body.push(e('div', { key: 'error', style: styles.error }, server.error));
      if (expanded && Array.isArray(tools)) {
        body.push(e('div', { key: 'tools', style: styles.tools },
          tools.length === 0
            ? e('span', { style: styles.hint }, '（无工具）')
            : tools.map((tool) => e(ToolRow, { key: tool.name, tool }))));
      }
      if (extra !== null) {
        const openItem = async (item) => {
          try {
            const response = await fetch(extra.kind === 'resources' ? '/api/mcp/read' : '/api/mcp/prompt', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(extra.kind === 'resources'
              ? { server: server.name, uri: item.id }
              : { server: server.name, name: item.id, arguments: JSON.parse(promptArgs.trim() === '' ? '{}' : promptArgs) }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
            const text = extra.kind === 'resources'
              ? (data.contents ?? []).map((part) => part.text ?? JSON.stringify(part)).join('\n')
              : JSON.stringify(data.result);
            setExtra({ ...extra, output: text });
            onRefresh?.();
          } catch (error) {
            setExtra({ ...extra, output: cleanMessage(error) });
          }
        };
        const rows = [];
        rows.push(e('strong', { key: 'title' }, extra.kind === 'resources' ? '资源' : '提示词'));
        if (extra.items.length === 0) rows.push(e('div', { key: 'none', style: styles.hint }, `（无${extra.kind === 'resources' ? '资源' : '提示词'}）`));
        for (const item of extra.items) {
          rows.push(e('div', { key: item.id, style: { padding: '2px 0' } },
            e('button', { style: { ...styles.button, padding: '1px 8px', marginRight: 6 }, onClick: () => openItem(item) }, '读取'),
            e('span', { style: { fontSize: 12 } }, item.label)));
        }
        if (extra.kind === 'prompts') {
          rows.push(e('div', { key: 'args', style: { marginTop: 8 } },
            e('div', { style: { ...styles.hint, marginBottom: 4 } }, '参数（JSON，可留空）'),
            e('textarea', {
              value: promptArgs,
              onChange: (ev) => setPromptArgs(ev.target.value),
              spellCheck: false,
              style: { width: '100%', minHeight: 54, fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: 6, borderRadius: 8, border: '1px solid #d1d5db', boxSizing: 'border-box' },
            })));
        }
        if (extra.output !== '') rows.push(e('pre', { key: 'out', style: { margin: '6px 0 0', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' } }, extra.output));
        body.push(e('div', { key: 'extra', style: styles.tools }, rows));
      }
      if (callOpen) body.push(e(CallBox, { key: 'call', server: server.name, onChanged: onRefresh }));
      return e('div', { style: styles.card }, body);
    }

    function ServerForm({ initial, isNew, onSave, onCancel }) {
      const [name, setName] = React.useState(initial.name ?? '');
      const [transport, setTransport] = React.useState(initial.transport ?? 'stdio');
      const [command, setCommand] = React.useState(initial.command ?? '');
      const [argsText, setArgsText] = React.useState((initial.args ?? []).join(' '));
      const [envText, setEnvText] = React.useState(JSON.stringify(initial.env ?? {}, null, 0));
      const [url, setUrl] = React.useState(initial.url ?? '');
      const [headersText, setHeadersText] = React.useState(JSON.stringify(initial.headers ?? {}, null, 0));
      const [timeoutText, setTimeoutText] = React.useState(initial.toolCallTimeoutMs === undefined ? '' : String(initial.toolCallTimeoutMs));
      const [oauth, setOauth] = React.useState(initial.oauth === true);
      const [clientId, setClientId] = React.useState(initial.clientId ?? '');
      const [error, setError] = React.useState('');
      const [mode, setMode] = React.useState('form');
      const [jsonText, setJsonText] = React.useState(JSON.stringify(initial, null, 2));

      const field = (label, value, onChange, placeholder) => e('label', { style: { display: 'block', marginBottom: 8 } },
        e('span', { style: { ...styles.hint, display: 'block', marginBottom: 4 } }, label),
        e('input', { value, placeholder, onChange: (ev) => onChange(ev.target.value), style: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 } }));

      const buildFromFields = () => {
        const base = { name: name.trim(), transport };
        if (transport === 'stdio') {
          base.command = command.trim();
          base.args = argsText.trim() === '' ? [] : argsText.trim().split(/\s+/);
          const env = envText.trim() === '' ? {} : JSON.parse(envText);
          if (Object.keys(env).length > 0) base.env = env;
        } else {
          base.url = url.trim();
          const headers = headersText.trim() === '' ? {} : JSON.parse(headersText);
          if (Object.keys(headers).length > 0) base.headers = headers;
        }
        base.oauth = oauth;
        if (oauth && clientId.trim() !== '') base.clientId = clientId.trim();
        if (timeoutText.trim() !== '') {
          const ms = Number(timeoutText.trim());
          if (!Number.isFinite(ms) || ms <= 0) throw new Error('超时必须是正数毫秒');
          base.toolCallTimeoutMs = Math.round(ms);
        }
        return base;
      };

      const applyJson = () => {
        const parsed = JSON.parse(jsonText);
        setName(parsed.name ?? '');
        setTransport(parsed.transport ?? 'stdio');
        setCommand(parsed.command ?? '');
        setArgsText((parsed.args ?? []).join(' '));
        setEnvText(JSON.stringify(parsed.env ?? {}));
        setUrl(parsed.url ?? '');
        setHeadersText(JSON.stringify(parsed.headers ?? {}));
        setTimeoutText(parsed.toolCallTimeoutMs === undefined ? '' : String(parsed.toolCallTimeoutMs));
        setOauth(parsed.oauth === true);
        setClientId(parsed.clientId ?? '');
      };

      const switchMode = (next) => {
        if (next === mode) return;
        setError('');
        try {
          if (next === 'json') setJsonText(JSON.stringify(buildFromFields(), null, 2));
          else applyJson();
          setMode(next);
        } catch (err) {
          setError(`JSON 格式错误：${cleanMessage(err)}`);
        }
      };

      const submit = async () => {
        setError('');
        try {
          const server = mode === 'json' ? JSON.parse(jsonText) : buildFromFields();
          await onSave(server);
        } catch (err) {
          setError(cleanMessage(err));
        }
      };

      const formBody = [];
      formBody.push(e('div', { key: 'title', style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 } },
        e('span', { style: { fontWeight: 600 } }, isNew ? '添加服务器' : `编辑 ${initial.name}`),
        e('div', { style: { display: 'flex', gap: 6, marginLeft: 'auto' } },
          ['form', 'json'].map((item) => e('button', {
            key: item,
            onClick: () => switchMode(item),
            style: { ...styles.button, background: mode === item ? '#eef2ff' : '#fff', borderColor: mode === item ? '#93c5fd' : '#d1d5db' },
          }, item === 'form' ? '表单' : 'JSON')))));
      if (mode === 'json') {
        formBody.push(e('textarea', {
          key: 'json',
          value: jsonText,
          onChange: (ev) => setJsonText(ev.target.value),
          spellCheck: false,
          style: { width: '100%', minHeight: 220, fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: 8, borderRadius: 8, border: '1px solid #d1d5db', boxSizing: 'border-box' },
        }));
      } else {
        formBody.push(field('名称', name, setName, '如 chrome-devtools'),
        e('div', { style: { marginBottom: 8 } },
          e('span', { style: { ...styles.hint, display: 'block', marginBottom: 4 } }, '传输'),
          e('div', { style: { display: 'flex', gap: 6 } },
            ['stdio', 'streamable-http'].map((item) => e('button', {
              key: item,
              onClick: () => setTransport(item),
              style: { ...styles.button, background: transport === item ? '#eef2ff' : '#fff', borderColor: transport === item ? '#93c5fd' : '#d1d5db' },
            }, item)))),
        );
        formBody.push(transport === 'stdio'
          ? e('div', { key: 'stdio' },
            field('命令', command, setCommand, 'node'),
            field('参数（空格分隔）', argsText, setArgsText, '/path/server.js --flag'),
            field('环境变量（JSON）', envText, setEnvText, '{"KEY":"value"}'))
          : e('div', null,
            field('URL', url, setUrl, 'http://127.0.0.1:6806/mcp'),
            field('请求头（JSON）', headersText, setHeadersText, '{"Authorization":"Bearer …"}')),
          e('div', { key: 'timeout', style: { marginTop: 8 } }, field('调用超时（毫秒，可空，默认 60000）', timeoutText, setTimeoutText, '60000')),
          transport === 'streamable-http'
            ? e('div', { key: 'oauth', style: { marginTop: 12 } },
              e('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                e('input', {
                  id: `oauth-${initial.name ?? 'new'}`,
                  type: 'checkbox',
                  checked: oauth,
                  onChange: (ev) => setOauth(ev.target.checked),
                  style: { width: 14, height: 14, margin: 0, cursor: 'pointer' },
                }),
                e('label', {
                  htmlFor: `oauth-${initial.name ?? 'new'}`,
                  style: { fontSize: 12, lineHeight: '14px', cursor: 'pointer', color: '#111827' },
                }, '使用 OAuth 登录')),
              oauth
                ? e('div', { style: { marginTop: 8 } }, field('client_id（服务器不支持动态注册时必填）', clientId, setClientId, '可选'))
                : null)
            : null);
      }
      formBody.push(error !== '' ? e('div', { key: 'err', style: styles.error }, error) : null,
        e('div', { key: 'actions', style: { display: 'flex', gap: 8, marginTop: 8 } },
          e('button', { style: styles.button, onClick: submit }, '保存'),
          e('button', { style: styles.button, onClick: onCancel }, '取消')));
      return e('div', { style: { ...styles.card, borderColor: '#93c5fd', background: '#f8fbff' } }, formBody);
    }

    function Tab() {
      const [state, reload] = useStatus();
      const [tools, setTools] = React.useState({});
      const [expanded, setExpanded] = React.useState({});
      const [busy, setBusy] = React.useState('');
      const [form, setForm] = React.useState(null);
      const [search, setSearch] = React.useState('');
      React.useEffect(() => {
        setExpanded((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const server of state.servers) {
            if (server.enabled === false && next[server.name]) { next[server.name] = false; changed = true; }
          }
          return changed ? next : prev;
        });
      }, [state.servers]);
      const [sort, setSort] = React.useState('name');
      const [sidebar, setSidebar] = React.useState(false);
      React.useEffect(() => { setSidebar(state.showInSidebar === true); }, [state.showInSidebar]);

      const refresh = async (server) => {
        setBusy(server ?? '*');
        try {
          await fetch('/api/mcp/refresh', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(server === undefined ? {} : { server }),
          });
          await reload();
        } finally {
          setBusy('');
        }
      };

      const toggleTools = async (server) => {
        if (expanded[server]) {
          setExpanded((prev) => ({ ...prev, [server]: false }));
          return;
        }
        setBusy(server);
        try {
          const response = await fetch('/api/mcp/tools', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ server }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          setTools((prev) => ({ ...prev, [server]: data.tools ?? [] }));
          setExpanded((prev) => ({ ...prev, [server]: true }));
          await reload();
        } catch (error) {
          setTools((prev) => ({ ...prev, [server]: [{ name: '(错误)', description: cleanMessage(error) }] }));
          setExpanded((prev) => ({ ...prev, [server]: true }));
        } finally {
          setBusy('');
        }
      };

      const readConfig = async () => {
        const response = await fetch('/api/mcp/config', { headers: { accept: 'application/json' } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        return data.servers ?? [];
      };

      const openForm = async (name) => {
        try {
          const all = await readConfig();
          const found = name === undefined ? undefined : all.find((server) => server.name === name);
          setForm({ all, isNew: found === undefined, initial: found ?? { name: '', transport: 'stdio', command: '', args: [], env: {} } });
        } catch (error) {
          setForm(null);
          alert(`读取配置失败：${String(error)}`);
        }
      };

      const saveForm = async (server) => {
        const collision = form.all.some((item) => item.name === server.name
          && !(form.isNew === false && item.name === form.initial.name));
        if (collision) throw new Error(`服务器名称重复："${server.name}" 已存在，请换一个名称或先删除原服务器`);
        const all = form.all.filter((item) => item.name !== server.name && item.name !== form.initial.name);
        const response = await fetch('/api/mcp/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ servers: [...all, server] }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }
        setForm(null);
        await reload();
      };

      const toggleEnabled = async (server) => {
        try {
          const all = await readConfig();
          const target = !(server.enabled === false);
          const next = all.map((item) => item.name === server.name ? { ...item, enabled: !target } : item);
          const response = await fetch('/api/mcp/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ servers: next }),
          });
          if (!response.ok) throw new Error((await response.json()).error);
          await reload();
        } catch (error) {
          alert(`操作失败：${cleanMessage(error)}`);
        }
      };

      const toggleTool = async (serverName, toolName, disabled) => {
        try {
          const all = await readConfig();
          const next = all.map((server) => {
            if (server.name !== serverName) return server;
            const list = new Set(server.disabledTools ?? []);
            if (disabled) list.add(toolName); else list.delete(toolName);
            return { ...server, disabledTools: [...list] };
          });
          const response = await fetch('/api/mcp/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ servers: next }),
          });
          if (!response.ok) throw new Error((await response.json()).error);
          await reload();
          await loadToolsFor(serverName);
        } catch (error) {
          alert(`操作失败：${cleanMessage(error)}`);
        }
      };

      const loadToolsFor = async (serverName) => {
        try {
          const response = await fetch('/api/mcp/tools', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ server: serverName }),
          });
          const data = await response.json();
          if (response.ok) setTools((prev) => ({ ...prev, [serverName]: data.tools ?? [] }));
        } catch { /* keep old list */ }
      };

      const removeServer = async (name) => {
        if (!confirm(`删除服务器 ${name}？`)) return;
        try {
          const all = await readConfig();
          const response = await fetch('/api/mcp/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ servers: all.filter((server) => server.name !== name) }),
          });
          if (!response.ok) throw new Error((await response.json()).error);
          await reload();
        } catch (error) {
          alert(`删除失败：${String(error)}`);
        }
      };

      const content = [];
      content.push(e('div', { key: 'head', style: styles.head },
        e('span', { style: styles.title }, 'MCP 服务器'),
        e('span', { style: styles.hint }, `${state.servers.length} 台 · 工具按需激活${state.activeTotal > 0 ? ` · 已激活 ${state.activeTotal}` : ''}`),
        e('button', { style: styles.button, onClick: () => refresh(undefined), disabled: busy !== '' }, busy === '*' ? '刷新中…' : '全部刷新'),
        e('button', { style: styles.button, onClick: () => openForm() }, '添加服务器'),
        e('input', {
          value: search,
          placeholder: '搜索服务器…',
          onChange: (ev) => setSearch(ev.target.value),
          style: { ...styles.button, width: 160 },
        }),
        e('div', { style: { display: 'flex', gap: 4 } },
          [['name', '名称'], ['status', '状态']].map(([key, label]) => e('button', {
            key,
            onClick: () => setSort(key),
            style: { ...styles.button, background: sort === key ? '#eef2ff' : '#fff', borderColor: sort === key ? '#93c5fd' : '#d1d5db' },
          }, label))),
        e('label', { style: { ...styles.hint, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' } },
          e('input', {
            type: 'checkbox',
            checked: sidebar,
            onChange: async (event) => {
              const checked = event.target.checked;
              setSidebar(checked);
              try {
                const response = await fetch('/api/mcp/settings', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ showInSidebar: checked }),
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                sidebarController?.(checked);
              } catch {
                setSidebar(!checked);
              }
            },
          }),
          '在侧边栏显示')));

      if (state.loading && state.servers.length === 0) content.push(e('div', { key: 'loading', style: styles.hint }, '正在读取 MCP 状态…'));
      if (state.error !== '') content.push(e('div', { key: 'error', style: styles.error }, `读取失败：${state.error}`));
      if (!state.loading && state.error === '' && state.servers.length === 0) {
        content.push(e('div', { key: 'empty', style: styles.hint }, '尚未配置 MCP 服务器。在 profile patch 的 mcp 行里填写 servers。'));
      }

      const order = { connected: 0, idle: 1, error: 2, disabled: 3 };
      const visible = state.servers
        .filter((server) => (server.name + ' ' + server.target).toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => sort === 'name'
          ? a.name.localeCompare(b.name)
          : (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name));

      for (const server of visible) {
        content.push(e(ServerCard, {
          key: server.name,
          server,
          busy: busy === server.name,
          tools: tools[server.name],
          expanded: expanded[server.name] === true && server.enabled !== false,
          onToggle: () => toggleTools(server.name),
          onRefresh: () => refresh(server.name),
          onEdit: openForm,
          onDelete: removeServer,
          onToggleEnabled: toggleEnabled,
          onToggleTool: toggleTool,
        }));
      }

      if (form !== null) {
        content.push(e(Modal, {
          key: 'mcp-form-modal',
          title: form.isNew ? '添加 MCP 服务器' : `编辑：${form.initial.name}`,
          onClose: () => setForm(null),
        }, e(ServerForm, {
          initial: form.initial,
          isNew: form.isNew,
          onSave: saveForm,
          onCancel: () => setForm(null),
        })));
      }

      return e('div', { style: styles.wrap }, content);
    }

    function Modal({ title, onClose, children }) {
      // A window-level Escape listener would also close the settings shell, so
      // handle the key on the focused card and stop it there.
      const card = React.useRef(null);
      React.useEffect(() => { card.current?.focus(); }, []);
      return e('div', {
        style: styles.modalBackdrop,
        onClick: (event) => { if (event.target === event.currentTarget) onClose(); },
      },
      e('div', {
        ref: card,
        tabIndex: -1,
        style: { ...styles.modalCard, outline: 'none' },
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': title,
        onKeyDown: (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        },
      },
      e('div', { style: { ...styles.row, justifyContent: 'space-between', marginBottom: 12 } },
        e('strong', { style: { fontSize: 14 } }, title),
        e('button', { style: styles.button, onClick: onClose }, '关闭')),
      children));
    }

    /** Compact card for 设置 → 插件 → 内置插件; the full console stays on the MCP page. */
    function InfoTab() {
      const [state, reload] = useStatus();
      const [sidebar, setSidebar] = React.useState(false);
      React.useEffect(() => { setSidebar(state.showInSidebar === true); }, [state.showInSidebar]);
      const servers = state.servers ?? [];
      const connected = servers.filter((server) => server.status === 'connected').length;
      const tools = servers.reduce((sum, server) => sum + (server.tools ?? 0), 0);

      const toggleSidebar = async (checked) => {
        setSidebar(checked);
        try {
          const response = await fetch('/api/mcp/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ showInSidebar: checked }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          sidebarController?.(checked);
        } catch {
          setSidebar(!checked);
        }
      };

      return e('div', { style: { padding: 4, maxWidth: 640 } },
        e('div', { style: { ...styles.row, justifyContent: 'space-between', marginBottom: 2 } },
          e('span', { style: styles.name }, 'MCP 连接器'),
          e('button', { style: styles.button, onClick: () => reload() }, '刷新')),
        state.error !== ''
          ? e('div', { style: { ...styles.error, marginTop: 8 } }, state.error)
          : e('div', { style: { ...styles.hint, marginTop: 2 } }, state.loading && servers.length === 0
            ? '正在读取状态…'
            : `${servers.length} 台服务器 · ${connected} 台已连接 · ${tools} 个工具${state.activeTotal > 0 ? ` · 已激活 ${state.activeTotal}` : ''}`),
        e('div', { style: { ...styles.hint, marginTop: 6, lineHeight: 1.6 } },
          state.lazy
            ? '懒加载：工具默认不进上下文，模型用 mcp({action:"activate"}) 按需激活，TTL 30 分钟。'
            : '懒加载已关闭（config.lazy=false）：所有 MCP 工具始终对模型可见。'),
        servers.length > 0
          ? e('div', { style: { ...styles.card, marginTop: 10, padding: '8px 12px' } },
            servers.map((server) => e('div', { key: server.name, style: { ...styles.row, padding: '3px 0', fontSize: 12 } },
              e('span', { style: { ...styles.name, fontWeight: 500, minWidth: 120 } }, server.name),
              e('span', { style: { ...styles.hint, minWidth: 56 } }, server.status === 'connected' ? '已连接' : server.status === 'disabled' ? '已停用' : '未连接'),
              e('span', { style: styles.hint }, `${server.tools ?? 0} 个工具`))))
          : null,
        e('label', { style: { ...styles.row, gap: 6, marginTop: 12, fontSize: 12, color: '#374151' } },
          e('input', { type: 'checkbox', checked: sidebar, onChange: (event) => toggleSidebar(event.target.checked) }),
          '在侧边栏显示 MCP 面板'),
        e('div', { style: { ...styles.hint, marginTop: 8 } },
          '服务器增删改、连接健康与工具调用在左侧「MCP」面板（或设置 → MCP）。'));
    }

    function Icon(props) {
      const size = props?.size ?? 16;
      return e('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        style: { display: 'block' },
      },
      e('rect', { x: 2.5, y: 2.5, width: 11, height: 4, rx: 1, stroke: 'currentColor', strokeWidth: 1.4 }),
      e('rect', { x: 2.5, y: 9.5, width: 11, height: 4, rx: 1, stroke: 'currentColor', strokeWidth: 1.4 }),
      e('circle', { cx: 4.8, cy: 4.5, r: 0.8, fill: 'currentColor' }),
      e('circle', { cx: 4.8, cy: 11.5, r: 0.8, fill: 'currentColor' }));
    }

    function Page() {
      return e('div', { style: { padding: 24, maxWidth: 980, margin: '0 auto' } }, e(Tab, null));
    }

    const NAV_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="4" rx="1" stroke="#000" stroke-width="1.4"/><rect x="2.5" y="9.5" width="11" height="4" rx="1" stroke="#000" stroke-width="1.4"/><circle cx="4.8" cy="4.5" r="0.8" fill="#000"/><circle cx="4.8" cy="11.5" r="0.8" fill="#000"/></svg>';

    // Third-party settings sections fall back to the gear glyph; claim our own
    // nav row and paint the same SVG the sidebar uses.
    function installNavIcon() {
      const mask = `url("data:image/svg+xml,${encodeURIComponent(NAV_SVG)}")`;
      const paint = () => {
        for (const row of document.querySelectorAll('[role="dialog"] nav button')) {
          if (row.textContent?.trim() !== 'MCP' || row.dataset.dshMcpIcon === '1') continue;
          row.dataset.dshMcpIcon = '1';
          const icon = row.firstElementChild;
          if (icon === null) continue;
          icon.style.maskImage = mask;
          icon.style.webkitMaskImage = mask;
          icon.style.backgroundColor = 'currentColor';
          icon.style.width = '16px';
          icon.style.height = '16px';
          icon.style.display = 'inline-block';
          icon.innerHTML = '';
        }
      };
      paint();
      const observer = new MutationObserver(paint);
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    }

    async function apply(ctx) {
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'mcp',
        order: 40,
        label: () => 'MCP',
        locale: 'mcp',
        inject: () => ({}),
      }, InfoTab));
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'mcp',
        order: 70,
        label: () => 'MCP',
        locale: 'mcp',
        inject: () => ({}),
      }, Tab));

      try {
        const stop = installNavIcon();
        ctx.effect?.(() => stop);
      } catch {
        // Settings shell not mounted yet; the gear fallback stays.
      }

      let cleanups = [];
      const setSidebar = (on) => {
        if (on && cleanups.length === 0) {
          try {
            cleanups.push(ctx.slots.register({
              name: 'sidebar.panellist',
              id: 'mcp',
              order: 1,
              label: () => 'MCP',
              locale: 'mcp',
            }, Icon));
            cleanups.push(ctx.slots.register({
              name: 'main',
              key: 'mcp',
              locale: 'mcp',
            }, Page));
          } catch (error) {
            cleanups = [];
            console.warn('dsh-mcp: sidebar registration failed', error);
          }
        } else if (!on && cleanups.length > 0) {
          for (const dispose of cleanups) {
            try { dispose(); } catch { /* already gone */ }
          }
          cleanups = [];
        }
      };
      sidebarController = setSidebar;

      let showInSidebar = false;
      try {
        const response = await fetch('/api/mcp/status', { headers: { accept: 'application/json' } });
        if (response.ok) showInSidebar = (await response.json()).showInSidebar === true;
      } catch {
        // Offline or unauthorized: keep the settings-only entry.
      }
      setSidebar(showInSidebar);
    }

    const module = { exports: { name: 'dsh-mcp', inject: ['slots'], apply } };
    return module.exports;
  },
});
