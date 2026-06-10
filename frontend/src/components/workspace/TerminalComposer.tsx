import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Image,
  Loader2,
  Paperclip,
  Square,
  Upload,
  Wand2,
  X
} from 'lucide-react';
import { TerminalChatFile } from '../../types';

export type TerminalComposerMode = 'chat' | 'agentic';
export type TerminalComposerSourceMode = 'focused' | 'full_context';

export interface TerminalComposerSourceFile {
  id: string;
  name: string;
  path: string;
  updatedAt?: string;
  indexStatusLabel?: string;
  indexStatusDetail?: string;
  indexStatusTone?: 'ready' | 'indexing' | 'degraded' | 'failed' | 'empty';
  chunkCount?: number;
}

interface TerminalComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  mode: TerminalComposerMode;
  onModeChange?: (mode: TerminalComposerMode) => void;
  selectedSources: Array<{ fileId: string; mode: TerminalComposerSourceMode }>;
  onSelectedSourcesChange?: (sources: Array<{ fileId: string; mode: TerminalComposerSourceMode }>) => void;
  sourceFiles?: TerminalComposerSourceFile[];
  chatFiles?: TerminalChatFile[];
  onRemoveChatFile?: (fileId: string) => void;
  onUploadChatFiles?: (files: FileList | File[]) => Promise<void> | void;
  uploadingChatFiles?: boolean;
  onUploadMaterials?: () => void;
  submitting?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}

const sourceStatusToneClass = (tone?: TerminalComposerSourceFile['indexStatusTone']) => {
  if (tone === 'ready') return 'bg-emerald-50 text-emerald-700';
  if (tone === 'degraded') return 'bg-amber-50 text-amber-700';
  if (tone === 'indexing') return 'bg-blue-50 text-blue-700';
  if (tone === 'failed') return 'bg-red-50 text-red-700';
  return 'bg-gray-100 text-gray-600';
};

const formatBytes = (bytes?: number) => {
  const value = Number(bytes || 0);
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
};

const fileIsImage = (file: Pick<TerminalChatFile, 'mimeType' | 'extension' | 'name'>) => {
  const mimeType = (file.mimeType || '').toLowerCase();
  const extension = (file.extension || file.name.split('.').pop() || '').toLowerCase();
  return mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension);
};

