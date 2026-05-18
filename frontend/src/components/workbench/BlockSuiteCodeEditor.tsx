import { useEffect, useRef, useState } from 'react';
import { effects as registerBlocksuiteBlockEffects } from '@blocksuite/blocks/effects';
import { effects as registerBlocksuiteEffects } from '@blocksuite/presets/effects';
import type { Doc } from '@blocksuite/store';
import { Loader2 } from 'lucide-react';
import { EditorState, ResourceReference } from '../../types';
import {
  BlocksuiteMode,
  BlocksuiteSnapshot,
  createBlocksuiteDoc,
  createCodeBlockMarkdown,
  extractCodeFromBlocksuiteMarkdown,
  serializeBlocksuiteMarkdown,
  serializeBlocksuiteSnapshot
} from './blocksuite';

interface BlockSuiteCodeEditorProps {
  editor: EditorState;
  resource: ResourceReference;
  content: string;
  isDirty?: boolean;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  savedAt?: string;
  saveError?: string;
  isLoading: boolean;
  onChangeContent?: (resourceId: string, content: string) => void;
  onSaveContent?: (content?: string) => void;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
}

type EditorElement = HTMLElement & {
  doc: Doc;
  mode: BlocksuiteMode;
  autofocus?: boolean;
};

const DEFAULT_MODE: BlocksuiteMode = 'page';

let blocksuiteRegistered = false;

function ensureBlocksuiteRegistered() {
  if (blocksuiteRegistered) return;

  if (!customElements.get('editor-host')) {
    registerBlocksuiteBlockEffects();
  }

  if (!customElements.get('affine-editor-container')) {
    registerBlocksuiteEffects();
  }

  blocksuiteRegistered = true;
}

function getStoredSnapshot(editor: EditorState): BlocksuiteSnapshot | null {
  const snapshot = editor.viewState?.blocksuiteSnapshot;
  return snapshot && typeof snapshot === 'object' ? (snapshot as BlocksuiteSnapshot) : null;
}

function normalizeCodeContent(value: string | null | undefined) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

function getStoredSourceContent(editor: EditorState): string | null {
  const sourceContent = editor.viewState?.blocksuiteSourceContent;
  return typeof sourceContent === 'string' ? normalizeCodeContent(sourceContent) : null;
}

