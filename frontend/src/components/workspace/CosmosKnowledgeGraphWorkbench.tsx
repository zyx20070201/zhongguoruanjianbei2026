import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Sparkles, Tag, X } from 'lucide-react';
import {
  Cosmograph,
  CosmographButtonFitView,
  CosmographButtonPlayPause,
  CosmographButtonZoomInOut,
  CosmographProvider,
  CosmographSearch,
  type CosmographConfig,
  type CosmographRef
} from '@cosmograph/react';
import type { ConceptEdge, ConceptNode, GraphSource } from './LearningIntelligenceDashboard';
import { learningApi } from '../../services/learningApi';

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
  expandedPracticeConceptId: string | null;
  practiceExercises: ConceptExercise[];
  practiceLoading: boolean;
  onTogglePractice: (conceptId: string) => void;
}

function SourceFilterPanel({
  sourceOptions,
  sourceLabel,
  selectedSourceIds,
  onToggleSource,
  onClearSources
}: Pick<GraphInspectorSidebarProps, 'sourceOptions' | 'sourceLabel' | 'selectedSourceIds' | 'onToggleSource' | 'onClearSources'>) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[#202124]">Sources</p>
          <p className="text-[11px] text-[#747980]">{sourceLabel}</p>
        </div>
        {selectedSourceIds.size ? (
          <button type="button" onClick={onClearSources} className="rounded px-2 py-1 text-xs font-medium text-[#5f6368] hover:bg-[#eef1f4]">
            Clear
          </button>
        ) : null}
      </div>
      {sourceOptions.length ? (
        <div className="rounded border border-[#e5e7eb] bg-white p-2">
          {sourceOptions.slice(0, 40).map((source) => {
            const checked = selectedSourceIds.has(source.id);
            return (
              <label key={source.id} className={`flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-xs transition ${checked ? 'bg-[#f0f2f4]' : 'hover:bg-[#f6f7f8]'}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleSource(source.id)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[#202124]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[#202124]">{source.name}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-[#7a7f85]">{source.path || source.origin || source.resourceType || source.id}</span>
                </span>
                <span className="shrink-0 text-[11px] text-[#8a8f94]">{source.nodeCount || 0}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="rounded border border-[#e5e7eb] bg-white px-3 py-3 text-xs text-[#777b80]">No source filters available.</p>
      )}
    </section>
  );
}

function ConceptSummaryPanel({ activeConcept }: { activeConcept: ConceptNode }) {
  const percent = (value?: number | null) => Math.round(Math.max(0, Math.min(1, Number(value ?? 0))) * 100);

  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-[#202124]">Concept Detail</p>
        {activeConcept.description ? <p className="mt-2 leading-5 text-[#5f6368]">{activeConcept.description}</p> : null}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-[#e5e7eb] bg-white px-2 py-2">
          <p className="text-[11px] text-[#96999d]">Mastery</p>
          <p className="mt-1 font-semibold text-[#202124]">{percent(activeConcept.learnerState?.masteryEstimate)}%</p>
        </div>
        <div className="rounded border border-[#e5e7eb] bg-white px-2 py-2">
          <p className="text-[11px] text-[#96999d]">Weak</p>
          <p className="mt-1 font-semibold text-[#202124]">{percent(activeConcept.learnerState?.weaknessEstimate)}%</p>
        </div>
        <div className="rounded border border-[#e5e7eb] bg-white px-2 py-2">
          <p className="text-[11px] text-[#96999d]">Ready</p>
          <p className="mt-1 font-semibold text-[#202124]">{percent(activeConcept.learnerState?.readinessEstimate)}%</p>
        </div>
      </div>
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
    <div className="space-y-2 rounded border border-[#eef1f4] bg-[#fbfbfa] p-2">
      <div className="space-y-2 pr-1">
        {chatMessages.length ? chatMessages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`rounded px-2 py-1.5 text-[11px] leading-4 ${message.role === 'user' ? 'ml-6 bg-white text-[#202124]' : 'mr-6 bg-[#edf3f8] text-[#2f3b46]'}`}>
            {message.content}
          </div>
        )) : <p className="px-1 text-[11px] text-[#777b80]">Ask about the node, and AI will explain it here.</p>}
        {chatReply && !chatMessages.some((message) => message.role === 'assistant' && message.content === chatReply) ? (
          <div className="rounded bg-[#edf3f8] px-2 py-1.5 text-[11px] leading-4 text-[#2f3b46]">{chatReply}</div>
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
          className="h-8 min-w-0 flex-1 rounded border border-[#d8dde4] px-2 text-xs outline-none focus:border-[#202124]"
        />
        <button
          type="button"
          onClick={onSuggestTags}
          disabled={tagSuggestionRunning}
          className="inline-flex h-8 items-center gap-1 rounded border border-[#d8dde4] bg-white px-2 text-xs font-medium text-[#34373c] hover:bg-[#f5f6f7] disabled:opacity-50"
        >
          {tagSuggestionRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Send
        </button>
      </div>
      {chatError ? <p className="px-1 text-[11px] text-[#b42318]">{chatError}</p> : null}
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
    <section className="space-y-3 rounded border border-[#e5e7eb] bg-white px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[#202124]">Tags</p>
        {tagSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#747980]" /> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {appliedTags.length ? appliedTags.map((tag) => (
          <span key={tag.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#d8dde4] bg-[#f8fafb] px-2 py-1 text-[11px] font-medium text-[#202124]">
            <Tag className="h-3 w-3 shrink-0 text-[#747980]" />
            <span className="truncate">{tag.label}</span>
            <button type="button" onClick={() => onRemoveTag(tag.id)} className="rounded-full p-0.5 text-[#747980] hover:bg-[#e9edf1] hover:text-[#202124]" title="Remove tag">
              <X className="h-3 w-3" />
            </button>
          </span>
        )) : <p className="text-[11px] text-[#777b80]">No applied tags yet.</p>}
      </div>
      <div className="flex gap-2">
        <input
          value={tagDraft}
          onChange={(event) => setTagDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onAddTag(tagDraft, { source: 'user', state: 'applied' });
          }}
          placeholder="Add tag"
          className="h-8 min-w-0 flex-1 rounded border border-[#d8dde4] px-2 text-xs outline-none focus:border-[#202124]"
        />
        <button
          type="button"
          onClick={() => onAddTag(tagDraft, { source: 'user', state: 'applied' })}
          disabled={tagSaving || !tagDraft.trim()}
          className="inline-flex h-8 items-center gap-1 rounded border border-[#202124] bg-[#202124] px-2 text-xs font-medium text-white disabled:opacity-50"
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
        <div className="space-y-2 border-t border-[#eef1f4] pt-2">
          <p className="text-[11px] font-semibold text-[#747980]">Suggested</p>
          {candidateTags.map((tag) => (
            <div key={tag.id} className="rounded border border-[#e5e7eb] bg-[#fbfbfa] px-2 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-[#202124]">{tag.label}</p>
                  {tag.rationale ? <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[#777b80]">{tag.rationale}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => onAddTag(tag.label, { source: tag.sources?.[0] || 'ai_suggested', state: 'applied', rationale: tag.rationale })}
                  className="shrink-0 rounded border border-[#d8dde4] bg-white px-2 py-1 text-[11px] font-medium text-[#34373c] hover:bg-[#f5f6f7]"
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
        className="w-full rounded border border-[#dfe3e8] bg-white px-3 py-2 text-xs font-medium text-[#34373c] hover:bg-[#f5f6f7]"
      >
        {practiceLoading && expandedPracticeConceptId === activeConcept.id
          ? 'Loading practice...'
          : expandedPracticeConceptId === activeConcept.id
            ? 'Hide practice layer'
            : 'Show practice layer'}
      </button>
      {expandedPracticeConceptId === activeConcept.id ? (
        <div className="space-y-2">
          <p className="font-semibold text-[#202124]">Practice</p>
          {practiceExercises.length ? practiceExercises.slice(0, 8).map((exercise) => (
            <div key={exercise.id} className="rounded border border-[#e5e7eb] bg-white px-3 py-2">
              <p className="line-clamp-2 font-medium text-[#34373c]">{exercise.title}</p>
              <p className="mt-1 line-clamp-3 text-[#6f747a]">{exercise.prompt}</p>
              {exercise.sourceRef ? <p className="mt-2 truncate text-[11px] text-[#96999d]">{exercise.sourceRef.name}</p> : null}
            </div>
          )) : <p className="rounded border border-[#e5e7eb] bg-white px-3 py-3 text-[#777b80]">No bound practice yet.</p>}
        </div>
      ) : null}
    </section>
  );
}

function SourceCardsPanel({ activeConcept }: { activeConcept: ConceptNode }) {
  return (
    <section className="space-y-2">
      <p className="font-semibold text-[#202124]">Sources</p>
      {(activeConcept.sources || []).slice(0, 5).map((source) => (
        <div key={source.id} className="rounded border border-[#e5e7eb] bg-white px-3 py-2">
          <p className="truncate font-medium text-[#34373c]">{source.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-[#7a7f85]">{source.path || source.id}</p>
          {source.snippets?.[0]?.quote ? (
            <p className="mt-2 line-clamp-3 text-[#5f6368]">{source.snippets[0].quote}</p>
          ) : null}
        </div>
      ))}
      {!activeConcept.sources?.length ? <p className="rounded border border-[#e5e7eb] bg-white px-3 py-3 text-[#777b80]">No source provenance recorded.</p> : null}
    </section>
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
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-[#e5e7eb] bg-[#fbfbfa]">
      {sidebarControls ? (
        <div className="shrink-0 border-b border-[#e5e7eb] px-4 py-4">
          {sidebarControls}
        </div>
      ) : null}

      <div className="shrink-0 border-b border-[#e5e7eb] px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#96999d]">Inspector</p>
        <h3 className="mt-1 truncate text-sm font-semibold text-[#202124]">{activeConcept?.title || 'Select a concept'}</h3>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-12"
        onWheelCapture={stopGraphWheel}
      >
        <div className="space-y-5 text-xs">
          <SourceFilterPanel
            sourceOptions={props.sourceOptions}
            sourceLabel={props.sourceLabel}
            selectedSourceIds={props.selectedSourceIds}
            onToggleSource={props.onToggleSource}
            onClearSources={props.onClearSources}
          />

          {activeConcept ? (
            <>
              <div className="border-t border-[#e5e7eb] pt-4">
                <ConceptSummaryPanel activeConcept={activeConcept} />
              </div>
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
            <div className="rounded border border-[#e5e7eb] bg-white px-3 py-8 text-center text-xs text-[#777b80]">
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
  sidebarControls,
  variant = 'embedded'
}: CosmosKnowledgeGraphWorkbenchProps) {
  const cosmographRef = useRef<CosmographRef>(undefined);
  const [mode, setMode] = useState<GraphMode>('global');
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set());
  const [inspectedPointId, setInspectedPointId] = useState<string | null>(selectedId || null);
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

  const conceptHasSelectedSource = (concept: ConceptNode) => {
    if (!selectedSourceIds.size) return true;
    const ids = concept.sourceIds?.length ? concept.sourceIds : (concept.sources || []).map((source) => source.id);
    return ids.some((id) => selectedSourceIds.has(id));
  };

  const visibleIds = useMemo(() => {
    const sourceFilteredIds = new Set(concepts.filter(conceptHasSelectedSource).map((concept) => concept.id));
    if (mode === 'path' && pathSet.size) return new Set(Array.from(pathSet).filter((id) => sourceFilteredIds.has(id)));
    if (mode === 'local' && selectedId) {
      const localIds = localNodeIdsFor(selectedId, edges, 2);
      return new Set(Array.from(localIds).filter((id) => sourceFilteredIds.has(id)));
    }
    return new Set(concepts.filter((concept) => sourceFilteredIds.has(concept.id)).slice(0, 1200).map((concept) => concept.id));
  }, [concepts, edges, mode, pathSet, selectedId, selectedSourceKey]);

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
        onSelectConcept?.(null);
        return;
      }
      const point = prepared.points[index];
      if (!point) return;
      if (point.nodeType === 'exercise') return;
      setInspectedPointId(point.id);
      onSelectConcept?.(conceptById.get(point.id) || null);
    },
    onLabelClick: (_index: number, id: string) => {
      if (conceptById.has(id)) {
        setInspectedPointId(id);
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

  const statsLabel = `${prepared.points.length} nodes · ${prepared.links.length} visible edges`;
  const sourceLabel = selectedSourceIds.size ? `${selectedSourceIds.size} source${selectedSourceIds.size > 1 ? 's' : ''}` : 'all sources';
  const frameHeightClass = variant === 'embedded'
    ? 'h-[calc(100dvh-48px)] max-h-[calc(100dvh-48px)]'
    : 'h-full max-h-full';

  return (
    <CosmographProvider>
      <div className={`grid min-h-0 w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,340px)] overflow-hidden overscroll-none bg-white ${frameHeightClass}`}>
        <div
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
              {(['global', 'local', 'path'] as GraphMode[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setMode(item)}
                  disabled={item === 'local' && !selectedId || item === 'path' && !pathIds.length}
                  className={`h-7 rounded px-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-35 ${
                    mode === item ? 'bg-[#202124] text-white' : 'text-[#5f6368] hover:bg-[#f1f3f5]'
                  }`}
                >
                  {item === 'global' ? 'Global' : item === 'local' ? 'Local' : 'Path'}
                </button>
              ))}
            </div>

            <div className="flex h-9 items-center gap-1 rounded-md border border-[#dfe3e8] bg-white/90 px-1 shadow-sm backdrop-blur">
              <CosmographButtonZoomInOut />
              <CosmographButtonFitView />
              <CosmographButtonPlayPause />
            </div>

            <div className="h-9 w-[260px] rounded-md border border-[#dfe3e8] bg-white/90 px-2 shadow-sm backdrop-blur">
              <CosmographSearch
                accessor="label"
                placeholderText="Search graph"
                showAccessorsMenu={false}
                suggestionFields={{ label: 'Concept', category: 'Type' }}
                selectConnectedPoints
                focusPointOnSelect
                zoomToPointOnSelectScale={2.8}
                zoomToPointOnSelectDuration={360}
              />
            </div>
          </div>

          <div className="absolute bottom-3 left-3 z-10 rounded-md border border-[#dfe3e8] bg-white/90 px-3 py-2 text-xs text-[#4d5864] shadow-sm backdrop-blur">
            {statsLabel} · {sourceLabel} · {mode === 'local' ? '2-hop local graph' : mode === 'path' ? 'planned path' : 'global graph'} · drag, zoom, search, focus
          </div>
        </div>

        <GraphInspectorSidebar
          sidebarControls={sidebarControls}
          activeConcept={activeConcept}
          sourceOptions={sourceOptions}
          sourceLabel={sourceLabel}
          selectedSourceIds={selectedSourceIds}
          onToggleSource={toggleSource}
          onClearSources={() => setSelectedSourceIds(new Set())}
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
          expandedPracticeConceptId={expandedPracticeConceptId}
          practiceExercises={practiceExercises}
          practiceLoading={practiceLoading}
          onTogglePractice={(conceptId) => void expandPracticeFor(conceptId)}
        />
      </div>
    </CosmographProvider>
  );
}

export default memo(CosmosKnowledgeGraphWorkbench, sameWorkbenchProps);
