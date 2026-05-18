import { useEffect, useRef, useState } from 'react';
import { BlockServiceWatcher, type ExtensionType } from '@blocksuite/block-std';
import { AffineFormatBarWidget, PageEditorBlockSpecs } from '@blocksuite/blocks';
import { getInlineEditorByModel } from '@blocksuite/affine-components/rich-text';
import { effects as registerBlocksuiteBlockEffects } from '@blocksuite/blocks/effects';
import { effects as registerBlocksuiteEffects } from '@blocksuite/presets/effects';
import type { Doc } from '@blocksuite/store';
import { Check, Clock3, Loader2, Redo2, RotateCcw, Save, Undo2, X } from 'lucide-react';
import { html } from 'lit';
import { aiApi, AiNoteEditAction } from '../../services/aiApi';
import { EditorState, ResourceReference } from '../../types';
import {
  BlocksuiteMode,
  BlocksuiteSnapshot,
  createBlocksuiteDoc,
  serializeBlocksuiteMarkdown,
  serializeBlocksuiteSnapshot
} from './blocksuite';

interface BlockSuiteNotesEditorProps {
  editor: EditorState;
  resource: ResourceReference | null;
  workspaceId: string;
  content: string;
  isDirty?: boolean;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  savedAt?: string;
  saveError?: string;
  isLoading: boolean;
  onChangeContent?: (resourceId: string, content: string) => void;
  onSaveContent?: (content?: string) => void;
  onApplyAiNoteEdit?: (
    resourceId: string,
    content: string,
    options?: { baseContentHash?: string | null; revisionSummary?: string; actionType?: string; actor?: string }
  ) => void | Promise<boolean | void>;
  onUpdateViewState?: (editorId: string, patch: Record<string, any>) => void;
  onBindResource: (editorId: string) => void;
}

type EditorElement = HTMLElement & {
  doc: Doc;
  mode: BlocksuiteMode;
  pageSpecs?: ExtensionType[];
  autofocus?: boolean;
  std?: any;
  host?: any;
};

interface AiSelectionState {
  text: string;
  rect: { left: number; top: number; width: number; height: number };
  surroundingText: string;
  textSelection?: any | null;
}

interface AiEditProposal {
  action: AiNoteEditAction;
  selectionText: string;
  textSelection?: any | null;
  replacement: string;
  nextContent: string;
  baseContent: string;
  baseContentHash: string;
  summary: string;
  warnings: string[];
}

const DEFAULT_MODE: BlocksuiteMode = 'page';
const PP1_AI_NOTE_EDIT_EVENT = 'pp1:blocksuite-ai-note-edit';
const PP1_AI_FORMAT_ACTIONS_ELEMENT = 'pp1-ai-format-actions';

let blocksuiteRegistered = false;

