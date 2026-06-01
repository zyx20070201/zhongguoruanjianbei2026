import { Check, ChevronDown, ChevronRight, Copy, Edit3 } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';

export interface OpenWebUICitationSource {
  sourceId: string;
  confidence?: 'high' | 'medium' | 'low';
  fileId: string;
  fileName: string;
  label: string;
  locator?: Record<string, any>;
  preview?: string;
}

interface Props {
  content: string;
  emptyMessage?: string;
  isStreaming?: boolean;
  fileId?: string;
  citationSources?: OpenWebUICitationSource[];
  onCitationJump?: (source: OpenWebUICitationSource) => void;
}

const rendererOptions = {
  breaks: true,
  gfm: true
};

const tokenText = (token: any) => String(token?.raw ?? token?.text ?? '');

const getDomain = (url: string) => {
  const domain = url.replace('http://', '').replace('https://', '').split(/[/?#]/)[0];
  return domain.startsWith('www.') ? domain.slice(4) : domain;
};

const formattedTitle = (title: string) => title.startsWith('http') ? getDomain(title) : title;

const getDisplayTitle = (title: string) => {
  if (!title) return 'N/A';
  if (title.length > 30) return `${title.slice(0, 15)}...${title.slice(-10)}`;
  return title;
};

const sourceForMarker = (marker: string, sourceById: Map<string, OpenWebUICitationSource>) => {
  const normalized = marker.replace(/^[SF]/, '');
  return sourceById.get(marker) || sourceById.get(normalized) || sourceById.get(`S${normalized}`) || sourceById.get(`F${normalized}`);
};

const renderTextWithSources = (
  value: string,
  keyPrefix: string,
  sourceById: Map<string, OpenWebUICitationSource>,
  onCitationJump?: (source: OpenWebUICitationSource) => void
): ReactNode[] => {
  const parts: ReactNode[] = [];
  const pattern = /\[((?:S|F)?\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`${keyPrefix}-text-${lastIndex}`}>{value.slice(lastIndex, match.index)}</span>);
    }

    const marker = match[1];
    const source = sourceForMarker(marker, sourceById);
    if (!source) {
      parts.push(<span key={`${keyPrefix}-missing-${match.index}`}>[{marker}]</span>);
    } else {
      const title = getDisplayTitle(formattedTitle(source.fileName || source.label || source.sourceId));
      parts.push(
        <button
          key={`${keyPrefix}-source-${match.index}`}
          type="button"
          aria-label={`View source: ${formattedTitle(source.fileName || source.label || source.sourceId)}`}
          onClick={() => onCitationJump?.(source)}
          className="inline-flex w-fit translate-y-[2px] rounded-xl bg-gray-50 px-2 py-0.5 text-[10px] text-black/80 transition hover:text-black"
        >
          <span className="line-clamp-1">{title}</span>
        </button>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    parts.push(<span key={`${keyPrefix}-text-${lastIndex}`}>{value.slice(lastIndex)}</span>);
  }

  return parts.length ? parts : [<span key={`${keyPrefix}-text`}>{value}</span>];
};

const renderInlineTokens = (
  tokens: any[] = [],
  sourceById: Map<string, OpenWebUICitationSource>,
  onCitationJump?: (source: OpenWebUICitationSource) => void
): ReactNode[] => {
  return tokens.map((token, index) => {
    if (token.type === 'escape' || token.type === 'text') {
      return <span key={index}>{renderTextWithSources(tokenText(token), String(index), sourceById, onCitationJump)}</span>;
    }
    if (token.type === 'strong') {
      return <strong key={index}>{renderInlineTokens(token.tokens, sourceById, onCitationJump)}</strong>;
    }
    if (token.type === 'em') {
      return <em key={index}>{renderInlineTokens(token.tokens, sourceById, onCitationJump)}</em>;
    }
    if (token.type === 'del') {
      return <del key={index}>{renderInlineTokens(token.tokens, sourceById, onCitationJump)}</del>;
    }
    if (token.type === 'codespan') {
      return (
        <code key={index} className="codespan cursor-pointer rounded-md bg-gray-100 px-1 py-0.5 font-mono text-[0.875em] text-gray-900">
          {String(token.text ?? '')}
        </code>
      );
    }
    if (token.type === 'br') return <br key={index} />;
    if (token.type === 'link') {
      return (
        <a key={index} href={token.href} target="_blank" rel="nofollow" title={token.title || undefined}>
          {token.tokens?.length ? renderInlineTokens(token.tokens, sourceById, onCitationJump) : token.text}
        </a>
      );
    }
    if (token.type === 'image') {
      return <img key={index} src={token.href} alt={token.text || ''} className="my-2 max-h-96 rounded-lg" />;
    }

    const markers = Array.from(tokenText(token).matchAll(/\[((?:S|F)?\d+)\]/g)).map((match) => match[1]);
    if (markers.length) {
      return markers.map((marker, markerIndex) => {
        const source = sourceForMarker(marker, sourceById);
        if (!source) return <span key={`${index}-${markerIndex}`}>[{marker}]</span>;
        const title = getDisplayTitle(formattedTitle(source.fileName || source.label || source.sourceId));
        return (
          <button
            key={`${index}-${markerIndex}`}
            type="button"
            onClick={() => onCitationJump?.(source)}
            className="inline-flex w-fit translate-y-[2px] rounded-xl bg-gray-50 px-2 py-0.5 text-[10px] text-black/80 transition hover:text-black"
          >
            <span className="line-clamp-1">{title}</span>
          </button>
        );
      });
    }

    return <span key={index}>{tokenText(token)}</span>;
  });
};

function CodeBlock({ code, lang, blockIndex, highlighted }: { code: string; lang?: string; blockIndex: number; highlighted: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(code);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!editing) setValue(code);
  }, [code, editing]);

  const copyCode = async () => {
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div data-md-block={blockIndex} className={`group overflow-hidden rounded-xl border border-gray-100 bg-gray-50 ${highlighted ? 'ring-1 ring-[#d3a900]/30' : ''}`}>
      <div className="flex items-center justify-between gap-2 border-b border-black/5 px-3 py-2">
        <button type="button" onClick={() => setCollapsed((current) => !current)} className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-[#6f7277] hover:text-[#25272b]">
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <span className="truncate">{lang || 'Code'}</span>
        </button>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button type="button" onClick={() => setEditing((current) => !current)} className="rounded-md p-1.5 text-[#6f7277] hover:bg-black/5 hover:text-[#25272b]" title={editing ? 'Preview code' : 'Edit code'}>
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => void copyCode()} className="rounded-md p-1.5 text-[#6f7277] hover:bg-black/5 hover:text-[#25272b]" title="Copy code">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {!collapsed && (editing ? (
        <textarea value={value} onChange={(event) => setValue(event.target.value)} className="block min-h-[160px] w-full resize-y border-0 bg-transparent p-3 font-mono text-xs leading-5 text-gray-900 outline-none" spellCheck={false} />
      ) : (
        <pre className="overflow-x-auto p-3 font-mono text-xs leading-5 text-gray-900"><code>{value}</code></pre>
      ))}
    </div>
  );
}

