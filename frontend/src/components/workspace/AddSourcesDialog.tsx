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
    setIsSubmitting(false);
    setSubmitError(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onUploadFiles(files);
      onClose();
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
      onClose();
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
      onClose();
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
      onClose();
    } catch (error: any) {
      setSubmitError(error?.response?.data?.error || error?.message || 'Failed to add text source');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 px-4 py-6 backdrop-blur-[2px]">
      <div className="flex max-h-[min(780px,calc(100vh-32px))] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#e4e4df] bg-white shadow-[0_28px_90px_rgba(15,23,42,0.22)]">
        <div className="flex items-start justify-between border-b border-[#eeeeeb] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[#202124]">Add sources</h2>
            <p className="mt-1 text-sm text-[#70757a]">Bring materials into this workbench for agents to read, compare and reason over.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#5f6368] transition hover:bg-[#f1f1ef] hover:text-[#202124]"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] overflow-hidden max-sm:grid-cols-1">
          <div className="border-r border-[#eeeeeb] bg-[#fafafa] p-3 max-sm:border-b max-sm:border-r-0">
            <div className="space-y-1">
              {modeItems.map((item) => {
                const Icon = item.icon;
                const isActive = mode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMode(item.id)}
                    className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition ${
                      isActive ? 'bg-white text-[#202124] shadow-[0_1px_4px_rgba(15,23,42,0.08)]' : 'text-[#4b4f55] hover:bg-white/70'
                    }`}
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${isActive ? 'text-[#202124]' : 'text-[#777b80]'}`} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{item.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-[#8b8f94]">{item.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-5">
            {submitError && (
              <div className="mb-4 rounded-xl border border-[#f0d5d0] bg-[#fff7f5] px-3 py-2 text-sm leading-6 text-[#9a3f32]">
                {submitError}
              </div>
            )}

            {mode === 'discover' && (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#34373c]">Search topic</label>
                  <div className="flex min-h-11 items-center gap-2 rounded-xl border border-[#deded9] bg-white px-3 focus-within:border-[#b8babf]">
                    <Search className="h-4 w-4 shrink-0 text-[#777b80]" />
                    <input
                      value={discoveryQuery}
                      onChange={(event) => setDiscoveryQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void handleDiscover();
                      }}
                      className="min-w-0 flex-1 bg-transparent text-sm text-[#202124] outline-none placeholder:text-[#a8aaad]"
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
                                ? 'border-[#c8d6cc] bg-[#f4faf6]'
                                : 'border-[#e7e6e1] bg-white hover:border-[#d9d8d2] hover:bg-[#fbfbfa]'
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
                className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#d8dadf] bg-[#fbfbfa] px-6 py-8 text-center transition hover:border-[#b9bcc2] hover:bg-white"
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
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#e4e4df] bg-white text-[#3f4247]">
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
                  <div className="flex h-11 items-center gap-2 rounded-xl border border-[#deded9] bg-white px-3 focus-within:border-[#b8babf]">
                    <Link2 className="h-4 w-4 shrink-0 text-[#777b80]" />
                    <input
                      value={websiteUrl}
                      onChange={(event) => setWebsiteUrl(event.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-sm text-[#202124] outline-none placeholder:text-[#a8aaad]"
                      placeholder="https://example.com/article or YouTube link"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#34373c]">Title</label>
                  <input
                    value={websiteTitle}
                    onChange={(event) => setWebsiteTitle(event.target.value)}
                    className="h-11 w-full rounded-xl border border-[#deded9] bg-white px-3 text-sm text-[#202124] outline-none transition placeholder:text-[#a8aaad] focus:border-[#b8babf]"
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
                    className="h-11 w-full rounded-xl border border-[#deded9] bg-white px-3 text-sm text-[#202124] outline-none transition placeholder:text-[#a8aaad] focus:border-[#b8babf]"
                    placeholder="pasted-source"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#34373c]">Text</label>
                  <textarea
                    value={textContent}
                    onChange={(event) => setTextContent(event.target.value)}
                    className="min-h-[260px] w-full resize-y rounded-xl border border-[#deded9] bg-white px-3 py-3 text-sm leading-6 text-[#202124] outline-none transition placeholder:text-[#a8aaad] focus:border-[#b8babf]"
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
  );
};