function ensureBlocksuiteRegistered() {
  if (blocksuiteRegistered) return;

  // BlockSuite splits low-level editor elements and preset containers across
  // different effect entrypoints. We need both, otherwise `new EditorHost()`
  // inside the preset container fails with `Illegal constructor`.
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

function getStoredSourceContent(editor: EditorState): string | null {
  const sourceContent = editor.viewState?.blocksuiteSourceContent;
  return typeof sourceContent === 'string' ? sourceContent : null;
}

const hashText = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const normalizeSelectionText = (value: string) =>
  String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim();

const nodeBelongsToHost = (node: Node | null, host: HTMLElement) => {
  let current: Node | null = node;
  while (current) {
    if (current === host || (current instanceof Node && host.contains(current))) return true;
    const root = current.getRootNode?.();
    if (root instanceof ShadowRoot) {
      current = root.host;
      continue;
    }
    current = current.parentNode;
  }
  return false;
};

const rangeRectOverlapsHost = (range: Range, host: HTMLElement) => {
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return false;
  const hostRect = host.getBoundingClientRect();
  return rect.right >= hostRect.left && rect.left <= hostRect.right && rect.bottom >= hostRect.top && rect.top <= hostRect.bottom;
};

const selectionBelongsTo = (selection: Selection, host: HTMLElement) => {
  if (!selection.rangeCount) return false;
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  const range = selection.getRangeAt(0);
  return Boolean(
    rangeRectOverlapsHost(range, host) ||
      (anchor &&
        focus &&
        nodeBelongsToHost(anchor, host) &&
        nodeBelongsToHost(focus, host) &&
        nodeBelongsToHost(range.commonAncestorContainer, host))
  );
};

const dispatchFormatBarAiEdit = (action: AiNoteEditAction, formatBar: AffineFormatBarWidget) => {
  const range = formatBar.nativeRange;
  const rect = range?.getBoundingClientRect();
  const textSelection = range ? formatBar.host?.std?.range?.rangeToTextSelection?.(range) : formatBar.host?.selection?.find?.('text');
  window.dispatchEvent(
    new CustomEvent(PP1_AI_NOTE_EDIT_EVENT, {
      detail: {
        action,
        text: normalizeSelectionText(range?.toString() || document.getSelection()?.toString() || ''),
        rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
        textSelection: textSelection || null
      }
    })
  );
};

const applyFormatBarLiquidGlassChrome = (toolbar: HTMLElement | null) => {
  if (!toolbar) return;
  toolbar.style.setProperty('background', 'rgba(255, 255, 255, 0.92)', 'important');
  toolbar.style.setProperty('border', '1px solid rgba(255, 255, 255, 0.72)', 'important');
  toolbar.style.setProperty('border-radius', '16px', 'important');
  toolbar.style.setProperty('box-shadow', '0 18px 50px rgba(0, 0, 0, 0.16), 0 1px 0 rgba(255, 255, 255, 0.95) inset', 'important');
  toolbar.style.setProperty('backdrop-filter', 'blur(18px) saturate(1.18)', 'important');
  toolbar.style.setProperty('-webkit-backdrop-filter', 'blur(18px) saturate(1.18)', 'important');
  toolbar.style.setProperty('padding', '0 7px', 'important');
  toolbar.style.setProperty('overflow', 'visible', 'important');
};

class PP1AiFormatActionsElement extends HTMLElement {
  formatBar: AffineFormatBarWidget | null = null;

  private _rendered = false;

  connectedCallback() {
    this._render();
    this._applyToolbarChrome();
    window.requestAnimationFrame(() => this._applyToolbarChrome());
  }

  private _applyToolbarChrome() {
    applyFormatBarLiquidGlassChrome(this.closest('editor-toolbar.affine-format-bar-widget') as HTMLElement | null);
  }

  private _render() {
    if (this._rendered) return;
    this._rendered = true;
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          align-items: center;
          height: 100%;
        }

        .actions {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          height: 100%;
          position: relative;
        }

        button {
          appearance: none;
          -webkit-appearance: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 30px;
          min-width: 34px;
          border: 0;
          border-radius: 12px;
          background: transparent;
          color: #202124;
          cursor: pointer;
          font: 650 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          margin: 0;
          padding: 0 8px;
          white-space: nowrap;
        }

        button.primary {
          background: #202124;
          color: #fff;
          box-shadow: 0 8px 20px rgba(32, 33, 36, 0.18);
        }

        button:hover,
        .more:hover > button,
        .more:focus-within > button {
          background: rgba(255, 255, 255, 0.78);
        }

        button.primary:hover {
          background: #34373c;
        }

        .ai-trigger {
          min-width: 42px;
          background: #202124;
          color: #fff;
          box-shadow: 0 8px 20px rgba(32, 33, 36, 0.18);
        }

        .ai-trigger:hover {
          background: #34373c;
        }

        .ai-menu-wrap {
          position: relative;
          display: inline-flex;
          height: 30px;
        }

        .menu {
          position: absolute;
          left: 0;
          top: 100%;
          display: none;
          width: 210px;
          margin-top: 8px;
          padding: 12px;
          border: 1px solid rgba(222, 222, 217, 0.95);
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.94);
          box-shadow: 0 22px 58px rgba(15, 23, 42, 0.18), 0 1px 0 rgba(255, 255, 255, 0.95) inset;
          backdrop-filter: blur(18px) saturate(1.18);
          -webkit-backdrop-filter: blur(18px) saturate(1.18);
          z-index: 10001;
        }

        .menu::before {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          top: -10px;
          height: 10px;
        }

        .ai-menu-wrap:hover .menu,
        .ai-menu-wrap:focus-within .menu {
          display: grid;
          gap: 3px;
        }

        .menu button {
          width: 100%;
          justify-content: flex-start;
          height: 36px;
          border-radius: 12px;
          padding: 0 8px;
          font-size: 15px;
          font-weight: 560;
        }

        .menu .section {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 4px 6px;
          color: #85898f;
          font-size: 13px;
          font-weight: 520;
        }

        .menu .slider {
          display: inline-flex;
          color: #85898f;
          font-size: 17px;
        }

        .menu .divider {
          height: 1px;
          margin: 4px 0 6px;
          background: #eeeeeb;
        }

        .prompt {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 4px;
          border: 1px solid #e5e5e1;
          border-radius: 12px;
          padding: 5px 6px 5px 10px;
          color: #85898f;
          font-size: 15px;
          line-height: 1;
        }

        .prompt span {
          min-width: 0;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .prompt .send {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 999px;
          background: #c7c7c3;
          color: white;
          font-size: 14px;
        }
      </style>
      <div class="actions">
        <div class="ai-menu-wrap">
          <button class="ai-trigger" title="AI 编辑">AI</button>
          <div class="menu">
            <div class="section"><span>技能</span><span class="slider">☷</span></div>
            <button data-action="improve" title="提升写作">提升写作</button>
            <button data-action="proofread" title="校对">校对</button>
            <button data-action="explain" title="解释">解释</button>
            <div class="divider"></div>
            <button data-action="reformat" title="重新格式化">重新格式化</button>
            <button data-action="shorten" title="缩短">缩短</button>
            <button data-action="expand" title="扩写">扩写</button>
            <button data-action="summarize" title="生成摘要">摘要</button>
            <button data-action="outline" title="整理成大纲">大纲</button>
            <div class="prompt"><span>使用 AI 编辑</span><span class="send">↑</span></div>
          </div>
        </div>
      </div>
    `;
    root.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.composedPath().find((node) => node instanceof HTMLElement && node.matches?.('button[data-action]'));
        if (!(target instanceof HTMLElement) || !this.formatBar) return;
        event.preventDefault();
        event.stopPropagation();
        dispatchFormatBarAiEdit(target.dataset.action as AiNoteEditAction, this.formatBar);
      },
      { capture: true }
    );
  }
}

const ensureAiFormatActionsElement = () => {
  if (customElements.get(PP1_AI_FORMAT_ACTIONS_ELEMENT)) return;
  customElements.define(PP1_AI_FORMAT_ACTIONS_ELEMENT, PP1AiFormatActionsElement);
};

const configureAiFormatBar = (formatBar: AffineFormatBarWidget) => {
  const bar = formatBar as AffineFormatBarWidget & { __pp1AiConfigured?: boolean };
  if (bar.__pp1AiConfigured) return;
  bar.__pp1AiConfigured = true;
  ensureAiFormatActionsElement();

  bar.addRawConfigItems([
    { type: 'divider' },
    {
      type: 'custom',
      render: (activeFormatBar) => html`
        <pp1-ai-format-actions .formatBar=${activeFormatBar}></pp1-ai-format-actions>
      `
    }
  ]);
  bar.requestUpdate();
};

class PP1AiFormatBarWatcher extends BlockServiceWatcher {
  static override flavour = 'affine:page';

  override created() {
    this.blockService.disposables.add(
      this.blockService.specSlots.widgetConnected.on(({ component }) => {
        if (!(component instanceof AffineFormatBarWidget)) return;
        window.setTimeout(() => configureAiFormatBar(component), 0);
      })
    );
  }
}

const pp1PageEditorBlockSpecs: ExtensionType[] = [...PageEditorBlockSpecs, PP1AiFormatBarWatcher];

const replaceSelectedText = (baseContent: string, selectedText: string, replacement: string) => {
  const normalized = normalizeSelectionText(selectedText);
  if (!normalized) return null;

  const directIndex = baseContent.indexOf(selectedText);
  if (directIndex >= 0) {
    if (baseContent.indexOf(selectedText, directIndex + selectedText.length) >= 0) return null;
    return `${baseContent.slice(0, directIndex)}${replacement}${baseContent.slice(directIndex + selectedText.length)}`;
  }

  const normalizedIndex = baseContent.indexOf(normalized);
  if (normalizedIndex >= 0) {
    if (baseContent.indexOf(normalized, normalizedIndex + normalized.length) >= 0) return null;
    return `${baseContent.slice(0, normalizedIndex)}${replacement}${baseContent.slice(normalizedIndex + normalized.length)}`;
  }

  return null;
};

const aiActionLabels: Record<AiNoteEditAction, string> = {
  proofread: '校对',
  improve: 'AI 写作',
  explain: '解释',
  reformat: '格式化',
  shorten: '缩短',
  expand: '扩写',
  summarize: '摘要',
  outline: '大纲'
};

const restoreTextSelection = (element: EditorElement | null, selection: any) => {
  if (!element?.std || !selection?.from) return null;
  const textSelection =
    typeof selection.isInSameBlock === 'function'
      ? selection
      : element.std.selection.create('text', {
          from: selection.from,
          to: selection.to ?? null,
          reverse: Boolean(selection.reverse)
        });
  element.std.selection.setGroup('note', [textSelection]);
  element.std.range.syncTextSelectionToRange(textSelection);
  return textSelection;
};

const applyReplacementToBlocksuiteSelection = (
  element: EditorElement | null,
  selection: any,
  replacement: string
) => {
  const host = element?.host || element?.std?.host;
  if (!element?.std || !host || !selection?.from) return false;

  const textSelection = restoreTextSelection(element, selection);
  if (!textSelection || !textSelection.isInSameBlock?.()) return false;

  const model = host.doc.getBlockById?.(textSelection.from.blockId) || host.std?.doc?.getBlock?.(textSelection.from.blockId)?.model;
  const inlineEditor = model ? getInlineEditorByModel(host, model) : null;
  if (!inlineEditor) return false;

  inlineEditor.insertText(
    {
      index: textSelection.from.index,
      length: textSelection.from.length
    },
    replacement
  );
  inlineEditor.setInlineRange({
    index: textSelection.from.index + replacement.length,
    length: 0
  });
  element.std.selection.setGroup('note', [
    element.std.selection.create('text', {
      from: {
        blockId: textSelection.from.blockId,
        index: textSelection.from.index + replacement.length,
        length: 0
      },
      to: null
    })
  ]);
  return true;
};

function SelectionDiff({ before, after }: { before: string; after: string }) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  const rows = Array.from({ length: maxLines }, (_, index) => ({
    before: beforeLines[index],
    after: afterLines[index],
    changed: beforeLines[index] !== afterLines[index]
  }));

  return (
    <div className="grid min-h-0 grid-cols-2 overflow-hidden rounded-xl border border-[#e5e5e1] bg-white text-xs">
      <div className="border-r border-[#e5e5e1]">
        <div className="border-b border-[#e5e5e1] px-3 py-2 font-semibold text-[#7b2f2f]">原选区</div>
        <div className="max-h-[320px] overflow-auto">
          {rows.map((row, index) => (
            <pre key={`before-${index}`} className={`whitespace-pre-wrap px-3 py-1 leading-5 ${row.changed ? 'bg-[#fff1f1] text-[#7b2f2f]' : 'text-[#6b6f75]'}`}>
              {row.before ?? ''}
            </pre>
          ))}
        </div>
      </div>
      <div>
        <div className="border-b border-[#e5e5e1] px-3 py-2 font-semibold text-[#176434]">AI 修改</div>
        <div className="max-h-[320px] overflow-auto">
          {rows.map((row, index) => (
            <pre key={`after-${index}`} className={`whitespace-pre-wrap px-3 py-1 leading-5 ${row.changed ? 'bg-[#edf8f1] text-[#176434]' : 'text-[#6b6f75]'}`}>
              {row.after ?? ''}
            </pre>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BlockSuiteNotesEditor({
  editor,
  resource,
  workspaceId,
  content,
  isDirty = false,
  saveStatus = 'idle',
  savedAt,
  saveError,
  isLoading,
  onChangeContent,
  onSaveContent,
  onApplyAiNoteEdit,
  onUpdateViewState
}: BlockSuiteNotesEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorElementRef = useRef<EditorElement | null>(null);
  const docRef = useRef<Doc | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastSnapshotRef = useRef('');
  const lastMarkdownRef = useRef('');
  const loadedKeyRef = useRef('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docRevision, setDocRevision] = useState(0);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [aiSelection, setAiSelection] = useState<AiSelectionState | null>(null);
  const [aiProposal, setAiProposal] = useState<AiEditProposal | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isApplyingAiEdit, setIsApplyingAiEdit] = useState(false);

  const mode = DEFAULT_MODE;

  const reportVisibleState = (element: HTMLDivElement) => {
    const totalScrollable = Math.max(1, element.scrollHeight - element.clientHeight);
    onUpdateViewState?.(editor.id, {
      scrollRatio: Math.min(1, Math.max(0, element.scrollTop / totalScrollable)),
      approxChunkIndex: Math.max(0, Math.round(Math.min(1, Math.max(0, element.scrollTop / totalScrollable)) * 20)),
      visibleBlockIds: [],
      selectedText: window.getSelection()?.toString().trim() || ''
    });
  };

  const captureEditorSelection = () => {
    const host = containerRef.current;
    if (!host) return null;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selectionBelongsTo(selection, host)) {
      setAiSelection(null);
      onUpdateViewState?.(editor.id, { selectedText: '', selectedRange: null });
      return null;
    }

    const text = normalizeSelectionText(selection.toString());
    if (!text || text.length < 2) {
      setAiSelection(null);
      return null;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    const textSelection = editorElementRef.current?.std?.range?.rangeToTextSelection?.(range);

    const markdown = lastMarkdownRef.current || content || '';
    const selectionIndex = markdown.indexOf(text);
    const surroundingText =
      selectionIndex >= 0
        ? markdown.slice(Math.max(0, selectionIndex - 1200), Math.min(markdown.length, selectionIndex + text.length + 1200))
        : markdown.slice(0, 2400);
    const nextSelection = {
      text,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      surroundingText,
      textSelection: textSelection || null
    };
    setAiSelection(nextSelection);
    setAiError(null);
    onUpdateViewState?.(editor.id, {
      selectedText: text,
      selectedRange: {
        charStart: selectionIndex >= 0 ? selectionIndex : undefined,
        charEnd: selectionIndex >= 0 ? selectionIndex + text.length : undefined,
        textLength: text.length
      }
    });
    return nextSelection;
  };

  const flushDocumentContent = async () => {
    const activeDoc = docRef.current;
    if (!activeDoc || !resource?.id) return content ?? '';

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const snapshot = serializeBlocksuiteSnapshot(activeDoc);
    const snapshotText = JSON.stringify(snapshot ?? null);
    const markdown = await serializeBlocksuiteMarkdown(activeDoc);

    if (snapshotText !== lastSnapshotRef.current || markdown !== lastMarkdownRef.current) {
      lastSnapshotRef.current = snapshotText;
      lastMarkdownRef.current = markdown;
      onUpdateViewState?.(editor.id, {
        blocksuiteSnapshot: snapshot,
        blocksuiteSourceContent: markdown,
        blocksuiteMode: editorElementRef.current?.mode || mode
      });
      onChangeContent?.(resource.id, markdown);
    }

    return markdown;
  };

  const selectionFromEventDetail = (
    detail:
      | {
          text?: string;
          rect?: AiSelectionState['rect'] | null;
          textSelection?: AiSelectionState['textSelection'];
        }
      | null
      | undefined
  ) => {
    const text = normalizeSelectionText(detail?.text || '');
    if (!text || !detail?.rect) return null;

    const markdown = lastMarkdownRef.current || content || '';
    const selectionIndex = markdown.indexOf(text);
    const surroundingText =
      selectionIndex >= 0
        ? markdown.slice(Math.max(0, selectionIndex - 1200), Math.min(markdown.length, selectionIndex + text.length + 1200))
        : markdown.slice(0, 2400);
    const nextSelection = {
      text,
      rect: detail.rect,
      surroundingText,
      textSelection: detail.textSelection || null
    };
    setAiSelection(nextSelection);
    setAiError(null);
    onUpdateViewState?.(editor.id, {
      selectedText: text,
      selectedRange: {
        charStart: selectionIndex >= 0 ? selectionIndex : undefined,
        charEnd: selectionIndex >= 0 ? selectionIndex + text.length : undefined,
        textLength: text.length
      }
    });
    return nextSelection;
  };

  const requestAiEdit = async (action: AiNoteEditAction, selectionOverride?: AiSelectionState | null) => {
    if (!resource?.id || !onApplyAiNoteEdit) return;
    const selection = selectionOverride || captureEditorSelection() || aiSelection;
    if (!selection?.text) {
      setAiError('请先选中一段笔记内容。');
      return;
    }

    setAiError(null);
    setAiProposal(null);

    try {
      const baseContent = await flushDocumentContent();
      const baseContentHash = await hashText(baseContent);
      const response = await aiApi.editNoteSelection({
        workspaceId,
        workbenchId: resource.ownerWorkbenchId || null,
        action,
        file: { id: resource.id, name: resource.name, path: resource.path },
        selection: {
          text: selection.text,
          surroundingText: selection.surroundingText
        },
        documentContext: {
          title: resource.name,
          nearbyHeadings: baseContent
            .split('\n')
            .filter((line) => /^#{1,4}\s+/.test(line))
            .slice(0, 8),
          visibleContent: selection.surroundingText
        }
      });
      const nextContent = replaceSelectedText(baseContent, selection.text, response.replacement);
      if (!nextContent && !selection.textSelection) {
        setAiError('AI 已生成修改，但无法在 markdown 中精确定位当前选区。请重新选择一段连续文本后再试。');
        return;
      }

      setAiProposal({
        action,
        selectionText: selection.text,
        textSelection: selection.textSelection || null,
        replacement: response.replacement,
        nextContent: nextContent || baseContent,
        baseContent,
        baseContentHash,
        summary: response.summary || 'AI 修改了选区',
        warnings: response.warnings || []
      });
    } catch (editError: any) {
      setAiError(editError?.response?.data?.error || editError?.message || 'AI 修改选区失败。');
    } finally {
    }
  };

  const applyAiProposal = async () => {
    if (!resource?.id || !aiProposal || !onApplyAiNoteEdit) return;
    setIsApplyingAiEdit(true);
    setAiError(null);
    try {
      const editorHost = editorElementRef.current;
      let appliedInBlocksuite = false;
      const textSelection = aiProposal.textSelection || aiSelection?.textSelection;
      if (aiProposal.baseContent && editorHost?.std && textSelection) {
        appliedInBlocksuite = applyReplacementToBlocksuiteSelection(editorHost, textSelection, aiProposal.replacement);
      }
      if (appliedInBlocksuite) {
        const latestMarkdown = await flushDocumentContent();
        await onApplyAiNoteEdit(resource.id, latestMarkdown, {
          baseContentHash: aiProposal.baseContentHash,
          revisionSummary: aiProposal.summary || `${aiActionLabels[aiProposal.action]}选区`,
          actionType: `ai_note_${aiProposal.action}`,
          actor: 'ai'
        });
        aiProposal.nextContent = latestMarkdown;
      } else if (aiProposal.nextContent !== aiProposal.baseContent) {
        await onApplyAiNoteEdit(resource.id, aiProposal.nextContent, {
          baseContentHash: aiProposal.baseContentHash,
          revisionSummary: aiProposal.summary || `${aiActionLabels[aiProposal.action]}选区`,
          actionType: `ai_note_${aiProposal.action}`,
          actor: 'ai'
        });
      } else {
        setAiError('AI 已生成修改，但当前选区无法由 BlockSuite 或 markdown 安全定位。请重新选择单个段落内的连续文本。');
        return;
      }
      onChangeContent?.(resource.id, aiProposal.nextContent);
      onUpdateViewState?.(editor.id, {
        blocksuiteSnapshot: null,
        blocksuiteSourceContent: aiProposal.nextContent,
        blocksuiteMode: editorElementRef.current?.mode || mode,
        selectedText: '',
        selectedRange: null
      });
      setAiProposal(null);
      setAiSelection(null);
      loadedKeyRef.current = '';
      lastSnapshotRef.current = '';
      lastMarkdownRef.current = aiProposal.nextContent;
      window.getSelection()?.removeAllRanges();
    } catch (applyError: any) {
      setAiError(applyError?.response?.data?.error || applyError?.message || '应用 AI 修改失败。');
    } finally {
      setIsApplyingAiEdit(false);
    }
  };

  useEffect(() => {
    ensureBlocksuiteRegistered();
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      const host = containerRef.current;
      const selection = window.getSelection();
      if (!host || !selection || selection.isCollapsed || !selectionBelongsTo(selection, host)) {
        return;
      }
      window.setTimeout(captureEditorSelection, 0);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [editor.id, onUpdateViewState, content]);

  useEffect(() => {
    const handleNativeAiEdit = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: AiNoteEditAction; text?: string; rect?: AiSelectionState['rect'] | null }>).detail;
      const action = detail?.action;
      if (!action) return;
      const selection = captureEditorSelection() || selectionFromEventDetail(detail) || aiSelection;
      void requestAiEdit(action, selection);
    };

    window.addEventListener(PP1_AI_NOTE_EDIT_EVENT, handleNativeAiEdit);
    return () => window.removeEventListener(PP1_AI_NOTE_EDIT_EVENT, handleNativeAiEdit);
  }, [aiSelection, content, editor.id, onUpdateViewState, resource?.id, onApplyAiNoteEdit]);

  useEffect(() => {
    const element = document.createElement('affine-editor-container') as EditorElement;
    element.className = 'h-full w-full';
    element.pageSpecs = pp1PageEditorBlockSpecs;
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
    const modalTags = new Set([
      'EMBED-CARD-CREATE-MODAL',
      'EMBED-CARD-EDIT-MODAL',
      'EMBED-CARD-CAPTION-EDIT-MODAL'
    ]);
    const movePanelModal = (node: Node) => {
      const host = rootRef.current;
      if (!host || !(node instanceof HTMLElement) || !modalTags.has(node.tagName)) return;
      node.classList.add('blocksuite-panel-modal');
      host.appendChild(node);
    };

    Array.from(document.body.children).forEach(movePanelModal);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach(movePanelModal);
      });
    });
    observer.observe(document.body, { childList: true });

    return () => observer.disconnect();
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
    const markdownSource = content ?? '';
    const canUseSnapshot = Boolean(snapshot) && storedSourceContent === markdownSource;

    if (!canUseSnapshot && isLoading) {
      return;
    }

    const loadKey = `${editor.id}:${resource?.id || 'local'}:${canUseSnapshot ? 'snapshot' : markdownSource}`;
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
        if (loadedKeyRef.current !== loadKey) return;

        const host = containerRef.current;
        if (!host) return;

        const initialSnapshot = serializeBlocksuiteSnapshot(doc);
        docRef.current = doc;
        element.doc = doc;
        element.mode = mode;
        setHistoryState({ canUndo: doc.canUndo, canRedo: doc.canRedo });

        if (!element.isConnected) {
          host.appendChild(element);
        }

        lastSnapshotRef.current = JSON.stringify(initialSnapshot ?? null);
        lastMarkdownRef.current = markdownSource;
        onUpdateViewState?.(editor.id, {
          blocksuiteSnapshot: initialSnapshot,
          blocksuiteSourceContent: markdownSource,
          blocksuiteMode: mode
        });
        setDocRevision((value) => value + 1);
        setReady(true);
      })
      .catch((loadError) => {
        console.error(loadError);
        setError('BlockSuite editor failed to initialize.');
      });
  }, [content, editor, isLoading, mode, onUpdateViewState, resource?.id]);

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

        if (!resource?.id) {
          if (snapshotText !== lastSnapshotRef.current) {
            lastSnapshotRef.current = snapshotText;
            onUpdateViewState?.(editor.id, {
              blocksuiteSnapshot: snapshot,
              blocksuiteMode: editorElementRef.current?.mode || mode
            });
          }
          return;
        }

        void serializeBlocksuiteMarkdown(activeDoc).then((markdown) => {
          const snapshotChanged = snapshotText !== lastSnapshotRef.current;
          const markdownChanged = markdown !== lastMarkdownRef.current;
          if (!snapshotChanged && !markdownChanged) {
            return;
          }

          lastSnapshotRef.current = snapshotText;
          lastMarkdownRef.current = markdown;
          onUpdateViewState?.(editor.id, {
            blocksuiteSnapshot: snapshot,
            blocksuiteSourceContent: markdown,
            blocksuiteMode: editorElementRef.current?.mode || mode
          });
          if (markdownChanged) {
            onChangeContent?.(resource.id, markdown);
          }
        });
      }, 500);
    };

    const blockUpdated = doc.slots.blockUpdated.on(persist);
    const readySlot = doc.slots.ready.on(persist);
    const rootAdded = doc.slots.rootAdded.on(persist);
    const historyUpdated = doc.slots.historyUpdated.on(() => {
      setHistoryState({ canUndo: doc.canUndo, canRedo: doc.canRedo });
    });

    return () => {
      blockUpdated.dispose();
      readySlot.dispose();
      rootAdded.dispose();
      historyUpdated.dispose();
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [docRevision, editor.id, mode, onChangeContent, onUpdateViewState, resource?.id]);

  const runHistoryCommand = (command: 'undo' | 'redo') => {
    const doc = docRef.current;
    if (!doc) return;
    if (command === 'undo' && doc.canUndo) doc.undo();
    if (command === 'redo' && doc.canRedo) doc.redo();
    setHistoryState({ canUndo: doc.canUndo, canRedo: doc.canRedo });
  };

  const savedTimeLabel = savedAt
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(savedAt))
    : '';
  const statusLabel =
    saveStatus === 'saving'
      ? 'Saving'
      : saveStatus === 'error'
        ? 'Save failed'
        : isDirty
          ? 'Unsaved'
          : savedTimeLabel
            ? `Saved ${savedTimeLabel}`
            : 'Saved';

  return (
    <div ref={rootRef} className="blocksuite-panel-scope flex h-full min-h-0 flex-col overflow-hidden bg-[var(--wb-editor)]">
      <div className="flex items-center justify-between border-b border-[#ecebe6] bg-white/90 px-3 py-1.5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => runHistoryCommand('undo')}
            disabled={!historyState.canUndo}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#4b4f55] hover:bg-[#f6f6f4] disabled:cursor-not-allowed disabled:text-[#c4c6ca]"
            title="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => runHistoryCommand('redo')}
            disabled={!historyState.canRedo}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#4b4f55] hover:bg-[#f6f6f4] disabled:cursor-not-allowed disabled:text-[#c4c6ca]"
            title="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-xs text-[#777a80]">
          <span
            className={`inline-flex h-8 w-[132px] items-center justify-center gap-1 rounded-full px-2 transition-colors ${
              saveStatus === 'error'
                ? 'bg-[#fff1f1] text-[#b42318]'
                : saveStatus === 'saving'
                  ? 'bg-[#f4f4f1] text-[#62666c]'
                  : isDirty
                    ? 'bg-[#fff8df] text-[#8a6400]'
                    : 'bg-[#edf8f1] text-[#16833a]'
            }`}
            title={saveStatus === 'error' ? saveError || statusLabel : statusLabel}
          >
            {saveStatus === 'saving' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : saveStatus === 'error' ? (
              <RotateCcw className="h-3.5 w-3.5" />
            ) : isDirty ? (
              <Clock3 className="h-3.5 w-3.5" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            <span className="min-w-0 truncate">{statusLabel}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              void flushDocumentContent().then((latestContent) => onSaveContent?.(latestContent));
            }}
            disabled={!resource?.id || saveStatus === 'saving'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#4b4f55] hover:bg-[#f6f6f4] disabled:cursor-not-allowed disabled:text-[#c4c6ca]"
            title="Save now"
          >
            <Save className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {aiError && (
          <div className="absolute left-4 right-4 top-4 z-[65] flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow-sm">
            <span>{aiError}</span>
            <button type="button" onClick={() => setAiError(null)} className="rounded p-0.5 hover:bg-amber-100" title="关闭">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {aiProposal && (
          <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/18 px-6 py-6 backdrop-blur-sm">
            <div className="flex max-h-full w-[min(860px,100%)] flex-col overflow-hidden rounded-2xl border border-[#e5e5e1] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.26)]">
              <div className="flex items-start justify-between gap-4 border-b border-[#eeeeeb] px-5 py-4">
                <div>
                  <div className="text-sm font-semibold text-[#25272b]">预览 AI 修改</div>
                  <div className="mt-1 text-xs text-[#777a80]">{aiProposal.summary}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAiProposal(null)}
                  className="rounded-lg p-1.5 text-[#777a80] hover:bg-[#f4f4f1] hover:text-[#25272b]"
                  title="取消"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-5">
                <SelectionDiff before={aiProposal.selectionText} after={aiProposal.replacement} />
                {aiProposal.warnings.length > 0 && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {aiProposal.warnings.join('；')}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-[#eeeeeb] px-5 py-4">
                <button
                  type="button"
                  onClick={() => setAiProposal(null)}
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-[#62666c] hover:bg-[#f4f4f1]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void applyAiProposal()}
                  disabled={isApplyingAiEdit}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#202124] px-3 py-2 text-sm font-semibold text-white hover:bg-[#34373c] disabled:cursor-wait disabled:bg-[#c9cbc7]"
                >
                  {isApplyingAiEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  接受并保存
                </button>
              </div>
            </div>
          </div>
        )}

        {!ready && !error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-3 bg-[var(--wb-editor)] text-sm text-[var(--wb-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {isLoading ? 'Loading note content...' : 'Preparing BlockSuite editor...'}
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
            onMouseUp={(event) => {
              reportVisibleState(event.currentTarget);
              window.setTimeout(captureEditorSelection, 0);
            }}
            onKeyUp={(event) => {
              reportVisibleState(event.currentTarget);
              window.setTimeout(captureEditorSelection, 0);
            }}
          />
        )}
      </div>
    </div>
  );
}
