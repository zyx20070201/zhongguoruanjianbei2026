import './Header.css';

interface HeaderProps {
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  onToggleConfig: () => void;
  configOpen: boolean;
}

export function Header({
  onToggleSidebar,
  sidebarOpen,
  onToggleConfig,
  configOpen,
}: HeaderProps) {
  return (
    <div className="hdr">
      <div className="hdr-top">
        <div className="hdr-left">
          {!sidebarOpen && (
            <button className="hamburger" onClick={onToggleSidebar}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          )}
          <h1>
            <span className="dot" />
            React Chatbox
            <span className="badge">React Sandbox</span>
          </h1>
        </div>
        <button
          className={`tog-btn${configOpen ? ' open' : ''}`}
          onClick={onToggleConfig}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          设置
        </button>
      </div>
    </div>
  );
}
