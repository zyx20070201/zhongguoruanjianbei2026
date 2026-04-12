import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';

export type CodeOpenMode = 'blocksuite' | 'plain';

const CODE_OPEN_MODE_STORAGE_KEY = 'pp1-code-open-mode';
const CODE_OPEN_PROMPT_STORAGE_KEY = 'pp1-code-open-prompt';

interface AppPreferencesContextValue {
  codeOpenMode: CodeOpenMode;
  shouldPromptForCodeOpenMode: boolean;
  setCodeOpenMode: (mode: CodeOpenMode) => void;
  setShouldPromptForCodeOpenMode: (shouldPrompt: boolean) => void;
}

const AppPreferencesContext = createContext<AppPreferencesContextValue | null>(null);

const getStoredCodeOpenMode = (): CodeOpenMode => {
  if (typeof window === 'undefined') return 'blocksuite';
  const stored = window.localStorage.getItem(CODE_OPEN_MODE_STORAGE_KEY);
  return stored === 'plain' ? 'plain' : 'blocksuite';
};

const getStoredPromptPreference = (): boolean => {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage.getItem(CODE_OPEN_PROMPT_STORAGE_KEY);
  return stored === null ? true : stored === 'true';
};

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [codeOpenMode, setCodeOpenModeState] = useState<CodeOpenMode>(() => getStoredCodeOpenMode());
  const [shouldPromptForCodeOpenMode, setShouldPromptForCodeOpenModeState] = useState<boolean>(() =>
    getStoredPromptPreference()
  );

  useEffect(() => {
    window.localStorage.setItem(CODE_OPEN_MODE_STORAGE_KEY, codeOpenMode);
  }, [codeOpenMode]);

  useEffect(() => {
    window.localStorage.setItem(
      CODE_OPEN_PROMPT_STORAGE_KEY,
      String(shouldPromptForCodeOpenMode)
    );
  }, [shouldPromptForCodeOpenMode]);

  const value = useMemo<AppPreferencesContextValue>(
    () => ({
      codeOpenMode,
      shouldPromptForCodeOpenMode,
      setCodeOpenMode: (mode) => setCodeOpenModeState(mode),
      setShouldPromptForCodeOpenMode: (shouldPrompt) =>
        setShouldPromptForCodeOpenModeState(shouldPrompt)
    }),
    [codeOpenMode, shouldPromptForCodeOpenMode]
  );

  return <AppPreferencesContext.Provider value={value}>{children}</AppPreferencesContext.Provider>;
}

export function useAppPreferences() {
  const context = useContext(AppPreferencesContext);
  if (!context) {
    throw new Error('useAppPreferences must be used within AppPreferencesProvider');
  }

  return context;
}
