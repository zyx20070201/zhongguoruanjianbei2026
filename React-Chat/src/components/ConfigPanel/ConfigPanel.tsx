import { useState, useRef } from 'react';
import { useConfig } from '../../context/ConfigContext';
import { PRESETS } from '../../constants/presets';
import './ConfigPanel.css';

import type { Message } from '../../types';

interface ConfigPanelProps {
  isOpen: boolean;
  connected: boolean;
  history: Message[];
}

export function ConfigPanel({ isOpen, connected, history }: ConfigPanelProps) {
  const {
    base, key, model, fmt, configs,
    setBase, setKey, setModel, setFmt,
    saveConfig, loadConfig, deleteConfig,
  } = useConfig();

  const [cfgName, setCfgName] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const handleSaveConfig = () => {
    if (!cfgName.trim()) {
      alert('请输入配置名称');
      return;
    }
    saveConfig(cfgName.trim());
    setCfgName('');
    alert('配置已保存');
  };

  const handleLoadConfig = (id: string) => {
    setSelectedId(id);
    if (id) {
      loadConfig(id);
    }
  };

  const handleDeleteConfig = () => {
    if (!selectedId || !confirm('确定删除此配置？')) return;
    deleteConfig(selectedId);
    setSelectedId('');
    setCfgName('');
  };

  const handlePreset = (key: string) => {
    const preset = PRESETS[key];
    if (!preset) return;
    setBase(preset.base);
    setModel(preset.model);
    setFmt(preset.fmt);
  };

  const handleExport = () => {
    if (history.length === 0) {
      alert('当前没有聊天记录');
      return;
    }
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `chat-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.json`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!Array.isArray(parsed)) throw new Error('格式错误');
        // Imported data is a history array; wrap in a new session
        const existing = (() => {
          try {
            const d = localStorage.getItem('sb3_sessions');
            return d ? JSON.parse(d) : [];
          } catch { return []; }
        })();
        const newSession = {
          id: Date.now().toString(),
          title: '导入的对话',
          updatedAt: Date.now(),
          history: parsed,
        };
        existing.unshift(newSession);
        localStorage.setItem('sb3_sessions', JSON.stringify(existing));
        localStorage.setItem('sb3_activeSession', newSession.id);
        window.location.reload();
      } catch (err) {
        alert('导入失败: ' + (err instanceof Error ? err.message : String(err)));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className={`cfg${isOpen ? ' open' : ''}`}>
      <div className="cfg-grid">
        {/* Saved configs dropdown */}
        <div className="cfg-g fw">
          <span className="cfg-l">已保存的配置</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              className="cfg-i"
              value={selectedId}
              onChange={(e) => handleLoadConfig(e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="">+ 新建配置</option>
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {selectedId && (
              <button className="pre-b" onClick={handleDeleteConfig}>
                删除
              </button>
            )}
          </div>
        </div>

        {/* Config name */}
        <div className="cfg-g fw">
          <span className="cfg-l">配置名称</span>
          <input
            className="cfg-i"
            value={cfgName}
            onChange={(e) => setCfgName(e.target.value)}
            placeholder="例：我的 Claude API"
          />
        </div>

        {/* Base URL */}
        <div className="cfg-g fw">
          <span className="cfg-l">API 端点 (Base URL)</span>
          <input
            className="cfg-i"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="https://api.anthropic.com"
          />
        </div>

        {/* API Key */}
        <div className="cfg-g">
          <span className="cfg-l">API Key</span>
          <input
            className="cfg-i"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-... 或第三方 Key"
          />
        </div>

        {/* Model */}
        <div className="cfg-g">
          <span className="cfg-l">模型名称（可自由填写）</span>
          <input
            className="cfg-i"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="任意模型名称"
          />
        </div>

        {/* API format */}
        <div className="cfg-g fw" style={{ marginTop: 4 }}>
          <span className="cfg-l">API 格式</span>
          <div className="fmt-row">
            <label className="fmt-label">
              <input
                type="radio"
                name="apiFmt"
                value="anthropic"
                checked={fmt === 'anthropic'}
                onChange={() => setFmt('anthropic')}
              />
              Anthropic (/v1/messages)
            </label>
            <label className="fmt-label">
              <input
                type="radio"
                name="apiFmt"
                value="openai"
                checked={fmt === 'openai'}
                onChange={() => setFmt('openai')}
              />
              OpenAI (/v1/chat/completions)
            </label>
          </div>
        </div>

        {/* Save button */}
        <div className="pre-row">
          <button
            className="pre-b"
            onClick={handleSaveConfig}
            style={{
              background: 'var(--green)',
              borderColor: 'var(--green)',
              color: '#fff',
              fontWeight: 600,
            }}
          >
            保存配置
          </button>
        </div>

        {/* Presets */}
        <div className="pre-row">
          <span className="cfg-l" style={{ width: '100%', marginBottom: 1 }}>
            快速预设
          </span>
          {Object.keys(PRESETS).map((k) => (
            <button
              key={k}
              className="pre-b"
              onClick={() => handlePreset(k)}
            >
              {k === 'openai-compat' ? 'OpenAI 兼容' : k.charAt(0).toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>

        {/* Connection status */}
        <div className="conn">
          <div className={`conn-d${connected ? ' ok' : ''}`} />
          <span>
            {connected
              ? `已连接 — ${model}`
              : '未连接'}
          </span>
        </div>

        {/* Import/Export */}
        <div className="save-bar">
          <span className="cfg-l" style={{ width: '100%', marginBottom: 1 }}>
            聊天记录
          </span>
        </div>
        <div className="save-bar">
          <button className="save-btn" onClick={handleExport}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            导出JSON
          </button>
          <button className="save-btn" onClick={() => importRef.current?.click()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            导入JSON
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleImport}
          />
        </div>
      </div>
    </div>
  );
}
