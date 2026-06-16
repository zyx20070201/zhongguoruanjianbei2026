import { useState, useCallback, useEffect } from 'react';
import { ConfigProvider } from './context/ConfigContext';
import { SessionProvider, useSession } from './context/SessionContext';
import { ChatProvider, useChat } from './context/ChatContext';
import { useWebSearch } from './hooks/useWebSearch';
import { useImageUpload } from './hooks/useImageUpload';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Header } from './components/Header/Header';
import { ConfigPanel } from './components/ConfigPanel/ConfigPanel';
import { ChatArea } from './components/Chat/ChatArea';
import { InputArea } from './components/InputArea/InputArea';
import { Toast } from './components/Toast/Toast';

function AppInner() {
  const {
    sessions,
    currentSessionId,
    history,
    setHistory,
    newSession,
    switchSession,
    deleteSession,
    saveCurrentSession,
  } = useSession();

  const { loading, send } = useChat();
  const { enabled: webSearchEnabled, toggle: toggleWebSearch, search } = useWebSearch();
  const { pendingImages, addImages, removeImage, clearImages } = useImageUpload();

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem('sb3_sidebarOpen') !== 'false';
  });
  const [configOpen, setConfigOpen] = useState(false);
  const [hintText, setHintText] = useState('');
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: 'error' | 'success';
  } | null>(null);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('sb3_sidebarOpen', String(next));
      return next;
    });
  }, []);

  // Save session on page unload
  useEffect(() => {
    const onUnload = () => saveCurrentSession(history);
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [saveCurrentSession, history]);

  const handleHintClick = useCallback((text: string) => {
    setHintText(text);
  }, []);

  const handleSend = useCallback(
    async (text: string, images: typeof pendingImages) => {
      if (loading) return;

      // Web search
      let searchContext = '';
      if (webSearchEnabled && text) {
        searchContext = await search(text);
      }

      clearImages();

      const result = await send(text, images, searchContext);

      if (result.error) {
        setToast({ message: result.error, type: 'error' });
        setConnected(false);
      } else {
        setConnected(true);
      }
    },
    [loading, webSearchEnabled, search, clearImages, send],
  );

  const handleClear = useCallback(() => {
    setHistory([]);
    clearImages();
    saveCurrentSession([]);
  }, [setHistory, clearImages, saveCurrentSession]);

  const handleNewSession = useCallback(() => {
    saveCurrentSession(history);
    clearImages();
    newSession();
  }, [saveCurrentSession, history, clearImages, newSession]);

  const handleSwitchSession = useCallback(
    (id: string) => {
      saveCurrentSession(history);
      clearImages();
      switchSession(id);
    },
    [saveCurrentSession, history, clearImages, switchSession],
  );

  return (
    <>
      <Sidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        isOpen={sidebarOpen}
        onSwitch={handleSwitchSession}
        onDelete={deleteSession}
        onNew={handleNewSession}
        onToggle={toggleSidebar}
        onOverlayClick={toggleSidebar}
      />
      <div className="main">
        <Header
          onToggleSidebar={toggleSidebar}
          sidebarOpen={sidebarOpen}
          onToggleConfig={() => setConfigOpen((p) => !p)}
          configOpen={configOpen}
        />
        <ConfigPanel isOpen={configOpen} connected={connected} history={history} />
        <ChatArea
          history={history}
          loading={loading}
          onHintClick={handleHintClick}
        />
        <InputArea
          onSend={handleSend}
          loading={loading}
          onClear={handleClear}
          pendingImages={pendingImages}
          onRemoveImage={removeImage}
          onAddImages={addImages}
          webSearchEnabled={webSearchEnabled}
          onToggleWebSearch={toggleWebSearch}
          hintText={hintText}
          onHintConsumed={() => setHintText('')}
        />
      </div>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDone={() => setToast(null)}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ConfigProvider>
      <SessionProvider>
        <ChatProvider>
          <AppInner />
        </ChatProvider>
      </SessionProvider>
    </ConfigProvider>
  );
}
