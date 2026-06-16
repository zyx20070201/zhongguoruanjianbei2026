import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { SandboxView } from '@react-chat/components/Sandbox/SandboxView';
import { parseResponse } from '@react-chat/utils/parser';
import type { ParsedPart } from '@react-chat/types';
import MarkdownPreview from './MarkdownPreview';
import '@react-chat/styles/variables.css';
import '@react-chat/components/Chat/Chat.css';
import '@react-chat/components/Sandbox/Sandbox.css';

export interface VisualCodeLessonPayload {
  schemaVersion: 'visual_code_lesson.v1';
  title: string;
  summary: string;
  sourceIds?: string[];
  contentMarkdown: string;
}

export interface VisualCodeLessonViewerResult {
  name: string;
  content: string;
}

export const parseVisualCodeMarkdown = (content: string): ParsedPart[] => parseResponse(content);

function HtmlCodeFrame({ code, title }: { code: string; title: string }) {
  return (
    <iframe
      title={title}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      srcDoc={code}
      className="h-[420px] w-full rounded-lg border border-[#e5e7eb] bg-white"
    />
  );
}

export function VisualCodeLessonViewer({
  result,
  lesson,
  onBack
}: {
  result: VisualCodeLessonViewerResult;
  lesson: VisualCodeLessonPayload;
  onBack?: () => void;
}) {
  const source = lesson.contentMarkdown || result.content;
  const parts = useMemo(() => parseResponse(source), [source]);
  let visualIndex = 0;
  const displayParts = parts.filter((part) => part.type === 'text' || part.code.trim());

  return (
    <section className="min-w-0 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e7eb] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-w-fit shrink-0 items-center gap-1 p-1.5 text-sm font-medium text-gray-900 transition select-none hover:text-gray-700 dark:text-gray-200 dark:hover:text-white"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">AI Studio</span>
            </button>
          ) : null}
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">
              React-Chat Visual
            </div>
            <h3 className="mt-1 truncate text-lg font-semibold text-[#202124]">{lesson.title || result.name}</h3>
          </div>
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-5">
        {lesson.summary ? (
          <div className="rounded-lg border border-[#dfe3ea] bg-[#f8fafc] px-4 py-3 text-sm leading-6 text-[#475569]">
            {lesson.summary}
          </div>
        ) : null}
        {displayParts.map((part, index) => {
          if (part.type === 'text') {
            return (
              <article key={`text-${index}`} className="rounded-lg border border-[#e5e7eb] bg-white px-5 py-4">
                <MarkdownPreview content={part.content} variant="document" />
              </article>
            );
          }

          visualIndex += 1;
          if (part.type === 'html') {
            return (
              <HtmlCodeFrame
                key={`${part.type}-${index}`}
                code={part.code}
                title={`可视化 ${visualIndex}`}
              />
            );
          }
          return (
            <SandboxView
              key={`${part.type}-${index}`}
              vizId={`studio-react-chat-${index}`}
              type={part.type}
              code={part.code}
              title={`可视化 ${visualIndex}`}
              initialHeight={420}
            />
          );
        })}
      </div>
    </section>
  );
}
