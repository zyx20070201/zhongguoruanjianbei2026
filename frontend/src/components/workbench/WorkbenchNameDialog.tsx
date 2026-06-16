import { FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';

interface WorkbenchNameDialogProps {
  isOpen: boolean;
  mode: 'create' | 'rename';
  initialTitle?: string;
  workspaceName?: string;
  headingOverride?: string;
  contextLabel?: string;
  inputLabel?: string;
  placeholder?: string;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (title: string) => void;
}

export default function WorkbenchNameDialog({
  isOpen,
  mode,
  initialTitle = '',
  workspaceName,
  headingOverride,
  contextLabel,
  inputLabel,
  placeholder,
  loading = false,
  error,
  onClose,
  onSubmit
}: WorkbenchNameDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(initialTitle);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [initialTitle, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const trimmedTitle = title.trim();
  const heading = headingOverride || (mode === 'create' ? '新建 workbench' : '重命名 workbench');
  const submitLabel = mode === 'create' ? '创建' : '保存';
  const helperLabel = contextLabel || (workspaceName ? `工作区：${workspaceName}` : '');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedTitle || loading) return;
    onSubmit(trimmedTitle);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex h-screen max-h-[100dvh] w-full justify-center overflow-y-auto overscroll-contain bg-black/30 p-3 animate-[openwebui-fade_10ms_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workbench-name-dialog-title"
      onMouseDown={() => {
        if (!loading) onClose();
      }}
    >
      <style>
        {`@keyframes openwebui-fade { from { opacity: 0; } to { opacity: 1; } }
          @keyframes openwebui-scale-up { from { transform: scale(0.985); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}
      </style>
      <form
        className="m-auto flex min-h-fit w-full max-w-[32rem] flex-col overflow-hidden rounded-[32px] border border-white bg-white/95 text-gray-900 shadow-[0_24px_90px_rgba(0,0,0,0.24)] backdrop-blur-sm animate-[openwebui-scale-up_100ms_ease-out_forwards]"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex justify-between px-5 pb-1 pt-4 text-gray-900">
          <div className="min-w-0 self-center">
            <h2 id="workbench-name-dialog-title" className="text-lg font-medium">
              {heading}
            </h2>
            {helperLabel ? (
              <p className="mt-0.5 truncate text-xs text-gray-500">{helperLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="self-center rounded-xl p-1 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            aria-label="关闭"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-3 text-gray-900 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <label className="block" htmlFor="workbench-title-input">
            <span className="mb-1 block text-xs text-gray-500">{inputLabel || 'Workbench 名称'}</span>
            <input
              id="workbench-title-input"
              ref={inputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full bg-transparent text-sm outline-none placeholder:text-gray-300"
              placeholder={placeholder || '输入 workbench 名称'}
              disabled={loading}
              required
            />
          </label>

          {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-1.5 px-5 pb-4 pt-3 text-sm font-medium">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-9 rounded-full px-3.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!trimmedTitle || loading}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-black px-3.5 text-sm font-medium text-white transition hover:bg-gray-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitLabel}
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
