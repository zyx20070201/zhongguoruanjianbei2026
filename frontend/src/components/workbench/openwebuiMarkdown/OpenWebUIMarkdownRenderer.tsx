import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  CircleArrowRight,
  Copy,
  Download,
  Info,
  Lightbulb,
  Sparkles,
  Star,
  Zap
} from 'lucide-react';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { decode } from 'html-entities';
import katex from 'katex';
import DOMPurify from 'dompurify';
import OpenWebUICodeBlock from './OpenWebUICodeBlock';
import { createOpenWebUIMarked } from './markedExtensions';

export interface OpenWebUICitationSource {
  sourceId: string;
  confidence?: 'high' | 'medium' | 'low';
  fileId: string;
  fileName: string;
  label: string;
  locator?: Record<string, any>;
  preview?: string;
}

interface OpenWebUIMarkdownRendererProps {
  content: string;
  emptyMessage?: string;
  isStreaming?: boolean;
  fileId?: string;
  citationSources?: OpenWebUICitationSource[];
  onCitationJump?: (source: OpenWebUICitationSource) => void;
  onLinkPreview?: (link: { href: string; title?: string; text?: string }) => void;
}

const marked = createOpenWebUIMarked();

const tokenText = (token: any) => String(token?.raw ?? token?.text ?? '');

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isChineseChar = (value: string) => /\p{Script=Han}/u.test(value);

