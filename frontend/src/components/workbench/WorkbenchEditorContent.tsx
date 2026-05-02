import {
  ArrowUpRight,
  Eye,
  ExternalLink,
  FileCode2,
  FileText,
  FolderOpen,
  Globe,
  PencilLine,
  Send,
  Sparkles,
  Video
} from 'lucide-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { EditorState, ResourceReference } from '../../types';
import { FilePreviewInfo, fileSystemApi } from '../../services/fileSystemApi';
import { aiApi, AiChatMessage } from '../../services/aiApi';
import MarkdownPreview from './MarkdownPreview';
import SyntaxHighlightedCode from './SyntaxHighlightedCode';
import {
  getLanguageLabel,
  getResourceKind,
  isJsonResource,
  isMarkdownResource
} from './editorResource';
import BlockSuiteNotesEditor from './BlockSuiteNotesEditor';
import BlockSuiteCodeEditor from './BlockSuiteCodeEditor';

interface WorkbenchEditorContentProps {
  editor: EditorState;
  resource: ResourceReference | null;
  workspaceId: string;
  content?: string;
  isDirty?: boolean;
  isLoading?: boolean;
  onChangeContent?: (resourceId: string, content: string) => void;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  onBindResource: (editorId: string) => void;
  aiContext?: {
    workbenchTitle?: string;
    workbenchDescription?: string;
    workbenchId?: string;
    activeFile?: { id?: string; name: string; path: string } | null;
    activeFileContent?: string | null;
    activeExternal?: { title: string; url: string; description?: string } | null;
  };
}

const getEditorIcon = (type: EditorState['type']) => {
  switch (type) {
    case 'resource':
      return <FolderOpen className="h-5 w-5" />;
    case 'notes':
      return <FileText className="h-5 w-5" />;
    case 'code':
      return <FileCode2 className="h-5 w-5" />;
    case 'video':
      return <Video className="h-5 w-5" />;
    case 'external':
      return <Globe className="h-5 w-5" />;
    case 'ai':
      return <Sparkles className="h-5 w-5" />;
  }
};

