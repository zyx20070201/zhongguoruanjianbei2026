import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Check, FileText, Globe2, Lightbulb, Loader2, Search, Sparkles, Tag, X } from 'lucide-react';
import {
  Cosmograph,
  CosmographButtonFitView,
  CosmographButtonPlayPause,
  CosmographButtonZoomInOut,
  CosmographProvider,
  type CosmographConfig,
  type CosmographRef
} from '@cosmograph/react';
import type { ConceptEdge, ConceptNode, GraphSource } from './LearningIntelligenceDashboard';
import { learningApi } from '../../services/learningApi';
import MarkdownPreview from '../workbench/MarkdownPreview';

interface CosmosKnowledgeGraphWorkbenchProps {
  workspaceId: string;
  workbenchId?: string;
  concepts: ConceptNode[];
  edges: ConceptEdge[];
  selectedId?: string | null;
  onSelectConcept?: (concept: ConceptNode | null) => void;
  pathIds: string[];
  sources?: GraphSource[];
  searchTerm?: string;
  focusConceptId?: string | null;
  variant?: 'embedded' | 'fullscreen';
  sidebarControls?: React.ReactNode;
}

type GraphMode = 'global' | 'local' | 'path';

type GraphPoint = {
  id: string;
  index: number;
  label: string;
  category: string;
  group: string;
  nodeType: 'concept' | 'exercise';
  parentConceptId?: string;
  color: string;
  size: number;
  labelWeight: number;
  path: boolean;
};

type GraphLink = {
  source: string;
  target: string;
  sourceIndex: number;
  targetIndex: number;
  relationType: string;
  color: string;
  width: number;
  strength: number;
  arrow: boolean;
};

type ConceptExercise = {
  id: string;
  title: string;
  prompt: string;
  exerciseType?: string;
  difficulty?: number;
  role?: string;
  confidence?: number;
  sourceRef?: { id: string; name: string; path?: string } | null;
};

type NodeChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type NodePopoverMode = 'menu' | 'explain' | 'tags' | 'sources';

const conceptGroup = (node: ConceptNode) => {
  const learner = node.learnerState;
  if ((learner?.weaknessEstimate ?? 0) >= 0.62) return 'weak';
  if ((learner?.readinessEstimate ?? 0) >= 0.62) return 'ready';
  if ((learner?.masteryEstimate ?? 0) >= 0.72) return 'mastered';
  return 'neutral';
};

const nodeColor = (group: string, isPath: boolean, isSelected: boolean) => {
  if (isSelected) return '#111214';
  if (isPath) return '#2b2d31';
  if (group === 'weak') return '#d98a3d';
  if (group === 'ready') return '#4c8fd0';
  if (group === 'mastered') return '#8b8f94';
  return '#5f6368';
};

const exerciseColor = (type?: string) => {
  if (type === 'coding') return '#5b7f95';
  if (type === 'design') return '#7a6f9b';
  if (type === 'calculation') return '#8b7a4f';
  return '#7b8087';
};

const relationColor = (type: string) => {
  if (type === 'prerequisite') return '#9aa3aa';
  if (type === 'part_of') return '#b6b3c8';
  if (type === 'assesses') return '#c3b4a3';
  if (type === 'remediates') return '#c6abaa';
  if (type === 'supports') return '#a8bac8';
  return '#b7bcc2';
};

const relationStrength = (type: string) => {
  if (type === 'prerequisite') return 1;
  if (type === 'part_of') return 0.82;
  if (type === 'remediates') return 0.74;
  if (type === 'supports') return 0.7;
  if (type === 'assesses') return 0.62;
  return 0.58;
};

const relationArrow = (type: string) =>
  type === 'prerequisite' || type === 'part_of' || type === 'remediates' || type === 'supports';

const normalizeTag = (value: string) => value.trim().replace(/^#+/, '').replace(/\s+/g, ' ');

const labelPillClassName =
  'color: #111214; background: rgba(255,255,255,0.96); border: 1px solid rgba(31,35,40,0.14); border-radius: 999px; box-shadow: 0 2px 8px rgba(15,23,42,0.12); font-weight: 600;';

const localNodeIdsFor = (rootId: string, edges: ConceptEdge[], depth = 2) => {
  const selected = new Set<string>([rootId]);
  let frontier = new Set<string>([rootId]);

  for (let hop = 0; hop < depth; hop += 1) {
    const next = new Set<string>();
    edges.forEach((edge) => {
      if (frontier.has(edge.from) && !selected.has(edge.to)) next.add(edge.to);
      if (frontier.has(edge.to) && !selected.has(edge.from)) next.add(edge.from);
    });
    next.forEach((id) => selected.add(id));
    frontier = next;
    if (!frontier.size) break;
  }

  return selected;
};

const matchesGraphSearch = (node: ConceptNode, query: string) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const tags = (node.tags || []).map((tag) => `${tag.label || ''} ${tag.normalizedLabel || ''}`).join(' ');
  const sources = [
    ...(node.sources || []).map((source) => `${source.name || ''} ${source.path || ''} ${source.resourceType || ''} ${source.origin || ''} ${source.snippets?.map((snippet) => `${snippet.quote || ''} ${snippet.rationale || ''}`).join(' ') || ''}`),
    ...(node.aiEvidence?.resourceEvidence || []).map((item) => `${item.fileName || ''} ${item.path || ''} ${item.snippet || ''} ${item.quote || ''}`)
  ].join(' ');
  const misconceptions = (node.misconceptions || []).map((item) => `${item.title || ''} ${item.repairHint || ''}`).join(' ');
  return [node.title, node.category, node.id, node.description, tags, sources, misconceptions]
    .some((value) => String(value || '').toLowerCase().includes(normalized));
};

