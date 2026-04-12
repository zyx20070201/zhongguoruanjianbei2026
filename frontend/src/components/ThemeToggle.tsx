import { Moon, SunMedium } from 'lucide-react';
import { useTheme } from '../theme';

interface ThemeToggleProps {
  compact?: boolean;
}

export default function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  const baseButtonClass = compact
    ? 'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors'
    : 'inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors';

  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-1 text-[var(--app-muted)] shadow-sm">
      <button
        type="button"
        onClick={() => setTheme('light')}
        className={`${baseButtonClass} ${
          theme === 'light'
            ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]'
            : 'hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]'
        }`}
        title="Use light theme"
      >
        <SunMedium className="h-4 w-4" />
        {!compact && <span>Light</span>}
      </button>
      <button
        type="button"
        onClick={() => setTheme('dark')}
        className={`${baseButtonClass} ${
          theme === 'dark'
            ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]'
            : 'hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]'
        }`}
        title="Use dark theme"
      >
        <Moon className="h-4 w-4" />
        {!compact && <span>Dark</span>}
      </button>
    </div>
  );
}