export default function BlockSuiteCodeEditor({
  editor,
  resource,
  content,
  isLoading,
  onChangeContent,
  onUpdateViewState
}: BlockSuiteCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorElementRef = useRef<EditorElement | null>(null);
  const docRef = useRef<Doc | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastSnapshotRef = useRef('');
  const lastMarkdownRef = useRef('');
  const lastSourceContentRef = useRef('');
  const loadedKeyRef = useRef('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docRevision, setDocRevision] = useState(0);

  const mode = (editor.viewState?.blocksuiteMode as BlocksuiteMode | undefined) || DEFAULT_MODE;
  const normalizedContent = normalizeCodeContent(content);
  const reportVisibleState = (element: HTMLDivElement) => {
    const totalScrollable = Math.max(1, element.scrollHeight - element.clientHeight);
    const lineHeight = 24;
    const start = Math.max(1, Math.floor(element.scrollTop / lineHeight) + 1);
    const end = Math.max(start, Math.ceil((element.scrollTop + element.clientHeight) / lineHeight));
    onUpdateViewState?.(editor.id, {
      visibleLineRange: { start, end },
      scrollRatio: Math.min(1, Math.max(0, element.scrollTop / totalScrollable)),
      approxChunkIndex: Math.max(0, start - 1),
      selectedText: window.getSelection()?.toString().trim() || ''
    });
  };

  const flushDocumentContent = async () => {
    const activeDoc = docRef.current;
    if (!activeDoc) return normalizedContent;

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const snapshot = serializeBlocksuiteSnapshot(activeDoc);
    const snapshotText = JSON.stringify(snapshot ?? null);
    const markdown = await serializeBlocksuiteMarkdown(activeDoc);
    const extractedContent = normalizeCodeContent(extractCodeFromBlocksuiteMarkdown(markdown));
    const nextMode = editorElementRef.current?.mode || mode;

    if (snapshotText !== lastSnapshotRef.current || extractedContent !== lastSourceContentRef.current || markdown !== lastMarkdownRef.current) {
      lastSnapshotRef.current = snapshotText;
      lastSourceContentRef.current = extractedContent;
      lastMarkdownRef.current = markdown;
      onUpdateViewState?.(editor.id, {
        blocksuiteSnapshot: snapshot,
        blocksuiteSourceContent: extractedContent,
        blocksuiteMode: nextMode
      });
      onChangeContent?.(resource.id, extractedContent);
    }

    return extractedContent;
  };

  useEffect(() => {
    ensureBlocksuiteRegistered();
  }, []);

  useEffect(() => {
    const element = document.createElement('affine-editor-container') as EditorElement;
    element.className = 'h-full w-full';
    element.autofocus = true;
    editorElementRef.current = element;

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      element.remove();
      editorElementRef.current = null;
      docRef.current = null;
    };
  }, []);

  useEffect(() => {
    const element = editorElementRef.current;
    if (!element) return;
    element.mode = mode;
  }, [mode]);

  useEffect(() => {
    const element = editorElementRef.current;
    if (!element) return;

    const snapshot = getStoredSnapshot(editor);
    const storedSourceContent = getStoredSourceContent(editor);
    const canUseSnapshot = Boolean(snapshot) && storedSourceContent === normalizedContent;

    if (!canUseSnapshot && isLoading) {
      return;
    }

    const markdownSource = createCodeBlockMarkdown(normalizedContent, resource);
    const loadKey = `${editor.id}:${resource.id}:${canUseSnapshot ? 'snapshot' : markdownSource}`;
    if (loadedKeyRef.current === loadKey) {
      return;
    }

    loadedKeyRef.current = loadKey;
    setReady(false);
    setError(null);

    void createBlocksuiteDoc({
      snapshot: canUseSnapshot ? snapshot : null,
      markdown: canUseSnapshot ? null : markdownSource,
      title: resource.name
    })
      .then((doc) => {
        if (loadedKeyRef.current !== loadKey) return;

        const host = containerRef.current;
        if (!host) return;

        const initialSnapshot = serializeBlocksuiteSnapshot(doc);
        docRef.current = doc;
        element.doc = doc;
        element.mode = mode;

        if (!element.isConnected) {
          host.appendChild(element);
        }

        lastSnapshotRef.current = JSON.stringify(initialSnapshot ?? null);
        lastMarkdownRef.current = markdownSource;
        lastSourceContentRef.current = normalizedContent;
        onUpdateViewState?.(editor.id, {
          blocksuiteSnapshot: initialSnapshot,
          blocksuiteSourceContent: normalizedContent,
          blocksuiteMode: mode
        });
        setDocRevision((value) => value + 1);
        setReady(true);
      })
      .catch((loadError) => {
        console.error(loadError);
        setError('BlockSuite code editor failed to initialize.');
      });
  }, [editor, isLoading, mode, normalizedContent, onUpdateViewState, resource]);

  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;

    const persist = () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = window.setTimeout(() => {
        const activeDoc = docRef.current;
        if (!activeDoc) return;

        const snapshot = serializeBlocksuiteSnapshot(activeDoc);
        const snapshotText = JSON.stringify(snapshot ?? null);
        const nextMode = editorElementRef.current?.mode || mode;

        void serializeBlocksuiteMarkdown(activeDoc).then((markdown) => {
          const extractedContent = normalizeCodeContent(extractCodeFromBlocksuiteMarkdown(markdown));
          const viewStatePatch: Record<string, any> = {
            blocksuiteMode: nextMode
          };
          let shouldPersistViewState = false;

          if (snapshotText !== lastSnapshotRef.current) {
            lastSnapshotRef.current = snapshotText;
            viewStatePatch.blocksuiteSnapshot = snapshot;
            shouldPersistViewState = true;
          }

          if (extractedContent !== lastSourceContentRef.current) {
            lastSourceContentRef.current = extractedContent;
            viewStatePatch.blocksuiteSourceContent = extractedContent;
            shouldPersistViewState = true;
          }

          if (shouldPersistViewState) {
            onUpdateViewState?.(editor.id, viewStatePatch);
          }

          if (markdown === lastMarkdownRef.current) {
            return;
          }

          lastMarkdownRef.current = markdown;
          onChangeContent?.(resource.id, extractedContent);
        });
      }, 500);
    };

    const blockUpdated = doc.slots.blockUpdated.on(persist);
    const readySlot = doc.slots.ready.on(persist);
    const rootAdded = doc.slots.rootAdded.on(persist);

    return () => {
      blockUpdated.dispose();
      readySlot.dispose();
      rootAdded.dispose();
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [docRevision, editor.id, mode, onChangeContent, onUpdateViewState, resource.id]);

  useEffect(() => {
    const handleJump = (event: Event) => {
      const detail = (event as CustomEvent).detail as { fileId?: string; locator?: Record<string, any> } | undefined;
      if (!detail?.fileId || detail.fileId !== resource.id) return;
      const start = Number(detail.locator?.lineStart || detail.locator?.startLine || 1);
      if (!Number.isFinite(start)) return;
      containerRef.current?.scrollTo({ top: Math.max(0, (start - 3) * 24), behavior: 'smooth' });
    };

    window.addEventListener('workbench:jump-to-citation', handleJump);
    return () => window.removeEventListener('workbench:jump-to-citation', handleJump);
  }, [resource.id]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--wb-editor)]">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!ready && !error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-3 bg-[var(--wb-editor)] text-sm text-[var(--wb-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {isLoading ? 'Loading code content...' : 'Preparing BlockSuite code editor...'}
          </div>
        )}

        {error ? (
          <div className="flex h-full items-center justify-center px-6 text-sm text-rose-300">{error}</div>
        ) : (
          <div
            ref={containerRef}
            className="h-full w-full overflow-auto"
            onScroll={(event) => reportVisibleState(event.currentTarget)}
            onMouseEnter={(event) => reportVisibleState(event.currentTarget)}
            onMouseUp={(event) => reportVisibleState(event.currentTarget)}
          />
        )}
      </div>
    </div>
  );
}
