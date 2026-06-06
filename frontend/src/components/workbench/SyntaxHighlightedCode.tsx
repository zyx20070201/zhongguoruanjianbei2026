import { useEffect, useRef, useState } from 'react';

interface SyntaxHighlightedCodeProps {
  code: string;
  language?: string;
  emptyMessage?: string;
  onViewportChange?: (patch: Record<string, any>) => void;
  fileId?: string;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const KEYWORDS =
  /\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|extends|import|from|export|default|async|await|try|catch|finally|throw|new|public|private|protected|static|void|int|float|double|bool|boolean|true|false|null|undefined|interface|type|enum|struct|package)\b/g;

const highlight = (code: string) => {
  const placeholders: string[] = [];
  const stash = (value: string, className: string) => {
    const index = placeholders.push(`<span class="${className}">${escapeHtml(value)}</span>`) - 1;
    return `__TOKEN_${index}__`;
  };

  let html = code;
  html = html.replace(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g, (match) =>
    stash(match, 'text-slate-500')
  );
  html = html.replace(/("[^"\n]*"|'[^'\n]*'|`[^`]*`)/g, (match) =>
    stash(match, 'text-blue-700')
  );
  html = escapeHtml(html);
  html = html.replace(/\b(\d+(\.\d+)?)\b/g, '<span class="text-violet-700">$1</span>');
  html = html.replace(KEYWORDS, '<span class="font-semibold text-blue-700">$1</span>');
  html = html.replace(/__TOKEN_(\d+)__/g, (_, index) => placeholders[Number(index)] || '');
  return html;
};

export default function SyntaxHighlightedCode({
  code,
  language,
  emptyMessage = 'Nothing to preview yet.',
  onViewportChange,
  fileId
}: SyntaxHighlightedCodeProps) {
  const preRef = useRef<HTMLPreElement | null>(null);
  const [highlightedLines, setHighlightedLines] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    const handleJump = (event: Event) => {
      const detail = (event as CustomEvent).detail as { fileId?: string; locator?: Record<string, any> } | undefined;
      if (!fileId || !detail?.fileId || detail.fileId !== fileId) return;
      const start = Number(detail.locator?.lineStart || detail.locator?.startLine || 1);
      const end = Number(detail.locator?.lineEnd || detail.locator?.endLine || start);
      const element = preRef.current;
      if (!element) return;
      element.scrollTo({ top: Math.max(0, (start - 3) * 24), behavior: 'smooth' });
      setHighlightedLines({ start, end });
      window.setTimeout(() => setHighlightedLines(null), 2600);
    };

    window.addEventListener('workbench:jump-to-citation', handleJump);
    return () => window.removeEventListener('workbench:jump-to-citation', handleJump);
  }, [fileId]);

  if (!code.trim()) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-[var(--wb-text-muted)]">
        {emptyMessage}
      </div>
    );
  }

  const reportViewport = (element: HTMLPreElement) => {
    if (!onViewportChange) return;
    const lineHeight = 24;
    const totalScrollable = Math.max(1, element.scrollHeight - element.clientHeight);
    const start = Math.max(1, Math.floor(element.scrollTop / lineHeight) + 1);
    const end = Math.max(start, Math.ceil((element.scrollTop + element.clientHeight) / lineHeight));
    onViewportChange({
      visibleLineRange: { start, end },
      scrollRatio: Math.min(1, Math.max(0, element.scrollTop / totalScrollable)),
      approxChunkIndex: Math.max(0, start - 1),
      selectedText: window.getSelection()?.toString().trim() || ''
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="border-b border-[#eeeeeb] bg-white px-4 py-2 text-xs uppercase tracking-[0.16em] text-[#777a80]">
        {language || 'Code Preview'}
      </div>
      <pre
        ref={preRef}
        className="min-h-0 flex-1 overflow-auto bg-white p-5 font-mono text-sm leading-6 text-[#25272b]"
        onScroll={(event) => reportViewport(event.currentTarget)}
        onMouseEnter={(event) => reportViewport(event.currentTarget)}
        onMouseUp={(event) => reportViewport(event.currentTarget)}
      >
        {highlightedLines ? (
          code.split('\n').map((line, index) => {
            const lineNumber = index + 1;
            const highlighted = lineNumber >= highlightedLines.start && lineNumber <= highlightedLines.end;
            return (
              <code
                key={index}
                className={highlighted ? 'block rounded bg-[#f5d36b]/25 ring-1 ring-[#d3a900]/30' : 'block'}
                dangerouslySetInnerHTML={{ __html: highlight(line || ' ') }}
              />
            );
          })
        ) : (
          <code dangerouslySetInnerHTML={{ __html: highlight(code) }} />
        )}
      </pre>
    </div>
  );
}