const replaceOutsideCode = (content: string, replacer: (segment: string) => string) =>
  content
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[\s\S]*?`)/)
    .map((segment) => (segment.startsWith('```') || segment.startsWith('~~~') || segment.startsWith('`') ? segment : replacer(segment)))
    .join('');

const processChineseDelimiters = (
  line: string,
  symbol: string,
  leftSymbol: string,
  rightSymbol: string
) => {
  const escapedSymbol = escapeRegExp(symbol);
  const regex = new RegExp(
    `(.?)(?<!${escapedSymbol})(${escapedSymbol})([^${escapedSymbol}]+)(${escapedSymbol})(?!${escapedSymbol})(.)`,
    'g'
  );
  return line.replace(regex, (match, leftChar, left, content, right, rightChar) => {
    const needsSpacing =
      (content.startsWith(leftSymbol) && leftChar && isChineseChar(leftChar[leftChar.length - 1])) ||
      (content.endsWith(rightSymbol) && rightChar && isChineseChar(rightChar[0]));

    return needsSpacing ? `${leftChar} ${left}${content}${right} ${rightChar}` : match;
  });
};

const processChineseContent = (content: string) => {
  if (!/[\u4e00-\u9fa5]/.test(content)) return content;

  return content.split('\n').map((line) => {
    if (!/[\u4e00-\u9fa5]/.test(line) || !line.includes('*')) return line;
    let nextLine = line;
    if (/（|）/.test(nextLine)) {
      nextLine = processChineseDelimiters(nextLine, '**', '（', '）');
      nextLine = processChineseDelimiters(nextLine, '*', '（', '）');
    }
    if (/“|”/.test(nextLine)) {
      nextLine = processChineseDelimiters(nextLine, '**', '“', '”');
      nextLine = processChineseDelimiters(nextLine, '*', '“', '”');
    }
    return nextLine;
  }).join('\n');
};

const replaceOpenWebUITokens = (content: string) => {
  if (!content.includes('{{')) return content;

  return replaceOutsideCode(content, (segment) =>
    segment
      .replace(/{{char}}/gi, 'Assistant')
      .replace(/{{user}}/gi, 'User')
      .replace(/{{VIDEO_FILE_ID_([a-f0-9-]+)}}/gi, (_match, fileId) => `<video data-file-id="${fileId}" controls></video>`)
      .replace(/{{HTML_FILE_ID_([a-f0-9-]+)}}/gi, (_match, fileId) => `<file type="html" id="${fileId}" />`)
  );
};

const codeStartPatterns: Array<{ lang: string; pattern: RegExp }> = [
  { lang: 'python', pattern: /^\s*(?:async\s+)?def\s+\w+\s*\([^)]*\)\s*:/ },
  { lang: 'python', pattern: /^\s*class\s+\w+(?:\([^)]*\))?\s*:/ },
  { lang: 'javascript', pattern: /^\s*(?:export\s+default\s+)?function\s+\w*\s*\([^)]*\)\s*\{/ },
  { lang: 'javascript', pattern: /^\s*(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/ },
  { lang: 'typescript', pattern: /^\s*(?:interface|type)\s+\w+\b/ },
  { lang: 'java', pattern: /^\s*(?:public|private|protected)?\s*(?:class|interface|enum)\s+\w+\b/ },
  { lang: 'c', pattern: /^\s*#include\s+[<"]/ },
  { lang: 'sql', pattern: /^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i },
  { lang: 'css', pattern: /^\s*[.#]?[a-zA-Z][\w-]*\s*\{$/ },
  { lang: 'html', pattern: /^\s*<!DOCTYPE\s+html\b/i },
  { lang: 'html', pattern: /^\s*<html[\s>]/i }
];

const markdownBoundaryPattern = /^(\s*$|\s{0,3}(?:#{1,6}\s|[-+*]\s|\d{1,9}[.)]\s|>\s?|```|~~~|:::+|\|)|\s{0,3}<\/?(?:details|summary|table|ul|ol|li|p|div|section|article|blockquote|pre|code|script|style)\b)/i;
const pythonContinuationPattern = /^\s*(?:elif\b|else:|except\b|finally:|for\b|while\b|if\b|try:|with\b|return\b|yield\b|raise\b|import\b|from\b|pass\b|break\b|continue\b|assert\b|[\w.\[\]'"]+\s*=)/;
const genericCodeContinuationPattern = /^\s*(?:[})\]];?|[A-Za-z_$][\w$]*\s*[=:({[]|\/\/|\/\*|\*\/|#|--)/;

const detectCodeStart = (line: string) => codeStartPatterns.find((item) => item.pattern.test(line));

const looksLikeCodeContinuation = (line: string, lang: string) => {
  if (/^\s*$/.test(line)) return true;
  if (/^\s{2,}\S/.test(line)) return true;
  if (lang === 'python') return pythonContinuationPattern.test(line);
  if (lang === 'sql') return /^\s*(?:FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|GROUP|ORDER|HAVING|LIMIT|VALUES|SET|ON|AND|OR|UNION|\)|;)/i.test(line);
  if (lang === 'html') return /^\s*<\/?[\w!-]/.test(line);
  if (lang === 'css') return /^\s*(?:[\w-]+\s*:|}|[.#]?[a-zA-Z][\w-]*\s*\{)/.test(line);
  return genericCodeContinuationPattern.test(line);
};

const normalizeBareCodeBlocks = (content: string) => {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  let inFence = false;
  let fenceMarker = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0];
      } else if (marker[0] === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      output.push(line);
      continue;
    }

    if (inFence) {
      output.push(line);
      continue;
    }

    const start = detectCodeStart(line);
    const previousLine = lines[index - 1] || '';
    const previousIsText = previousLine.trim() && !markdownBoundaryPattern.test(previousLine);
    const previousEndsAsSentence = /[。.!?？；;：:]$/.test(previousLine.trim());
    if (!start || (previousIsText && !previousEndsAsSentence)) {
      output.push(line);
      continue;
    }

    const block = [line];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const nextLine = lines[cursor];
      if (/^(\s*)(`{3,}|~{3,})/.test(nextLine)) break;
      if (markdownBoundaryPattern.test(nextLine) && nextLine.trim()) break;
      if (!looksLikeCodeContinuation(nextLine, start.lang)) break;
      block.push(nextLine);
      cursor += 1;
    }

    const significantLines = block.filter((item) => item.trim()).length;
    const hasIndentedBody = block.slice(1).some((item) => /^\s{2,}\S/.test(item));
    if (significantLines >= 2 && (hasIndentedBody || start.lang !== 'python')) {
      output.push(`\`\`\`${start.lang}`, ...block, '```');
      index = cursor - 1;
    } else {
      output.push(line);
    }
  }

  return output.join('\n');
};

const processResponseContent = (content: string) =>
  normalizeBareCodeBlocks(normalizeLooseMarkdownLists(replaceOpenWebUITokens(processChineseContent(content)))).trim();

const looseOrderedMarker = (line: string) => line.match(/^\s{0,3}(\d{1,9})([.)])(?=\S)/);