export default function OpenWebUIMarkdownPreview({
  content,
  emptyMessage = 'Nothing to preview yet.',
  isStreaming,
  fileId,
  citationSources = [],
  onCitationJump
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [highlightedBlock, setHighlightedBlock] = useState<number | null>(null);
  const sourceById = useMemo(() => {
    const map = new Map<string, OpenWebUICitationSource>();
    citationSources.forEach((source, index) => {
      const normalized = String(source.sourceId || index + 1).replace(/^[SF]/, '');
      map.set(source.sourceId, source);
      map.set(normalized, source);
      map.set(`S${normalized}`, source);
      map.set(`F${normalized}`, source);
    });
    return map;
  }, [citationSources]);
  const tokens = useMemo(() => marked.lexer(content || '', rendererOptions), [content]);

  useEffect(() => {
    const handleJump = (event: Event) => {
      const detail = (event as CustomEvent).detail as { fileId?: string; locator?: Record<string, any> } | undefined;
      if (!fileId || !detail?.fileId || detail.fileId !== fileId) return;
      const targetIndex = typeof detail.locator?.chunkIndex === 'number' ? detail.locator.chunkIndex : 0;
      const target = containerRef.current?.querySelector<HTMLElement>(`[data-md-block="${targetIndex}"]`);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedBlock(targetIndex);
      window.setTimeout(() => setHighlightedBlock(null), 2600);
    };

    window.addEventListener('workbench:jump-to-citation', handleJump);
    return () => window.removeEventListener('workbench:jump-to-citation', handleJump);
  }, [fileId]);

  if (!content.trim() && !isStreaming) {
    return <div className="flex h-full items-center justify-center px-6 text-sm text-[var(--wb-text-muted)]">{emptyMessage}</div>;
  }

  const renderTokens = (items: any[] = [], top = true): ReactNode[] => {
    return items.map((token, index) => {
      const key = `${token.type}-${index}`;
      const blockIndex = index;
      const highlight = highlightedBlock === blockIndex ? 'rounded bg-[#f5d36b]/35 ring-1 ring-[#d3a900]/30' : '';

      if (token.type === 'space') return <div key={key} className="my-2" />;
      if (token.type === 'hr') return <hr key={key} className="border-gray-100/30" />;
      if (token.type === 'heading') {
        const children = renderInlineTokens(token.tokens, sourceById, onCitationJump);
        if (token.depth === 1) return <h1 key={key} dir="auto" data-md-block={blockIndex} className={highlight}>{children}</h1>;
        if (token.depth === 2) return <h2 key={key} dir="auto" data-md-block={blockIndex} className={highlight}>{children}</h2>;
        if (token.depth === 3) return <h3 key={key} dir="auto" data-md-block={blockIndex} className={highlight}>{children}</h3>;
        if (token.depth === 4) return <h4 key={key} dir="auto" data-md-block={blockIndex} className={highlight}>{children}</h4>;
        if (token.depth === 5) return <h5 key={key} dir="auto" data-md-block={blockIndex} className={highlight}>{children}</h5>;
        return <h6 key={key} dir="auto" data-md-block={blockIndex} className={highlight}>{children}</h6>;
      }
      if (token.type === 'paragraph') {
        return <p key={key} dir="auto" data-md-block={blockIndex} className={highlight}>{renderInlineTokens(token.tokens, sourceById, onCitationJump)}</p>;
      }
      if (token.type === 'text') {
        return top ? <p key={key} data-md-block={blockIndex} className={highlight}>{token.tokens ? renderInlineTokens(token.tokens, sourceById, onCitationJump) : token.text}</p> : <span key={key}>{token.tokens ? renderInlineTokens(token.tokens, sourceById, onCitationJump) : token.text}</span>;
      }
      if (token.type === 'code') {
        return <CodeBlock key={key} code={token.text || ''} lang={token.lang || ''} blockIndex={blockIndex} highlighted={highlightedBlock === blockIndex} />;
      }
      if (token.type === 'blockquote') {
        return <blockquote key={key} dir="auto" data-md-block={blockIndex} className={highlight}>{renderTokens(token.tokens, false)}</blockquote>;
      }
      if (token.type === 'list') {
        const ListTag = token.ordered ? 'ol' : 'ul';
        return (
          <ListTag key={key} start={token.start || 1} dir="auto" data-md-block={blockIndex} className={highlight}>
            {(token.items || []).map((item: any, itemIndex: number) => (
              <li key={itemIndex} className="text-start">
                {renderTokens(item.tokens, false)}
              </li>
            ))}
          </ListTag>
        );
      }
      if (token.type === 'table') {
        return (
          <div key={key} className="relative mb-2 w-full group" data-md-block={blockIndex}>
            <div className="scrollbar-hidden relative max-w-full overflow-x-auto">
              <table className="w-full max-w-full rounded-xl text-start text-sm text-gray-500">
                <thead className="border-none bg-white text-xs uppercase text-gray-700">
                  <tr>{(token.header || []).map((cell: any, cellIndex: number) => <th key={cellIndex} className="cursor-pointer border-b border-gray-100 px-2.5 py-2 text-start">{renderInlineTokens(cell.tokens, sourceById, onCitationJump)}</th>)}</tr>
                </thead>
                <tbody>{(token.rows || []).map((row: any[], rowIndex: number) => <tr key={rowIndex} className="bg-white text-xs">{row.map((cell, cellIndex) => <td key={cellIndex} className="w-max border-b border-gray-50 px-3 py-2 text-gray-900">{renderInlineTokens(cell.tokens, sourceById, onCitationJump)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
        );
      }
      if (token.type === 'html') {
        return <span key={key}>{token.text}</span>;
      }
      return null;
    });
  };

  return (
    <div ref={containerRef} className="openwebui-markdown markdown-prose w-full min-w-full">
      {renderTokens(tokens)}
      {!content && isStreaming ? <span className="text-sm text-inherit">...</span> : null}
    </div>
  );
}
