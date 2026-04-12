import { Code2, Layers3, X } from 'lucide-react';
import { CodeOpenMode } from '../../appPreferences';

interface CodeOpenModeDialogProps {
  isOpen: boolean;
  fileName: string;
  onClose: () => void;
  onConfirm: (mode: CodeOpenMode, rememberPreference: boolean) => void;
}

export default function CodeOpenModeDialog({
  isOpen,
  fileName,
  onClose,
  onConfirm
}: CodeOpenModeDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-panel)] shadow-2xl">
        <div className="flex items-start justify-between border-b border-[var(--wb-border)] px-6 py-5">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--wb-accent)]">
              Open Code File
            </div>
            <h2 className="mt-2 text-xl font-semibold text-[var(--wb-text)]">{fileName}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--wb-text-muted)]">
              Choose how code files should open. BlockSuite is the recommended default and can
              render the file as a code block document.
            </p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--wb-text-dim)] transition-colors hover:bg-white/5 hover:text-[var(--wb-text)]"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 px-6 py-5 md:grid-cols-2">
          <button
            onClick={() => onConfirm('blocksuite', false)}
            className="rounded-2xl border border-[var(--wb-border)] bg-[rgba(90,166,255,0.12)] p-5 text-left transition hover:border-[var(--wb-accent)] hover:bg-[rgba(90,166,255,0.18)]"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-[rgba(90,166,255,0.18)] p-3 text-[var(--wb-accent)]">
                <Layers3 className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--wb-text)]">
                  Open in BlockSuite
                </div>
                <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--wb-accent)]">
                  Recommended
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--wb-text-muted)]">
              Opens the file in a BlockSuite document and shows the code as a code block.
            </p>
            <div className="mt-5">
              <span className="inline-flex rounded-full border border-[var(--wb-border)] px-3 py-1 text-xs text-[var(--wb-text-muted)]">
                Primary mode
              </span>
            </div>
          </button>

          <button
            onClick={() => onConfirm('plain', false)}
            className="rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-editor)] p-5 text-left transition hover:border-[var(--wb-accent)] hover:bg-white/5"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white/5 p-3 text-[var(--wb-text)]">
                <Code2 className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--wb-text)]">Open in Plain Mode</div>
                <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--wb-text-dim)]">
                  Text editor
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--wb-text-muted)]">
              Uses the existing plain text editor with edit and preview modes.
            </p>
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--wb-border)] px-6 py-4">
          <button
            onClick={() => onConfirm('blocksuite', true)}
            className="rounded-lg border border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] px-4 py-2 text-sm font-medium text-[var(--wb-text)] transition hover:bg-white/5"
          >
            Always use BlockSuite
          </button>
          <button
            onClick={() => onConfirm('plain', true)}
            className="rounded-lg border border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] px-4 py-2 text-sm font-medium text-[var(--wb-text)] transition hover:bg-white/5"
          >
            Always use Plain Mode
          </button>
        </div>
      </div>
    </div>
  );
}