const shouldNormalizeOrderedLine = (lines: string[], index: number) => {
  const marker = looseOrderedMarker(lines[index]);
  if (!marker) return false;

  const currentNumber = Number.parseInt(marker[1], 10);
  const previous = looseOrderedMarker(lines[index - 1] || '');
  const next = looseOrderedMarker(lines[index + 1] || '');
  const previousNumber = previous ? Number.parseInt(previous[1], 10) : null;
  const nextNumber = next ? Number.parseInt(next[1], 10) : null;

  return (
    (previous?.[2] === marker[2] && previousNumber === currentNumber - 1) ||
    (next?.[2] === marker[2] && nextNumber === currentNumber + 1)
  );
};

const normalizeLooseMarkdownLists = (content: string) => {
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let fenceMarker = '';

  return lines.map((line, index) => {
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0];
      } else if (marker[0] === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      return line;
    }

    if (inFence) return line;

    return line
      .replace(/^(\s{0,3})([-+*])(?=\S)(?![-+*\d])/, '$1$2 ')
      .replace(/^(\s{0,3})(\d{1,9}[.)])(?=\S)/, shouldNormalizeOrderedLine(lines, index) ? '$1$2 ' : '$&');
  }).join('\n');
};

const sourceForMarker = (marker: string, sourceById: Map<string, OpenWebUICitationSource>) => {
  const normalized = marker.replace(/^[SF]/, '').split('#')[0];
  return (
    sourceById.get(marker) ||
    sourceById.get(normalized) ||
    sourceById.get(`S${normalized}`) ||
    sourceById.get(`F${normalized}`)
  );
};

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

type AlertType = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

const alertStyles: Record<
  AlertType,
  {
    border: string;
    text: string;
    Icon: typeof Info;
  }
> = {
  NOTE: { border: 'border-sky-500', text: 'text-sky-500', Icon: Info },
  TIP: { border: 'border-emerald-500', text: 'text-emerald-500', Icon: Lightbulb },
  IMPORTANT: { border: 'border-purple-500', text: 'text-purple-500', Icon: Star },
  WARNING: { border: 'border-yellow-500', text: 'text-yellow-500', Icon: CircleArrowRight },
  CAUTION: { border: 'border-rose-500', text: 'text-rose-500', Icon: Zap }
};

const alertComponent = (token: any) => {
  const matches = String(token?.text || '').match(/^(?:\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])\s*?\n*/);
  if (!matches?.length) return false;

  const type = matches[1] as AlertType;
  const text = String(token.text || '').replace(/^(?:\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])\s*?\n*/, '');
  return {
    type,
    text,
    tokens: marked.lexer(text)
  };
};

const getDetailTextContent = (token: any) =>
  decode(String(token?.text || ''))
    .replace(/<summary>.*?<\/summary>/gi, '')
    .trim();

const groupableDetailTypes = new Set(['tool_calls', 'reasoning', 'code_interpreter']);

const isGroupableDetailToken = (token: any) =>
  token?.type === 'details' && groupableDetailTypes.has(token?.attributes?.type ?? '');

const getDisplayTokens = (tokenList: any[] = []) => {
  const displayTokens: any[] = [];
  let detailGroup: any[] = [];

  const flushDetailGroup = () => {
    if (detailGroup.length > 1) {
      displayTokens.push({ type: 'detail_group', items: [...detailGroup] });
    } else if (detailGroup.length === 1) {
      displayTokens.push(detailGroup[0]);
    }
    detailGroup = [];
  };

  tokenList.forEach((token) => {
    if (isGroupableDetailToken(token)) {
      detailGroup.push(token);
    } else {
      flushDetailGroup();
      displayTokens.push(token);
    }
  });

  flushDetailGroup();
  return displayTokens;
};

function SourcePill({
  marker,
  source,
  onCitationJump
}: {
  marker: string;
  source: OpenWebUICitationSource;
  onCitationJump?: (source: OpenWebUICitationSource) => void;
}) {
  const title = formattedTitle(source.fileName || source.label || source.sourceId);
  return (
    <span className="relative inline-flex align-baseline">
      <button
        type="button"
        aria-label={`View source: ${title}`}
        onClick={() => onCitationJump?.(source)}
        className="inline-flex w-fit max-w-[12rem] translate-y-[2px] items-center rounded-xl bg-gray-50 px-2 py-0.5 text-[10px] leading-4 text-black/80 transition hover:text-black"
        title={title}
      >
        <span className="truncate">{getDisplayTitle(marker.includes('#') ? `${marker}` : title)}</span>
      </button>
    </span>
  );
}

