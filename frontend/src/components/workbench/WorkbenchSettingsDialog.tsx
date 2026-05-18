import { MonitorCog, Moon, Settings2, SunMedium, X } from 'lucide-react';
import { AppTheme } from '../../theme';

interface WorkbenchSettingsDialogProps {
  isOpen: boolean;
  theme: AppTheme;
  onClose: () => void;
  onThemeChange: (theme: AppTheme) => void;
}

export default function WorkbenchSettingsDialog({
  isOpen,
  theme,
  onClose,
  onThemeChange
}: WorkbenchSettingsDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="flex h-[560px] w-full max-w-3xl overflow-hidden rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-panel)] shadow-2xl">
        <div className="w-56 border-r border-[var(--wb-border)] bg-[var(--wb-sidebar)] px-4 py-5">
          <div className="flex items-center gap-3 px-2">
            <div className="rounded-xl bg-[rgba(90,166,255,0.12)] p-2 text-[var(--wb-accent)]">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[var(--wb-text)]">Workbench Settings</div>
              <div className="text-xs text-[var(--wb-text-dim)]">Appearance</div>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-[var(--wb-border)] bg-[var(--wb-panel)] px-3 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--wb-accent)]">
              Sections
            </div>
            <div className="mt-3 space-y-2 text-sm text-[var(--wb-text-muted)]">
              <div className="rounded-lg bg-[rgba(90,166,255,0.1)] px-3 py-2 text-[var(--wb-text)]">
                Appearance
              </div>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--wb-border)] px-6 py-5">
            <div>
              <h2 className="text-xl font-semibold text-[var(--wb-text)]">Settings</h2>
              <p className="mt-1 text-sm text-[var(--wb-text-muted)]">
                Adjust the current page appearance.
              </p>
            </div>
            <button
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--wb-text-dim)] transition-colors hover:bg-white/5 hover:text-[var(--wb-text)]"
              title="Close settings"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
            <section className="rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-editor)] p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-[rgba(90,166,255,0.12)] p-3 text-[var(--wb-accent)]">
                  <MonitorCog className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[var(--wb-text)]">Appearance</h3>
                  <p className="text-sm text-[var(--wb-text-muted)]">
                    Move the current light and dark appearance controls into one place.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => onThemeChange('light')}
                  className={`rounded-2xl border p-4 text-left transition ${
                    theme === 'light'
                      ? 'border-[var(--wb-accent)] bg-[rgba(90,166,255,0.12)]'
                      : 'border-[var(--wb-border)] bg-[var(--wb-panel)] hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <SunMedium className="h-5 w-5 text-[var(--wb-text)]" />
                    <div>
                      <div className="text-sm font-semibold text-[var(--wb-text)]">Light</div>
                      <div className="text-xs text-[var(--wb-text-dim)]">Bright workspace UI</div>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => onThemeChange('dark')}
                  className={`rounded-2xl border p-4 text-left transition ${
                    theme === 'dark'
                      ? 'border-[var(--wb-accent)] bg-[rgba(90,166,255,0.12)]'
                      : 'border-[var(--wb-border)] bg-[var(--wb-panel)] hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Moon className="h-5 w-5 text-[var(--wb-text)]" />
                    <div>
                      <div className="text-sm font-semibold text-[var(--wb-text)]">Dark</div>
                      <div className="text-xs text-[var(--wb-text-dim)]">Dimmer workbench UI</div>
                    </div>
                  </div>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
