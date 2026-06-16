import React from 'react';
import {
  ArrowRight,
  Check,
  ExternalLink,
  FileUp,
  Link2,
  Loader2,
  Search,
  TextCursorInput,
  X
} from 'lucide-react';
import { DiscoveredResource } from '../../services/fileSystemApi';

type SourceMode = 'discover' | 'files' | 'website' | 'text';

interface AddSourcesDialogProps {
  isOpen: boolean;
  targetLabel?: string;
  onClose: () => void;
  onUploadFiles: (files: File[]) => Promise<void>;
  onAddWebsite: (input: { title: string; url: string }) => Promise<void>;
  onAddText: (input: { title: string; content: string }) => Promise<void>;
  onDiscoverSources: (input: { query: string; maxResults?: number }) => Promise<DiscoveredResource[]>;
  onImportDiscoveredSources: (sources: DiscoveredResource[]) => Promise<void>;
}

const modeItems: Array<{
  id: SourceMode;
  label: string;
  description: string;
  icon: typeof FileUp;
}> = [
  {
    id: 'discover',
    label: 'Search web',
    description: 'Find online sources and import selected results.',
    icon: Search
  },
  {
    id: 'files',
    label: 'Upload files',
    description: 'Select multiple files before adding them.',
    icon: FileUp
  },
  {
    id: 'website',
    label: 'URL',
    description: 'Add a webpage, article or video link.',
    icon: Link2
  },
  {
    id: 'text',
    label: 'Copied text',
    description: 'Paste text as workspace knowledge.',
    icon: TextCursorInput
  }
];

const makeTitleFromUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, '') || 'web-source';
  } catch {
    return 'web-source';
  }
};

const fieldShellClass =
  'rounded-lg bg-gray-50';

const textFieldClass =
  'rounded-lg bg-gray-50';

const modeButtonClass =
  'px-3.5 py-1.5 font-medium hover:bg-black/5 outline outline-1 outline-gray-100 rounded-3xl transition';

