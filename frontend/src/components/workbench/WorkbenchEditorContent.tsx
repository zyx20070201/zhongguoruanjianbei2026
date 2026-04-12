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
    activeFile?: { name: string; path: string } | null;
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
    <pre className="h-full overflow-auto whitespace-pre-wrap bg-[var(--wb-editor)] p-6 font-mono text-sm leading-7 text-[var(--wb-text)]">
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--wb-editor)]">
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
    <div className="h-full overflow-hidden bg-[var(--wb-editor)] p-5 text-[var(--wb-text)]">
      <div className="flex h-full min-h-0 flex-col rounded border border-[var(--wb-border)] bg-[var(--wb-panel)] p-4 shadow-sm">
        <div className="min-h-0 flex-1 overflow-hidden rounded border border-[var(--wb-border)] bg-[var(--wb-editor)]">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--wb-text-muted)]">
              Preparing document preview...
            </div>
          ) : previewInfo?.status === 'ready' && previewInfo.previewUrl ? (
            <iframe
              title={resource.name}
              src={previewInfo.previewUrl}
              className="h-full min-h-[320px] w-full bg-white"
            />
          ) : (
            <div className="flex h-full flex-col justify-center gap-4 p-6 text-sm text-[var(--wb-text-muted)]">
              <p>{previewInfo?.message || 'This document cannot be previewed right now.'}</p>
              <p>当前版本不支持原位编辑，建议外部编辑后回写到工作区文件。</p>
              {previewInfo?.sourceUrl && (
                <a
                  href={previewInfo.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-2 rounded border border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] px-4 py-2 text-[var(--wb-text)] hover:bg-white/5"
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
        <div className="flex items-center justify-between border-b border-[var(--wb-border)] bg-[var(--wb-panel)] px-4 py-2">
          <div className="flex items-center gap-2">
            {editor.type === 'code' && (
              <>
                <button
                  onClick={() => onUpdateViewState?.(editor.id, { codeOpenMode: 'blocksuite' })}
                  className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                    codeOpenMode === 'blocksuite'
                      ? 'bg-[var(--wb-tab)] text-[var(--wb-text)] shadow-sm ring-1 ring-[var(--wb-border)]'
                      : 'text-[var(--wb-text-muted)] hover:bg-white/5 hover:text-[var(--wb-text)]'
                  }`}
                >
                  BlockSuite
                </button>
                <button
                  onClick={() => onUpdateViewState?.(editor.id, { codeOpenMode: 'plain' })}
                  className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                    codeOpenMode === 'plain'
                      ? 'bg-[var(--wb-tab)] text-[var(--wb-text)] shadow-sm ring-1 ring-[var(--wb-border)]'
                      : 'text-[var(--wb-text-muted)] hover:bg-white/5 hover:text-[var(--wb-text)]'
                  }`}
                >
                  Plain
                </button>
              </>
            )}
            <button
              onClick={() => onUpdateViewState?.(editor.id, { mode: 'edit' })}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                previewMode === 'edit'
                  ? 'bg-[var(--wb-tab)] text-[var(--wb-text)] shadow-sm ring-1 ring-[var(--wb-border)]'
                  : 'text-[var(--wb-text-muted)] hover:bg-white/5 hover:text-[var(--wb-text)]'
              }`}
            >
              <PencilLine className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              onClick={() => onUpdateViewState?.(editor.id, { mode: 'preview' })}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                previewMode === 'preview'
                  ? 'bg-[var(--wb-tab)] text-[var(--wb-text)] shadow-sm ring-1 ring-[var(--wb-border)]'
                  : 'text-[var(--wb-text-muted)] hover:bg-white/5 hover:text-[var(--wb-text)]'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--wb-text-muted)]">
            <span>{languageLabel}</span>
            {showStructuredEditor && isJsonResource(resource) && (
              <button
                onClick={handleFormat}
                className="rounded border border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] px-3 py-1.5 font-medium text-[var(--wb-text)] hover:bg-white/5"
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
          className="h-full w-full resize-none border-0 bg-[var(--wb-editor)] px-5 py-4 font-mono text-sm leading-6 text-[var(--wb-text)] outline-none"
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
    <div className="flex h-full flex-col overflow-hidden bg-[var(--wb-editor)] text-[var(--wb-text)]">
      <div className="flex items-center justify-between border-b border-[var(--wb-border)] bg-[var(--wb-panel)] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Globe className="h-4 w-4 shrink-0 text-[var(--wb-accent)]" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[var(--wb-text)]">
              {externalResource?.title || editor.title}
            </div>
            <div className="truncate text-xs text-[var(--wb-text-dim)]">External Reference</div>
          </div>
        </div>
        {externalResource?.url && (
          <a
            href={externalResource.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded border border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] px-2.5 py-1.5 text-xs text-[var(--wb-text)] hover:bg-white/5"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            Open
          </a>
        )}
      </div>

      <div className="p-5">
      <div className="rounded border border-[var(--wb-border)] bg-[var(--wb-panel)] p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--wb-accent)]">
          <Globe className="h-4 w-4" />
          External Resource
        </div>
        <div className="mt-4 text-2xl font-semibold text-[var(--wb-text)]">
          {externalResource?.title || editor.title}
        </div>
        <div className="mt-2 break-all text-sm text-[var(--wb-text-muted)]">
          {externalResource?.url || 'No URL provided'}
        </div>
        {externalResource?.description && (
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--wb-text-muted)]">
            {externalResource.description}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {externalResource?.url && (
            <a
              href={externalResource.url}
              target="_blank"
              rel="noreferrer"
                className="inline-flex items-center gap-2 rounded bg-[var(--wb-accent)] px-4 py-2 text-sm font-medium text-[#08111c] transition hover:brightness-110"
            >
              <ExternalLink className="h-4 w-4" />
              Open Source
            </a>
          )}
          <div className="inline-flex items-center rounded border border-[var(--wb-border)] px-4 py-2 text-sm text-[var(--wb-text-muted)]">
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
  aiContext,
  onUpdateViewState
}: {
  editor: EditorState;
  aiContext?: WorkbenchEditorContentProps['aiContext'];
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
}) {
  const [input, setInput] = useState('');
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

  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input.trim() };
    const contextLines = [
      aiContext?.activeExternal
        ? `External: ${aiContext.activeExternal.title} (${aiContext.activeExternal.url})`
        : null,
      aiContext?.activeFile ? `File: ${aiContext.activeFile.path}` : null
    ].filter(Boolean);
    const assistantMessage = {
      role: 'assistant',
      content: contextLines.length
        ? `I will use the current workbench context for this task.\n${contextLines.join('\n')}`
        : 'I can help with the current workbench task. Open a file or external resource to give me more context.'
    };

    onUpdateViewState?.(editor.id, {
      messages: [...messages, userMessage, assistantMessage]
    });
    setInput('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--wb-editor)]">
      <div className="border-b border-[var(--wb-border)] bg-[var(--wb-panel)] px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-[var(--wb-accent)]" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--wb-text)]">{editor.title}</div>
              <div className="truncate text-xs text-[var(--wb-text-dim)]">
                Scoped to the current workbench context
              </div>
            </div>
          </div>
          <div className="rounded-sm bg-[rgba(90,166,255,0.14)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--wb-accent)]">
            AI
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {aiContext?.activeExternal && (
            <span className="rounded-full bg-[rgba(90,166,255,0.12)] px-3 py-1 text-xs font-medium text-[#dbeaff]">
              External: {aiContext.activeExternal.title}
            </span>
          )}
          {aiContext?.activeFile && (
            <span className="rounded-full bg-[rgba(90,166,255,0.18)] px-3 py-1 text-xs font-medium text-[#dbeaff]">
              File: {aiContext.activeFile.name}
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--wb-editor)] px-5 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.map((message: { role: string; content: string }, index: number) => (
            <div
              key={`${message.role}-${index}`}
              className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                message.role === 'user'
                  ? 'self-end bg-[var(--wb-accent)] text-[#08111c]'
                  : 'self-start border border-[var(--wb-border)] bg-[var(--wb-panel)] text-[var(--wb-text)]'
              }`}
            >
              <div className="whitespace-pre-wrap">{message.content}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--wb-border)] bg-[var(--wb-panel)] px-5 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              onClick={() => setInput('Summarize the current external resource')}
                className="rounded-full border border-[var(--wb-border)] px-3 py-1 text-xs font-medium text-[var(--wb-text-muted)] hover:bg-white/5"
            >
              Summarize external resource
            </button>
            <button
              onClick={() => setInput('Compare the open file with the current external resource')}
                className="rounded-full border border-[var(--wb-border)] px-3 py-1 text-xs font-medium text-[var(--wb-text-muted)] hover:bg-white/5"
            >
              Compare file and reference
            </button>
          </div>
          <div className="flex items-end gap-3 rounded border border-[var(--wb-border)] bg-[var(--wb-editor)] p-3 shadow-sm">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              rows={2}
              placeholder="Ask AI to work with the current file and external context..."
              className="min-h-[52px] flex-1 resize-none border-0 bg-transparent text-sm text-[var(--wb-text)] outline-none"
            />
            <button
              onClick={handleSend}
              className="inline-flex h-10 w-10 items-center justify-center rounded bg-[var(--wb-accent)] text-[#08111c] transition hover:brightness-110"
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
    return <AiEditorView editor={editor} aiContext={aiContext} onUpdateViewState={onUpdateViewState} />;
  }

  if (editor.type === 'external') {
    return <ExternalEditorView editor={editor} />;
  }

  if (!resource) {
    return (
      <div className="flex h-full overflow-hidden flex-col items-center justify-center gap-4 bg-[var(--wb-editor)] px-8 text-center">
        <div className="rounded border border-[var(--wb-border)] bg-[var(--wb-panel)] p-4 text-[var(--wb-text-muted)] shadow-sm">
          {getEditorIcon(editor.type)}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--wb-text)]">No resource bound yet</h3>
          <p className="mt-2 max-w-md text-sm text-[var(--wb-text-muted)]">
            This editor references a workspace file. The file content remains in the shared file
            system.
          </p>
        </div>
        <button
          onClick={() => onBindResource(editor.id)}
          className="rounded border border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] px-4 py-2 text-sm font-medium text-[var(--wb-text)] transition-colors hover:bg-white/5"
        >
          Bind Resource
        </button>
      </div>
    );
  }

  const resourceKind = getResourceKind(resource);

  if (editor.type === 'video' || resourceKind === 'video') {
    return (
      <div className="flex h-full overflow-hidden flex-col justify-between bg-[var(--wb-editor)] p-6 text-[var(--wb-text)]">
        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.2em] text-[var(--wb-text-dim)]">Video</div>
          </div>
          <div className="mt-4 text-xl font-semibold">{resource.name}</div>
          <div className="mt-2 break-all text-sm text-[var(--wb-text-muted)]">{resource.path}</div>
        </div>
        <div className="rounded border border-[var(--wb-border)] bg-[var(--wb-panel)] px-4 py-10 text-center text-sm text-[var(--wb-text-muted)] shadow-sm">
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
