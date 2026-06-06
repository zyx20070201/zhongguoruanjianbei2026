import { Check, ChevronDown, ChevronRight, Copy, Edit3 } from 'lucide-react';
import { Fragment, ReactNode, UIEvent, useEffect, useMemo, useRef, useState } from 'react';

export interface MarkdownCitationSource {
  sourceId: string;
  confidence?: 'high' | 'medium' | 'low';
  fileId: string;
  fileName: string;
  label: string;
  locator?: Record<string, any>;
  preview?: string;
}

interface MarkdownPreviewProps {
  content: string;
  emptyMessage?: string;
  variant?: 'document' | 'message';
  onViewportChange?: (patch: Record<string, any>) => void;
  fileId?: string;
  citationSources?: MarkdownCitationSource[];
  onCitationJump?: (source: MarkdownCitationSource) => void;
  isStreaming?: boolean;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderInline = (
  line: string,
  isMessage = false,
  citationSources?: Map<string, MarkdownCitationSource>,
  onCitationJump?: (source: MarkdownCitationSource) => void
): ReactNode[] => {
  const parts = line
    .split(/(\[[^\]]+\]\([^)]+\)|(?:\[(?:S\d+|\d+)\]\s*)+|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g)
    .filter(Boolean);

  return parts.map((part, index) => {
    const markers = Array.from(part.matchAll(/\[(S\d+|\d+)\]/g)).map((match) => match[1]);
    if (markers.length > 0 && part.replace(/\[(?:S\d+|\d+)\]/g, '').trim() === '') {
      const sources = markers
        .map((marker) => {
          const sourceId = marker.startsWith('S') ? marker : `S${marker}`;
          return citationSources?.get(sourceId);
        })
        .filter((source): source is MarkdownCitationSource => Boolean(source));
      const source = sources[0];
      if (!source) return <Fragment key={index}>{part}</Fragment>;
      const distinctFiles = Array.from(new Set(sources.map((item) => item.fileName || item.label).filter(Boolean)));
      const label =
        markers.length > 1
          ? distinctFiles.length === 1
            ? `${markers.join(', ')}`
            : `${markers[0]} +${markers.length - 1}`
          : markers[0];
      const title =
        sources.length > 1
          ? sources.map((item, sourceIndex) => `[${markers[sourceIndex]}] ${item.label || item.fileName}`).join('\n')
          : source.label || source.fileName;

      return (
        <span key={`${markers.join('-')}-${index}`} className="relative inline-flex align-baseline">
          <button
            type="button"
            onClick={() => onCitationJump?.(source)}
            className="mx-0.5 inline-flex items-center rounded-full border border-[#dfe5dc] bg-[#f7fbf6] px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-4 text-[#4f6f49] transition-colors hover:border-[#b8d8b1] hover:bg-[#eef8eb] hover:text-[#1f5f2f]"
            title={title}
          >
            {label}
          </button>
        </span>
      );
    }

    if (/^`[^`]+`$/.test(part)) {
      return (
        <code
          key={index}
          className={
            isMessage
              ? 'rounded-md bg-gray-100 px-1 py-0.5 font-mono text-[0.875em] text-gray-900'
              : 'rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.92em] text-[#25272b]'
          }
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    if (/^\*[^*]+\*$/.test(part)) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={index}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--wb-accent)] underline decoration-[rgba(90,166,255,0.4)] underline-offset-4"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <Fragment key={index}>{part}</Fragment>;
  });
};

function CodeBlock({
  code,
  isMessage,
  highlighted,
  blockIndex
}: {
  code: string;
  isMessage: boolean;
  highlighted: boolean;
  blockIndex: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(code);
  const [copied, setCopied] = useState(false);
  const lineCount = value.split('\n').length;

  useEffect(() => {
    if (!editing) setValue(code);
  }, [code, editing]);

  const copyCode = async () => {
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      data-md-block={blockIndex}
      className={`group overflow-hidden rounded-xl border ${
        isMessage ? 'border-gray-100 bg-gray-50' : 'border-[#eeeeeb] bg-white'
      } ${highlighted ? 'ring-1 ring-[#d3a900]/30' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-black/5 px-3 py-2">
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-[#6f7277] hover:text-[#25272b]"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <span className="truncate">Code</span>
          <span className="text-[#a0a3a7]">{lineCount} lines</span>
        </button>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => setEditing((current) => !current)}
            className="rounded-md p-1.5 text-[#6f7277] hover:bg-black/5 hover:text-[#25272b]"
            title={editing ? 'Preview code' : 'Edit code'}
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void copyCode()}
            className="rounded-md p-1.5 text-[#6f7277] hover:bg-black/5 hover:text-[#25272b]"
            title="Copy code"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {!collapsed && (
        editing ? (
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={`block min-h-[160px] w-full resize-y border-0 bg-transparent p-3 font-mono text-xs leading-5 outline-none ${isMessage ? 'text-gray-900' : 'text-[#25272b]'}`}
            spellCheck={false}
          />
        ) : (
          <pre className={`${isMessage ? 'text-gray-900' : 'text-[#25272b]'} overflow-x-auto p-3 font-mono text-xs leading-5`}>
            <code dangerouslySetInnerHTML={{ __html: escapeHtml(value) }} />
          </pre>
        )
      )}
    </div>
  );
}

export default function MarkdownPreview({
  content,
  emptyMessage = 'Nothing to preview yet.',
  variant = 'document',
  onViewportChange,
  fileId,
  citationSources = [],
  onCitationJump,
  isStreaming
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [highlightedBlock, setHighlightedBlock] = useState<number | null>(null);
  const citationSourceById = useMemo(
    () => new Map(citationSources.map((source) => [source.sourceId, source])),
    [citationSources]
  );
  const isMessage = variant === 'message';

  useEffect(() => {
    const handleJump = (event: Event) => {
      const detail = (event as CustomEvent).detail as { fileId?: string; locator?: Record<string, any> } | undefined;
      if (!fileId || !detail?.fileId || detail.fileId !== fileId) return;
      const chunkIndex = typeof detail.locator?.chunkIndex === 'number' ? detail.locator.chunkIndex : undefined;
      const targetIndex =
        typeof chunkIndex === 'number'
          ? chunkIndex
          : typeof detail.locator?.lineStart === 'number'
            ? Math.max(0, Math.floor(detail.locator.lineStart / 8))
            : 0;
      const target = containerRef.current?.querySelector<HTMLElement>(`[data-md-block="${targetIndex}"]`);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedBlock(targetIndex);
      window.setTimeout(() => setHighlightedBlock(null), 2600);
    };

    window.addEventListener('workbench:jump-to-citation', handleJump);
    return () => window.removeEventListener('workbench:jump-to-citation', handleJump);
  }, [fileId]);

  if (!content.trim() && !(isStreaming && isMessage)) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-[var(--wb-text-muted)]">
        {emptyMessage}
      </div>
    );
  }

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let orderedListItems: string[] = [];
  let codeFence: string[] = [];
  let inCodeFence = false;
  const highlightClass = (index: number) =>
    highlightedBlock === index ? 'rounded bg-[#f5d36b]/35 ring-1 ring-[#d3a900]/30' : '';
  const reportViewport = (event: UIEvent<HTMLDivElement>) => {
    if (!onViewportChange || isMessage) return;
    const element = event.currentTarget;
    const totalScrollable = Math.max(1, element.scrollHeight - element.clientHeight);
    const scrollRatio = Math.min(1, Math.max(0, element.scrollTop / totalScrollable));
    onViewportChange({
      scrollRatio,
      approxChunkIndex: Math.max(0, Math.round(scrollRatio * Math.max(0, blocks.length - 1))),
      selectedText: window.getSelection()?.toString().trim() || ''
    });
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p
        data-md-block={blocks.length}
        key={`p-${blocks.length}`}
        className={`${isMessage ? 'text-[15px] font-normal leading-7 text-gray-900' : 'text-sm leading-7 text-[var(--wb-text-muted)]'} ${highlightClass(blocks.length)}`}
      >
        {renderInline(paragraph.join(' '), isMessage, citationSourceById, onCitationJump)}
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul
        data-md-block={blocks.length}
        key={`ul-${blocks.length}`}
        className={`${isMessage ? 'list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-gray-900' : 'list-disc space-y-2 pl-6 text-sm leading-7 text-[var(--wb-text-muted)]'} ${highlightClass(blocks.length)}`}
      >
        {listItems.map((item, index) => (
          <li key={index}>{renderInline(item, isMessage, citationSourceById, onCitationJump)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const flushOrderedList = () => {
    if (orderedListItems.length === 0) return;
    blocks.push(
      <ol
        data-md-block={blocks.length}
        key={`ol-${blocks.length}`}
        className={`${isMessage ? 'list-decimal space-y-2 pl-5 text-[15px] leading-7 text-gray-900' : 'list-decimal space-y-2 pl-6 text-sm leading-7 text-[var(--wb-text-muted)]'} ${highlightClass(blocks.length)}`}
      >
        {orderedListItems.map((item, index) => (
          <li key={index}>{renderInline(item, isMessage, citationSourceById, onCitationJump)}</li>
        ))}
      </ol>
    );
    orderedListItems = [];
  };

  const flushCodeFence = () => {
    if (codeFence.length === 0 && !inCodeFence) return;
    const blockIndex = blocks.length;
    blocks.push(
      <CodeBlock
        key={`pre-${blockIndex}`}
        code={codeFence.join('\n')}
        isMessage={isMessage}
        highlighted={highlightedBlock === blockIndex}
        blockIndex={blockIndex}
      />
    );
    codeFence = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
      flushOrderedList();
      if (inCodeFence) {
        inCodeFence = false;
        flushCodeFence();
      } else {
        inCodeFence = true;
      }
      continue;
    }

    if (inCodeFence) {
      codeFence.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushOrderedList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushOrderedList();
      const level = headingMatch[1].length;
      const className =
        isMessage
          ? level === 1
            ? 'mb-2 mt-7 text-[2rem] font-bold leading-tight tracking-normal text-gray-900 first:mt-0'
            : level === 2
              ? 'mb-2 mt-6 text-2xl font-bold leading-snug tracking-normal text-gray-900 first:mt-0'
              : level === 3
                ? 'mb-1.5 mt-5 text-xl font-semibold leading-snug tracking-normal text-gray-900 first:mt-0'
                : 'mb-1 mt-4 text-base font-semibold leading-snug tracking-normal text-gray-900 first:mt-0'
          : level === 1
          ? 'text-3xl font-semibold text-[var(--wb-text)]'
          : level === 2
            ? 'text-2xl font-semibold text-[var(--wb-text)]'
            : 'text-lg font-semibold text-[var(--wb-text)]';
      blocks.push(
        <div key={`h-${blocks.length}`} data-md-block={blocks.length} className={`${className} ${highlightClass(blocks.length)}`}>
          {renderInline(headingMatch[2], isMessage, citationSourceById, onCitationJump)}
        </div>
      );
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      flushList();
      orderedListItems.push(orderedMatch[1]);
      continue;
    }

    if (/^\s*(-|\*)\s+/.test(line)) {
      flushParagraph();
      flushOrderedList();
      listItems.push(line.replace(/^\s*(-|\*)\s+/, ''));
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      flushOrderedList();
      blocks.push(
        <blockquote
          key={`blockquote-${blocks.length}`}
          className={isMessage ? 'border-l-2 border-gray-200 pl-4 text-[15px] font-normal leading-7 text-gray-900' : 'border-l-2 border-[rgba(90,166,255,0.5)] pl-4 text-sm italic leading-7 text-[var(--wb-text-muted)]'}
        >
          {renderInline(line.replace(/^>\s?/, ''), isMessage, citationSourceById, onCitationJump)}
        </blockquote>
      );
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushParagraph();
      flushList();
      flushOrderedList();
      blocks.push(<hr key={`hr-${blocks.length}`} className={isMessage ? 'my-4 border-gray-100' : 'border-[var(--wb-border)]'} />);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushOrderedList();
  flushCodeFence();

  return (
    <div
      ref={containerRef}
      className={
        isMessage
          ? 'openwebui-markdown flex flex-col gap-3 text-gray-900'
          : 'h-full overflow-auto bg-white p-6'
      }
      onScroll={reportViewport}
      onMouseEnter={reportViewport}
      onMouseUp={reportViewport}
    >
      <div className={isMessage ? 'flex flex-col gap-3 text-gray-900' : 'flex flex-col gap-5'}>
        {blocks}
        {!content && isStreaming ? <span className="text-sm text-inherit">...</span> : null}
      </div>
    </div>
  );
}