const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export const AddSourcesDialog: React.FC<AddSourcesDialogProps> = ({
  isOpen,
  targetLabel,
  onClose,
  onUploadFiles,
  onAddWebsite,
  onAddText,
  onDiscoverSources,
  onImportDiscoveredSources
}) => {
  const [mode, setMode] = React.useState<SourceMode>('discover');
  const [discoveryQuery, setDiscoveryQuery] = React.useState('');
  const [discoveredSources, setDiscoveredSources] = React.useState<DiscoveredResource[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = React.useState<Record<string, boolean>>({});
  const [discoveryError, setDiscoveryError] = React.useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = React.useState(false);
  const [websiteUrl, setWebsiteUrl] = React.useState('');
  const [websiteTitle, setWebsiteTitle] = React.useState('');
  const [textTitle, setTextTitle] = React.useState('pasted-source');
  const [textContent, setTextContent] = React.useState('');
  const [queuedFiles, setQueuedFiles] = React.useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    setMode('discover');
    setDiscoveryQuery('');
    setDiscoveredSources([]);
    setSelectedSourceIds({});
    setDiscoveryError(null);
    setIsDiscovering(false);
    setWebsiteUrl('');
    setWebsiteTitle('');
    setTextTitle('pasted-source');
    setTextContent('');
    setQueuedFiles([]);
    setIsSubmitting(false);
    setSubmitError(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRequestClose = () => {
    onClose();
  };

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onUploadFiles(files);
      handleRequestClose();
    } catch (error: any) {
      setSubmitError(error?.response?.data?.error || error?.message || 'Failed to upload files');
    } finally {
      setIsSubmitting(false);
    }
  };

  const addQueuedFiles = (files: File[]) => {
    if (!files.length) return;
    setQueuedFiles((current) => {
      const existingKeys = new Set(
        current.map((file) => `${file.name}-${file.size}-${file.lastModified}`)
      );
      const next = [...current];
      for (const file of files) {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          next.push(file);
        }
      }
      return next;
    });
  };

  const handleDiscover = async () => {
    const query = discoveryQuery.trim();
    if (!query) return;

    setIsDiscovering(true);
    setDiscoveryError(null);
    try {
      const results = await onDiscoverSources({ query, maxResults: 10 });
      setDiscoveredSources(results);
      setSelectedSourceIds(
        Object.fromEntries(results.slice(0, 5).map((source) => [source.id, true]))
      );
      if (results.length === 0) {
        setDiscoveryError('No sources found. Try a more specific topic or keywords.');
      }
    } catch (error: any) {
      setDiscoveredSources([]);
      setSelectedSourceIds({});
      setDiscoveryError(error?.response?.data?.error || error?.message || 'Source discovery failed');
    } finally {
      setIsDiscovering(false);
    }
  };

  const selectedSources = discoveredSources.filter((source) => selectedSourceIds[source.id]);

  const handleImportDiscovered = async () => {
    if (selectedSources.length === 0) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onImportDiscoveredSources(selectedSources);
      handleRequestClose();
    } catch (error: any) {
      setSubmitError(error?.response?.data?.error || error?.message || 'Failed to import selected sources');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWebsiteSubmit = async () => {
    const url = websiteUrl.trim();
    if (!url) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onAddWebsite({
        url,
        title: websiteTitle.trim() || makeTitleFromUrl(url)
      });
      handleRequestClose();
    } catch (error: any) {
      setSubmitError(error?.response?.data?.error || error?.message || 'Failed to add website');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTextSubmit = async () => {
    const content = textContent.trim();
    if (!content) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onAddText({
        title: textTitle.trim() || 'pasted-source',
        content
      });
      handleRequestClose();
    } catch (error: any) {
      setSubmitError(error?.response?.data?.error || error?.message || 'Failed to add text source');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedMode = modeItems.find((item) => item.id === mode) ?? modeItems[0];

  return (
    <div className="fixed inset-0 z-[90] flex h-screen max-h-[100dvh] items-center justify-center overflow-y-auto overscroll-contain bg-black/30 p-3">
      <div className="m-auto mx-2 max-h-[100dvh] min-h-fit w-[42rem] max-w-full overflow-hidden rounded-[2rem] border border-white bg-white/95 shadow-3xl backdrop-blur-sm">
        <div className="flex justify-between px-5 pb-1 pt-4 text-gray-900">
          <div className="self-center text-lg font-medium">Add Knowledge</div>
          <button type="button" onClick={handleRequestClose} className="self-center" title="Close">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex max-h-[calc(100vh-7rem)] flex-col overflow-y-auto px-5 pb-4 text-gray-900 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex flex-col w-full">
            <div className="my-2">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-gray-500">
                <span>Knowledge</span>
                {targetLabel ? <span className="min-w-0 truncate rounded-lg bg-gray-50 px-2 py-1 text-gray-600">{targetLabel}</span> : null}
              </div>
              <div className="flex flex-wrap flex-row text-sm gap-1">
                {modeItems.map((item) => {
                  const isActive = mode === item.id;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMode(item.id)}
                      className={`${modeButtonClass} flex items-center gap-2 ${
                        isActive ? 'bg-black/5 text-gray-900' : 'text-gray-900'
                      }`}
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 text-xs text-gray-500">{selectedMode.description}</div>
            </div>

            <hr className="my-2.5 w-full border-gray-50" />

            <div className="min-h-[300px] w-full">
              {submitError && (
                <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm leading-6 text-red-600">
                  {submitError}
                </div>
              )}

              {mode === 'discover' && (
                <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs text-gray-500">Search topic</label>
                  <div className={`flex items-center gap-2 py-2 px-4 ${fieldShellClass}`}>
                    <Search className="h-4 w-4 shrink-0 text-gray-500" />
                    <input
                      value={discoveryQuery}
                      onChange={(event) => setDiscoveryQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void handleDiscover();
                      }}
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                      placeholder="e.g. transformer attention visual explanation, database indexing lecture notes"
                    />
                    <button
                      type="button"
                      onClick={() => void handleDiscover()}
                      disabled={isDiscovering || !discoveryQuery.trim()}
                      className="flex shrink-0 items-center gap-2 rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-medium transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {isDiscovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                      Search
                    </button>
                  </div>
                </div>

                {discoveryError && (
                  <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm leading-6 text-red-600">
                    {discoveryError}
                  </div>
                )}

                {discoveredSources.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm">
                        {selectedSources.length} selected from {discoveredSources.length} results
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleImportDiscovered()}
                        disabled={isSubmitting || selectedSources.length === 0}
                        className="flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-2 text-sm font-medium transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                        Import selected
                      </button>
                    </div>

                    <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                      {discoveredSources.map((source) => {
                        const selected = Boolean(selectedSourceIds[source.id]);
                        return (
                          <button
                            key={source.id}
                            type="button"
                            onClick={() =>
                              setSelectedSourceIds((current) => ({
                                ...current,
                                [source.id]: !current[source.id]
                              }))
                            }
                            className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                              selected
                                ? 'border-emerald-100 bg-emerald-50'
                                : 'border-gray-100 bg-gray-50 hover:bg-gray-100'
                            }`}
                          >
                            <span className="flex items-start gap-3">
                              <span
                                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                                  selected ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-200 bg-white text-transparent'
                                }`}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-medium leading-5">
                                  {source.title}
                                </span>
                                <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-gray-500">
                                  <span className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 uppercase tracking-wide text-gray-600">
                                    {source.provider}
                                  </span>
                                  <span className="truncate">{source.source || source.author || new URL(source.url).hostname.replace(/^www\./, '')}</span>
                                  {source.publishedAt && <span className="shrink-0">{source.publishedAt.slice(0, 10)}</span>}
                                </span>
                                <span className="mt-2 block text-sm leading-6 text-gray-600">
                                  {source.summary || source.snippet}
                                </span>
                                <span className="mt-2 flex items-center gap-1 text-xs text-gray-500">
                                  <ExternalLink className="h-3 w-3" />
                                  <span className="truncate">{source.url}</span>
                                </span>
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                </div>
              )}

              {mode === 'files' && (
                <div className="space-y-4">
                <div
                className="rounded-lg bg-gray-50 px-4 py-4"
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  addQueuedFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addQueuedFiles(Array.from(event.target.files || []));
                    event.currentTarget.value = '';
                  }}
                />
                  <div className="flex flex-wrap flex-row text-sm gap-1">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSubmitting}
                      className={`${modeButtonClass} flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
                      Upload Files
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">Drag files here or use Upload Files. They will be added after you save.</div>
                </div>
                {queuedFiles.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs text-gray-500">{queuedFiles.length} file{queuedFiles.length === 1 ? '' : 's'} selected</div>
                    <div className="max-h-[120px] space-y-1.5 overflow-y-auto pr-1">
                      {queuedFiles.map((file) => (
                        <div
                          key={`${file.name}-${file.size}-${file.lastModified}`}
                          className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm"
                        >
                          <FileUp className="h-4 w-4 shrink-0 text-gray-500" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{file.name}</div>
                            <div className="text-xs text-gray-500">{formatFileSize(file.size)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setQueuedFiles((current) =>
                                current.filter((item) => item !== file)
                              )
                            }
                            className="inline-flex size-7 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
                            title="Remove"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleFiles(queuedFiles)}
                    disabled={isSubmitting || queuedFiles.length === 0}
                    className="flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-2 text-sm font-medium transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    Add files
                  </button>
                </div>
                </div>
              )}

              {mode === 'website' && (
                <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs text-gray-500">Website or video URL</label>
                  <div className={`flex items-center gap-2 py-2 px-4 ${fieldShellClass}`}>
                    <Link2 className="h-4 w-4 shrink-0 text-gray-500" />
                    <input
                      value={websiteUrl}
                      onChange={(event) => setWebsiteUrl(event.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                      placeholder="https://example.com/article or YouTube link"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-xs text-gray-500">Title</label>
                  <input
                    value={websiteTitle}
                    onChange={(event) => setWebsiteTitle(event.target.value)}
                    className={`w-full py-2 px-4 text-sm outline-none ${textFieldClass}`}
                    placeholder="Optional, generated from the URL if empty"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleWebsiteSubmit()}
                  disabled={isSubmitting || !websiteUrl.trim()}
                  className="flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-2 text-sm font-medium transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Add website
                </button>
                </div>
              )}

              {mode === 'text' && (
                <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs text-gray-500">Title</label>
                  <input
                    value={textTitle}
                    onChange={(event) => setTextTitle(event.target.value)}
                    className={`w-full py-2 px-4 text-sm outline-none ${textFieldClass}`}
                    placeholder="pasted-source"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs text-gray-500">Text</label>
                  <textarea
                    value={textContent}
                    onChange={(event) => setTextContent(event.target.value)}
                    className={`min-h-[180px] w-full resize-y py-2 px-4 text-sm outline-none ${textFieldClass}`}
                    placeholder="Paste source text here..."
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleTextSubmit()}
                  disabled={isSubmitting || !textContent.trim()}
                  className="flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-2 text-sm font-medium transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Add text
                </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