export default function TerminalComposer({
  value,
  onValueChange,
  onSubmit,
  placeholder = 'Send a Message',
  mode,
  onModeChange,
  selectedSources,
  onSelectedSourcesChange,
  sourceFiles = [],
  chatFiles = [],
  onRemoveChatFile,
  onUploadChatFiles,
  uploadingChatFiles = false,
  onUploadMaterials,
  submitting = false,
  disabled = false,
  autoFocus = false
}: TerminalComposerProps) {
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const sourceMenuRef = useRef<HTMLDivElement | null>(null);
  const uploadMenuRef = useRef<HTMLDivElement | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const readyChatFiles = useMemo(
    () => chatFiles.filter((file) => file.status !== 'uploading' && file.status !== 'error'),
    [chatFiles]
  );
  const selectedSourceModeById = useMemo(
    () => new Map(selectedSources.map((source) => [source.fileId, source.mode] as const)),
    [selectedSources]
  );
  const activeSources = useMemo(
    () => sourceFiles.filter((file) => selectedSourceModeById.has(file.id)),
    [selectedSourceModeById, sourceFiles]
  );
  const canSubmit = Boolean(value.trim() || readyChatFiles.length > 0) && !disabled && !submitting;
  const canAttachFiles = Boolean(onUploadChatFiles);
  const hasUploadChoices = canAttachFiles && Boolean(onUploadMaterials);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!modeMenuRef.current?.contains(target)) setModeMenuOpen(false);
      if (!sourceMenuRef.current?.contains(target)) setSourceMenuOpen(false);
      if (!uploadMenuRef.current?.contains(target)) setUploadMenuOpen(false);
    };

    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const uploadFiles = async (files: FileList | File[]) => {
    if (!files.length || !onUploadChatFiles || uploadingChatFiles) return;
    await onUploadChatFiles(files);
    if (chatFileInputRef.current) chatFileInputRef.current.value = '';
    setUploadMenuOpen(false);
  };

  const toggleSourceId = (sourceId: string) => {
    const next = selectedSources.some((source) => source.fileId === sourceId)
      ? selectedSources.filter((source) => source.fileId !== sourceId)
      : [...selectedSources, { fileId: sourceId, mode: 'focused' as const }];
    onSelectedSourcesChange?.(next.slice(0, 12).map((source) => ({
      fileId: source.fileId,
      mode: source.mode === 'full_context' ? 'full_context' : 'focused'
    })));
  };

  const updateSourceMode = (sourceId: string, nextMode: TerminalComposerSourceMode) => {
    onSelectedSourcesChange?.(selectedSources.map((source) =>
      source.fileId === sourceId
        ? { fileId: source.fileId, mode: nextMode }
        : { fileId: source.fileId, mode: source.mode === 'full_context' ? 'full_context' : 'focused' }
    ));
  };

  const submit = () => {
    if (canSubmit) onSubmit();
  };

  return (
    <form
      className="workspace-composer flex w-full flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-1 flex-col rounded-3xl border border-gray-100/30 bg-white/95 px-1 shadow-lg backdrop-blur-sm transition hover:border-gray-200 focus-within:border-gray-100">
        <input
          ref={chatFileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) void uploadFiles(event.target.files);
          }}
        />
        {chatFiles.length > 0 ? (
          <div className="flex max-w-full gap-2 overflow-x-auto px-3 pt-3">
            {chatFiles.map((file) => (
              <div
                key={file.id}
                className="group/attachment flex h-10 max-w-52 shrink-0 items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-2 text-xs text-gray-700"
                title={`${file.name}${file.size ? ` · ${formatBytes(file.size)}` : ''}`}
              >
                <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-gray-500">
                  {fileIsImage(file) && file.downloadUrl ? (
                    <img src={file.downloadUrl} alt={file.name} className="h-full w-full object-cover" />
                  ) : fileIsImage(file) ? (
                    <Image className="size-3.5" />
                  ) : (
                    <Paperclip className="size-3.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-gray-800">{file.name}</div>
                  <div className="truncate text-[10px] text-gray-400">{formatBytes(file.size) || file.mimeType || 'Attachment'}</div>
                </div>
                {onRemoveChatFile ? (
                  <button
                    type="button"
                    onClick={() => onRemoveChatFile(file.id)}
                    className="flex size-5 shrink-0 items-center justify-center rounded-full text-gray-400 opacity-80 transition hover:bg-gray-200 hover:text-gray-700 group-hover/attachment:opacity-100"
                    title="Remove attachment"
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="px-2.5">
          <textarea
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className="scrollbar-hidden min-h-[52px] max-h-96 w-full resize-none bg-transparent px-1 pb-1 pt-3 text-[15px] leading-6 text-gray-900 outline-none placeholder:text-gray-500"
            placeholder={placeholder}
            rows={1}
            autoFocus={autoFocus}
          />
        </div>

        <div className="mx-0.5 mb-2.5 mt-0.5 flex max-w-full justify-between" dir="ltr">
          <div className="ml-1 flex max-w-[82%] flex-1 items-center gap-0.5 self-end">
            <div ref={modeMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setModeMenuOpen((current) => !current)}
                className="flex size-8 items-center justify-center rounded-full bg-transparent text-gray-700 outline-none transition hover:bg-gray-100"
                title={`Mode: ${mode === 'agentic' ? 'Agentic' : 'Chat'}`}
              >
                <Wand2 className="size-4.5" strokeWidth={1.75} />
              </button>
              {modeMenuOpen ? (
                <div className="absolute bottom-10 left-0 z-50 w-44 rounded-2xl border border-gray-100 bg-white p-1 text-sm text-gray-900 shadow-lg">
                  {([
                    { value: 'chat' as const, label: 'Chat' },
                    { value: 'agentic' as const, label: 'Agentic' }
                  ]).map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => {
                        onModeChange?.(item.value);
                        setModeMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition hover:bg-gray-50"
                    >
                      <span>{item.label}</span>
                      {mode === item.value ? <Check className="size-4 shrink-0 text-gray-900" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div ref={sourceMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setSourceMenuOpen((current) => !current)}
                className="flex size-8 items-center justify-center rounded-full bg-transparent text-gray-700 outline-none transition hover:bg-gray-100"
                title={activeSources.length ? `${activeSources.length} locked sources` : 'Workspace scope'}
              >
                <BookOpen className="size-4.5" strokeWidth={1.75} />
              </button>
              {sourceMenuOpen ? (
                <div className="absolute bottom-10 left-0 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-100 bg-white p-2 text-sm text-gray-900 shadow-lg">
                  <div className="flex items-center justify-between gap-3 px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                    <span>Lock sources for this chat</span>
                    <span>{activeSources.length ? `${activeSources.length} selected` : 'Workspace scope'}</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {sourceFiles.length > 0 ? (
                      sourceFiles.map((source) => {
                        const isActive = selectedSourceModeById.has(source.id);
                        const sourceMode = selectedSourceModeById.get(source.id) || 'focused';
                        return (
                          <div
                            key={source.id}
                            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-gray-50"
                          >
                            <button
                              type="button"
                              onClick={() => toggleSourceId(source.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="truncate text-sm font-medium text-gray-900">{source.name}</div>
                              <div className="truncate text-xs text-gray-500">{source.path}</div>
                              <div className="mt-1 flex min-w-0 items-center gap-1.5">
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${sourceStatusToneClass(source.indexStatusTone)}`}>
                                  {source.indexStatusLabel || 'Unknown'}
                                </span>
                                <span className="truncate text-[10px] text-gray-400">
                                  {source.indexStatusDetail || 'Index status unavailable'}
                                </span>
                              </div>
                              {isActive && Number(source.chunkCount || 0) === 0 ? (
                                <div className="mt-1 text-[10px] text-red-500">No chunks yet; focused retrieval may not find evidence.</div>
                              ) : null}
                            </button>
                            <div className="flex shrink-0 items-center gap-2">
                              {isActive ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    updateSourceMode(source.id, sourceMode === 'focused' ? 'full_context' : 'focused');
                                  }}
                                  className="rounded-full border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-gray-50"
                                >
                                  {sourceMode === 'focused' ? 'Focused' : 'Full'}
                                </button>
                              ) : null}
                              {isActive ? <Check className="size-4 shrink-0 text-black" /> : null}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-3 py-3 text-sm text-gray-500">No workspace sources available.</div>
                    )}
                  </div>
                  <div className="mt-2 flex justify-between gap-2 border-t border-gray-100 px-2 pt-2">
                    <button
                      type="button"
                      onClick={() => onSelectedSourcesChange?.([])}
                      className="rounded-full px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceMenuOpen(false)}
                      className="rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div ref={uploadMenuRef} className="relative">
              <button
                type="button"
                disabled={uploadingChatFiles || (!canAttachFiles && !onUploadMaterials)}
                onClick={() => {
                  if (hasUploadChoices) {
                    setUploadMenuOpen((current) => !current);
                    return;
                  }
                  if (canAttachFiles) chatFileInputRef.current?.click();
                  else onUploadMaterials?.();
                }}
                className="flex size-8 items-center justify-center rounded-full bg-transparent text-gray-700 outline-none transition hover:bg-gray-100 disabled:opacity-40"
                title="Upload auxiliary resources"
              >
                {uploadingChatFiles ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4.5" />}
              </button>
              {uploadMenuOpen ? (
                <div className="absolute bottom-10 left-0 z-50 w-56 rounded-2xl border border-gray-100 bg-white p-1 text-sm text-gray-900 shadow-lg">
                  {canAttachFiles ? (
                    <button
                      type="button"
                      onClick={() => chatFileInputRef.current?.click()}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-gray-50"
                    >
                      <Paperclip className="size-4 text-gray-500" />
                      <span>Attach to chat</span>
                    </button>
                  ) : null}
                  {onUploadMaterials ? (
                    <button
                      type="button"
                      onClick={() => {
                        setUploadMenuOpen(false);
                        onUploadMaterials();
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-gray-50"
                    >
                      <Upload className="size-4 text-gray-500" />
                      <span>Add to Knowledge</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mr-1 flex shrink-0 items-center gap-[0.5px] self-end">
            {submitting ? (
              <button
                type="button"
                disabled
                className="self-center rounded-full bg-white p-1.5 text-gray-800 transition hover:bg-gray-100"
                title="Stop"
              >
                <Square className="size-5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSubmit}
                className={`self-center rounded-full p-1.5 transition ${
                  canSubmit
                    ? 'bg-black text-white hover:bg-gray-900'
                    : 'cursor-not-allowed bg-gray-200 text-white'
                }`}
                title="Send message"
              >
                <ArrowUp className="size-5" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="mb-1" />
    </form>
  );
}
