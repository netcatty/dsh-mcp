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
      tools: { marginTop: 10, maxHeight: 280, overflow: 'auto', background: 'var(--dsh-surface, #fff)', border: '1px solid var(--dsh-border, #eceef1)', borderRadius: 10, padding: '2px 10px', fontSize: 12, lineHeight: 1.6 },
      toolName: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 600, marginRight: 6 },
      error: { color: '#b3261e', fontSize: 12, marginTop: 8 },
      // 卡片头、统计块、标签等复用的小样式
      section: { marginTop: 14, padding: '12px 14px', border: '1px solid var(--dsh-border, #e5e7eb)', borderRadius: 12, background: 'var(--dsh-surface, #fff)' },
      sectionTitle: { fontSize: 13, fontWeight: 600, color: 'var(--dsh-text-primary, #111827)', marginBottom: 8 },
      sectionHint: { fontSize: 12, color: 'var(--dsh-text-secondary, #6b7280)', lineHeight: 1.6 },
      statRow: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 10 },
      stat: { minWidth: 0, padding: '10px 12px', borderRadius: 10, background: 'var(--dsh-surface-subtle, #f7f8fa)', border: '1px solid var(--dsh-border, #eceef1)' },
      statLabel: { fontSize: 11, color: 'var(--dsh-text-secondary, #6b7280)', letterSpacing: '0.02em' },
      statValue: { fontSize: 20, fontWeight: 600, lineHeight: 1.3, color: 'var(--dsh-text-primary, #111827)' },
      pill: { display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 600 },
      input: { padding: '5px 8px', borderRadius: 8, border: '1px solid var(--dsh-border, #d1d5db)', fontSize: 12, background: 'var(--dsh-surface, #fff)', color: 'var(--dsh-text-primary, #111827)', boxSizing: 'border-box' },
      tableRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px', fontSize: 12, borderTop: '1px solid var(--dsh-border, #f1f2f4)' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      badge: { borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' },
    };

    function cleanMessage(error) {
      const text = error instanceof Error ? error.message : String(error);
      return text.replace(/^(Error|SyntaxError|TypeError):\s*/u, '');
    }

    const STATUS_FACES = {
      connected: { color: '#16794a', background: '#e7f6ee', text: '已连接' },
      pending: { color: '#8a5a00', background: '#fff4d6', text: '未连接' },
      idle: { color: '#6b7280', background: '#f1f2f4', text: '未连接' },
      disabled: { color: '#6b7280', background: '#f1f2f4', text: '已停用' },
      error: { color: '#b3261e', background: '#fdecea', text: '错误' },
    };

    function badge(status, busy, enabled) {
      if (enabled === false || status === 'disabled') return e('span', { style: { ...styles.badge, ...STATUS_FACES.disabled } }, '已停用');
      if (busy) return e('span', { style: { ...styles.badge, color: '#8a5a00', background: '#fff4d6' } }, '连接中');
      const face = STATUS_FACES[status] ?? STATUS_FACES.idle;
      return e('span', { style: { ...styles.badge, color: face.color, background: face.background } }, face.text);
    }

    /** 轻量开关：替代原生 checkbox，与设置页其他开关保持一致。 */
    function Switch({ checked, onChange, disabled }) {
      return e('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        disabled,
        onClick: () => onChange?.(!checked),
        style: {
          width: 40, height: 22, borderRadius: 999, border: 'none', padding: 0,
          background: checked ? '#2563eb' : '#d1d5db', cursor: disabled ? 'default' : 'pointer',
          position: 'relative', flex: '0 0 auto', transition: 'background 120ms ease',
        },
      }, e('span', {
        style: {
          position: 'absolute', top: 2, left: checked ? 20 : 2, width: 18, height: 18,
          borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(15,23,42,0.25)',
          transition: 'left 120ms ease',
        },
      }));
    }

    let sidebarController = null;

    function useStatus() {
      const [state, setState] = React.useState({ loading: true, error: '', servers: [], showInSidebar: false, lazy: true, activeTotal: 0, defaultTtlMinutes: 30, maxTtlMinutes: 120 });
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
            defaultTtlMinutes: typeof data.defaultTtlMinutes === 'number' ? data.defaultTtlMinutes : 30,
            maxTtlMinutes: typeof data.maxTtlMinutes === 'number' ? data.maxTtlMinutes : 120,
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
      const stored = (() => {
        try {
          return JSON.parse(sessionStorage.getItem(`dsh-mcp-call:${server}`) ?? 'null');
        } catch {
          return null;
        }
      })();
      const [args, setArgs] = React.useState(stored?.args ?? '{}');
      const [out, setOut] = React.useState(stored?.out ?? '');
      React.useEffect(() => {
        try {
          sessionStorage.setItem(`dsh-mcp-call:${server}`, JSON.stringify({ args, out }));
        } catch {
          // Storage may be unavailable in embedded contexts; the panel still works.
        }
      }, [server, args, out]);
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
              style: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4, background: '#fff', border: '1px solid var(--dsh-border, #e5e7eb)', borderRadius: 10, boxShadow: '0 12px 30px rgba(15,23,42,.14)', maxHeight: 240, overflow: 'auto', padding: 4 },
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
      rows.push(e('div', { key: 'hint', style: { ...styles.sectionHint, marginTop: 6, fontSize: 11.5 } },
        '试调用不绑定会话：需要审批（ask）的工具会被拒绝，请让模型在会话内激活后调用'));
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
        style: { ...styles.input, width: '100%', minHeight: 72, marginTop: 8, fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: 10, lineHeight: 1.6, boxSizing: 'border-box' },
      }));
      if (out !== '')
        rows.push(e('div', { key: 'out-wrap', style: { marginTop: 8 } },
          e('div', { style: { ...styles.statLabel, marginBottom: 4 } }, '结果'),
          e('pre', {
            style: {
              margin: 0, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: 'var(--dsh-surface-subtle, #f7f8fa)', border: '1px solid var(--dsh-border, #eceef1)',
              borderRadius: 10, padding: 10, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, lineHeight: 1.6,
            },
          }, out)));
      return e('div', null, rows);
    }

    /** " · 12 分钟后到期", highlighted when the window is nearly gone. */
    function expiryText(server) {
      if (typeof server.expiresAt !== 'number') return '';
      const minutes = Math.max(0, Math.round((server.expiresAt - Date.now()) / 60000));
      return minutes <= 5 ? ` · ${minutes} 分钟后到期（即将到期）` : ` · ${minutes} 分钟后到期`;
    }

    /** One tool row; the parameter list is folded away until asked for. */
    function ToolRow({ tool, onToggleDisabled }) {
      const schema = tool.inputSchema ?? {};
      const properties = schema.properties ?? {};
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      const names = Object.keys(properties);
      const stateBadge = tool.disabled === true
        ? { color: '#6b7280', background: '#f1f2f4', text: '已禁用' }
        : tool.active === true
          ? { color: '#1d4ed8', background: '#e8efff', text: '已激活' }
          : { color: '#6b7280', background: 'transparent', text: '按需激活' };
      return e('div', { style: { padding: '8px 0', borderTop: '1px solid var(--dsh-border, #f1f2f4)' } },
        e('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          e('span', { style: { ...styles.toolName, fontSize: 12, color: 'var(--dsh-text-primary, #111827)' } }, tool.name),
          e('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsh-text-secondary, #6b7280)', fontSize: 12 } }, tool.description ?? ''),
          e('span', { style: { ...styles.badge, ...stateBadge, flex: '0 0 auto' } }, stateBadge.text),
          e('button', {
            style: { ...styles.button, padding: '2px 8px', fontSize: 11, flex: '0 0 auto' },
            onClick: () => onToggleDisabled(tool),
          }, tool.disabled === true ? '启用' : '禁用')),
        names.length === 0
          ? null
          : e('details', { style: { marginTop: 2 } },
            e('summary', { style: { ...styles.hint, cursor: 'pointer', marginTop: 3, fontSize: 11.5 } },
              `参数 ${names.length} 项${required.size > 0 ? ` · 必填 ${required.size}` : ''}`),
            e('div', { style: { marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 } },
              names.map((name) => {
                const property = properties[name] ?? {};
                const type = property.type ?? (property.oneOf === undefined ? 'any' : 'oneOf');
                return e('div', { key: name, style: { ...styles.hint, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } },
                  `${name}: ${type}${required.has(name) ? ' *' : ''}${property.description ? ` — ${property.description}` : ''}`);
              }))));
    }

    function ServerCard({ server, busy, tools, expanded, diag, workspaceLabel, onToggle, onRefresh, onDiagnose, onEdit, onDuplicate, onDelete, onToggleEnabled, onToggleTool, onToggleDisabled }) {
      const [callOpen, setCallOpen] = React.useState(false);
      const [uriPrompt, setUriPrompt] = React.useState(null);
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
          showToast(`OAuth 登录失败：${cleanMessage(error)}`, 'error');
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
          let items;
          if (kind === 'resources') {
            items = (data.resources ?? []).map((item) => ({ id: item.uri, label: `${item.uri}${item.name ? ` — ${item.name}` : ''}` }));
            try {
              const response2 = await fetch('/api/mcp/resource-templates', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ server: server.name }),
              });
              const data2 = await response2.json();
              if (response2.ok) {
                for (const template of data2.templates ?? []) {
                  items.push({
                    id: template.uriTemplate,
                    label: `模板 ${template.uriTemplate}${template.name ? ` — ${template.name}` : ''}`,
                    template: true,
                  });
                }
              }
            } catch {
              // Templates are a bonus; a server without them or a failed call keeps the resource list.
            }
          } else {
            items = (data.prompts ?? []).map((item) => ({ id: item.name, label: `${item.name}${item.description ? ` — ${item.description}` : ''}` }));
          }
          setExtra({ kind, items, output: '' });
        } catch (error) {
          setExtra({ kind, items: [], output: cleanMessage(error) });
        } finally {
          setExtraBusy(false);
        }
      };

      const body = [];
      body.push(e('div', { key: 'head', style: { ...styles.row, gap: 8 } },
        e('span', { style: { ...styles.name, fontSize: 13.5 } }, server.name),
        badge(server.status, busy, server.enabled),
        server.active > 0
          ? e('span', { style: { ...styles.badge, color: '#1d4ed8', background: '#e8efff' } }, `已激活 ${server.active}${expiryText(server)}`)
          : null,
        e('span', { style: { ...styles.sectionHint, marginLeft: 'auto' } },
          `${server.transport} · ${server.tools} 个工具${server.workspaceIds ? ` · 仅 ${server.workspaceIds.map((id) => workspaceLabel(id)).join('、')}` : ''}${server.reconnects > 0 ? ` · 重连 ${server.reconnects} 次` : ''}`)));
      body.push(e('div', { key: 'target', style: { ...styles.target, marginTop: 4 } }, server.target));
      // 卡片按钮只有两级：主操作用实线描边，次操作同样描边但更淡，避免"有的有框有的没框"。
      const inline = { ...styles.button, padding: '3px 10px', fontSize: 11.5, borderColor: 'var(--dsh-border, #d1d5db)', color: 'var(--dsh-text-primary, #374151)' };
      const danger = { ...inline, color: '#b91c1c', borderColor: '#f3c6c6' };
      body.push(e('div', { key: 'actions', style: { ...styles.row, marginTop: 10, gap: 6 } },
        e('button', { style: inline, onClick: onToggle, disabled: busy || server.enabled === false }, expanded ? '收起工具' : '查看工具'),
        e('button', { style: inline, onClick: () => setCallOpen(!callOpen), disabled: server.enabled === false }, callOpen ? '关闭调用' : '调用'),
        e('button', { style: inline, onClick: () => loadExtra('resources'), disabled: extraBusy || server.enabled === false }, '资源'),
        e('button', { style: inline, onClick: onRefresh, disabled: busy || server.enabled === false }, '重连'),
        e('button', { style: inline, onClick: () => onDiagnose(server.name), disabled: busy }, '检查'),
        ...(server.oauth === true
          ? [e('button', {
            key: 'oauth',
            style: inline,
            onClick: server.oauthLoggedIn === true ? logoutOauth : startOauth,
          }, server.oauthLoggedIn === true ? '登出' : '登录')]
          : []),
        e('span', { style: { marginLeft: 'auto', display: 'flex', gap: 2, alignItems: 'center' } },
          e('button', { style: inline, onClick: () => onToggleEnabled(server) }, server.enabled === false ? '启用' : '停用'),
          e('button', { style: inline, onClick: () => onEdit(server.name) }, '编辑'),
          e('button', { style: inline, onClick: () => onDuplicate(server.name) }, '复制'),
          e('button', { style: danger, onClick: () => onDelete(server.name) }, '删除'))));
      if (server.error) body.push(e('div', { key: 'error', style: styles.error }, server.error));
      if (diag !== undefined) {
        body.push(e('div', {
          key: 'diag',
          style: { ...styles.hint, marginTop: 8, color: diag.ok ? '#047857' : '#b91c1c', lineHeight: 1.5 },
        }, `${diag.ok ? '通过' : '失败'} [${diag.code}] ${diag.message}${diag.hint ? ` — ${diag.hint}` : ''}`));
      }
      if (expanded && Array.isArray(tools)) {
        body.push(e('div', { key: 'tools', style: styles.tools },
          tools.length === 0
            ? e('span', { style: styles.hint }, '（无工具）')
            : tools.map((tool) => e(ToolRow, { key: tool.name, tool, onToggleDisabled }))));
      }
      if (uriPrompt !== null) {
        body.push(e(Modal, {
          key: 'mcp-uri-prompt',
          title: '读取资源模板',
          onClose: () => setUriPrompt(null),
        },
        e('div', { style: { ...styles.sectionHint, marginTop: 8 } }, '把 {占位符} 换成实际值：'),
        e('input', {
          value: uriPrompt.value,
          onChange: (event) => setUriPrompt({ ...uriPrompt, value: event.target.value }),
          style: { ...styles.input, width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '7px 10px', fontFamily: 'ui-monospace, monospace' },
        }),
        e('div', { style: { ...styles.row, gap: 8, marginTop: 12 } },
          e('button', {
            style: styles.button,
            onClick: () => {
              const value = uriPrompt.value.trim();
              const item = uriPrompt.item;
              setUriPrompt(null);
              if (value !== '') void runItem(item, value);
            },
          }, '读取'),
          e('button', { style: styles.button, onClick: () => setUriPrompt(null) }, '取消'))));
      }

      if (extra !== null) {
        const runItem = async (item, uri) => {
          try {
            const response = await fetch(extra.kind === 'resources' ? '/api/mcp/read' : '/api/mcp/prompt', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(extra.kind === 'resources'
              ? { server: server.name, uri }
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
        const openItem = (item) => {
          if (item.template === true) {
            setUriPrompt({ item, value: item.id });
            return;
          }
          void runItem(item, item.id);
        };
        const rows = [];
        const kindLabel = extra.kind === 'resources' ? '资源' : '提示词';
        rows.push(e('div', { key: 'title', style: { ...styles.row, justifyContent: 'space-between' } },
          e('span', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsh-text-primary, #111827)' } }, kindLabel),
          e('span', { style: styles.statLabel }, `${extra.items.length} 项`)));
        if (extra.items.length === 0) {
          rows.push(e('div', { key: 'none', style: { ...styles.sectionHint, marginTop: 6 } }, `该服务器没有提供${kindLabel}`));
        }
        for (const item of extra.items) {
          rows.push(e('div', {
            key: item.id,
            style: { ...styles.row, padding: '6px 0', borderTop: '1px solid var(--dsh-border, #f1f2f4)', alignItems: 'center' },
          },
          e('button', { style: { ...styles.button, padding: '2px 9px', fontSize: 11, flex: '0 0 auto' }, onClick: () => openItem(item) }, '读取'),
          e('span', { style: { ...styles.mono, fontSize: 11.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsh-text-secondary, #4b5563)' } }, item.label),
          item.template === true
            ? e('span', { style: { ...styles.badge, color: '#8a5a00', background: '#fff4d6' } }, '模板')
            : null));
        }
        if (extra.kind === 'prompts') {
          rows.push(e('div', { key: 'args', style: { marginTop: 8 } },
            e('div', { style: { ...styles.statLabel, marginBottom: 5 } }, '参数（JSON，可留空）'),
            e('textarea', {
              value: promptArgs,
              onChange: (ev) => setPromptArgs(ev.target.value),
              spellCheck: false,
              style: { ...styles.input, width: '100%', minHeight: 56, fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: 9, boxSizing: 'border-box' },
            })));
        }
        if (extra.output !== '') {
          rows.push(e('pre', {
            key: 'out',
            style: {
              margin: '8px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto',
              background: 'var(--dsh-surface-subtle, #f7f8fa)', border: '1px solid var(--dsh-border, #eceef1)',
              borderRadius: 10, padding: 10, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, lineHeight: 1.6,
            },
          }, extra.output));
        }
        body.push(e('div', { key: 'extra', style: { ...styles.tools, padding: '8px 12px' } }, rows));
      }
      if (callOpen) body.push(e(CallBox, { key: 'call', server: server.name, onChanged: onRefresh }));
      return e('div', { style: styles.card }, body);
    }

    function ServerForm({ initial, isNew, workspaces = [], onSave, onCancel }) {
      const [name, setName] = React.useState(initial.name ?? '');
      const [transport, setTransport] = React.useState(initial.transport ?? 'stdio');
      const [command, setCommand] = React.useState(initial.command ?? '');
      const [argsText, setArgsText] = React.useState((initial.args ?? []).join(' '));
      const [cwd, setCwd] = React.useState(initial.cwd ?? '');
      const [envRows, setEnvRows] = React.useState(() => Object.entries(initial.env ?? {}).map(([key, value]) => ({ key, value })));
      const [url, setUrl] = React.useState(initial.url ?? '');
      const [headersText, setHeadersText] = React.useState(JSON.stringify(initial.headers ?? {}, null, 0));
      const [timeoutText, setTimeoutText] = React.useState(initial.toolCallTimeoutMs === undefined ? '' : String(initial.toolCallTimeoutMs));
      const [oauth, setOauth] = React.useState(initial.oauth === true);
      const [clientId, setClientId] = React.useState(initial.clientId ?? '');
      const [workspaceIds, setWorkspaceIds] = React.useState(Array.isArray(initial.workspaceIds) ? initial.workspaceIds : []);
      const [scopeOpen, setScopeOpen] = React.useState(false);
      const [scopeQuery, setScopeQuery] = React.useState('');
      const workspaceTitle = (id) => workspaces.find((workspace) => workspace.id === id)?.title ?? id.slice(0, 8);
      const toggleWorkspace = (id, checked) => setWorkspaceIds(checked ? [...workspaceIds, id] : workspaceIds.filter((item) => item !== id));
      const [error, setError] = React.useState('');
      const [mode, setMode] = React.useState('form');
      const [jsonText, setJsonText] = React.useState(JSON.stringify(initial, null, 2));

      const field = (label, value, onChange, placeholder) => e('label', { style: { display: 'block', marginBottom: 10 } },
        e('span', { style: { ...styles.statLabel, display: 'block', marginBottom: 5 } }, label),
        e('input', { value, placeholder, onChange: (ev) => onChange(ev.target.value), style: { ...styles.input, width: '100%', padding: '7px 10px', fontSize: 12.5 } }));

      const buildFromFields = () => {
        const base = { name: name.trim(), transport };
        if (transport === 'stdio') {
          base.command = command.trim();
          base.args = argsText.trim() === '' ? [] : argsText.trim().split(/\s+/);
          const env = {};
          for (const row of envRows) {
            const key = row.key.trim();
            if (key !== '') env[key] = row.value;
          }
          if (Object.keys(env).length > 0) base.env = env;
          if (cwd.trim() !== '') base.cwd = cwd.trim();
        } else {
          base.url = url.trim();
          const headers = headersText.trim() === '' ? {} : JSON.parse(headersText);
          if (Object.keys(headers).length > 0) base.headers = headers;
        }
        base.oauth = oauth;
        if (workspaceIds.length > 0) base.workspaceIds = [...workspaceIds];
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
        setEnvRows(Object.entries(parsed.env ?? {}).map(([key, value]) => ({ key, value: String(value) })));
        setUrl(parsed.url ?? '');
        setHeadersText(JSON.stringify(parsed.headers ?? {}));
        setTimeoutText(parsed.toolCallTimeoutMs === undefined ? '' : String(parsed.toolCallTimeoutMs));
        setCwd(parsed.cwd ?? '');
        setWorkspaceIds(Array.isArray(parsed.workspaceIds) ? parsed.workspaceIds : []);
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
      formBody.push(e('div', { key: 'title', style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 } },
        e('span', { style: { fontSize: 15, fontWeight: 600, color: 'var(--dsh-text-primary, #111827)' } }, isNew ? '添加服务器' : `编辑 ${initial.name}`),
        e('div', { style: { display: 'flex', gap: 4, marginLeft: 'auto', padding: 2, borderRadius: 8, background: 'var(--dsh-surface-subtle, #f1f2f4)' } },
          ['form', 'json'].map((item) => e('button', {
            key: item,
            onClick: () => switchMode(item),
            style: { ...styles.button, border: 'none', padding: '4px 12px', background: mode === item ? '#fff' : 'transparent', boxShadow: mode === item ? '0 1px 2px rgba(15,23,42,0.12)' : 'none', color: mode === item ? '#111827' : '#6b7280' },
          }, item === 'form' ? '表单' : 'JSON')))));
      if (mode === 'json') {
        formBody.push(e('textarea', {
          key: 'json',
          value: jsonText,
          onChange: (ev) => setJsonText(ev.target.value),
          spellCheck: false,
          style: { ...styles.input, width: '100%', minHeight: 240, fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: 10, lineHeight: 1.6, boxSizing: 'border-box' },
        }));
      } else {
        formBody.push(field('名称', name, setName, '如 chrome-devtools'),
        e('div', { style: { marginBottom: 10 } },
          e('span', { style: { ...styles.statLabel, display: 'block', marginBottom: 5 } }, '传输'),
          e('div', { style: { display: 'inline-flex', gap: 4, padding: 2, borderRadius: 8, background: 'var(--dsh-surface-subtle, #f1f2f4)' } },
            ['stdio', 'streamable-http'].map((item) => e('button', {
              key: item,
              onClick: () => setTransport(item),
              style: { ...styles.button, border: 'none', padding: '4px 12px', background: transport === item ? '#fff' : 'transparent', boxShadow: transport === item ? '0 1px 2px rgba(15,23,42,0.12)' : 'none', color: transport === item ? '#111827' : '#6b7280' },
            }, item)))),
        );
        formBody.push(transport === 'stdio'
          ? e('div', { key: 'stdio' },
            field('命令', command, setCommand, 'node'),
            field('参数（空格分隔）', argsText, setArgsText, '/path/server.js --flag'),
            e('div', { style: { marginBottom: 8 } },
              e('span', { style: { ...styles.hint, display: 'block', marginBottom: 4 } }, '环境变量'),
              envRows.length === 0
                ? e('div', { style: { ...styles.hint, marginBottom: 4 } }, '（无）')
                : envRows.map((row, index) => e('div', { key: index, style: { display: 'flex', gap: 6, marginBottom: 4 } },
                  e('input', {
                    value: row.key,
                    placeholder: 'KEY',
                    onChange: (ev) => setEnvRows(envRows.map((item, at) => at === index ? { ...item, key: ev.target.value } : item)),
                    style: { flex: 1, padding: '4px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 },
                  }),
                  e('input', {
                    value: row.value,
                    placeholder: 'value',
                    onChange: (ev) => setEnvRows(envRows.map((item, at) => at === index ? { ...item, value: ev.target.value } : item)),
                    style: { flex: 1, padding: '4px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 },
                  }),
                  e('button', {
                    style: { ...styles.button, padding: '1px 8px' },
                    onClick: () => setEnvRows(envRows.filter((_, at) => at !== index)),
                  }, '×'))),
              e('button', {
                style: { ...styles.button, padding: '2px 8px' },
                onClick: () => setEnvRows([...envRows, { key: '', value: '' }]),
              }, '添加变量')),
            field('工作目录（可空）', cwd, setCwd, '/home/me/work'))
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
      const filteredWorkspaces = workspaces.filter((workspace) => {
        const needle = scopeQuery.trim().toLowerCase();
        if (needle === '') return true;
        return `${workspace.title} ${workspace.path ?? ''}`.toLowerCase().includes(needle);
      });
      formBody.push(e('div', { key: 'scope', style: { marginTop: 10, marginBottom: 8 } },
        e('span', { style: { ...styles.hint, display: 'block', marginBottom: 4 } },
          `可见范围（${workspaces.length} 个工作区，不选 = 全局）`),
        e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
          workspaceIds.length === 0
            ? e('span', { style: styles.hint }, '全局（所有工作区）')
            : workspaceIds.map((id) => e('span', {
              key: id,
              style: { ...styles.hint, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: '#eef2ff', color: '#3730a3' },
            }, workspaceTitle(id),
            e('button', {
              style: { border: 'none', background: 'transparent', cursor: 'pointer', color: '#4338ca', padding: 0, fontSize: 12 },
              onClick: () => toggleWorkspace(id, false),
              'aria-label': `移除 ${workspaceTitle(id)}`,
            }, '×'))),
          e('button', {
            style: { ...styles.button, padding: '2px 8px' },
            onClick: () => { setScopeOpen(!scopeOpen); setScopeQuery(''); },
          }, scopeOpen ? '收起' : '选择…')),
        scopeOpen
          ? e('div', { style: { marginTop: 6, border: '1px solid #e5e7eb', borderRadius: 8, padding: 6 } },
            e('input', {
              value: scopeQuery,
              placeholder: '搜索工作区…',
              onChange: (ev) => setScopeQuery(ev.target.value),
              style: { ...styles.button, width: '100%', boxSizing: 'border-box', marginBottom: 6 },
            }),
            e('div', { style: { maxHeight: 160, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 } },
              filteredWorkspaces.length === 0
                ? e('span', { style: styles.hint }, '没有匹配的工作区')
                : filteredWorkspaces.map((workspace) => {
                  const checked = workspaceIds.includes(workspace.id);
                  return e('label', { key: workspace.id, style: { ...styles.hint, display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', cursor: 'pointer' } },
                    e('input', { type: 'checkbox', checked, onChange: (ev) => toggleWorkspace(workspace.id, ev.target.checked) }),
                    e('span', null, workspace.title),
                    e('span', { style: { opacity: 0.6 } }, workspace.path ?? ''));
                })))
          : null));
      formBody.push(error !== '' ? e('div', { key: 'err', style: styles.error }, error) : null,
        e('div', { key: 'actions', style: { display: 'flex', gap: 8, marginTop: 8 } },
          e('button', { style: styles.button, onClick: submit }, '保存'),
          e('button', { style: styles.button, onClick: onCancel }, '取消')));
      return e('div', { style: { ...styles.card, borderColor: '#93c5fd' } }, formBody);
    }

    function Tab() {
      const [state, reload] = useStatus();
      const [tools, setTools] = React.useState({});
      const [expanded, setExpanded] = React.useState({});
      const [busy, setBusy] = React.useState('');
      const [form, setForm] = React.useState(null);
      const [diag, setDiag] = React.useState({});
      const [diagSummary, setDiagSummary] = React.useState(null);
      const [snapshots, setSnapshots] = React.useState(null);
      const [snapshotDiffs, setSnapshotDiffs] = React.useState({});
      const [audit, setAudit] = React.useState(null);
      const [workspaces, setWorkspaces] = React.useState([]);
      const [confirmDelete, setConfirmDelete] = React.useState(null);
      const [autoCheck, setAutoCheck] = React.useState(() => {
        try {
          return localStorage.getItem('dsh-mcp-auto-check') === '1';
        } catch {
          return false;
        }
      });
      const diagnoseAllRef = React.useRef(null);
      const [toolQuery, setToolQuery] = React.useState('');
      const [toolHits, setToolHits] = React.useState([]);
      React.useEffect(() => {
        (async () => {
          try {
            const response = await fetch('/api/mcp/workspaces', { headers: { accept: 'application/json' } });
            const data = response.ok ? await response.json() : { workspaces: [] };
            setWorkspaces(Array.isArray(data.workspaces) ? data.workspaces : []);
          } catch {
            setWorkspaces([]);
          }
        })();
      }, []);
      const [snapshotBusy, setSnapshotBusy] = React.useState(false);
      const [transfer, setTransfer] = React.useState(null);
      const [transferBusy, setTransferBusy] = React.useState(false);
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

      const searchTools = async (query) => {
        setToolQuery(query);
        if (query.trim() === '') { setToolHits([]); return; }
        try {
          const response = await fetch(`/api/mcp/search?q=${encodeURIComponent(query)}&limit=50`, { headers: { accept: 'application/json' } });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          setToolHits(data.hits ?? []);
        } catch {
          setToolHits([]);
        }
      };

      const toggleToolDisabled = async (serverName, toolName, disabled) => {
        try {
          const all = await readConfig();
          const next = all.map((server) => {
            if (server.name !== serverName) return server;
            const list = new Set(server.disabledTools ?? []);
            if (disabled) list.add(toolName); else list.delete(toolName);
            const copy = { ...server };
            if (list.size === 0) delete copy.disabledTools; else copy.disabledTools = [...list];
            return copy;
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
          showToast(`操作失败：${cleanMessage(error)}`, 'error');
        }
      };

      const runDiagnose = async (server) => {
        setBusy(server);
        try {
          const response = await fetch('/api/mcp/diagnose', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ server }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          setDiag((prev) => ({ ...prev, [server]: data.result }));
        } catch (error) {
          setDiag((prev) => ({ ...prev, [server]: { ok: false, code: 'client', message: cleanMessage(error) } }));
        } finally {
          setBusy('');
        }
      };

      const openAudit = async () => {
        try {
          const response = await fetch('/api/mcp/audit?limit=100', { headers: { accept: 'application/json' } });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          setAudit(data.events ?? []);
        } catch (error) {
          setAudit([]);
          showToast(`读取审计失败：${cleanMessage(error)}`, 'error');
        }
      };

      const showSnapshotDiff = async (id) => {
        try {
          const response = await fetch('/api/mcp/snapshot-diff', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          setSnapshotDiffs((prev) => ({ ...prev, [id]: data.diff }));
        } catch (error) {
          showToast(`读取差异失败：${cleanMessage(error)}`, 'error');
        }
      };

      const openSnapshots = async () => {
        setSnapshotBusy(true);
        try {
          const response = await fetch('/api/mcp/snapshots', { headers: { accept: 'application/json' } });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          setSnapshots(data.snapshots ?? []);
        } catch (error) {
          setSnapshots([]);
          showToast(`读取快照失败：${cleanMessage(error)}`, 'error');
        } finally {
          setSnapshotBusy(false);
        }
      };

      const restoreSnapshot = async (id) => {
        setSnapshotBusy(true);
        try {
          const response = await fetch('/api/mcp/restore', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          setSnapshots(null);
          await reload();
          showToast(`已恢复到 ${data.at ?? id}`, 'info');
        } catch (error) {
          showToast(`恢复失败：${cleanMessage(error)}`, 'error');
        } finally {
          setSnapshotBusy(false);
        }
      };

      const runDiagnoseAll = async () => {
        setBusy('*');
        try {
          const response = await fetch('/api/mcp/diagnose', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          const next = {};
          for (const item of data.results ?? []) next[item.server] = item.result;
          setDiag(next);
          const failed = (data.results ?? []).filter((item) => item.result?.ok !== true);
          setDiagSummary(failed.length === 0
            ? { ok: true, text: `全部通过（${(data.results ?? []).length} 台）` }
            : { ok: false, text: `${failed.length} 台异常：${failed.map((item) => `${item.server} — ${item.result?.code ?? '?'}`).join('；')}` });
        } catch (error) {
          setDiagSummary({ ok: false, text: `检查失败：${cleanMessage(error)}` });
        } finally {
          setBusy('');
        }
      };

      diagnoseAllRef.current = runDiagnoseAll;
      React.useEffect(() => {
        try {
          localStorage.setItem('dsh-mcp-auto-check', autoCheck ? '1' : '0');
        } catch {
          // A blocked localStorage only loses the preference.
        }
        if (!autoCheck) return undefined;
        const timer = setInterval(() => { void diagnoseAllRef.current?.(); }, 60000);
        return () => clearInterval(timer);
      }, [autoCheck]);

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

      const duplicateServer = async (name) => {
        try {
          const all = await readConfig();
          const source = all.find((server) => server.name === name);
          if (source === undefined) throw new Error(`找不到服务器 "${name}"`);
          const copy = { ...source, name: `${name}-copy` };
          setForm({ all, isNew: true, initial: copy });
        } catch (error) {
          showToast(`复制失败：${cleanMessage(error)}`, 'error');
        }
      };

      const setAllEnabled = async (enabled) => {
        try {
          const all = await readConfig();
          const next = all.map((server) => ({ ...server, enabled }));
          const response = await fetch('/api/mcp/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ servers: next }),
          });
          if (!response.ok) throw new Error((await response.json()).error);
          await reload();
        } catch (error) {
          showToast(`操作失败：${cleanMessage(error)}`, 'error');
        }
      };

      const openImport = () => setTransfer({ kind: 'import', mode: 'overwrite', text: '{\n  "mcpServers": {}\n}', error: '' });
      const openExport = async (selected = [], redact = true) => {
        setTransferBusy(true);
        try {
          const params = new URLSearchParams();
          if (selected.length > 0) {
            params.set('servers', selected.join(','));
            params.set('format', 'entry');
          }
          if (!redact) params.set('redact', '0');
          const query = params.toString() === '' ? '' : `?${params.toString()}`;
          const response = await fetch(`/api/mcp/export${query}`, { headers: { accept: 'application/json' } });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          setTransfer({ kind: 'export', selected, redact, text: data.json ?? '', error: '' });
        } catch (error) {
          setTransfer({ kind: 'export', selected, redact, text: '', error: cleanMessage(error) });
        } finally {
          setTransferBusy(false);
        }
      };

      const runImport = async () => {
        setTransferBusy(true);
        try {
          const response = await fetch('/api/mcp/import', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: transfer.text, mode: transfer.mode ?? 'overwrite' }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          const parts = [];
          if ((data.added ?? []).length > 0) parts.push(`新增 ${data.added.join(', ')}`);
          if ((data.updated ?? []).length > 0) parts.push(`更新 ${data.updated.join(', ')}`);
          if ((data.skipped ?? 0) > 0) parts.push(`跳过 ${data.skipped} 台已存在`);
          setTransfer(null);
          if (parts.length > 0) showToast(`导入完成：${parts.join('；')}`, 'info');
          await reload();
        } catch (error) {
          setTransfer({ ...transfer, error: cleanMessage(error) });
        } finally {
          setTransferBusy(false);
        }
      };

      const openForm = async (name) => {
        try {
          const all = await readConfig();
          const found = name === undefined ? undefined : all.find((server) => server.name === name);
          setForm({ all, isNew: found === undefined, initial: found ?? { name: '', transport: 'stdio', command: '', args: [], env: {} } });
        } catch (error) {
          setForm(null);
          showToast(`读取配置失败：${String(error)}`, 'error');
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
          showToast(`操作失败：${cleanMessage(error)}`, 'error');
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
          showToast(`操作失败：${cleanMessage(error)}`, 'error');
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
        setConfirmDelete(null);
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
          showToast(`删除失败：${String(error)}`, 'error');
        }
      };

      const content = [];
      const searchBox = (value, placeholder, onChange) => e('input', {
        value,
        placeholder,
        onChange: (ev) => onChange(ev.target.value),
        style: { ...styles.input, flex: '1 1 140px', minWidth: 120 },
      });
      content.push(e('div', { key: 'head', style: { ...styles.head, marginBottom: 10 } },
        e('div', { style: { ...styles.row, gap: 8, width: '100%' } },
          e('span', { style: { ...styles.title, fontSize: 16 } }, 'MCP 服务器'),
          e('span', { style: styles.hint }, `${state.servers.length} 台`),
          state.activeTotal > 0
            ? e('span', { style: { ...styles.badge, color: '#1d4ed8', background: '#e8efff' } }, `已激活 ${state.activeTotal}`)
            : null,
          e('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
            e('button', { style: { ...styles.button, padding: '5px 12px' }, onClick: () => openForm() }, '添加服务器'),
            state.activeTotal > 0
              ? e('button', {
                style: { ...styles.button, padding: '5px 10px' },
                onClick: async () => {
                  try {
                    const response = await fetch('/api/mcp/deactivate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    await reload();
                  } catch (error) {
                    showToast(`清空失败：${cleanMessage(error)}`, 'error');
                  }
                },
              }, '清空激活')
              : null)),

        e('div', { key: 'toolbar', style: { ...styles.row, gap: 6, width: '100%', marginTop: 8 } },
          searchBox(search, '搜索服务器…', setSearch),
          searchBox(toolQuery, '搜索工具…（跨服务器）', (value) => searchTools(value)),
          e('div', { style: { display: 'flex', gap: 2 } },
            [['name', '名称'], ['status', '状态']].map(([key, label]) => e('button', {
              key,
              onClick: () => setSort(key),
              style: { ...styles.button, padding: '5px 9px', background: sort === key ? '#eef2ff' : '#fff', borderColor: sort === key ? '#93c5fd' : '#e5e7eb', color: sort === key ? '#1d4ed8' : undefined },
            }, label))),
          e('button', { style: { ...styles.button, padding: '5px 10px' }, onClick: () => refresh(undefined), disabled: busy !== '' }, busy === '*' ? '刷新中…' : '全部刷新'),
          e('button', { style: { ...styles.button, padding: '5px 10px' }, onClick: runDiagnoseAll, disabled: busy !== '' }, busy === '*' ? '检查中…' : '检查全部')),

        e('div', { key: 'toolbar2', style: { ...styles.row, gap: 6, width: '100%', marginTop: 6 } },
          e('button', { style: { ...styles.button, padding: '4px 9px', fontSize: 11.5 }, onClick: () => setAllEnabled(true) }, '全部启用'),
          e('button', { style: { ...styles.button, padding: '4px 9px', fontSize: 11.5 }, onClick: () => setAllEnabled(false) }, '全部停用'),
          e('button', { style: { ...styles.button, padding: '4px 9px', fontSize: 11.5 }, onClick: openSnapshots, disabled: snapshotBusy }, '快照'),
          e('button', { style: { ...styles.button, padding: '4px 9px', fontSize: 11.5 }, onClick: openAudit }, '审计'),
          e('button', { style: { ...styles.button, padding: '4px 9px', fontSize: 11.5 }, onClick: () => openImport() }, '导入'),
          e('button', { style: { ...styles.button, padding: '4px 9px', fontSize: 11.5 }, onClick: () => openExport() }, '导出'),
          e('label', { style: { ...styles.hint, display: 'flex', alignItems: 'center', gap: 5, marginLeft: 6 } },
            e('input', { type: 'checkbox', checked: autoCheck, onChange: (ev) => setAutoCheck(ev.target.checked) }),
            '自动检查'))));

      if (state.loading && state.servers.length === 0) content.push(e('div', { key: 'loading', style: styles.hint }, '正在读取 MCP 状态…'));
      if (state.error !== '') content.push(e('div', { key: 'error', style: styles.error }, `读取失败：${state.error}`));
      if (!state.loading && state.error === '' && state.servers.length === 0) {
        content.push(e('div', { key: 'empty', style: styles.hint }, '尚未配置 MCP 服务器；在设置页添加，或编辑 profile patch 的 mcp 行'));
      }

      if (diagSummary !== null) {
        content.push(e('div', {
          key: 'diag-summary',
          style: { ...styles.hint, marginBottom: 10, color: diagSummary.ok ? '#047857' : '#b91c1c' },
        }, diagSummary.text));
      }

      if (toolHits.length > 0) {
        content.push(e('div', { key: 'tool-hits', style: { ...styles.card, padding: '8px 12px', fontSize: 12, lineHeight: 1.6 } },
          e('div', { style: { ...styles.hint, marginBottom: 6 } }, `匹配 ${toolHits.length} 个工具`),
          e('div', { style: { maxHeight: 260, overflow: 'auto' } },
            toolHits.map((hit) => e('div', { key: hit.publicName, style: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 0', fontSize: 12 } },
              e('span', { style: { ...styles.toolName, fontWeight: 500, fontSize: 12, minWidth: 200 } }, `${hit.server}/${hit.tool}`),
              e('span', { style: { ...styles.hint, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, hit.description),
              e('span', { style: { ...styles.hint, whiteSpace: 'nowrap' } }, hit.disabled === true ? '已禁用' : hit.active === true ? '已激活' : ''))))));
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
          diag: diag[server.name],
          workspaceLabel: (id) => workspaces.find((workspace) => workspace.id === id)?.title ?? id.slice(0, 8),
          onToggle: () => toggleTools(server.name),
          onRefresh: () => refresh(server.name),
          onDiagnose: runDiagnose,
          onEdit: openForm,
          onDuplicate: duplicateServer,
          onDelete: (name) => setConfirmDelete(name),
          onToggleEnabled: toggleEnabled,
          onToggleTool: toggleTool,
          onToggleDisabled: (tool) => toggleToolDisabled(server.name, tool.tool ?? tool.name, tool.disabled !== true),
        }));
      }

      if (confirmDelete !== null) {
        content.push(e(Modal, {
          key: 'mcp-confirm-delete',
          title: '删除服务器',
          onClose: () => setConfirmDelete(null),
        },
        e('div', { style: { marginTop: 8, fontSize: 13 } }, `删除服务器 ${confirmDelete}？`),
        e('div', { style: { ...styles.hint, marginTop: 6 } }, '相关会话里的激活会一并失效；配置会先写入快照，可在「快照」里恢复'),
        e('div', { style: { ...styles.row, gap: 8, marginTop: 12 } },
          e('button', {
            style: { ...styles.button, borderColor: '#fca5a5', color: '#b91c1c' },
            onClick: () => removeServer(confirmDelete),
          }, '删除'),
          e('button', { style: styles.button, onClick: () => setConfirmDelete(null) }, '取消'))));
      }

      if (audit !== null) {
        const rows = audit.length === 0
          ? e('div', { key: 'empty', style: { ...styles.hint, marginTop: 10 } }, '还没有审计记录')
          : e('div', { key: 'list', style: { marginTop: 10, maxHeight: 420, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 } },
            audit.map((item, index) => {
              const text = `${new Date(item.at).toLocaleString()} ${item.ok === false ? '✗' : '·'} ${item.action}`
                + (item.server ? ` ${item.server}` : '')
                + (item.tool ? ` ${item.tool}` : '')
                + (item.detail ? ` — ${item.detail}` : '');
              return e('div', {
                key: `${item.at}-${index}`,
                style: { ...styles.hint, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
              }, text);
            }));
        content.push(e(Modal, {
          key: 'mcp-audit-modal',
          title: `审计（最近 ${audit.length} 条）`,
          onClose: () => setAudit(null),
        }, rows));
      }

      if (snapshots !== null) {
        content.push(e(Modal, {
          key: 'mcp-snapshots-modal',
          title: '配置快照（每次写入前自动保存，保留最近 20 份）',
          onClose: () => setSnapshots(null),
        },
        snapshots.length === 0
          ? e('div', { style: { ...styles.hint, marginTop: 10 } }, '还没有快照；修改或导入配置后会自动生成')
          : e('div', { style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 } },
            snapshots.map((item) => {
              const diff = snapshotDiffs[item.id];
              const diffText = diff === undefined
                ? ''
                : diff.identical
                  ? '与当前配置相同'
                  : [
                    diff.added.length > 0 ? `恢复后新增：${diff.added.join(', ')}` : '',
                    diff.removed.length > 0 ? `恢复后移除：${diff.removed.join(', ')}` : '',
                    diff.changed.length > 0 ? `字段变化：${diff.changed.map((entry) => `${entry.name}(${entry.fields.join('/')})`).join('，')}` : '',
                  ].filter((part) => part !== '').join('；');
              return e('div', { key: item.id, style: { padding: '4px 0', fontSize: 12 } },
                e('div', { style: { ...styles.row, justifyContent: 'space-between' } },
                  e('span', { style: styles.hint }, `${new Date(item.at).toLocaleString()} · ${item.reason} · ${item.servers} 台（${item.names.join(', ')}）`),
                  e('div', { style: { display: 'flex', gap: 6 } },
                    e('button', { style: styles.button, onClick: () => showSnapshotDiff(item.id) }, '差异'),
                    e('button', { style: styles.button, onClick: () => restoreSnapshot(item.id), disabled: snapshotBusy }, '恢复'))),
                diffText === '' ? null : e('div', { style: { ...styles.hint, color: diff.identical ? '#047857' : '#92400e', marginTop: 2 } }, diffText));
            }))));
      }

      if (transfer !== null) {
        content.push(e(Modal, {
          key: 'mcp-transfer-modal',
          title: transfer.kind === 'import' ? '导入 mcpServers JSON' : '导出（密钥已脱敏）',
          onClose: () => setTransfer(null),
        },
        transfer.kind === 'export'
          ? e('div', { style: { ...styles.row, gap: 12, marginTop: 10 } },
            e('span', { style: styles.hint }, '导出范围'),
            state.servers.map((server) => {
              const checked = Array.isArray(transfer.selected) && transfer.selected.includes(server.name);
              return e('label', { key: server.name, style: { ...styles.hint, display: 'flex', alignItems: 'center', gap: 4 } },
                e('input', {
                  type: 'checkbox',
                  checked,
                  onChange: (ev) => {
                    const current = Array.isArray(transfer.selected) ? transfer.selected : [];
                    const next = ev.target.checked
                      ? [...current, server.name]
                      : current.filter((name) => name !== server.name);
                    openExport(next);
                  },
                }),
                server.name);
            }),
            e('label', { style: { ...styles.hint, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' } },
              e('input', {
                type: 'checkbox',
                checked: transfer.redact !== false,
                onChange: (ev) => openExport(Array.isArray(transfer.selected) ? transfer.selected : [], ev.target.checked),
              }),
              '脱敏'))
          : null,
        transfer.kind === 'import'
          ? e('label', { style: { ...styles.hint, display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 } },
            '同名服务器',
            e('select', {
              value: transfer.mode ?? 'overwrite',
              onChange: (ev) => setTransfer({ ...transfer, mode: ev.target.value }),
              style: { ...styles.button, padding: '2px 6px' },
            },
            e('option', { value: 'overwrite' }, '覆盖'),
            e('option', { value: 'skip' }, '跳过')))
          : null,
        e('textarea', {
          value: transfer.text,
          readOnly: transfer.kind === 'export',
          onChange: (ev) => setTransfer({ ...transfer, text: ev.target.value }),
          spellCheck: false,
          style: { width: '100%', minHeight: 260, fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: 8, borderRadius: 8, border: '1px solid #d1d5db', boxSizing: 'border-box', marginTop: 10 },
        }),
        transfer.error !== ''
          ? e('div', { style: { ...styles.error, marginTop: 8 } }, transfer.error)
          : null,
        e('div', { style: { ...styles.hint, marginTop: 6 } }, transfer.kind === 'import'
          ? '支持 {"mcpServers": {…}}、{"名称": {…}}，以及单条片段 "名称": {…}；同名服务器会被覆盖'
          : 'env/headers 的值替换为 <REDACTED>，cwd 替换为 <REDACTED:LOCAL_PATH>；导入后需重新填写'),
        transfer.kind === 'import'
          ? e('div', { style: { ...styles.row, marginTop: 10 } },
            e('button', { style: styles.button, onClick: runImport, disabled: transferBusy }, transferBusy ? '导入中…' : '导入'),
            e('button', { style: styles.button, onClick: () => setTransfer(null) }, '取消'))
          : null));
      }

      if (form !== null) {
        content.push(e(Modal, {
          key: 'mcp-form-modal',
          title: form.isNew ? '添加 MCP 服务器' : `编辑：${form.initial.name}`,
          onClose: () => setForm(null),
        }, e(ServerForm, {
          initial: form.initial,
          isNew: form.isNew,
          workspaces,
          onSave: saveForm,
          onCancel: () => setForm(null),
        })));
      }

      content.push(e(ToastHost, { key: 'mcp-toast' }));
      return e('div', { style: styles.wrap }, content);
    }

    // One toast surface for the whole panel: alerts are blocked in some
    // embedded contexts and look foreign next to our own dialogs.
    const toastStore = { message: '', kind: 'info', timer: null, listeners: new Set() };
    function emitToast() {
      for (const listener of toastStore.listeners) listener();
    }
    function showToast(message, kind = 'info') {
      toastStore.message = String(message ?? '');
      toastStore.kind = kind;
      clearTimeout(toastStore.timer);
      toastStore.timer = setTimeout(() => {
        toastStore.message = '';
        emitToast();
      }, 4000);
      emitToast();
    }
    function ToastHost() {
      const [, setTick] = React.useState(0);
      React.useEffect(() => {
        const listener = () => setTick((value) => value + 1);
        toastStore.listeners.add(listener);
        return () => toastStore.listeners.delete(listener);
      }, []);
      if (toastStore.message === '') return null;
      const error = toastStore.kind === 'error';
      return e('div', {
        role: 'status',
        style: {
          position: 'fixed',
          right: 20,
          bottom: 20,
          zIndex: 1200,
          maxWidth: 460,
          padding: '10px 14px',
          borderRadius: 10,
          fontSize: 12,
          lineHeight: 1.6,
          background: error ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${error ? '#fecaca' : '#bbf7d0'}`,
          color: error ? '#b91c1c' : '#166534',
          boxShadow: '0 10px 30px rgba(15,23,42,0.12)',
        },
      }, toastStore.message);
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

    /** TTL settings: the idle window and the ceiling one activation may ask for. */
    function TtlSettings({ state, onSaved }) {
      const [idle, setIdle] = React.useState(String(state.defaultTtlMinutes ?? 30));
      const [max, setMax] = React.useState(String(state.maxTtlMinutes ?? 120));
      const [busy, setBusy] = React.useState(false);
      React.useEffect(() => {
        setIdle(String(state.defaultTtlMinutes ?? 30));
        setMax(String(state.maxTtlMinutes ?? 120));
      }, [state.defaultTtlMinutes, state.maxTtlMinutes]);

      const dirty = idle !== String(state.defaultTtlMinutes ?? 30) || max !== String(state.maxTtlMinutes ?? 120);

      const save = async () => {
        setBusy(true);
        try {
          const response = await fetch('/api/mcp/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ defaultTtlMinutes: Number(idle), maxTtlMinutes: Number(max) }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
          showToast(`已保存：空闲 ${data.defaultTtlMinutes} 分钟 / 上限 ${data.maxTtlMinutes} 分钟`, 'info');
          await onSaved?.();
        } catch (error) {
          showToast(`保存失败：${cleanMessage(error)}`, 'error');
        } finally {
          setBusy(false);
        }
      };

      // 输入框失焦或回车即保存；「保存」按钮保留为显式入口。
      const commit = () => {
        if (!busy && dirty) void save();
      };
      const field = (label, value, onChange) => e('label', { style: { ...styles.row, justifyContent: 'space-between', padding: '7px 0' } },
        e('span', { style: { fontSize: 12.5, color: 'var(--dsh-text-primary, #374151)' } }, label),
        e('span', { style: { ...styles.row, gap: 6 } },
          e('input', {
            value,
            inputMode: 'numeric',
            onChange: (event) => onChange(event.target.value.replace(/[^0-9]/gu, '')),
            onBlur: commit,
            onKeyDown: (event) => { if (event.key === 'Enter') event.currentTarget.blur(); },
            style: { ...styles.input, width: 72, textAlign: 'right' },
          }),
          e('span', { style: { ...styles.sectionHint, width: 28 } }, '分钟')));

      const dirtyText = dirty && !busy;
      return e('div', { style: { ...styles.section, marginTop: 12 } },
        e('div', { style: { ...styles.row, justifyContent: 'space-between' } },
          e('span', { style: { ...styles.sectionTitle, marginBottom: 0 } }, '激活窗口'),
          busy ? e('span', { style: styles.sectionHint }, '保存中…') : null),
        e('div', { style: { marginTop: 4, borderTop: '1px solid var(--dsh-border, #f1f2f4)' } },
          field('空闲多久失效', idle, setIdle),
          e('div', { style: { borderTop: '1px solid var(--dsh-border, #f1f2f4)' } }, field('单次上限', max, setMax))),
        e('div', { style: { ...styles.row, justifyContent: 'space-between', marginTop: 8, gap: 12 } },
          e('span', { style: { ...styles.sectionHint, color: dirtyText ? '#8a5a00' : undefined } }, dirtyText ? '有未保存的改动' : '调用即续期，上限只约束 activate'),
          e('button', {
            style: { ...styles.button, padding: '5px 14px', background: dirty ? '#1f2937' : '#fff', color: dirty ? '#fff' : '#9ca3af', borderColor: dirty ? '#1f2937' : '#e5e7eb', cursor: dirty && !busy ? 'pointer' : 'default' },
            onClick: save,
            disabled: busy || !dirty,
          }, busy ? '保存中…' : '保存')));
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

      const online = servers.filter((server) => server.status === 'connected');
      const totalTools = online.reduce((sum, server) => sum + (server.tools ?? 0), 0);
      const stat = (label, value, tone) => e('div', { style: styles.stat },
        e('div', { style: styles.statLabel }, label),
        e('div', { style: { ...styles.statValue, ...(tone ? { color: tone } : {}) } }, String(value)));

      return e('div', { style: { padding: '4px 0', maxWidth: 680 } },
        e(ToastHost, null),
        e('div', { style: { ...styles.row, justifyContent: 'space-between', gap: 12 } },
          e('span', { style: styles.sectionHint },
            state.lazy
              ? '懒加载：工具默认不进上下文，按需激活，调用即续期'
              : '懒加载已关闭：所有 MCP 工具始终对模型可见'),
          e('button', { style: { ...styles.button, padding: '5px 12px' }, onClick: () => reload() }, '刷新')),

        state.error !== ''
          ? e('div', { style: { ...styles.error, marginTop: 8 } }, state.error)
          : e('div', { style: styles.statRow },
            stat('服务器', servers.length),
            stat('已连接', `${online.length}/${servers.length}`, online.length === servers.length && servers.length > 0 ? '#16794a' : undefined),
            stat('工具', totalTools),
            stat('已激活', state.activeTotal ?? 0, (state.activeTotal ?? 0) > 0 ? '#1d4ed8' : undefined)),

        servers.length > 0
          ? e('div', { style: { ...styles.section, marginTop: 12, paddingTop: 10, paddingBottom: 10 } },
            servers.map((server, index) => {
              const face = STATUS_FACES[server.status] ?? STATUS_FACES.idle;
              return e('div', {
                key: server.name,
                style: { ...styles.tableRow, borderTop: index === 0 ? 'none' : undefined },
              },
                e('span', { style: { ...styles.mono, fontSize: 12, fontWeight: 500, flex: 1, color: 'var(--dsh-text-primary, #111827)' } }, server.name),
                e('span', { style: { ...styles.badge, color: face.color, background: face.background } },
                  server.status === 'connected' ? '已连接' : '未连接'),
                e('span', { style: { ...styles.sectionHint, minWidth: 64, textAlign: 'right' } }, `${server.tools ?? 0} 个工具`));
            }))
          : e('div', { style: { ...styles.section, marginTop: 12, ...styles.sectionHint } }, '还没有服务器；到左侧「MCP」面板添加'),

        e('div', { style: { ...styles.section, marginTop: 14, padding: '10px 14px' } },
          e('div', { style: { ...styles.row, justifyContent: 'space-between' } },
            e('div', null,
              e('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsh-text-primary, #111827)' } }, '在侧边栏显示'),
              e('div', { style: { ...styles.sectionHint, marginTop: 2 } }, '在左侧导航里加一个 MCP 入口')),
            e(Switch, { checked: sidebar, onChange: toggleSidebar }))),

        e(TtlSettings, { state, onSaved: reload }),
        e('div', { style: { ...styles.sectionHint, marginTop: 10 } },
          '服务器增删改、连接健康与工具调用在左侧「MCP」面板（或设置 → MCP）'));
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