function AlertBlock({
  alert,
  id,
  sourceById,
  onCitationJump,
  highlightedBlock
}: {
  alert: { type: AlertType; text: string; tokens: any[] };
  id: string;
  sourceById: Map<string, OpenWebUICitationSource>;
  onCitationJump?: (source: OpenWebUICitationSource) => void;
  highlightedBlock?: number | null;
}) {
  const style = alertStyles[alert.type];
  const Icon = style.Icon;

  return (
    <div className={`my-0.5 border-l-4 pl-2.5 ${style.border}`}>
      <div className={`${style.text} flex items-center gap-1 py-1.5`}>
        <Icon className="inline-block size-4" />
        <span className="font-medium">{alert.type}</span>
      </div>
      <div className="pb-2">
        <MarkdownTokens
          id={`${id}-alert`}
          tokens={alert.tokens}
          sourceById={sourceById}
          onCitationJump={onCitationJump}
          highlightedBlock={highlightedBlock}
        />
      </div>
    </div>
  );
}

function CollapsibleBlock({
  title,
  attributes,
  children,
  disabled = false,
  defaultOpen = false
}: {
  title?: string;
  attributes?: Record<string, string>;
  children?: ReactNode;
  disabled?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const normalizedTitle = (() => {
    if (attributes?.type === 'reasoning') return attributes?.done === 'true' ? 'Thought' : 'Thinking...';
    if (attributes?.type === 'code_interpreter') return attributes?.done === 'true' ? 'Analyzed' : 'Analyzing...';
    return decode(title || 'Details');
  })();

  return (
    <div className="w-full space-y-1">
      <button
        type="button"
        className={`w-fit text-gray-500 transition hover:text-gray-700 ${disabled ? '' : 'cursor-pointer'}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <div>{normalizedTitle}</div>
          {!disabled ? (
            <div className="flex self-center translate-y-[1px]">
              {open ? <ChevronUp className="size-3.5" strokeWidth={3.5} /> : <ChevronDown className="size-3.5" strokeWidth={3.5} />}
            </div>
          ) : null}
        </div>
      </button>
      {open ? <div className="mb-1.5">{children}</div> : null}
    </div>
  );
}

function DetailGroupBlock({
  id,
  tokens,
  sourceById,
  onCitationJump,
  highlightedBlock
}: {
  id: string;
  tokens: any[];
  sourceById: Map<string, OpenWebUICitationSource>;
  onCitationJump?: (source: OpenWebUICitationSource) => void;
  highlightedBlock?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const toolTokens = tokens.filter((token) => token?.attributes?.type === 'tool_calls');
  const reasoningCount = tokens.filter((token) => token?.attributes?.type === 'reasoning').length;
  const codeInterpreterCount = tokens.filter((token) => token?.attributes?.type === 'code_interpreter').length;
  const hasPending = tokens.some((token) => token?.attributes?.done !== undefined && token?.attributes?.done !== 'true');
  const summaryParts: string[] = [];

  if (toolTokens.length > 0) {
    const nameCounts = new Map<string, number>();
    toolTokens.forEach((token) => {
      const name = token?.attributes?.name ?? 'tool';
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    });
    nameCounts.forEach((count, name) => summaryParts.push(count > 1 ? `${count} ${name}` : name));
  }
  if (codeInterpreterCount > 0) {
    summaryParts.push(codeInterpreterCount === 1 ? 'Ran 1 analysis' : `Ran ${codeInterpreterCount} analyses`);
  }
  if (reasoningCount > 0 && summaryParts.length === 0) {
    summaryParts.push(reasoningCount === 1 ? 'reasoning' : `${reasoningCount} reasoning steps`);
  }

  return (
    <div id={id} className="w-full">
      <button
        type="button"
        className="w-fit cursor-pointer text-left text-gray-500 transition hover:text-gray-700"
        aria-label="Toggle details"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <div className="flex items-center gap-1.5">
          <div className={toolTokens.length > 0 ? 'text-emerald-500' : 'text-gray-400'}>
            {toolTokens.length > 0 ? <Check className="size-4" strokeWidth={2} /> : <Sparkles className="size-3.5" />}
          </div>
          <div className="line-clamp-1 flex-1">
            <span className={`text-gray-600 ${hasPending ? 'shimmer' : ''}`}>{hasPending ? 'Exploring' : 'Explored'}</span>
            {summaryParts.length ? <span className="text-gray-400">{summaryParts.join(', ')}</span> : null}
          </div>
          <div className="flex shrink-0 self-center text-gray-400">
            {open ? <ChevronUp className="size-3" strokeWidth={3.5} /> : <ChevronDown className="size-3" strokeWidth={3.5} />}
          </div>
        </div>
      </button>
      {open ? (
        <div className="mb-0.5 space-y-0.5">
          {tokens.map((token, index) => (
            <DetailsBlock
              key={`${id}-${index}`}
              token={token}
              id={`${id}-${index}`}
              sourceById={sourceById}
              onCitationJump={onCitationJump}
              highlightedBlock={highlightedBlock}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DetailsBlock({
  token,
  id,
  sourceById,
  onCitationJump,
  highlightedBlock
}: {
  token: any;
  id: string;
  sourceById: Map<string, OpenWebUICitationSource>;
  onCitationJump?: (source: OpenWebUICitationSource) => void;
  highlightedBlock?: number | null;
}) {
  const textContent = getDetailTextContent(token);
  const attributes = token?.attributes ?? {};
  if (textContent.length === 0) {
    return <CollapsibleBlock title={token.summary} attributes={attributes} disabled />;
  }

  return (
    <CollapsibleBlock title={token.summary} attributes={attributes}>
      <MarkdownTokens
        tokens={marked.lexer(decode(token.text || ''))}
        id={`${id}-details`}
        sourceById={sourceById}
        onCitationJump={onCitationJump}
        highlightedBlock={highlightedBlock}
      />
    </CollapsibleBlock>
  );
}

const renderTextWithSources = (
  value: string,
  keyPrefix: string,
  sourceById: Map<string, OpenWebUICitationSource>,
  onCitationJump?: (source: OpenWebUICitationSource) => void
): ReactNode[] => {
  const parts: ReactNode[] = [];
  const pattern = /\[((?:S|F)?\d+(?:#[^\]\s,]+)?)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`${keyPrefix}-text-${lastIndex}`}>{decode(value.slice(lastIndex, match.index))}</span>);
    }

    const marker = match[1];
    const source = sourceForMarker(marker, sourceById);
    parts.push(
      source ? (
        <SourcePill key={`${keyPrefix}-source-${match.index}`} marker={marker} source={source} onCitationJump={onCitationJump} />
      ) : (
        <span key={`${keyPrefix}-missing-${match.index}`}>[{marker}]</span>
      )
    );
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    parts.push(<span key={`${keyPrefix}-text-${lastIndex}`}>{decode(value.slice(lastIndex))}</span>);
  }

  return parts.length ? parts : [<span key={`${keyPrefix}-text`}>{decode(value)}</span>];
};

function KatexToken({ content, displayMode }: { content: string; displayMode?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(content, {
        throwOnError: false,
        displayMode: Boolean(displayMode),
        strict: false,
        trust: false
      });
    } catch {
      return content;
    }
  }, [content, displayMode]);

  return (
    <span
      className={displayMode ? 'openwebui-katex-display' : 'openwebui-katex-inline'}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  );
}

function InlineTokens({
  tokens = [],
  id,
  sourceById,
  onCitationJump,
  onLinkPreview
}: {
  tokens?: any[];
  id: string;
  sourceById: Map<string, OpenWebUICitationSource>;
  onCitationJump?: (source: OpenWebUICitationSource) => void;
  onLinkPreview?: (link: { href: string; title?: string; text?: string }) => void;
}): ReactNode {
  return tokens.map((token, index) => {
    const key = `${id}-${index}-${token.type}`;
    if (token.type === 'escape' || token.type === 'text') {
      return <span key={key}>{renderTextWithSources(tokenText(token), key, sourceById, onCitationJump)}</span>;
    }
    if (token.type === 'html') {
      return <span key={key} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(token.raw || token.text || '') }} />;
    }
    if (token.type === 'link') {
      return (
        <a
          key={key}
          href={token.href}
          target="_blank"
          rel="nofollow noreferrer"
          title={token.title || undefined}
          onClick={(event) => {
            if (!onLinkPreview || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onLinkPreview({ href: token.href, title: token.title || undefined, text: token.text || undefined });
          }}
        >
          {token.tokens?.length ? <InlineTokens tokens={token.tokens} id={`${key}-link`} sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} /> : token.text}
        </a>
      );
    }
    if (token.type === 'image') {
      return <img key={key} src={token.href} alt={token.text || ''} className="my-1 max-h-96 rounded-lg" />;
    }
    if (token.type === 'strong') {
      return <strong key={key}><InlineTokens tokens={token.tokens} id={`${key}-strong`} sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} /></strong>;
    }
    if (token.type === 'em') {
      return <em key={key}><InlineTokens tokens={token.tokens} id={`${key}-em`} sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} /></em>;
    }
    if (token.type === 'del') {
      return <del key={key}><InlineTokens tokens={token.tokens} id={`${key}-del`} sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} /></del>;
    }
    if (token.type === 'codespan') {
      return <code key={key} className="codespan cursor-pointer">{decode(String(token.text ?? ''))}</code>;
    }
    if (token.type === 'br') return <br key={key} />;
    if (token.type === 'inlineKatex') {
      return <KatexToken key={key} content={String(token.text || '')} displayMode={token.displayMode} />;
    }
    if (token.type === 'footnote') {
      return (
        <sup key={key} className="footnote-ref footnote-ref-text rounded bg-gray-50 px-1 text-[10px] text-gray-500">
          {token.escapedText || token.text}
        </sup>
      );
    }
    if (token.type === 'citation') {
      const markers = (token.citationIdentifiers || token.ids || []).map(String);
      if (!markers.length) return <span key={key}>{token.raw}</span>;
      return markers.map((marker: string, markerIndex: number) => {
        const source = sourceForMarker(marker, sourceById);
        return source ? (
          <SourcePill key={`${key}-${markerIndex}`} marker={marker} source={source} onCitationJump={onCitationJump} />
        ) : (
          <span key={`${key}-${markerIndex}`}>[{marker}]</span>
        );
      });
    }

    return <span key={key}>{renderTextWithSources(tokenText(token), key, sourceById, onCitationJump)}</span>;
  });
}

function TableBlock({
  token,
  blockId,
  blockIndex,
  sourceById,
  onCitationJump,
  onLinkPreview
}: {
  token: any;
  blockId: string;
  blockIndex: number;
  sourceById: Map<string, OpenWebUICitationSource>;
  onCitationJump?: (source: OpenWebUICitationSource) => void;
  onLinkPreview?: (link: { href: string; title?: string; text?: string }) => void;
}) {
  const [copied, setCopied] = useState(false);
  const align = token.align || [];

  const copyTable = async () => {
    await navigator.clipboard?.writeText(String(token.raw || '')).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const exportCsv = () => {
    const quote = (value: string) => `"${decode(value).replace(/"/g, '""')}"`;
    const header = (token.header || []).map((cell: any) => quote(cell.text || cell.raw || ''));
    const rows = (token.rows || []).map((row: any[]) => row.map((cell) => quote((cell.tokens || []).map((item: any) => item.text || item.raw || '').join(''))));
    const csv = [header, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=UTF-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `table-${blockId}-${blockIndex}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="relative mb-2 w-full group" data-md-block={blockIndex}>
      <div className="scrollbar-hidden relative max-w-full overflow-x-auto">
        <table className="w-full max-w-full rounded-xl text-start text-sm text-gray-500" dir="auto">
          <thead className="border-none bg-white text-xs uppercase text-gray-700">
            <tr>
              {(token.header || []).map((cell: any, cellIndex: number) => (
                <th
                  key={cellIndex}
                  scope="col"
                  className="cursor-pointer border-b border-gray-100 px-2.5 py-2 text-start"
                  style={align[cellIndex] ? { textAlign: align[cellIndex] } : undefined}
                >
                  <div className="break-normal">
                    <InlineTokens tokens={cell.tokens} id={`${blockId}-h-${cellIndex}`} sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(token.rows || []).map((row: any[], rowIndex: number) => (
              <tr key={rowIndex} className="bg-white text-xs">
                {(row || []).map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`w-max px-3 py-2 text-gray-900 ${rowIndex === token.rows.length - 1 ? '' : 'border-b border-gray-50'}`}
                    style={align[cellIndex] ? { textAlign: align[cellIndex] } : undefined}
                  >
                    <div className="break-normal">
                        <InlineTokens tokens={cell.tokens} id={`${blockId}-r-${rowIndex}-${cellIndex}`} sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="invisible absolute right-1.5 top-1 z-20 flex gap-0.5 group-hover:visible">
        <button type="button" className="rounded-lg bg-transparent p-1 transition hover:bg-black/5" onClick={() => void copyTable()} title="复制">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
        <button type="button" className="rounded-lg bg-transparent p-1 transition hover:bg-black/5" onClick={exportCsv} title="导出为 CSV">
          <Download className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function MarkdownTokens({
  tokens = [],
  id,
  top = true,
  sourceById,
  onCitationJump,
  onLinkPreview,
  highlightedBlock
}: {
  tokens?: any[];
  id: string;
  top?: boolean;
  sourceById: Map<string, OpenWebUICitationSource>;
  onCitationJump?: (source: OpenWebUICitationSource) => void;
  onLinkPreview?: (link: { href: string; title?: string; text?: string }) => void;
  highlightedBlock?: number | null;
}): ReactNode {
  return getDisplayTokens(tokens).map((token, tokenIndex) => {
    const key = `${id}-${tokenIndex}-${token.type}`;
    const blockIndex = tokenIndex;
    const highlight = highlightedBlock === blockIndex ? 'rounded bg-[#f5d36b]/35 ring-1 ring-[#d3a900]/30' : '';

    if (token.type === 'space') return <div key={key} className="my-2" />;
    if (token.type === 'hr') return <hr key={key} className="border-gray-100/30" />;
    if (token.type === 'heading') {
      const Heading = `h${token.depth}` as keyof JSX.IntrinsicElements;
      return (
        <Heading key={key} dir="auto" data-md-block={blockIndex} className={highlight}>
          <InlineTokens tokens={token.tokens} id={`${key}-heading`} sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} />
        </Heading>
      );
    }
    if (token.type === 'code') {
      if (!String(token.raw || '').includes('```') && !String(token.raw || '').includes('~~~')) {
        return top ? (
          <p key={key} data-md-block={blockIndex} className={highlight}>
            {decode(String(token.text || ''))}
          </p>
        ) : (
          <span key={key}>{decode(String(token.text || ''))}</span>
        );
      }

      return (
        <OpenWebUICodeBlock
          key={key}
          id={key}
          code={token.text || ''}
          raw={token.raw || ''}
          lang={token.lang || ''}
          highlighted={highlightedBlock === blockIndex}
        />
      );
    }
    if (token.type === 'table') {
      return <TableBlock key={key} token={token} blockId={id} blockIndex={blockIndex} sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} />;
    }
    if (token.type === 'blockquote') {
      const alert = alertComponent(token);
      if (alert) {
        return (
          <div key={key} data-md-block={blockIndex} className={highlight}>
            <AlertBlock alert={alert} id={key} sourceById={sourceById} onCitationJump={onCitationJump} highlightedBlock={highlightedBlock} />
          </div>
        );
      }

      return (
        <blockquote key={key} dir="auto" data-md-block={blockIndex} className={highlight}>
          <MarkdownTokens tokens={token.tokens} id={`${key}-quote`} top={false} sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} highlightedBlock={highlightedBlock} />
        </blockquote>
      );
    }
    if (token.type === 'list') {
      const ListTag = token.ordered ? 'ol' : 'ul';
      return (
        <ListTag key={key} start={token.start || 1} dir="auto" data-md-block={blockIndex} className={highlight}>
          {(token.items || []).map((item: any, itemIndex: number) => (
            <li key={itemIndex} className={`text-start ${item?.task && !token.ordered ? 'openwebui-task-item' : ''}`}>
              {item?.task ? (
                <input className="openwebui-task-checkbox" type="checkbox" checked={Boolean(item.checked)} readOnly />
              ) : null}
              <MarkdownTokens tokens={item.tokens} id={`${key}-li-${itemIndex}`} top={Boolean(token.loose)} sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} highlightedBlock={highlightedBlock} />
            </li>
          ))}
        </ListTag>
      );
    }
    if (token.type === 'detail_group') {
      return (
        <div key={key} data-md-block={blockIndex} className={highlight}>
          <DetailGroupBlock id={key} tokens={token.items || []} sourceById={sourceById} onCitationJump={onCitationJump} highlightedBlock={highlightedBlock} />
        </div>
      );
    }
    if (token.type === 'details') {
      return (
        <div key={key} data-md-block={blockIndex} className={highlight}>
          <DetailsBlock token={token} id={key} sourceById={sourceById} onCitationJump={onCitationJump} highlightedBlock={highlightedBlock} />
        </div>
      );
    }
    if (token.type === 'html') {
      return <span key={key} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(token.raw || token.text || '') }} />;
    }
    if (token.type === 'paragraph') {
      return (
        <p key={key} dir="auto" data-md-block={blockIndex} className={highlight}>
          <InlineTokens tokens={token.tokens} id={`${key}-p`} sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} />
        </p>
      );
    }
    if (token.type === 'text') {
      const children = token.tokens?.length ? (
        <InlineTokens tokens={token.tokens} id={`${key}-text`} sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} />
      ) : (
        decode(token.text || '')
      );
      return top ? <p key={key} data-md-block={blockIndex} className={highlight}>{children}</p> : <span key={key}>{children}</span>;
    }
    if (token.type === 'blockKatex') {
      return (
        <div key={key} data-md-block={blockIndex} className={highlight}>
          <KatexToken content={String(token.text || '')} displayMode={token.displayMode ?? true} />
        </div>
      );
    }
    if (token.type === 'colonFence') {
      const label = String(token.fenceType ?? token.meta ?? 'default')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
      return (
        <div key={key} data-md-block={blockIndex} className={`openwebui-colon-fence group relative my-2 rounded-2xl border border-gray-100 px-4 py-3 ${highlight}`}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">{label}</span>
            <button
              type="button"
              className="invisible rounded-lg bg-transparent p-1 transition hover:bg-black/5 group-hover:visible"
              onClick={() => void navigator.clipboard?.writeText(token.text || '')}
              title="复制"
            >
              <Copy className="size-3.5" strokeWidth={1.5} />
            </button>
          </div>
          <div className="prose-sm" dir="auto">
            <MarkdownTokens tokens={marked.lexer(token.text || '')} id={`${key}-colon`} sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} highlightedBlock={highlightedBlock} />
          </div>
        </div>
      );
    }

    return null;
  });
}

