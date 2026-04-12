import { useEffect, useRef, useState } from 'react';
import { effects as registerBlocksuiteBlockEffects } from '@blocksuite/blocks/effects';
import { effects as registerBlocksuiteEffects } from '@blocksuite/presets/effects';
import type { Doc } from '@blocksuite/store';
import { Code2, Layers3, Loader2, Map, MonitorSmartphone } from 'lucide-react';
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
  isLoading: boolean;
  onChangeContent?: (resourceId: string, content: string) => void;
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
      markdown: canUseSnapshot ? null : markdownSource
    })
      .then((doc) => {
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
          blocksuiteMode: mode,
          codeOpenMode: 'blocksuite'
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
            blocksuiteMode: nextMode,
            codeOpenMode: 'blocksuite'
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--wb-editor)]">
      <div className="flex items-center justify-between border-b border-[var(--wb-border)] bg-[var(--wb-panel)] px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onUpdateViewState?.(editor.id, { codeOpenMode: 'blocksuite' })}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--wb-tab)] px-3 py-1.5 text-xs font-medium text-[var(--wb-text)] shadow-sm ring-1 ring-[var(--wb-border)]"
          >
            <Layers3 className="h-3.5 w-3.5" />
            BlockSuite
          </button>
          <button
            onClick={() => onUpdateViewState?.(editor.id, { codeOpenMode: 'plain' })}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--wb-text-muted)] hover:bg-white/5 hover:text-[var(--wb-text)]"
          >
            <MonitorSmartphone className="h-3.5 w-3.5" />
            Plain
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onUpdateViewState?.(editor.id, { blocksuiteMode: 'page' })}
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium ${
              mode === 'page'
                ? 'bg-[var(--wb-tab)] text-[var(--wb-text)] shadow-sm ring-1 ring-[var(--wb-border)]'
                : 'text-[var(--wb-text-muted)] hover:bg-white/5 hover:text-[var(--wb-text)]'
            }`}
          >
            <Layers3 className="h-3.5 w-3.5" />
            Page
          </button>
          <button
            onClick={() => onUpdateViewState?.(editor.id, { blocksuiteMode: 'edgeless' })}
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium ${
              mode === 'edgeless'
                ? 'bg-[var(--wb-tab)] text-[var(--wb-text)] shadow-sm ring-1 ring-[var(--wb-border)]'
                : 'text-[var(--wb-text-muted)] hover:bg-white/5 hover:text-[var(--wb-text)]'
            }`}
          >
            <Map className="h-3.5 w-3.5" />
            Edgeless
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-[var(--wb-text-muted)]">
          <Code2 className="h-3.5 w-3.5" />
          <span>{resource.name}</span>
        </div>
      </div>

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
          <div ref={containerRef} className="h-full w-full overflow-hidden" />
        )}
      </div>
    </div>
  );
}