const PlainTextPreview = ({
  content,
  emptyMessage = 'Nothing to preview yet.'
}: {
  content: string;
  emptyMessage?: string;
}) => {
  if (!content.trim()) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-[var(--wb-text-muted)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap bg-white p-6 font-mono text-sm leading-7 text-[#25272b]">
      {content}
    </pre>
  );
};

function TextEditorShell({
  toolbar,
  children
}: {
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      {toolbar}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function DocumentPreview({
  resource,
  workspaceId
}: {
  resource: ResourceReference;
  workspaceId: string;
}) {
  const [previewInfo, setPreviewInfo] = useState<FilePreviewInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    void fileSystemApi
      .getPreviewInfo(workspaceId, resource.id)
      .then((info) => {
        if (active) setPreviewInfo(info);
      })
      .catch(() => {
        if (active) {
          setPreviewInfo({
            status: 'unavailable',
            previewKind: 'document',
            sourceUrl: fileSystemApi.downloadUrl(workspaceId, resource.id),
            message: 'Preview is temporarily unavailable for this document.'
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [resource.id, workspaceId]);

  return (
    <div className="h-full overflow-hidden bg-white p-5 text-[#25272b]">
      <div className="flex h-full min-h-0 flex-col rounded-3xl border border-[#e5e5e1] bg-white p-4 shadow-sm">
        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#eeeeeb] bg-[#fbfbfa]">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-[#777a80]">
              Preparing document preview...
            </div>
          ) : previewInfo?.status === 'ready' && previewInfo.previewUrl ? (
            <iframe
              title={resource.name}
              src={previewInfo.previewUrl}
              className="h-full min-h-[320px] w-full bg-white"
            />
          ) : (
            <div className="flex h-full flex-col justify-center gap-4 p-6 text-sm text-[#777a80]">
              <p>{previewInfo?.message || 'This document cannot be previewed right now.'}</p>
              <p>当前版本不支持原位编辑，建议外部编辑后回写到工作区文件。</p>
              {previewInfo?.sourceUrl && (
                <a
                  href={previewInfo.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-2 rounded-full border border-[#e5e5e1] bg-white px-4 py-2 text-[#34373c] transition-all duration-200 hover:bg-[#f6f6f4]"
                >
                  Open Original File
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HtmlVisualizationPreview({
  resource,
  workspaceId
}: {
  resource: ResourceReference;
  workspaceId: string;
}) {
  const previewUrl = fileSystemApi.downloadUrl(workspaceId, resource.id);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="flex items-center justify-between border-b border-[#eeeeeb] bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#25272b]">{resource.name}</div>
          <div className="truncate text-xs text-[#96999d]">
            Interactive visualization
          </div>
        </div>
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-[#e5e5e1] bg-white px-3 py-1.5 text-xs text-[#34373c] transition-all duration-200 hover:bg-[#f6f6f4]"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          Open Fullscreen
        </a>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <div className="h-full overflow-hidden rounded-2xl border border-[#e5e5e1] bg-white shadow-sm">
          <iframe title={resource.name} src={previewUrl} className="h-full w-full bg-white" />
        </div>
      </div>
    </div>
  );
}

function TextEditingSurface({
  editor,
  resource,
  content,
  isLoading,
  onChangeContent,
  onUpdateViewState
}: {
  editor: EditorState;
  resource: ResourceReference;
  content: string;
  isLoading: boolean;
  onChangeContent?: (resourceId: string, content: string) => void;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
}) {
  const resourceKind = getResourceKind(resource);
  const languageLabel = getLanguageLabel(resource);
  const previewMode =
    (editor.viewState.mode as 'edit' | 'preview' | undefined) ||
    (editor.type === 'notes' ? 'edit' : 'preview');
  const editable = resourceKind !== 'binary' && resourceKind !== 'document' && resourceKind !== 'pdf';
  const showMarkdownPreview = isMarkdownResource(resource);
  const showStructuredEditor = resourceKind === 'structured' || resourceKind === 'code';
  const codeOpenMode =
    (editor.viewState.codeOpenMode as 'blocksuite' | 'plain' | undefined) || 'blocksuite';

  const handleFormat = () => {
    if (!resource.id || !isJsonResource(resource)) return;

    try {
      const formatted = JSON.stringify(JSON.parse(content || '{}'), null, 2);
      onChangeContent?.(resource.id, formatted);
    } catch {
      // Keep the current content when JSON is invalid.
    }
  };

  return (
    <TextEditorShell
      toolbar={
        <div className="flex items-center justify-between border-b border-[#eeeeeb] bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            {editor.type === 'code' && (
              <>
                <button
                  onClick={() => onUpdateViewState?.(editor.id, { codeOpenMode: 'blocksuite' })}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                    codeOpenMode === 'blocksuite'
                      ? 'bg-[#202124] text-white shadow-sm'
                      : 'text-[#777a80] hover:bg-[#f1f1ef] hover:text-[#202124]'
                  }`}
                >
                  BlockSuite
                </button>
                <button
                  onClick={() => onUpdateViewState?.(editor.id, { codeOpenMode: 'plain' })}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                    codeOpenMode === 'plain'
                      ? 'bg-[#202124] text-white shadow-sm'
                      : 'text-[#777a80] hover:bg-[#f1f1ef] hover:text-[#202124]'
                  }`}
                >
                  Plain
                </button>
              </>
            )}
            <button
              onClick={() => onUpdateViewState?.(editor.id, { mode: 'edit' })}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                previewMode === 'edit'
                  ? 'bg-[#202124] text-white shadow-sm'
                  : 'text-[#777a80] hover:bg-[#f1f1ef] hover:text-[#202124]'
              }`}
            >
              <PencilLine className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              onClick={() => onUpdateViewState?.(editor.id, { mode: 'preview' })}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                previewMode === 'preview'
                  ? 'bg-[#202124] text-white shadow-sm'
                  : 'text-[#777a80] hover:bg-[#f1f1ef] hover:text-[#202124]'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#777a80]">
            <span>{languageLabel}</span>
            {showStructuredEditor && isJsonResource(resource) && (
              <button
                onClick={handleFormat}
                className="rounded-full border border-[#e5e5e1] bg-white px-3 py-1.5 font-medium text-[#34373c] transition-all duration-200 hover:bg-[#f6f6f4]"
              >
                Format JSON
              </button>
            )}
          </div>
        </div>
      }
    >
      {previewMode === 'edit' && editable ? (
        <textarea
          value={String(content ?? '')}
          onChange={(event) => resource.id && onChangeContent?.(resource.id, event.target.value)}
          className="h-full w-full resize-none border-0 bg-white px-5 py-4 font-mono text-sm leading-6 text-[#25272b] outline-none placeholder:text-[#a6a8ab]"
          placeholder={isLoading ? 'Loading file content...' : 'Open a file to start editing.'}
          spellCheck={editor.type === 'notes'}
        />
      ) : showMarkdownPreview ? (
        <MarkdownPreview
          content={content}
          emptyMessage={isLoading ? 'Loading file content...' : 'Open a markdown note to preview.'}
        />
      ) : resourceKind === 'note' ? (
        <PlainTextPreview
          content={content}
          emptyMessage={isLoading ? 'Loading file content...' : 'Open a text note to preview.'}
        />
      ) : (
        <SyntaxHighlightedCode
          code={content}
          language={languageLabel}
          emptyMessage={isLoading ? 'Loading file content...' : 'Open a file to preview.'}
        />
      )}
    </TextEditorShell>
  );
}

function ExternalEditorView({
  editor
}: {
  editor: EditorState;
}) {
  const externalResource = editor.viewState?.externalResource as
    | { title?: string; url?: string; description?: string }
    | undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white text-[#25272b]">
      <div className="flex items-center justify-between border-b border-[#eeeeeb] bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Globe className="h-4 w-4 shrink-0 text-[#16833a]" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[#25272b]">
              {externalResource?.title || editor.title}
            </div>
            <div className="truncate text-xs text-[#96999d]">External Reference</div>
          </div>
        </div>
        {externalResource?.url && (
          <a
            href={externalResource.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-[#e5e5e1] bg-white px-2.5 py-1.5 text-xs text-[#34373c] transition-all duration-200 hover:bg-[#f6f6f4]"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            Open
          </a>
        )}
      </div>

      <div className="p-5">
      <div className="rounded-3xl border border-[#e5e5e1] bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#16833a]">
          <Globe className="h-4 w-4" />
          External Resource
        </div>
        <div className="mt-4 text-2xl font-semibold text-[#25272b]">
          {externalResource?.title || editor.title}
        </div>
        <div className="mt-2 break-all text-sm text-[#777a80]">
          {externalResource?.url || 'No URL provided'}
        </div>
        {externalResource?.description && (
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[#777a80]">
            {externalResource.description}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {externalResource?.url && (
            <a
              href={externalResource.url}
              target="_blank"
              rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-[#202124] px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-[#34373c] active:scale-95"
            >
              <ExternalLink className="h-4 w-4" />
              Open Source
            </a>
          )}
          <div className="inline-flex items-center rounded-full border border-[#e5e5e1] px-4 py-2 text-sm text-[#777a80]">
            This panel references an external source and does not own storage.
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

function AiEditorView({
  editor,
  workspaceId,
  aiContext,
  onUpdateViewState
}: {
  editor: EditorState;
  workspaceId: string;
  aiContext?: WorkbenchEditorContentProps['aiContext'];
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
}) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messages = useMemo(
    () =>
      Array.isArray(editor.viewState?.messages) && editor.viewState.messages.length > 0
        ? editor.viewState.messages
        : [
            {
              role: 'assistant',
              content:
                'I can work with files and external references in this workbench. Open both side by side and I will use that context for the current task.'
            }
          ],
    [editor.viewState?.messages]
  );

  const handleSend = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isSending) return;

    const previousMessages = [...messages] as AiChatMessage[];
    const nextMessages: AiChatMessage[] = [
      ...previousMessages,
      { role: 'user', content: trimmedInput }
    ];

    onUpdateViewState?.(editor.id, { messages: nextMessages });
    setInput('');
    setError(null);
    setIsSending(true);

    try {
      const response = await aiApi.chat({
        messages: nextMessages,
        context: {
          workbenchTitle: aiContext?.workbenchTitle,
          workbenchDescription: aiContext?.workbenchDescription,
          workspaceId,
          workbenchId: aiContext?.workbenchId,
          activeFile: aiContext?.activeFile
            ? {
                ...aiContext.activeFile,
                content: aiContext.activeFileContent || undefined
              }
            : null,
          activeExternal: aiContext?.activeExternal || null
        }
      });

      onUpdateViewState?.(editor.id, {
        messages: [
          ...nextMessages,
          {
            role: 'assistant',
            content: response.reply
          }
        ],
        lastModel: response.model || 'deepseek-chat'
      });
    } catch (sendError: any) {
      const message =
        sendError?.response?.data?.error ||
        sendError?.message ||
        'AI request failed. Please check the backend configuration.';
      setError(message);
      onUpdateViewState?.(editor.id, { messages: previousMessages });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="border-b border-[#eeeeeb] bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-[#16833a]" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[#25272b]">{editor.title}</div>
              <div className="truncate text-xs text-[#96999d]">
                DeepSeek chat scoped to the current workbench context
              </div>
            </div>
          </div>
          <div className="rounded-full bg-[#f1f1ef] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#777a80]">
            {isSending ? 'Thinking' : 'DeepSeek'}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {aiContext?.activeExternal && (
            <span className="rounded-full bg-[#f1f1ef] px-3 py-1 text-xs font-medium text-[#34373c]">
              External: {aiContext.activeExternal.title}
            </span>
          )}
          {aiContext?.activeFile && (
            <span className="rounded-full bg-[#f1f1ef] px-3 py-1 text-xs font-medium text-[#34373c]">
              File: {aiContext.activeFile.name}
            </span>
          )}
        </div>
        {error && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {error}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-white px-5 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.map((message: { role: string; content: string }, index: number) => (
            <div
              key={`${message.role}-${index}`}
              className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                message.role === 'user'
                  ? 'self-end bg-[#202124] text-white'
                  : 'self-start border border-[#e5e5e1] bg-[#fbfbfa] text-[#25272b]'
              }`}
            >
              <div className="whitespace-pre-wrap">{message.content}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-[#eeeeeb] bg-white px-5 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              onClick={() => setInput('Summarize the current external resource')}
                className="rounded-full border border-[#e5e5e1] px-3 py-1 text-xs font-medium text-[#777a80] transition-all duration-200 hover:bg-[#f6f6f4]"
            >
              Summarize external resource
            </button>
            <button
              onClick={() => setInput('Compare the open file with the current external resource')}
              className="rounded-full border border-[#e5e5e1] px-3 py-1 text-xs font-medium text-[#777a80] transition-all duration-200 hover:bg-[#f6f6f4]"
            >
              Compare file and reference
            </button>
            <button
              onClick={() => setInput('请结合当前文件内容，讲解这段代码或知识点的核心思路、复杂度和常见考点')}
              className="rounded-full border border-[#e5e5e1] px-3 py-1 text-xs font-medium text-[#777a80] transition-all duration-200 hover:bg-[#f6f6f4]"
            >
              Explain current file
            </button>
          </div>
          <div className="flex items-end gap-3 rounded-3xl border border-[#e5e5e1] bg-white p-3 shadow-[0_18px_60px_rgba(0,0,0,0.08)]">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              rows={2}
              placeholder="Ask AI to work with the current file and external context..."
              disabled={isSending}
              className="min-h-[52px] flex-1 resize-none border-0 bg-transparent text-sm text-[#25272b] outline-none placeholder:text-[#a6a8ab]"
            />
            <button
              onClick={() => void handleSend()}
              disabled={isSending || !input.trim()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#202124] text-white transition-all duration-200 hover:bg-[#34373c] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              title="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorkbenchEditorContent({
  editor,
  resource,
  workspaceId,
  content,
  isLoading = false,
  onChangeContent,
  onUpdateViewState,
  onBindResource,
  aiContext
}: WorkbenchEditorContentProps) {
  if (editor.type === 'notes') {
    return (
      <BlockSuiteNotesEditor
        editor={editor}
        resource={resource}
        content={content ?? ''}
        isLoading={Boolean(isLoading)}
        onChangeContent={onChangeContent}
        onUpdateViewState={onUpdateViewState}
        onBindResource={onBindResource}
      />
    );
  }

  if (editor.type === 'ai') {
    return <AiEditorView editor={editor} workspaceId={workspaceId} aiContext={aiContext} onUpdateViewState={onUpdateViewState} />;
  }

  if (editor.type === 'external') {
    return <ExternalEditorView editor={editor} />;
  }

  if (!resource) {
    return (
      <div className="flex h-full overflow-hidden flex-col items-center justify-center gap-4 bg-white px-8 text-center">
        <div className="rounded-2xl border border-[#e5e5e1] bg-[#f6f6f4] p-4 text-[#777a80] shadow-sm">
          {getEditorIcon(editor.type)}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[#25272b]">No resource bound yet</h3>
          <p className="mt-2 max-w-md text-sm text-[#777a80]">
            This editor references a workspace file. The file content remains in the shared file
            system.
          </p>
        </div>
        <button
          onClick={() => onBindResource(editor.id)}
          className="rounded-full border border-[#e5e5e1] bg-white px-4 py-2 text-sm font-medium text-[#34373c] transition-all duration-200 hover:bg-[#f6f6f4] active:scale-95"
        >
          Bind Resource
        </button>
      </div>
    );
  }

  const resourceKind = getResourceKind(resource);

  if (resourceKind === 'html') {
    return <HtmlVisualizationPreview resource={resource} workspaceId={workspaceId} />;
  }

  if (editor.type === 'video' || resourceKind === 'video') {
    return (
      <div className="flex h-full overflow-hidden flex-col justify-between bg-white p-6 text-[#25272b]">
        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.14em] text-[#96999d]">Video</div>
          </div>
          <div className="mt-4 text-xl font-semibold">{resource.name}</div>
          <div className="mt-2 break-all text-sm text-[#777a80]">{resource.path}</div>
        </div>
        <div className="rounded-3xl border border-[#e5e5e1] bg-[#fbfbfa] px-4 py-10 text-center text-sm text-[#777a80] shadow-sm">
          Video playback is intentionally not implemented yet. This editor preserves the resource
          reference and open state.
        </div>
      </div>
    );
  }

  if (resourceKind === 'pdf' || resourceKind === 'document' || editor.type === 'resource') {
    return <DocumentPreview resource={resource} workspaceId={workspaceId} />;
  }

  if (
    editor.type === 'code' &&
    (resourceKind === 'code' || resourceKind === 'structured') &&
    ((editor.viewState.codeOpenMode as 'blocksuite' | 'plain' | undefined) || 'blocksuite') ===
      'blocksuite'
  ) {
    return (
      <BlockSuiteCodeEditor
        editor={editor}
        resource={resource}
        content={String(content ?? '')}
        isLoading={isLoading}
        onChangeContent={onChangeContent}
        onUpdateViewState={onUpdateViewState}
      />
    );
  }

  return (
    <TextEditingSurface
      editor={editor}
      resource={resource}
      content={String(content ?? '')}
      isLoading={isLoading}
      onChangeContent={onChangeContent}
      onUpdateViewState={onUpdateViewState}
    />
  );
}
