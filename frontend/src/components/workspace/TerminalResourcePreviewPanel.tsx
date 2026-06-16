import { Download, Expand, FileCheck2, FileText, Loader2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { parseResponse } from '@react-chat/utils/parser';
import { SandboxView } from '@react-chat/components/Sandbox/SandboxView';
import {
  extractLightVisualLessonPayloadFromText,
  LightVisualLessonViewer
} from '../workbench/LightVisualLessonViewer';
import MarkdownPreview from '../workbench/MarkdownPreview';
import { extractQuizPracticePayloadFromText, QuizPracticeViewer } from '../workbench/QuizPracticeViewer';
import { VisualCodeLessonViewer, type VisualCodeLessonPayload } from '../workbench/VisualCodeSandbox';
import { fileSystemApi } from '../../services/fileSystemApi';
import '@react-chat/styles/variables.css';
import '@react-chat/components/Sandbox/Sandbox.css';

export interface TerminalResourcePreview {
  id: string;
  title: string;
  subtitle?: string;
  kind?: string;
  templateId?: string;
  fileObjectId?: string;
  filename?: string;
  previewContent?: string;
  url?: string;
  renderer?: string;
  framework?: string;
  reviewSummary?: string;
}

const looksLikeHtml = (value: string) => /<!doctype html|<html[\s>]/i.test(value);
type WebPreviewData = Awaited<ReturnType<typeof fileSystemApi.extractUrlPreview>>;

const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const parseJsonRecord = (value: string): Record<string, any> | null => {
  if (!value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const looksLikeLightVisualLessonContent = (content: string) => {
  const parsed = parseJsonRecord(content);
  const payload = isRecord(parsed?.payload) ? parsed.payload : parsed;
  return Array.isArray(payload?.slides) && (
    payload.schemaVersion === 'light_visual_lesson.v1' ||
    payload.schemaVersion === 'light_visual_lesson' ||
    typeof payload.title === 'string' ||
    payload.slides.some((slide: any) => isRecord(slide) && ('header' in slide || 'visuals' in slide || 'timeline' in slide))
  );
};

const looksLikeReactChatVisualContent = (content: string) =>
  /~~~(?:REACT_VIZ|HTML_VIZ)(?:[^\S\r\n]*\r?\n|[^\S\r\n]+|$)/i.test(content);

const isLightVisualPreview = (preview: TerminalResourcePreview) =>
  preview.templateId === 'light_visual_lesson' ||
  preview.renderer === 'light_visual_lesson' ||
  preview.kind === 'light_visual_lesson' ||
  preview.framework === 'light_visual_lesson' ||
  preview.filename?.includes('light_visual_lesson') ||
  preview.subtitle?.includes('light_visual_lesson');

const isReactChatVisualPreview = (preview: TerminalResourcePreview) =>
  preview.templateId === 'react_chat_visual' ||
  preview.renderer === 'react_chat_visual' ||
  preview.kind === 'react_chat_visual' ||
  preview.framework === 'react-chat-sandbox' ||
  preview.framework === 'react_chat_visual' ||
  preview.filename?.includes('react_chat_visual') ||
  preview.subtitle?.includes('react_chat_visual');

const isQuizPracticePreview = (preview: TerminalResourcePreview) =>
  preview.templateId === 'custom_practice' ||
  preview.templateId === 'quiz' ||
  preview.renderer === 'quiz' ||
  preview.kind === 'custom_practice' ||
  preview.kind === 'quiz' ||
  preview.filename?.includes('practice-') ||
  preview.filename?.includes('custom-quiz') ||
  preview.subtitle?.includes('practice-') ||
  preview.subtitle?.includes('custom-quiz');

const extractVisualCodeLessonPayloadFromText = (
  content: string,
  title: string
): VisualCodeLessonPayload | null => {
  const parsed = parseJsonRecord(content);
  const payload = isRecord(parsed?.payload) ? parsed.payload : parsed;
  if (payload?.schemaVersion === 'visual_code_lesson.v1' && typeof payload.contentMarkdown === 'string') {
    return payload as unknown as VisualCodeLessonPayload;
  }
  if (looksLikeReactChatVisualContent(content)) {
    return {
      schemaVersion: 'visual_code_lesson.v1',
      title,
      summary: '包含讲解文本和可执行前端可视化代码块的视觉化课程。',
      contentMarkdown: content
    };
  }
  return null;
};

const getEmbedInfo = (url?: string | null) => {
  if (!url) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      const videoId = host.includes('youtu.be')
        ? parsed.pathname.split('/').filter(Boolean)[0]
        : parsed.searchParams.get('v') || parsed.pathname.match(/\/shorts\/([^/?#]+)/)?.[1] || parsed.pathname.match(/\/embed\/([^/?#]+)/)?.[1];
      return videoId
        ? {
            type: 'video' as const,
            provider: 'YouTube',
            embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`
          }
        : null;
    }

    if (host.includes('bilibili.com')) {
      const bvid = parsed.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1];
      const aid = parsed.pathname.match(/\/video\/av(\d+)/i)?.[1];
      const page = parsed.searchParams.get('p');
      const params = new URLSearchParams();
      if (bvid) params.set('bvid', bvid);
      if (aid) params.set('aid', aid);
      if (page) params.set('page', page);
      return params.toString()
        ? {
            type: 'video' as const,
            provider: 'Bilibili',
            embedUrl: `https://player.bilibili.com/player.html?${params.toString()}`
          }
        : null;
    }
  } catch {
    return null;
  }

  return null;
};

const copyText = async (value: string) => {
  if (!value) return;
  await navigator.clipboard?.writeText(value);
};

function HtmlFrame({ content, title }: { content: string; title: string }) {
  return (
    <iframe
      title={title}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      srcDoc={content}
      className="h-full w-full rounded-none border-0 bg-white"
    />
  );
}

function UrlPreviewBody({
  preview,
  workspaceId
}: {
  preview: TerminalResourcePreview;
  workspaceId: string;
}) {
  const url = String(preview.url || '').trim();
  const embed = useMemo(() => getEmbedInfo(url), [url]);
  const [previewData, setPreviewData] = useState<WebPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!url || embed) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setPreviewData(null);
    void fileSystemApi
      .extractUrlPreview(workspaceId, { url, title: preview.title })
      .then((result) => {
        if (!cancelled) setPreviewData(result);
      })
      .catch((previewError) => {
        if (!cancelled) setError(previewError?.response?.data?.error || previewError?.message || '提取网页内容失败。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [embed, preview.title, url, workspaceId]);

  if (embed) {
    const embedUrl = `${embed.embedUrl}${embed.embedUrl.includes('?') ? '&' : '?'}start=0&autoplay=0`;
    return (
      <div className="h-full overflow-auto bg-white px-6 py-5">
        <div className="mx-auto max-w-5xl">
          <div className="overflow-hidden bg-black">
            <iframe
              title={preview.title || `${embed.provider} video`}
              src={embedUrl}
              className="aspect-video w-full"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-3 bg-white px-6 text-sm text-gray-500">
        <Loader2 className="size-4 animate-spin" />
        正在提取网页内容...
      </div>
    );
  }

  const richHtml = previewData?.contentHtml || '';
  const readableText = previewData?.contentMarkdown || preview.previewContent || '';
  const title = previewData?.title || preview.title;
  const displayedUrl = previewData?.url || url;

  if (richHtml.trim()) {
    return (
      <div className="h-full overflow-auto bg-white px-6 py-5">
        <article className="mx-auto max-w-5xl min-w-0 text-[#25272b]">
          <div className="mb-6 pb-5">
            <h1 className="text-4xl font-semibold tracking-normal text-[#202124]">{title}</h1>
            <div className="mt-3 break-all text-sm text-[#777a80]">{displayedUrl}</div>
            {(previewData?.byline || previewData?.siteName || previewData?.excerpt) ? (
              <div className="mt-4 space-y-1 text-sm leading-6 text-[#70757a]">
                {previewData.siteName ? <div>网站：{previewData.siteName}</div> : null}
                {previewData.byline ? <div>作者：{previewData.byline}</div> : null}
                {previewData.excerpt ? <div>摘要：{previewData.excerpt}</div> : null}
              </div>
            ) : null}
          </div>
          <div
            className="web-rich-preview"
            dangerouslySetInnerHTML={{ __html: richHtml }}
          />
        </article>
      </div>
    );
  }

  if (readableText.trim()) {
    return (
      <div className="h-full overflow-y-auto px-6 py-7">
        <MarkdownPreview content={`# ${title}\n\n${readableText}`} variant="document" />
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-500">
      {error || '无法从这个链接提取可读网页内容。'}
    </div>
  );
}

function PreviewBody({
  preview,
  workspaceId
}: {
  preview: TerminalResourcePreview;
  workspaceId: string;
}) {
  const [fileContent, setFileContent] = useState('');
  const [fileContentLoading, setFileContentLoading] = useState(false);
  const [fileContentError, setFileContentError] = useState('');
  const fileUrl = preview.fileObjectId ? fileSystemApi.downloadUrl(workspaceId, preview.fileObjectId) : '';
  const shouldLoadFileContent = Boolean(
    preview.fileObjectId &&
    (
      isLightVisualPreview(preview) ||
      isReactChatVisualPreview(preview) ||
      isQuizPracticePreview(preview) ||
      preview.filename?.toLowerCase().endsWith('.json') ||
      preview.filename?.toLowerCase().endsWith('.md') ||
      preview.kind === 'markdown'
    )
  );

  useEffect(() => {
    if (!shouldLoadFileContent || !preview.fileObjectId) return;
    let cancelled = false;
    setFileContentLoading(true);
    setFileContentError('');
    void fileSystemApi
      .getContent(workspaceId, preview.fileObjectId)
      .then((result) => {
        if (!cancelled) setFileContent(String(result.content || ''));
      })
      .catch((contentError) => {
        if (!cancelled) setFileContentError(contentError?.response?.data?.error || contentError?.message || '加载文件内容失败。');
      })
      .finally(() => {
        if (!cancelled) setFileContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preview.fileObjectId, shouldLoadFileContent, workspaceId]);

  const content = String(fileContent || preview.previewContent || '').trim();
  const contentLooksLikeLightVisual = looksLikeLightVisualLessonContent(content);
  const contentLooksLikeReactChatVisual = looksLikeReactChatVisualContent(content);
  const parts = useMemo(() => parseResponse(content), [content]);
  const displayParts = parts.filter((part) => part.type === 'text' || part.code.trim());
  const hasVisualParts = displayParts.some((part) => part.type === 'html' || part.type === 'react');
  const lightVisualLesson = useMemo(
    () => extractLightVisualLessonPayloadFromText(content, preview.title),
    [content, preview.title]
  );
  const visualCodeLesson = useMemo(
    () => isReactChatVisualPreview(preview) || contentLooksLikeReactChatVisual
      ? extractVisualCodeLessonPayloadFromText(content, preview.title)
      : null,
    [
      content,
      contentLooksLikeReactChatVisual,
      preview.filename,
      preview.framework,
      preview.kind,
      preview.renderer,
      preview.subtitle,
      preview.templateId,
      preview.title
    ]
  );
  const quizPractice = useMemo(
    () => extractQuizPracticePayloadFromText(content, preview.title),
    [content, preview.title]
  );

  if (preview.url) {
    return <UrlPreviewBody preview={preview} workspaceId={workspaceId} />;
  }

  if (fileContentLoading && shouldLoadFileContent && !fileContent) {
    return (
      <div className="flex h-full items-center justify-center gap-3 bg-white px-6 text-sm text-gray-500">
        <Loader2 className="size-4 animate-spin" />
        正在加载完整预览...
      </div>
    );
  }

  if (isLightVisualPreview(preview) || contentLooksLikeLightVisual || lightVisualLesson) {
    return (
      <LightVisualLessonViewer
        result={{ name: preview.title, content }}
        lesson={lightVisualLesson}
      />
    );
  }

  if (visualCodeLesson) {
    return (
      <VisualCodeLessonViewer
        result={{ name: preview.title, content }}
        lesson={visualCodeLesson}
      />
    );
  }

  if (isQuizPracticePreview(preview) || quizPractice) {
    if (quizPractice) {
      return <QuizPracticeViewer lesson={quizPractice} />;
    }
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center p-6 text-center text-sm text-gray-500">
        练习预览仍在加载，或无法解析测验内容。
      </div>
    );
  }

  if (fileContentError && shouldLoadFileContent && !content) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center p-6 text-center text-sm text-gray-500">
        {fileContentError}
      </div>
    );
  }

  if (hasVisualParts) {
    let visualIndex = 0;
    return (
      <div className="space-y-4 px-5 py-6">
        {displayParts.map((part, index) => {
          if (part.type === 'text') {
            return (
              <article key={`text-${index}`} className="px-2 py-1">
                <MarkdownPreview content={part.content} variant="document" />
              </article>
            );
          }
          visualIndex += 1;
          if (part.type === 'html') {
            return (
              <div key={`${part.type}-${index}`} className="h-[440px] overflow-hidden rounded-lg border border-gray-100 bg-white">
                <HtmlFrame
                  content={part.code}
                  title={`预览 ${visualIndex}`}
                />
              </div>
            );
          }
          return (
            <SandboxView
              key={`${part.type}-${index}`}
              vizId={`terminal-preview-${preview.id}-${index}`}
              type={part.type}
              code={part.code}
              title={`预览 ${visualIndex}`}
              initialHeight={440}
            />
          );
        })}
      </div>
    );
  }

  if (content && looksLikeHtml(content)) {
    return <HtmlFrame content={content} title={preview.title} />;
  }

  if (content) {
    return (
      <div className="h-full overflow-y-auto px-6 py-7">
        <MarkdownPreview content={content} variant="document" />
      </div>
    );
  }

  if (fileUrl) {
    return (
      <iframe
        title={preview.title}
        src={fileUrl}
        className="h-full w-full rounded-none border-0 bg-white"
      />
    );
  }

  return (
    <div className="flex h-full min-h-[420px] items-center justify-center p-6 text-center text-sm text-gray-500">
      <div>
        <FileText className="mx-auto mb-3 size-6 text-gray-300" />
        这个资源暂无可预览内容。
      </div>
    </div>
  );
}

export default function TerminalResourcePreviewPanel({
  workspaceId,
  workbenchId,
  preview,
  onClose
}: {
  workspaceId: string;
  workbenchId?: string;
  preview: TerminalResourcePreview;
  onClose: () => void;
}) {
  const fileUrl = preview.fileObjectId ? fileSystemApi.downloadUrl(workspaceId, preview.fileObjectId) : '';
  const externalUrl = preview.url || fileUrl;
  const content = String(preview.previewContent || preview.url || '');
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const importLabel = workbenchId ? '导入到 workbench' : '导入';

  const importSource = async () => {
    if (!preview.url || importing || imported) return;
    setImporting(true);
    try {
      await fileSystemApi.importUrl(workspaceId, {
        url: preview.url,
        title: preview.title,
        ...(workbenchId ? { workbenchId, scope: 'workbench' } : {})
      });
      setImported(true);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div id="artifacts-container" className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-white">
      <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="pointer-events-auto z-20 flex min-w-0 shrink-0 items-center justify-between gap-2 p-2.5 text-gray-900">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2 pr-1">
            <div className="min-w-0 flex items-center space-x-2">
              <div className="flex min-w-fit items-center gap-0.5 self-center" dir="ltr">
                <button
                  type="button"
                  disabled
                  className="self-center rounded-md p-1 transition hover:bg-black/5 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="size-3.5"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                  </svg>
                </button>

                <div className="min-w-fit self-center text-xs">版本 1 / 1</div>

                <button
                  type="button"
                  disabled
                  className="self-center rounded-md p-1 transition hover:bg-black/5 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="size-3.5"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex min-w-0 shrink-0 items-center gap-1.5">
              {preview.url ? (
                <button
                  type="button"
                  onClick={() => void importSource()}
                  disabled={importing || imported}
                  className="inline-flex items-center gap-1 rounded-md border-none bg-gray-50 px-2 py-0.5 text-xs transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                  title={importLabel}
                >
                  {imported ? <FileCheck2 className="size-3.5" /> : importing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                  {imported ? '已导入' : '导入'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void copyText(content)}
                disabled={!content}
                className="copy-code-button rounded-md border-none bg-gray-50 px-1.5 py-0.5 text-xs transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                复制
              </button>

              {fileUrl ? (
                <a
                  href={fileUrl}
                  download
                  className="rounded-md border-none bg-gray-50 p-0.5 text-xs transition hover:bg-gray-100"
                  title="下载"
                >
                  <Download className="size-3.5" />
                </a>
              ) : null}

              {externalUrl ? (
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border-none bg-gray-50 p-0.5 text-xs transition hover:bg-gray-100"
                  title="全屏打开"
                >
                  <Expand className="size-3.5" />
                </a>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="pointer-events-auto shrink-0 self-center rounded-full bg-white p-1"
            aria-label="关闭资源预览"
          >
            <X className="size-3.5 text-gray-900" />
          </button>
        </div>

        <div className="min-h-0 w-full flex-1 overflow-hidden">
          <div className="flex h-full flex-col">
            <div className="h-full w-full max-w-full">
              <PreviewBody preview={preview} workspaceId={workspaceId} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
