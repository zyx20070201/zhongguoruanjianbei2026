import { Fragment, ReactNode } from 'react';

interface MarkdownPreviewProps {
  content: string;
  emptyMessage?: string;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderInline = (line: string): ReactNode[] => {
  const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);

  return parts.map((part, index) => {
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code
          key={index}
          className="rounded bg-[var(--wb-sidebar-alt)] px-1.5 py-0.5 font-mono text-[0.92em] text-[#d7e7ff]"
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

export default function MarkdownPreview({
  content,
  emptyMessage = 'Nothing to preview yet.'
}: MarkdownPreviewProps) {
  if (!content.trim()) {
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
  let codeFence: string[] = [];
  let inCodeFence = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-7 text-[var(--wb-text-muted)]">
        {renderInline(paragraph.join(' '))}
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc space-y-2 pl-6 text-sm leading-7 text-[var(--wb-text-muted)]">
        {listItems.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const flushCodeFence = () => {
    if (codeFence.length === 0 && !inCodeFence) return;
    blocks.push(
      <pre
        key={`pre-${blocks.length}`}
        className="overflow-x-auto rounded-xl border border-[var(--wb-border)] bg-[var(--wb-panel)] p-4 font-mono text-sm leading-6 text-[#d7e7ff]"
      >
        <code dangerouslySetInnerHTML={{ __html: escapeHtml(codeFence.join('\n')) }} />
      </pre>
    );
    codeFence = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
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
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const className =
        level === 1
          ? 'text-3xl font-semibold text-[var(--wb-text)]'
          : level === 2
            ? 'text-2xl font-semibold text-[var(--wb-text)]'
            : 'text-lg font-semibold text-[var(--wb-text)]';
      blocks.push(
        <div key={`h-${blocks.length}`} className={className}>
          {renderInline(headingMatch[2])}
        </div>
      );
      continue;
    }

    if (/^(-|\*)\s+/.test(line)) {
      flushParagraph();
      listItems.push(line.replace(/^(-|\*)\s+/, ''));
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(
        <blockquote
          key={`blockquote-${blocks.length}`}
          className="border-l-2 border-[rgba(90,166,255,0.5)] pl-4 text-sm italic leading-7 text-[var(--wb-text-muted)]"
        >
          {renderInline(line.replace(/^>\s?/, ''))}
        </blockquote>
      );
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushParagraph();
      flushList();
      blocks.push(<hr key={`hr-${blocks.length}`} className="border-[var(--wb-border)]" />);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushCodeFence();

  return <div className="flex flex-col gap-5 bg-[var(--wb-editor)] p-6">{blocks}</div>;
}