export default function OpenWebUIMarkdownRenderer({
  content,
  emptyMessage = 'Nothing to preview yet.',
  isStreaming,
  fileId,
  citationSources = [],
  onCitationJump,
  onLinkPreview
}: OpenWebUIMarkdownRendererProps) {
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
  const processedContent = useMemo(() => processResponseContent(content || ''), [content]);
  const tokens = useMemo(() => marked.lexer(processedContent), [processedContent]);

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

  return (
    <div
      ref={containerRef}
      className="openwebui-markdown markdown-prose prose prose-slate max-w-none prose-blockquote:border-s-gray-100 prose-blockquote:border-s-2 prose-blockquote:not-italic prose-blockquote:font-normal prose-headings:font-semibold prose-hr:my-4 prose-hr:border-gray-50 prose-p:my-0 prose-img:my-1 prose-headings:my-1 prose-pre:my-0 prose-table:my-0 prose-blockquote:my-0 prose-ul:-my-0 prose-ol:-my-0 prose-li:-my-0 w-full min-w-full"
    >
      <MarkdownTokens tokens={tokens} id="openwebui-md" sourceById={sourceById} onCitationJump={onCitationJump} onLinkPreview={onLinkPreview} highlightedBlock={highlightedBlock} />
      {!content && isStreaming ? <span className="text-sm text-inherit">...</span> : null}
    </div>
  );
}