const sameStringList = (left: string[], right: string[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

const sameWorkbenchProps = (prev: CosmosKnowledgeGraphWorkbenchProps, next: CosmosKnowledgeGraphWorkbenchProps) =>
  prev.workspaceId === next.workspaceId &&
  prev.workbenchId === next.workbenchId &&
  prev.concepts === next.concepts &&
  prev.edges === next.edges &&
  prev.selectedId === next.selectedId &&
  prev.onSelectConcept === next.onSelectConcept &&
  prev.sources === next.sources &&
  prev.searchTerm === next.searchTerm &&
  prev.focusConceptId === next.focusConceptId &&
  prev.variant === next.variant &&
  prev.sidebarControls === next.sidebarControls &&
  sameStringList(prev.pathIds, next.pathIds);

type AddTagOptions = { source?: 'user' | 'ai_suggested' | 'system_candidate'; state?: 'candidate' | 'applied'; rationale?: string };

interface GraphInspectorSidebarProps {
  sidebarControls?: React.ReactNode;
  activeConcept: ConceptNode | null;
  sourceOptions: GraphSource[];
  sourceLabel: string;
  selectedSourceIds: Set<string>;
  onToggleSource: (sourceId: string) => void;
  onClearSources: () => void;
  appliedTags: any[];
  candidateTags: any[];
  tagDraft: string;
  setTagDraft: (value: string) => void;
  tagSaving: boolean;
  onAddTag: (label: string, options?: AddTagOptions) => void;
  onRemoveTag: (tagId: string) => void;
  chatMessages: NodeChatMessage[];
  chatInput: string;
  setChatInput: (value: string) => void;
  chatReply: string;
  chatError: string | null;
  tagSuggestionRunning: boolean;
  onSuggestTags: () => void;
  onExplainConcept: () => void;
  expandedPracticeConceptId: string | null;
  practiceExercises: ConceptExercise[];
  practiceLoading: boolean;
  onTogglePractice: (conceptId: string) => void;
}

function SourceFilterPanel({
  sourceOptions,
  selectedSourceIds,
  onToggleSource,
  onClearSources
}: Pick<GraphInspectorSidebarProps, 'sourceOptions' | 'sourceLabel' | 'selectedSourceIds' | 'onToggleSource' | 'onClearSources'>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const visibleSources = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const candidates = sourceOptions.slice(0, 80);
    if (!normalized) return candidates;
    return candidates.filter((source) =>
      [source.name, source.path, source.origin, source.resourceType, source.id]
        .some((value) => String(value || '').toLowerCase().includes(normalized))
    );
  }, [query, sourceOptions]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return undefined;
    }

    const close = () => {
      setOpen(false);
      setQuery('');
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (dropdownRef.current?.contains(event.target as Node)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={dropdownRef} className="relative">
      {open ? (
        <style>
          {'@keyframes kg-fly-and-scale{from{transform:translate3d(0,-8px,0) scale(.95);opacity:0}to{transform:translate3d(0,0,0) scale(1);opacity:1}}'}
        </style>
      ) : null}
      {sourceOptions.length ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="px-3.5 py-1.5 text-sm font-medium hover:bg-black/5 outline outline-1 outline-gray-100 rounded-3xl"
          >
            Select Knowledge
          </button>
          {open ? (
            <div
              className="absolute left-0 top-10 z-[10000] flex w-[17.5rem] origin-top-left flex-col rounded-2xl border border-gray-200 bg-white p-1.5 text-black shadow-lg"
              style={{ animation: 'kg-fly-and-scale 200ms cubic-bezier(0.33, 1, 0.68, 1)' }}
            >
              <div className="flex w-full space-x-2 px-2 pb-0.5">
                <div className="flex flex-1">
                  <div className="self-center mr-2">
                    <Search className="size-3.5" />
                  </div>
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search"
                    className="w-full rounded-r-xl bg-transparent py-1 pr-4 text-sm outline-none"
                  />
                </div>
              </div>
              {selectedSourceIds.size ? (
                <button
                  type="button"
                  onClick={onClearSources}
                  className="mb-1 w-full rounded-xl px-2.5 py-1 text-left text-sm text-gray-500 hover:bg-gray-50"
                >
                  Clear selection
                </button>
              ) : null}
              <div className="max-h-56 overflow-y-scroll gap-0.5 flex flex-col">
                {visibleSources.length ? visibleSources.map((source) => {
                  const checked = selectedSourceIds.has(source.id);
                  const Icon = source.origin === 'web' ? Globe2 : FileText;
                  return (
                    <div
                      key={source.id}
                      className={`px-2.5 py-1 rounded-xl w-full text-left flex justify-between items-center text-sm hover:bg-gray-50 selected-command-option-button ${checked ? 'bg-gray-50' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => onToggleSource(source.id)}
                        className="w-full flex-1"
                      >
                        <div className="text-black flex items-center gap-1 shrink-0">
                          <Icon className="size-4" />
                          <div className="line-clamp-1 flex-1 text-sm text-left">{source.name}</div>
                        </div>
                      </button>
                      {checked ? <Check className="size-3.5 shrink-0 text-black" /> : null}
                    </div>
                  );
                }) : (
                  <div className="text-center text-xs text-gray-500 pt-4 pb-6">
                    No knowledge found
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          disabled
          className="px-3.5 py-1.5 text-sm font-medium text-gray-400 outline outline-1 outline-gray-100 rounded-3xl bg-white/95 shadow-sm"
        >
          Select Knowledge
        </button>
      )}
    </div>
  );
}

function ConceptSummaryPanel({ activeConcept }: { activeConcept: ConceptNode }) {
  return (
    <section>
      {activeConcept.description ? <p className="text-sm leading-6 text-gray-600">{activeConcept.description}</p> : null}
    </section>
  );
}

function NodeChatPanel({
  chatMessages,
  chatInput,
  setChatInput,
  chatReply,
  chatError,
  tagSuggestionRunning,
  onSuggestTags
}: Pick<GraphInspectorSidebarProps, 'chatMessages' | 'chatInput' | 'setChatInput' | 'chatReply' | 'chatError' | 'tagSuggestionRunning' | 'onSuggestTags'>) {
  return (
    <div className="space-y-2">
      <div className="space-y-2 pr-1">
        {chatMessages.length ? chatMessages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`rounded-xl px-3 py-2 text-xs leading-5 ${message.role === 'user' ? 'ml-6 bg-gray-50 text-gray-800' : 'mr-6 bg-[#f4f4f2] text-gray-700'}`}>
            {message.content}
          </div>
        )) : <p className="px-1 text-xs text-gray-400">Ask about the node, and AI will explain it here.</p>}
        {chatReply && !chatMessages.some((message) => message.role === 'assistant' && message.content === chatReply) ? (
          <div className="rounded-xl bg-[#f4f4f2] px-3 py-2 text-xs leading-5 text-gray-700">{chatReply}</div>
        ) : null}
      </div>
      <div className="flex gap-2">
        <input
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSuggestTags();
          }}
          placeholder="Ask AI about this node"
          className="h-9 min-w-0 flex-1 rounded-xl bg-gray-50 px-3 text-sm outline-none placeholder:text-gray-400"
        />
        <button
          type="button"
          onClick={onSuggestTags}
          disabled={tagSuggestionRunning}
          className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {tagSuggestionRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Send
        </button>
      </div>
      {chatError ? <p className="px-1 text-xs text-[#b42318]">{chatError}</p> : null}
    </div>
  );
}

function TagsPanel({
  appliedTags,
  candidateTags,
  tagDraft,
  setTagDraft,
  tagSaving,
  onAddTag,
  onRemoveTag,
  chatMessages,
  chatInput,
  setChatInput,
  chatReply,
  chatError,
  tagSuggestionRunning,
  onSuggestTags
}: Pick<GraphInspectorSidebarProps, 'appliedTags' | 'candidateTags' | 'tagDraft' | 'setTagDraft' | 'tagSaving' | 'onAddTag' | 'onRemoveTag' | 'chatMessages' | 'chatInput' | 'setChatInput' | 'chatReply' | 'chatError' | 'tagSuggestionRunning' | 'onSuggestTags'>) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-700">Tags</p>
        {tagSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" /> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {appliedTags.length ? appliedTags.map((tag) => (
          <span key={tag.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
            <Tag className="h-3 w-3 shrink-0 text-gray-500" />
            <span className="truncate">{tag.label}</span>
            <button type="button" onClick={() => onRemoveTag(tag.id)} className="rounded-full p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-800" title="Remove tag">
              <X className="h-3 w-3" />
            </button>
          </span>
        )) : <p className="text-xs text-gray-400">No applied tags yet.</p>}
      </div>
      <div className="flex gap-2">
        <input
          value={tagDraft}
          onChange={(event) => setTagDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onAddTag(tagDraft, { source: 'user', state: 'applied' });
          }}
          placeholder="Add tag"
          className="h-9 min-w-0 flex-1 rounded-xl bg-gray-50 px-3 text-sm outline-none placeholder:text-gray-400"
        />
        <button
          type="button"
          onClick={() => onAddTag(tagDraft, { source: 'user', state: 'applied' })}
          disabled={tagSaving || !tagDraft.trim()}
          className="inline-flex h-9 items-center gap-1 rounded-full bg-black px-3 text-sm font-medium text-white hover:bg-gray-950 disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
      <NodeChatPanel
        chatMessages={chatMessages}
        chatInput={chatInput}
        setChatInput={setChatInput}
        chatReply={chatReply}
        chatError={chatError}
        tagSuggestionRunning={tagSuggestionRunning}
        onSuggestTags={onSuggestTags}
      />
      {candidateTags.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500">Suggested</p>
          {candidateTags.map((tag) => (
            <div key={tag.id} className="rounded-xl bg-gray-50 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-700">{tag.label}</p>
                  {tag.rationale ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{tag.rationale}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => onAddTag(tag.label, { source: tag.sources?.[0] || 'ai_suggested', state: 'applied', rationale: tag.rationale })}
                  className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                >
                  Apply
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PracticePanel({
  activeConcept,
  expandedPracticeConceptId,
  practiceExercises,
  practiceLoading,
  onTogglePractice
}: Pick<GraphInspectorSidebarProps, 'activeConcept' | 'expandedPracticeConceptId' | 'practiceExercises' | 'practiceLoading' | 'onTogglePractice'> & { activeConcept: ConceptNode }) {
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => onTogglePractice(activeConcept.id)}
        className="inline-flex h-9 w-full items-center justify-center rounded-full bg-gray-100 px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-200"
      >
        {practiceLoading && expandedPracticeConceptId === activeConcept.id
          ? 'Loading practice...'
          : expandedPracticeConceptId === activeConcept.id
            ? 'Hide practice layer'
            : 'Show practice layer'}
      </button>
      {expandedPracticeConceptId === activeConcept.id ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Practice</p>
          {practiceExercises.length ? practiceExercises.slice(0, 8).map((exercise) => (
            <div key={exercise.id} className="rounded-xl bg-gray-50 px-3 py-2">
              <p className="line-clamp-2 text-sm font-medium text-gray-700">{exercise.title}</p>
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-gray-500">{exercise.prompt}</p>
              {exercise.sourceRef ? <p className="mt-2 truncate text-xs text-gray-400">{exercise.sourceRef.name}</p> : null}
            </div>
          )) : <p className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-400">No bound practice yet.</p>}
        </div>
      ) : null}
    </section>
  );
}

function SourceCardsPanel({ activeConcept }: { activeConcept: ConceptNode }) {
  return (
    <section className="space-y-2">
      <p className="text-sm font-medium text-gray-700">Sources</p>
      {(activeConcept.sources || []).slice(0, 5).map((source) => (
        <div key={source.id} className="rounded-xl bg-gray-50 px-3 py-2">
          <p className="truncate text-sm font-medium text-gray-700">{source.name}</p>
          <p className="mt-0.5 truncate text-xs text-gray-400">{source.path || source.id}</p>
          {source.snippets?.[0]?.quote ? (
            <p className="mt-2 line-clamp-3 text-xs leading-5 text-gray-500">{source.snippets[0].quote}</p>
          ) : null}
        </div>
      ))}
      {!activeConcept.sources?.length ? <p className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-400">No source provenance recorded.</p> : null}
    </section>
  );
}

interface NodeActionPopoverProps {
  activeConcept: ConceptNode;
  position: { x: number; y: number };
  mode: NodePopoverMode;
  setMode: (mode: NodePopoverMode) => void;
  appliedTags: any[];
  candidateTags: any[];
  tagDraft: string;
  setTagDraft: (value: string) => void;
  tagSaving: boolean;
  onAddTag: (label: string, options?: AddTagOptions) => void;
  onRemoveTag: (tagId: string) => void;
  chatMessages: NodeChatMessage[];
  chatInput: string;
  setChatInput: (value: string) => void;
  chatReply: string;
  chatError: string | null;
  tagSuggestionRunning: boolean;
  onSuggestTags: () => void;
  onExplainConcept: () => void;
}

function NodeActionPopover({
  activeConcept,
  position,
  mode,
  setMode,
  appliedTags,
  candidateTags,
  tagDraft,
  setTagDraft,
  tagSaving,
  onAddTag,
  onRemoveTag,
  chatMessages,
  chatInput,
  setChatInput,
  chatReply,
  chatError,
  tagSuggestionRunning,
  onSuggestTags,
  onExplainConcept
}: NodeActionPopoverProps) {
  const stopCanvasGesture = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className="pointer-events-auto absolute rounded-lg mt-1 text-xs z-[9999]"
      style={{ left: position.x, top: position.y }}
      onMouseDown={stopCanvasGesture}
      onClick={stopCanvasGesture}
      onWheel={stopCanvasGesture}
    >
      {mode === 'menu' ? (
        <div className="flex flex-row shrink-0 p-0.5 bg-white text-medium rounded-xl shadow-xl border border-gray-100">
          <button
            aria-label="Explain"
            className="px-1.5 py-[1px] hover:bg-gray-50 rounded-xl flex items-center gap-1 min-w-fit transition"
            onClick={() => setMode('explain')}
          >
            <Lightbulb className="size-3 shrink-0" />
            <div className="shrink-0">Explain</div>
          </button>
          <button
            aria-label="Tags"
            className="px-1.5 py-[1px] hover:bg-gray-50 rounded-xl flex items-center gap-1 min-w-fit transition"
            onClick={() => setMode('tags')}
          >
            <Tag className="size-3 shrink-0" />
            <div className="shrink-0">Tags</div>
          </button>
          <button
            aria-label="Sources"
            className="px-1.5 py-[1px] hover:bg-gray-50 rounded-xl flex items-center gap-1 min-w-fit transition"
            onClick={() => setMode('sources')}
          >
            <FileText className="size-3 shrink-0" />
            <div className="shrink-0">Sources</div>
          </button>
        </div>
      ) : null}

      {mode === 'explain' ? (
        <div className="space-y-1">
          <div className="py-1 flex bg-white border border-gray-100 w-72 rounded-full shadow-xl">
            <input
              type="text"
              id={`floating-message-input-${activeConcept.id}`}
              name={`kg-node-question-${activeConcept.id}`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="ml-5 w-full flex-1 appearance-none border-0 bg-transparent text-sm font-normal text-gray-900 outline-none ring-0 placeholder:text-gray-400 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
              placeholder="Ask a question"
              aria-label="Ask a question"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onExplainConcept();
              }}
              autoFocus
            />
            <div className="ml-1 mr-1">
              <button
                aria-label="Submit question"
                className={`${chatInput.trim() !== '' ? 'bg-black text-white hover:bg-gray-900 ' : 'text-white bg-gray-200 disabled'} transition rounded-full p-1.5 m-0.5 self-center`}
                onClick={onExplainConcept}
                disabled={tagSuggestionRunning}
              >
                {tagSuggestionRunning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-4">
                    <path fillRule="evenodd" d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          {(chatMessages.length || chatReply || chatError) ? (
            <div className="w-72 rounded-2xl border border-gray-100 bg-white p-2 text-xs font-normal text-gray-700 shadow-xl">
              <div className="mb-1 line-clamp-1 px-1 text-xs font-medium leading-5 text-gray-500">{activeConcept.title}</div>
              <div className="max-h-[18rem] overflow-y-auto overscroll-contain pr-1 text-sm leading-6 [&>div>div]:gap-1 [&_li]:text-sm [&_li]:leading-6 [&_ol]:space-y-1 [&_p]:text-sm [&_p]:font-normal [&_p]:leading-6 [&_ul]:space-y-1">
                {chatMessages.slice(-4).map((message, index) => (
                  <div key={`${message.role}-${index}`} className={`mb-1 rounded-xl px-2 py-1.5 text-sm font-normal leading-6 ${message.role === 'user' ? 'ml-5 bg-gray-50 text-gray-700' : 'mr-5 bg-white text-gray-700'}`}>
                    {message.role === 'assistant' ? (
                      <MarkdownPreview content={message.content} variant="message" emptyMessage="" />
                    ) : (
                      message.content
                    )}
                  </div>
                ))}
                {chatReply && !chatMessages.some((message) => message.role === 'assistant' && message.content === chatReply) ? (
                  <div className="mr-5 rounded-xl bg-white px-2 py-1.5 text-sm font-normal leading-6 text-gray-700">
                    <MarkdownPreview content={chatReply} variant="message" emptyMessage="" isStreaming={tagSuggestionRunning} />
                  </div>
                ) : null}
                {chatError ? <div className="px-1 py-1 text-[#b42318]">{chatError}</div> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {mode === 'tags' ? (
        <div className="w-80 rounded-2xl border border-gray-100 bg-white p-2 text-xs shadow-xl">
          <div className="mb-2 flex items-center justify-between px-1">
            <div className="font-medium text-gray-500">Tags</div>
            {tagSaving ? <Loader2 className="size-3.5 animate-spin text-gray-400" /> : null}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {appliedTags.length ? appliedTags.map((tag) => (
              <span key={tag.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-700">
                <Tag className="size-3 shrink-0 text-gray-500" />
                <span className="truncate">{tag.label}</span>
                <button type="button" onClick={() => onRemoveTag(tag.id)} className="rounded-full p-0.5 text-gray-500 hover:bg-gray-200">
                  <X className="size-3" />
                </button>
              </span>
            )) : <div className="px-1 text-gray-500">No applied tags yet.</div>}
          </div>
          <div className="mb-2 flex gap-1.5">
            <input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onAddTag(tagDraft, { source: 'user', state: 'applied' });
              }}
              placeholder="Add tag"
              className="min-w-0 flex-1 rounded-xl bg-gray-50 px-3 py-1.5 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => onAddTag(tagDraft, { source: 'user', state: 'applied' })}
              disabled={!tagDraft.trim() || tagSaving}
              className="rounded-full bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {candidateTags.length ? (
            <div className="space-y-1">
              <div className="px-1 text-gray-500">Suggested</div>
              {candidateTags.slice(0, 4).map((tag) => (
                <div key={tag.id} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 hover:bg-gray-50">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-gray-700">{tag.label}</div>
                    {tag.rationale ? <div className="line-clamp-1 text-xs text-gray-400">{tag.rationale}</div> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => onAddTag(tag.label, { source: tag.sources?.[0] || 'ai_suggested', state: 'applied', rationale: tag.rationale })}
                    className="shrink-0 rounded-full px-2 py-1 text-xs font-medium hover:bg-gray-100"
                  >
                    Apply
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {mode === 'sources' ? (
        <div className="w-80 max-h-72 overflow-y-auto rounded-2xl border border-gray-100 bg-white p-1.5 text-xs shadow-xl">
          <div className="px-2 py-1 text-gray-500">Sources</div>
          {(activeConcept.sources || []).length ? (activeConcept.sources || []).slice(0, 8).map((source) => (
            <div key={source.id} className="rounded-xl px-2.5 py-1.5 text-left hover:bg-gray-50">
              <div className="flex items-center gap-1 text-black">
                <FileText className="size-4 shrink-0" />
                <div className="line-clamp-1 flex-1 text-sm">{source.name}</div>
              </div>
              <div className="line-clamp-1 pl-5 text-xs text-gray-500">{source.path || source.id}</div>
              {source.snippets?.[0]?.quote ? <div className="mt-1 line-clamp-2 pl-5 text-xs text-gray-500">{source.snippets[0].quote}</div> : null}
            </div>
          )) : (
            <div className="px-2 pt-4 pb-6 text-center text-xs text-gray-500">No source provenance recorded.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function GraphInspectorSidebar(props: GraphInspectorSidebarProps) {
  const {
    sidebarControls,
    activeConcept
  } = props;

  const stopGraphWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-gray-100 bg-white">
      {sidebarControls ? (
        <div className="shrink-0 border-b border-gray-100 px-4 py-3">
          {sidebarControls}
        </div>
      ) : null}

      <div className="shrink-0 border-b border-gray-100 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-gray-400">Inspector</p>
        <h3 className="mt-1 truncate text-base font-medium text-gray-800">{activeConcept?.title || 'Select a concept'}</h3>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-12"
        onWheelCapture={stopGraphWheel}
      >
        <div className="space-y-5 text-sm">
          <SourceFilterPanel
            sourceOptions={props.sourceOptions}
            sourceLabel={props.sourceLabel}
            selectedSourceIds={props.selectedSourceIds}
            onToggleSource={props.onToggleSource}
            onClearSources={props.onClearSources}
          />

          {activeConcept ? (
            <>
              {activeConcept.description ? <ConceptSummaryPanel activeConcept={activeConcept} /> : null}
              <TagsPanel
                appliedTags={props.appliedTags}
                candidateTags={props.candidateTags}
                tagDraft={props.tagDraft}
                setTagDraft={props.setTagDraft}
                tagSaving={props.tagSaving}
                onAddTag={props.onAddTag}
                onRemoveTag={props.onRemoveTag}
                chatMessages={props.chatMessages}
                chatInput={props.chatInput}
                setChatInput={props.setChatInput}
                chatReply={props.chatReply}
                chatError={props.chatError}
                tagSuggestionRunning={props.tagSuggestionRunning}
                onSuggestTags={props.onSuggestTags}
              />
              <PracticePanel
                activeConcept={activeConcept}
                expandedPracticeConceptId={props.expandedPracticeConceptId}
                practiceExercises={props.practiceExercises}
                practiceLoading={props.practiceLoading}
                onTogglePractice={props.onTogglePractice}
              />
              <SourceCardsPanel activeConcept={activeConcept} />
            </>
          ) : (
            <div className="px-3 py-8 text-center text-sm text-gray-400">
              Select a concept on the graph to inspect sources and practice.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function CosmosKnowledgeGraphWorkbench({
  workspaceId,
  concepts,
  edges,
  selectedId,
  onSelectConcept,
  pathIds,
  sources = [],
  searchTerm = '',
  focusConceptId = null,
  sidebarControls,
  variant = 'embedded'
}: CosmosKnowledgeGraphWorkbenchProps) {
  const cosmographRef = useRef<CosmographRef>(undefined);
  const graphFrameRef = useRef<HTMLDivElement>(null);
  const [mode] = useState<GraphMode>('global');
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set());
  const [inspectedPointId, setInspectedPointId] = useState<string | null>(selectedId || null);
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const [nodePopoverMode, setNodePopoverMode] = useState<NodePopoverMode>('menu');
  const [nodePopoverPosition, setNodePopoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [expandedPracticeConceptId, setExpandedPracticeConceptId] = useState<string | null>(null);
  const [practiceExercises, setPracticeExercises] = useState<ConceptExercise[]>([]);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [conceptTags, setConceptTags] = useState<any[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [tagQuestion, setTagQuestion] = useState('');
  const [chatMessages, setChatMessages] = useState<NodeChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatReply, setChatReply] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [tagSaving, setTagSaving] = useState(false);
  const [tagSuggestionRunning, setTagSuggestionRunning] = useState(false);
  const pathSet = useMemo(() => new Set(pathIds), [pathIds]);
  const normalizedSearchTerm = useMemo(() => searchTerm.trim().toLowerCase(), [searchTerm]);
  const selectedSourceKey = useMemo(() => Array.from(selectedSourceIds).sort().join('|'), [selectedSourceIds]);
  const sourceOptions = useMemo(() => {
    if (sources.length) return sources;
    const byId = new Map<string, GraphSource>();
    concepts.forEach((concept) => {
      (concept.sources || []).forEach((source) => {
        if (!source.id || byId.has(source.id)) return;
        byId.set(source.id, {
          id: source.id,
          name: source.name || 'Unknown source',
          path: source.path,
          resourceType: source.resourceType,
          origin: source.origin,
          nodeCount: 0,
          edgeCount: 0
        });
      });
    });
    return Array.from(byId.values());
  }, [concepts, sources]);
  const conceptById = useMemo(() => new Map(concepts.map((concept) => [concept.id, concept])), [concepts]);
  const activeConcept = inspectedPointId ? conceptById.get(inspectedPointId) || null : null;
  const appliedTags = useMemo(() => conceptTags.filter((tag) => tag.state === 'applied'), [conceptTags]);
  const candidateTags = useMemo(() => conceptTags.filter((tag) => tag.state !== 'applied'), [conceptTags]);

  useEffect(() => {
    setInspectedPointId(selectedId || null);
  }, [selectedId]);

  useEffect(() => {
    if (activePointIndex === null || !activeConcept) {
      setNodePopoverPosition(null);
      return;
    }

    let frameId = 0;
    const updatePosition = () => {
      const cosmograph = cosmographRef.current;
      const frame = graphFrameRef.current;
      const pointPosition = cosmograph?.getPointPositionByIndex(activePointIndex);
      const screenPosition = pointPosition ? cosmograph?.spaceToScreenPosition(pointPosition) : undefined;

      if (frame && screenPosition) {
        const radius = cosmograph?.getPointScreenRadiusByIndex(activePointIndex) ?? 8;
        const width = frame.clientWidth;
        const height = frame.clientHeight;
        const popoverWidth = nodePopoverMode === 'explain' ? 288 : nodePopoverMode === 'menu' ? 190 : 320;
        const popoverHeight = nodePopoverMode === 'menu' ? 38 : 260;
        const preferRight = screenPosition[0] + radius + 12 + popoverWidth < width - 12;
        const x = preferRight
          ? screenPosition[0] + radius + 12
          : Math.max(12, screenPosition[0] - radius - popoverWidth - 12);
        const y = Math.max(12, Math.min(height - popoverHeight - 12, screenPosition[1] + radius + 8));
        setNodePopoverPosition((current) => {
          if (current && Math.abs(current.x - x) < 0.5 && Math.abs(current.y - y) < 0.5) return current;
          return { x, y };
        });
      }

      frameId = window.requestAnimationFrame(updatePosition);
    };

    frameId = window.requestAnimationFrame(updatePosition);
    return () => window.cancelAnimationFrame(frameId);
  }, [activeConcept, activePointIndex, nodePopoverMode]);

  useEffect(() => {
    if (!activeConcept?.id) {
      setConceptTags([]);
      setTagDraft('');
      setTagQuestion('');
      setChatMessages([]);
      setChatInput('');
      setChatReply('');
      setChatError(null);
      return;
    }
    let cancelled = false;
    setConceptTags(activeConcept.tags || []);
    setChatMessages([]);
    setChatInput('');
    setChatReply('');
    setChatError(null);
    learningApi.getConceptTags(workspaceId, activeConcept.id)
      .then((result) => {
        if (!cancelled) setConceptTags(Array.isArray(result.tags) ? result.tags : []);
      })
      .catch(() => {
        if (!cancelled) setConceptTags(activeConcept.tags || []);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, activeConcept?.id]);

  const reloadConceptTags = async (conceptId: string) => {
    const result = await learningApi.getConceptTags(workspaceId, conceptId);
    setConceptTags(Array.isArray(result.tags) ? result.tags : []);
  };

  const addTag = async (label: string, options?: { source?: 'user' | 'ai_suggested' | 'system_candidate'; state?: 'candidate' | 'applied'; rationale?: string }) => {
    if (!activeConcept?.id) return;
    const next = normalizeTag(label);
    if (!next) return;
    setTagSaving(true);
    try {
      await learningApi.addConceptTag({
        workspaceId,
        conceptId: activeConcept.id,
        label: next,
        source: options?.source || 'user',
        state: options?.state || 'applied',
        rationale: options?.rationale
      });
      await reloadConceptTags(activeConcept.id);
      setTagDraft('');
    } finally {
      setTagSaving(false);
    }
  };

  const removeTag = async (tagId: string) => {
    if (!activeConcept?.id || tagId.startsWith('suggested-')) return;
    setTagSaving(true);
    try {
      await learningApi.deleteConceptTag(workspaceId, activeConcept.id, tagId);
      await reloadConceptTags(activeConcept.id);
    } finally {
      setTagSaving(false);
    }
  };

  const suggestTags = async () => {
    if (!activeConcept?.id) return;
    setTagSuggestionRunning(true);
    setChatError(null);
    try {
      const result = await learningApi.suggestConceptTags({
        workspaceId,
        conceptId: activeConcept.id,
        question: chatInput.trim() || tagQuestion.trim() || undefined,
        history: chatMessages.slice(-6)
      });
      setChatReply(result.reply || '');
      const suggested = Array.isArray(result.suggestedTags) ? result.suggestedTags : [];
      setConceptTags((current) => {
        const byKey = new Map(current.map((item) => [String(item.normalizedLabel || item.label).toLowerCase(), item]));
        suggested.forEach((item: any) => {
          const label = normalizeTag(String(item.label || ''));
          const key = label.toLowerCase();
          if (!key || byKey.has(key)) return;
          byKey.set(key, {
            id: `suggested-${key}`,
            label,
            normalizedLabel: key,
            state: 'candidate',
            sources: ['ai_suggested'],
            rationale: item.rationale || ''
          });
        });
        return Array.from(byKey.values());
      });
      const userText = chatInput.trim() || tagQuestion.trim();
      if (userText) {
        const nextMessages: NodeChatMessage[] = [
          { role: 'user', content: userText },
          ...(result.reply ? [{ role: 'assistant' as const, content: String(result.reply) }] : [])
        ];
        setChatMessages((current) => [
          ...current,
          ...nextMessages
        ]);
      } else if (result.reply) {
        setChatMessages((current) => [...current, { role: 'assistant', content: String(result.reply) }]);
      }
      setChatInput('');
      setTagQuestion('');
    } catch (error: any) {
      setChatError(error?.response?.data?.error || error?.message || 'AI 请求失败');
    } finally {
      setTagSuggestionRunning(false);
    }
  };

  const explainConcept = async () => {
    if (!activeConcept?.id) return;
    const userText = chatInput.trim() || tagQuestion.trim();
    setTagSuggestionRunning(true);
    setChatError(null);
    setChatReply('');
    let streamedReply = '';
    try {
      await learningApi.streamConceptExplanation({
        workspaceId,
        conceptId: activeConcept.id,
        question: userText || undefined,
        history: chatMessages.slice(-6)
      }, {
        onDelta: (delta) => {
          streamedReply += delta;
          setChatReply(streamedReply);
        }
      });

      const nextMessages: NodeChatMessage[] = [
        ...(userText ? [{ role: 'user' as const, content: userText }] : []),
        ...(streamedReply ? [{ role: 'assistant' as const, content: streamedReply }] : [])
      ];
      if (nextMessages.length) setChatMessages((current) => [...current, ...nextMessages]);
      setChatInput('');
      setTagQuestion('');
    } catch (error: any) {
      setChatError(error?.response?.data?.error || error?.message || 'AI 请求失败');
    } finally {
      setTagSuggestionRunning(false);
    }
  };

  const conceptHasSelectedSource = (concept: ConceptNode) => {
    if (!selectedSourceIds.size) return true;
    const ids = concept.sourceIds?.length ? concept.sourceIds : (concept.sources || []).map((source) => source.id);
    return ids.some((id) => selectedSourceIds.has(id));
  };

  const visibleIds = useMemo(() => {
    const sourceFilteredIds = new Set(concepts.filter(conceptHasSelectedSource).map((concept) => concept.id));
    let searchFilteredIds = sourceFilteredIds;
    if (normalizedSearchTerm) {
      const matchedIds = new Set(
        concepts
          .filter((concept) => sourceFilteredIds.has(concept.id) && matchesGraphSearch(concept, normalizedSearchTerm))
          .map((concept) => concept.id)
      );
      searchFilteredIds = new Set(matchedIds);
      edges.forEach((edge) => {
        if (matchedIds.has(edge.from) && sourceFilteredIds.has(edge.to)) searchFilteredIds.add(edge.to);
        if (matchedIds.has(edge.to) && sourceFilteredIds.has(edge.from)) searchFilteredIds.add(edge.from);
      });
    }
    if (mode === 'path' && pathSet.size) return new Set(Array.from(pathSet).filter((id) => sourceFilteredIds.has(id)));
    if (mode === 'local' && selectedId) {
      const localIds = localNodeIdsFor(selectedId, edges, 2);
      return new Set(Array.from(localIds).filter((id) => searchFilteredIds.has(id)));
    }
    return new Set(concepts.filter((concept) => searchFilteredIds.has(concept.id)).slice(0, 1200).map((concept) => concept.id));
  }, [concepts, edges, mode, normalizedSearchTerm, pathSet, selectedId, selectedSourceKey]);

  const prepared = useMemo(() => {
    const candidate = concepts.filter((concept) => visibleIds.has(concept.id)).slice(0, mode === 'global' ? 1200 : 260);
    const exercisePoints = expandedPracticeConceptId && visibleIds.has(expandedPracticeConceptId)
      ? practiceExercises.slice(0, 16).map((exercise, exerciseIndex) => ({
          exercise,
          id: `exercise:${exercise.id}`,
          indexOffset: exerciseIndex
        }))
      : [];
    const candidateIds = new Set(candidate.map((node) => node.id));
    const indexById = new Map<string, number>();
    candidate.forEach((node, index) => indexById.set(node.id, index));
    exercisePoints.forEach((item, index) => indexById.set(item.id, candidate.length + index));
    const visibleEdges = edges
      .filter((edge) => candidateIds.has(edge.from) && candidateIds.has(edge.to))
      .slice(0, mode === 'global' ? 2400 : 720);
    const degreeById = new Map<string, number>();

    visibleEdges.forEach((edge) => {
      degreeById.set(edge.from, (degreeById.get(edge.from) || 0) + 1);
      degreeById.set(edge.to, (degreeById.get(edge.to) || 0) + 1);
    });

    const points: GraphPoint[] = candidate.map((node, index) => {
      const group = conceptGroup(node);
      const degree = degreeById.get(node.id) || 0;
      const isPath = pathSet.has(node.id);
      const isSelected = node.id === selectedId;
      return {
        id: node.id,
        index,
        label: node.title || node.id,
        category: node.category || group,
        group,
        nodeType: 'concept',
        color: nodeColor(group, isPath, isSelected),
        size: 4.5 + Math.min(8, Math.sqrt(degree + 1) * 1.55) + (isPath ? 1.4 : 0),
        labelWeight: isSelected ? 1 : isPath ? 0.92 : Math.min(0.82, 0.18 + degree * 0.08),
        path: isPath
      };
    });

    const exerciseGraphPoints: GraphPoint[] = exercisePoints.map((item, index) => ({
      id: item.id,
      index: candidate.length + index,
      label: item.exercise.title || item.exercise.prompt || 'Practice',
      category: item.exercise.exerciseType || 'exercise',
      group: 'exercise',
      nodeType: 'exercise',
      parentConceptId: expandedPracticeConceptId || undefined,
      color: exerciseColor(item.exercise.exerciseType),
      size: 4.2,
      labelWeight: 0.72,
      path: false
    }));

    const links: GraphLink[] = visibleEdges.map((edge) => ({
      source: edge.from,
      target: edge.to,
      sourceIndex: indexById.get(edge.from) ?? 0,
      targetIndex: indexById.get(edge.to) ?? 0,
      relationType: edge.relationType,
      color: relationColor(edge.relationType),
      width: Math.max(0.45, Math.min(2.2, Number(edge.weight || 0.65))),
      strength: relationStrength(edge.relationType) * Math.max(0.25, Number(edge.confidence ?? 0.7)),
      arrow: relationArrow(edge.relationType)
    }));
    exercisePoints.forEach((item) => {
      if (!expandedPracticeConceptId) return;
      links.push({
        source: expandedPracticeConceptId,
        target: item.id,
        sourceIndex: indexById.get(expandedPracticeConceptId) ?? 0,
        targetIndex: indexById.get(item.id) ?? 0,
        relationType: item.exercise.role || 'assesses',
        color: '#c8cdd2',
        width: 0.75,
        strength: Math.max(0.42, Number(item.exercise.confidence || 0.66)),
        arrow: false
      });
    });

    return { points: [...points, ...exerciseGraphPoints], links };
  }, [concepts, edges, mode, pathSet, selectedId, visibleIds, expandedPracticeConceptId, practiceExercises]);

  const toggleSource = (sourceId: string) => {
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  const expandPracticeFor = async (conceptId: string) => {
    if (expandedPracticeConceptId === conceptId) {
      setExpandedPracticeConceptId(null);
      setPracticeExercises([]);
      return;
    }
    setExpandedPracticeConceptId(conceptId);
    setPracticeLoading(true);
    try {
      const result = await learningApi.getConceptExercises(workspaceId, conceptId, { limit: 16 });
      setPracticeExercises(Array.isArray(result.exercises) ? result.exercises : []);
    } catch {
      setPracticeExercises([]);
    } finally {
      setPracticeLoading(false);
    }
  };

  const config = useMemo<CosmographConfig>(() => ({
    points: prepared.points,
    links: prepared.links,
    pointIdBy: 'id',
    pointIndexBy: 'index',
    pointLabelBy: 'label',
    pointLabelWeightBy: 'labelWeight',
    pointIncludeColumns: ['id', 'label', 'category', 'group', 'nodeType', 'path'],
    pointColorBy: 'color',
    pointColorStrategy: 'direct',
    pointDefaultColor: '#5f6368',
    pointSizeBy: 'size',
    pointSizeStrategy: 'direct',
    pointDefaultSize: 5,
    pointSizeScale: 1,
    linkSourceBy: 'source',
    linkTargetBy: 'target',
    linkSourceIndexBy: 'sourceIndex',
    linkTargetIndexBy: 'targetIndex',
    linkColorBy: 'color',
    linkColorStrategy: 'direct',
    linkDefaultColor: '#b7bcc2',
    linkWidthBy: 'width',
    linkWidthStrategy: 'direct',
    linkDefaultWidth: 0.7,
    linkStrengthBy: 'strength',
    linkArrowBy: 'arrow',
    linkDefaultArrows: false,
    linkArrowsSizeScale: 0.62,
    linkVisibilityDistanceRange: [30, 220],
    linkVisibilityMinTransparency: 0.1,
    linkGreyoutOpacity: 0.06,
    backgroundColor: '#ffffff',
    hoveredPointCursor: 'pointer',
    hoveredLinkCursor: 'pointer',
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#111214',
    focusedPointRingColor: '#111214',
    showLabels: true,
    showDynamicLabels: true,
    showDynamicLabelsLimit: mode === 'global' ? 34 : 80,
    showTopLabels: true,
    showTopLabelsLimit: mode === 'global' ? 18 : 60,
    showFocusedPointLabel: true,
    showHoveredPointLabel: true,
    showSelectedLabels: true,
    showUnselectedPointLabels: false,
    selectedPointLabelsLimit: 80,
    pointLabelClassName: labelPillClassName,
    hoveredPointLabelClassName: labelPillClassName,
    pointLabelColor: '#111214',
    pointLabelFontSize: 12,
    staticLabelWeight: 0.82,
    dynamicLabelWeight: 0.7,
    labelMargin: 6,
    labelPadding: [8, 4, 8, 4],
    enableSimulation: true,
    simulationDecay: 5200,
    simulationFriction: 0.91,
    simulationGravity: mode === 'local' ? 0.2 : 0.14,
    simulationCenter: 0.08,
    simulationRepulsion: mode === 'global' ? 0.82 : 0.72,
    simulationLinkSpring: 0.9,
    simulationLinkDistance: mode === 'global' ? 46 : 58,
    simulationCluster: 0.025,
    enableDrag: true,
    enableZoom: true,
    enableSimulationDuringZoom: true,
    selectPointOnClick: true,
    focusPointOnClick: true,
    onClick: (index?: number) => {
      if (typeof index !== 'number') {
        setInspectedPointId(null);
        setActivePointIndex(null);
        setNodePopoverMode('menu');
        onSelectConcept?.(null);
        return;
      }
      const point = prepared.points[index];
      if (!point) return;
      if (point.nodeType === 'exercise') return;
      setInspectedPointId(point.id);
      setActivePointIndex(index);
      setNodePopoverMode('menu');
      onSelectConcept?.(conceptById.get(point.id) || null);
    },
    onLabelClick: (index: number, id: string) => {
      if (conceptById.has(id)) {
        setInspectedPointId(id);
        setActivePointIndex(index);
        setNodePopoverMode('menu');
        onSelectConcept?.(conceptById.get(id) || null);
      }
    },
    resetSelectionOnEmptyCanvasClick: true,
    preservePointPositionsOnDataUpdate: true,
    fitViewOnInit: true,
    fitViewDelay: 520,
    fitViewDuration: 620,
    fitViewPadding: mode === 'global' ? 0.22 : 0.3,
    pixelRatio: typeof window === 'undefined' ? 2 : Math.min(2, window.devicePixelRatio || 1),
    pointSamplingDistance: 130,
    statusIndicatorMode: 'spinner',
    disableLogging: true,
    attribution: ''
  }), [mode, prepared, conceptById, onSelectConcept]);

  useEffect(() => {
    if (!focusConceptId) return;
    const index = prepared.points.findIndex((point) => point.nodeType === 'concept' && point.id === focusConceptId);
    if (index < 0) return;
    const concept = conceptById.get(focusConceptId) || null;
    const timer = window.setTimeout(() => {
      const cosmograph = cosmographRef.current;
      cosmograph?.selectPoint(index);
      cosmograph?.zoomToPoint(index, 650, 2.2, true);
      setInspectedPointId(focusConceptId);
      setActivePointIndex(index);
      setNodePopoverMode('menu');
      onSelectConcept?.(concept);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [focusConceptId, prepared.points, conceptById, onSelectConcept]);

  const statsLabel = `${prepared.points.length} nodes · ${prepared.links.length} visible edges`;
  const sourceLabel = selectedSourceIds.size ? `${selectedSourceIds.size} source${selectedSourceIds.size > 1 ? 's' : ''}` : 'all sources';
  const frameHeightClass = variant === 'embedded'
    ? 'h-[calc(100dvh-48px)] max-h-[calc(100dvh-48px)]'
    : 'h-full max-h-full';

  return (
    <CosmographProvider>
      <div className={`min-h-0 w-full min-w-0 overflow-hidden overscroll-none bg-white ${frameHeightClass}`}>
        <div
          ref={graphFrameRef}
          className={`relative min-h-0 min-w-0 overflow-hidden overscroll-none bg-white ${frameHeightClass}`}
          style={{
            '--cosmograph-ui-background': 'rgba(255, 255, 255, 0.92)',
            '--cosmograph-ui-text': '#34373c',
            '--cosmograph-ui-element-color': '#eef1f4',
            '--cosmograph-ui-highlighted-element-color': '#111214',
            '--cosmograph-search-background': 'transparent',
            '--cosmograph-search-list-background': 'rgba(255, 255, 255, 0.94)',
            '--cosmograph-search-list-match-background': 'rgba(17, 18, 20, 0.1)',
            '--cosmograph-search-list-match-color': '#111214',
            '--cosmograph-button-background': '#eef1f4',
            '--cosmograph-button-color': '#34373c',
            '--cosmograph-button-border-radius': '6px'
          } as React.CSSProperties}
        >
          {prepared.points.length ? (
            <Cosmograph ref={cosmographRef} className="h-full w-full" {...config} />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-[#747980]">
              暂无可显示的知识节点
            </div>
          )}

          <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-2">
            <div className="flex h-9 items-center gap-1 rounded-md border border-[#dfe3e8] bg-white/90 px-1 shadow-sm backdrop-blur">
              <CosmographButtonZoomInOut />
              <CosmographButtonFitView />
              <CosmographButtonPlayPause />
            </div>
          </div>

          <div className="absolute right-3 top-3 z-10 flex max-w-[calc(100%-120px)] flex-wrap items-center justify-end gap-2">
            <SourceFilterPanel
              sourceOptions={sourceOptions}
              sourceLabel={sourceLabel}
              selectedSourceIds={selectedSourceIds}
              onToggleSource={toggleSource}
              onClearSources={() => setSelectedSourceIds(new Set())}
            />
            {sidebarControls}
          </div>

          <div className="absolute bottom-3 left-3 z-10 rounded-md border border-[#dfe3e8] bg-white/90 px-3 py-2 text-xs text-[#4d5864] shadow-sm backdrop-blur">
            {statsLabel} · {sourceLabel} · {mode === 'local' ? '2-hop local graph' : mode === 'path' ? 'planned path' : 'global graph'} · drag, zoom, search, focus
          </div>

          {activeConcept && nodePopoverPosition ? (
            <div className="pointer-events-none absolute inset-0 z-20">
              <NodeActionPopover
                activeConcept={activeConcept}
                position={nodePopoverPosition}
                mode={nodePopoverMode}
                setMode={setNodePopoverMode}
                appliedTags={appliedTags}
                candidateTags={candidateTags}
                tagDraft={tagDraft}
                setTagDraft={setTagDraft}
                tagSaving={tagSaving}
                onAddTag={(label, options) => void addTag(label, options)}
                onRemoveTag={(tagId) => void removeTag(tagId)}
                chatMessages={chatMessages}
                chatInput={chatInput}
                setChatInput={setChatInput}
                chatReply={chatReply}
                chatError={chatError}
                tagSuggestionRunning={tagSuggestionRunning}
                onSuggestTags={() => void suggestTags()}
                onExplainConcept={() => void explainConcept()}
              />
            </div>
          ) : null}
        </div>
      </div>
    </CosmographProvider>
  );
}

export default memo(CosmosKnowledgeGraphWorkbench, sameWorkbenchProps);
