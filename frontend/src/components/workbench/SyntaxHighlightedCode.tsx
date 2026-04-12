interface SyntaxHighlightedCodeProps {
  code: string;
  language?: string;
  emptyMessage?: string;
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
    stash(match, 'text-blue-200')
  );
  html = escapeHtml(html);
  html = html.replace(/\b(\d+(\.\d+)?)\b/g, '<span class="text-blue-300">$1</span>');
  html = html.replace(KEYWORDS, '<span class="text-blue-400">$1</span>');
  html = html.replace(/__TOKEN_(\d+)__/g, (_, index) => placeholders[Number(index)] || '');
  return html;
};

export default function SyntaxHighlightedCode({
  code,
  language,
  emptyMessage = 'Nothing to preview yet.'
}: SyntaxHighlightedCodeProps) {
  if (!code.trim()) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-[var(--wb-text-muted)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--wb-editor)]">
      <div className="border-b border-[var(--wb-border)] bg-[var(--wb-panel)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--wb-text-dim)]">
        {language || 'Code Preview'}
      </div>
      <pre className="min-h-0 flex-1 overflow-auto bg-[var(--wb-editor)] p-5 font-mono text-sm leading-6 text-[#d7e7ff]">
        <code dangerouslySetInnerHTML={{ __html: highlight(code) }} />
      </pre>
    </div>
  );
}
