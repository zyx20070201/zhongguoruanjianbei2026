import React from 'react';
import {
  ArrowRight,
  Check,
  ExternalLink,
  FileUp,
  Globe2,
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
    description: 'Find online sources with Exa or Tavily and add the best ones.',
    icon: Search
  },
  {
    id: 'files',
    label: 'Upload files',
    description: 'PDF, docs, slides, images, audio or code from your computer.',
    icon: FileUp
  },
  {
    id: 'website',
    label: 'Websites',
    description: 'Save a webpage, article, YouTube or video link as a source.',
    icon: Globe2
  },
  {
    id: 'text',
    label: 'Copied text',
    description: 'Paste notes, excerpts, prompts or any text you want agents to use.',
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
  'border border-[#d9d8d2] bg-[#efefec] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] transition focus-within:border-[#b9bab5] focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(0,0,0,0.035)]';

const textFieldClass =
  'border border-[#d9d8d2] bg-[#efefec] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] transition placeholder:text-[#9b9da1] focus:border-[#b9bab5] focus:bg-white focus:shadow-[0_0_0_3px_rgba(0,0,0,0.035)]';

export const AddSourcesDialog: React.FC<AddSourcesDialogProps> = ({
  isOpen,
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
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [isClosing, setIsClosing] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const closeTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsClosing(false);
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
    setIsSubmitting(false);
    setSubmitError(null);
  }, [isOpen]);

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  if (!isOpen) return null;

  const handleRequestClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 180);
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

  return (
    <div className={`fixed inset-0 z-[90] flex items-center justify-center bg-black/10 px-4 py-6 ${isClosing ? 'add-sources-overlay-out' : 'add-sources-overlay-in'}`}>
      <div className={`relative flex max-h-[min(780px,calc(100vh-32px))] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[#d0d0ca] bg-[#f4f4f1] shadow-[0_18px_45px_rgba(15,23,42,0.14),0_50px_120px_rgba(15,23,42,0.22),0_0_0_1px_rgba(255,255,255,0.72)] ${isClosing ? 'add-sources-panel-out' : 'add-sources-panel-in'}`}>
        <button
          type="button"
          onClick={handleRequestClose}
          className="absolute right-4 top-4 z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#5f6368] transition hover:bg-white/70 hover:text-[#202124]"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-hidden max-sm:grid-cols-1">
          <div className="border-r border-[#dcdbd6] bg-[#f4f4f1] p-5 max-sm:border-b max-sm:border-r-0">
            <div className="mb-5 pr-6">
              <h2 className="text-xl font-semibold leading-7 text-[#202124]">Add sources</h2>
              <p className="mt-2 text-sm leading-6 text-[#70757a]">
                Bring materials into this workbench for agents to read, compare and reason over.
              </p>
            </div>
            <div className="space-y-2">
              {modeItems.map((item) => {
                const Icon = item.icon;
                const isActive = mode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMode(item.id)}
                    className={`flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3.5 text-left transition ${
                      isActive
                        ? 'border-[#d9d8d2] bg-[#ebeae6] text-[#202124] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_8px_22px_rgba(15,23,42,0.06)]'
                        : 'border-transparent text-[#4b4f55] hover:border-[#deddd8] hover:bg-[#efefec]'
                    }`}
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      isActive ? 'bg-white/70 text-[#202124]' : 'bg-[#ebeae6] text-[#777b80]'
                    }`}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block whitespace-nowrap text-sm font-semibold leading-5">{item.label}</span>
                      <span className="mt-1.5 block text-xs leading-5 text-[#858a91]">{item.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex min-h-0 items-center overflow-y-auto bg-[#f4f4f1] p-6 pr-14">
            <div className="w-full">
              {submitError && (
                <div className="mb-4 rounded-xl border border-[#f0d5d0] bg-[#fff7f5] px-3 py-2 text-sm leading-6 text-[#9a3f32]">
                  {submitError}
                </div>
              )}

              {mode === 'discover' && (
                <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#34373c]">Search topic</label>
                  <div className={`flex min-h-11 items-center gap-2 rounded-xl px-3 ${fieldShellClass}`}>
                    <Search className="h-4 w-4 shrink-0 text-[#777b80]" />
                    <input
                      value={discoveryQuery}
                      onChange={(event) => setDiscoveryQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void handleDiscover();
                      }}
                      className="min-w-0 flex-1 bg-transparent text-sm text-[#202124] outline-none placeholder:text-[#9b9da1]"
                      placeholder="e.g. transformer attention visual explanation, database indexing lecture notes"
                    />
                    <button
                      type="button"
                      onClick={() => void handleDiscover()}
                      disabled={isDiscovering || !discoveryQuery.trim()}
                      className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg bg-[#202124] px-3 text-xs font-medium text-white transition hover:bg-[#34373c] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {isDiscovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                      Search
                    </button>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#8b8f94]">
                    Powered by the configured Exa or Tavily key on the backend.
                  </p>
                </div>

                {discoveryError && (
                  <div className="rounded-xl border border-[#f0d5d0] bg-[#fff7f5] px-3 py-2 text-sm text-[#9a3f32]">
                    {discoveryError}
                  </div>
                )}

                {discoveredSources.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-[#34373c]">
                        {selectedSources.length} selected from {discoveredSources.length} results
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleImportDiscovered()}
                        disabled={isSubmitting || selectedSources.length === 0}
                        className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-[#34373c] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                        Import selected
                      </button>
                    </div>

                    <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
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
                                ? 'border-[#c8d6cc] bg-[#eef6f0]'
                                : 'border-[#d9d8d2] bg-[#efefec] hover:border-[#c8c7c1] hover:bg-white/70'
                            }`}
                          >
                            <span className="flex items-start gap-3">
                              <span
                                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                                  selected ? 'border-[#6b8f73] bg-[#6b8f73] text-white' : 'border-[#d8dadf] bg-white text-transparent'
                                }`}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold leading-5 text-[#202124]">
                                  {source.title}
                                </span>
                                <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-[#70757a]">
                                  <span className="shrink-0 rounded-md bg-[#f0efea] px-1.5 py-0.5 uppercase tracking-wide text-[#666b72]">
                                    {source.provider}
                                  </span>
                                  <span className="truncate">{source.source || source.author || new URL(source.url).hostname.replace(/^www\./, '')}</span>
                                  {source.publishedAt && <span className="shrink-0">{source.publishedAt.slice(0, 10)}</span>}
                                </span>
                                <span className="mt-2 block text-sm leading-6 text-[#5f6368]">
                                  {source.summary || source.snippet}
                                </span>
                                <span className="mt-2 flex items-center gap-1 text-xs text-[#6b7280]">
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
                <div
                className={`flex min-h-[320px] flex-col items-center justify-center rounded-2xl border-dashed px-6 py-8 text-center hover:border-[#b9bcc2] hover:bg-white/70 ${fieldShellClass}`}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void handleFiles(Array.from(event.target.files || []));
                    event.currentTarget.value = '';
                  }}
                />
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#d9d8d2] bg-white/70 text-[#3f4247]">
                  <FileUp className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-[#202124]">Upload local files</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-[#70757a]">
                  Drag files here or choose them from your computer. They will be added to the selected folder.
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSubmitting}
                  className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-[#202124] px-4 text-sm font-medium text-white transition hover:bg-[#34373c] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                  Choose files
                </button>
                </div>
              )}

              {mode === 'website' && (
                <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#34373c]">Website or video URL</label>
                  <div className={`flex h-11 items-center gap-2 rounded-xl px-3 ${fieldShellClass}`}>
                    <Link2 className="h-4 w-4 shrink-0 text-[#777b80]" />
                    <input
                      value={websiteUrl}
                      onChange={(event) => setWebsiteUrl(event.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-sm text-[#202124] outline-none placeholder:text-[#9b9da1]"
                      placeholder="https://example.com/article or YouTube link"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#34373c]">Title</label>
                  <input
                    value={websiteTitle}
                    onChange={(event) => setWebsiteTitle(event.target.value)}
                    className={`h-11 w-full rounded-xl px-3 text-sm text-[#202124] outline-none ${textFieldClass}`}
                    placeholder="Optional, generated from the URL if empty"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleWebsiteSubmit()}
                  disabled={isSubmitting || !websiteUrl.trim()}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#202124] px-4 text-sm font-medium text-white transition hover:bg-[#34373c] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Add website
                </button>
                </div>
              )}

              {mode === 'text' && (
                <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#34373c]">Title</label>
                  <input
                    value={textTitle}
                    onChange={(event) => setTextTitle(event.target.value)}
                    className={`h-11 w-full rounded-xl px-3 text-sm text-[#202124] outline-none ${textFieldClass}`}
                    placeholder="pasted-source"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#34373c]">Text</label>
                  <textarea
                    value={textContent}
                    onChange={(event) => setTextContent(event.target.value)}
                    className={`min-h-[260px] w-full resize-y rounded-xl px-3 py-3 text-sm leading-6 text-[#202124] outline-none ${textFieldClass}`}
                    placeholder="Paste source text here..."
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleTextSubmit()}
                  disabled={isSubmitting || !textContent.trim()}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#202124] px-4 text-sm font-medium text-white transition hover:bg-[#34373c] disabled:cursor-not-allowed disabled:opacity-45"
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
