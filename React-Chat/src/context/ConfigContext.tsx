import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { APIConfig, ApiFormat } from '../types';

const CONFIGS_KEY = 'sb3_configs';
const CURRENT_CONFIG_KEY = 'sb3_currentConfig';
const SB3_PREFIX = 'sb3_';

interface ConfigState {
  base: string;
  key: string;
  model: string;
  fmt: ApiFormat;
}

interface ConfigContextValue extends ConfigState {
  configs: APIConfig[];
  setBase: (v: string) => void;
  setKey: (v: string) => void;
  setModel: (v: string) => void;
  setFmt: (v: ApiFormat) => void;
  saveConfig: (name: string) => void;
  loadConfig: (id: string) => void;
  deleteConfig: (id: string) => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

function getConfigs(): APIConfig[] {
  try {
    const d = localStorage.getItem(CONFIGS_KEY);
    return d ? JSON.parse(d) : [];
  } catch {
    return [];
  }
}

function saveConfigs(configs: APIConfig[]) {
  localStorage.setItem(CONFIGS_KEY, JSON.stringify(configs));
}

function persist(key: string, value: string) {
  localStorage.setItem(`${SB3_PREFIX}${key}`, value);
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [base, setBaseState] = useState(
    () => localStorage.getItem('sb3_cfgBase') || 'https://api.anthropic.com',
  );
  const [key, setKeyState] = useState(
    () => localStorage.getItem('sb3_cfgKey') || '',
  );
  const [model, setModelState] = useState(
    () => localStorage.getItem('sb3_cfgModel') || 'claude-sonnet-4-20250514',
  );
  const [fmt, setFmtState] = useState<ApiFormat>(
    () =>
      (localStorage.getItem('sb3_apiFmt') as ApiFormat) || 'anthropic',
  );
  const [configs, setConfigs] = useState<APIConfig[]>(getConfigs);

  const setBase = useCallback((v: string) => { setBaseState(v); persist('cfgBase', v); }, []);
  const setKey = useCallback((v: string) => { setKeyState(v); persist('cfgKey', v); }, []);
  const setModel = useCallback((v: string) => { setModelState(v); persist('cfgModel', v); }, []);
  const setFmt = useCallback((v: ApiFormat) => { setFmtState(v); persist('apiFmt', v); }, []);

  const saveConfig = useCallback(
    (name: string) => {
      if (!name) return;
      const cfg: APIConfig = {
        id: Date.now().toString(),
        name,
        base,
        key,
        model,
        fmt,
      };
      const updated = [...configs, cfg];
      setConfigs(updated);
      saveConfigs(updated);
    },
    [base, key, model, fmt, configs],
  );

  const loadConfig = useCallback(
    (id: string) => {
      const cfg = configs.find((c) => c.id === id);
      if (!cfg) return;
      setBaseState(cfg.base);
      setKeyState(cfg.key);
      setModelState(cfg.model);
      setFmtState(cfg.fmt);
      persist('cfgBase', cfg.base);
      persist('cfgKey', cfg.key);
      persist('cfgModel', cfg.model);
      persist('apiFmt', cfg.fmt);
      localStorage.setItem(CURRENT_CONFIG_KEY, id);
    },
    [configs],
  );

  const deleteConfig = useCallback(
    (id: string) => {
      const updated = configs.filter((c) => c.id !== id);
      setConfigs(updated);
      saveConfigs(updated);
    },
    [configs],
  );

  // Restore last used config on mount
  useEffect(() => {
    const lastId = localStorage.getItem(CURRENT_CONFIG_KEY);
    if (lastId) {
      const cfg = configs.find((c) => c.id === lastId);
      if (cfg) {
        setBaseState(cfg.base);
        setKeyState(cfg.key);
        setModelState(cfg.model);
        setFmtState(cfg.fmt);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ConfigContext.Provider
      value={{
        base, key, model, fmt, configs,
        setBase, setKey, setModel, setFmt,
        saveConfig, loadConfig, deleteConfig,
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be inside ConfigProvider');
  return ctx;
}
