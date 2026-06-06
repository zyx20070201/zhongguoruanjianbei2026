import {
  ChevronDown,
  CheckCircle2,
  Target,
  Upload
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import {
  OpenWebUISidebarIcon,
  OWDocumentPageIcon,
  OWEllipsisHorizontalIcon,
  OWPencilSquareIcon,
  OWSearchIcon,
  OWWorkspaceIcon
} from '../common/openWebUIIcons';
import { EditorState, ResourceReference } from '../../types';

interface WorkbenchSidebarProps {
  editors: EditorState[];
  resources: ResourceReference[];
  plans?: WorkbenchSidebarPlan[];
  currentWorkbenchId: string;
  activeEditorId: string | null;
  currentWorkbenchTitle: string;
  isExpanded: boolean;
  onActivateEditor: (editorId: string) => void;
  onResourceOpen: (resource: ResourceReference) => void;
  onNewChat: () => void;
  onNewNote: () => void;
  onNewPlan: () => void;
  onOpenAIStudio: () => void;
  onUploadResources: () => void;
  onSearch: () => void;
  onResourceDuplicate: (resource: ResourceReference) => void;
  onResourceDelete: (resource: ResourceReference) => void;
  onResourceReorder: (orderedIds: string[]) => void;
  onToggleSidebar: () => void;
  onPlanStepStatusChange?: (
    planId: string,
    stepId: string,
    status: 'pending' | 'active' | 'done' | 'skipped' | 'blocked'
  ) => void | Promise<void>;
  onPlanAction?: (
    planId: string,
    action: 'start' | 'pause' | 'resume' | 'complete' | 'archive' | 'restore' | 'supersede' | 'set_primary' | 'reopen' | 'duplicate' | 'replan',
    options?: { targetPlanId?: string; title?: string; note?: string }
  ) => void | Promise<void>;
  onPlanStepUpdate?: (
    planId: string,
    stepId: string,
    patch: { title?: string; description?: string; note?: string; estimateMinutes?: number | null; dueDate?: string | null; tags?: string[] }
  ) => void | Promise<void>;
  onPlanFeedback?: (
    planId: string,
    feedback: { stepId?: string | null; category: 'too_hard' | 'too_easy' | 'blocked' | 'resource_mismatch' | 'replan' | 'other'; note?: string; rating?: number | null }
  ) => void | Promise<void>;
}

interface WorkbenchSidebarPlan {
  id: string;
  objective?: string;
  status?: string;
  nextStepId?: string | null;
  version?: number;
  updatedAt?: string;
  structuredPlan?: {
    title?: string;
    objective?: string;
    stages?: Array<Record<string, any>>;
  } | null;
  steps?: Array<Record<string, any>>;
  knowledgeGraphSnapshot?: {
    planFeedback?: Array<Record<string, any>>;
  } | null;
}

type ResourceSectionKey = 'source' | 'workspace' | 'generated';
type WorkbenchSidebarSectionKey = ResourceSectionKey | 'plans';
type SidebarVisualState = 'collapsed' | 'opening' | 'expanded' | 'closing';
type DragResourceItem = {
  type: 'WORKBENCH_RESOURCE';
  resourceId: string;
  resource: ResourceReference;
};

const WORKBENCH_RESOURCE_ITEM_TYPE = 'WORKBENCH_RESOURCE';
const SIDEBAR_SLIDE_MS = 250;

const getResourceSection = (resource: ResourceReference): ResourceSectionKey => {
  const resourceType = (resource.resourceType || resource.type || '').toLowerCase();
  const fileCategory = (resource.fileCategory || '').toLowerCase();
  const extension = (resource.extension || resource.name.split('.').pop() || '').toLowerCase();

  if (resourceType === 'generated' || fileCategory.includes('generated')) return 'generated';
  if (
    resourceType === 'source' ||
    fileCategory.includes('source') ||
    fileCategory.includes('web') ||
    extension === 'source'
  ) {
    return 'source';
  }

  return 'workspace';
};

const formatFileSize = (size?: number) => {
  if (!size) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const getResourceSize = (resource: ResourceReference) => {
  const value = (resource as ResourceReference & { size?: number }).size ?? resource.metadata?.size;
  return typeof value === 'number' ? value : undefined;
};

const getResourceCapsuleType = (resource: ResourceReference, sectionKey: ResourceSectionKey) => {
  if (sectionKey === 'source') return 'Source';
  if (resource.resourceType === 'note' || resource.fileCategory?.includes('note')) return 'Note';
  if (sectionKey === 'generated') return 'Generated';
  return 'File';
};

const formatPlanDate = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
};

const getPlanTitle = (plan: WorkbenchSidebarPlan) =>
  String(plan.structuredPlan?.objective || plan.objective || plan.structuredPlan?.title || 'Learning plan').replace(/\s+/g, ' ').trim();

const getPlanStageCount = (plan: WorkbenchSidebarPlan) =>
  (Array.isArray(plan.structuredPlan?.stages) ? plan.structuredPlan?.stages.length : 0) ||
  (Array.isArray(plan.steps) ? plan.steps.length : 0);

const cleanPlanText = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();

const getPlanStepTitle = (step: Record<string, any>, index: number) => {
  return cleanPlanText(
    step.title ||
      step.display?.title ||
      step.display?.shortHint ||
      step.stepDetail?.title ||
      step.stepDetail?.learningGoal ||
      step.learningGoal ||
      `Step ${index + 1}`
  );
};

const getPlanStepDescription = (step: Record<string, any>) => {
  const parts = [
    step.display?.summary,
    step.display?.narrative,
    step.stepDetail?.narrative,
    step.stepDetail?.whyThisStep,
    step.whyThisStage,
    step.rationale,
    step.stepDetail?.learningGoal,
    step.learningGoal,
    step.stepDetail?.howToLearn,
    step.howToLearn
  ]
    .map(cleanPlanText)
    .filter(Boolean);

  return Array.from(new Set(parts)).slice(0, 3).join(' ');
};

const getPlanStepBullets = (step: Record<string, any>) => {
  const bullets = [
    ...((Array.isArray(step.stepDetail?.practiceTasks) && step.stepDetail.practiceTasks) || []),
    ...((Array.isArray(step.practiceTasks) && step.practiceTasks) || []),
    ...((Array.isArray(step.stepDetail?.completionCriteria) && step.stepDetail.completionCriteria) || []),
    ...((Array.isArray(step.completionCriteria) && step.completionCriteria) || [])
  ]
    .map(cleanPlanText)
    .filter(Boolean);

  return Array.from(new Set(bullets)).slice(0, 4);
};

const getPlanSteps = (plan: WorkbenchSidebarPlan) => {
  const rawSteps = Array.isArray(plan.steps) ? plan.steps : [];
  if (rawSteps.length) {
    return rawSteps.map((step, index) => ({
      id: String(step.id || `step-${index + 1}`),
      status: String(step.status || 'pending'),
      title: getPlanStepTitle(step, index),
      description: getPlanStepDescription(step),
      bullets: getPlanStepBullets(step),
      note: cleanPlanText(step.note),
      artifactBindings: Array.isArray(step.artifactBindings) ? step.artifactBindings : []
    }));
  }

  const structuredStages = Array.isArray(plan.structuredPlan?.stages) ? plan.structuredPlan?.stages || [] : [];
  if (structuredStages.length) {
    return structuredStages.map((stage, index) => ({
      id: String(stage.id || `structured-${stage.order || index + 1}`),
      status: String(stage.status || 'pending'),
      title: cleanPlanText(stage.title || stage.display?.shortHint || `Stage ${index + 1}`),
      description: cleanPlanText(stage.display?.narrative || stage.display?.summary || stage.detail?.narrative || ''),
      bullets: [
        cleanPlanText(stage.display?.primaryTask || ''),
        cleanPlanText(stage.display?.completionHint || ''),
        ...safeStageList(stage.detail?.practiceTasks),
        ...safeStageList(stage.detail?.completionCriteria)
      ].filter(Boolean),
      note: cleanPlanText(stage.note),
      artifactBindings: Array.isArray(stage.artifactBindings) ? stage.artifactBindings : []
    }));
  }

  return [];
};

const getPrimaryPlan = (plans: WorkbenchSidebarPlan[]) =>
  plans.find((plan) => plan.status === 'active') || plans.find((plan) => plan.status !== 'completed' && plan.status !== 'superseded') || plans[0] || null;

const getPlanProgress = (plan: WorkbenchSidebarPlan | null) => {
  const steps = plan ? getPlanSteps(plan) : [];
  const completed = steps.filter((step) => step.status === 'done' || step.status === 'skipped').length;
  const nextStep =
    steps.find((step) => plan?.nextStepId && step.id === plan.nextStepId) ||
    steps.find((step) => step.status === 'active') ||
    steps.find((step) => step.status !== 'done' && step.status !== 'skipped') ||
    null;
  return {
    steps,
    completed,
    total: steps.length,
    percent: steps.length ? Math.round((completed / steps.length) * 100) : 0,
    nextStep
  };
};

const isArchivedPlanStep = (status?: string) => status === 'done' || status === 'skipped';

const planStatusLabel = (value?: string) => {
  if (value === 'done') return 'Done';
  if (value === 'active') return 'Current';
  if (value === 'blocked') return 'Blocked';
  if (value === 'skipped') return 'Skipped';
  return 'Pending';
};

const stepStatusClass = (value?: string) => {
  if (value === 'done') return 'border-[#cfe8d4] bg-[#eef7f0] text-[#2f6f46]';
  if (value === 'active') return 'border-[#d8d8d3] bg-[#202124] text-white';
  if (value === 'blocked') return 'border-[#fed7aa] bg-[#fff7ed] text-[#b54708]';
  if (value === 'skipped') return 'border-[#e2e1dc] bg-[#f1f1ef] text-[#7a7e84]';
  return 'border-[#e2e1dc] bg-white text-[#6e7278]';
};

const planStepStatusOptions = [
  { status: 'active' as const, label: 'Set current' },
  { status: 'done' as const, label: 'Mark done' },
  { status: 'blocked' as const, label: 'Mark blocked' },
  { status: 'skipped' as const, label: 'Skip' },
  { status: 'pending' as const, label: 'Reset pending' }
];

const planActionOptions = [
  { action: 'set_primary' as const, label: 'Set as primary' },
  { action: 'pause' as const, label: 'Pause plan' },
  { action: 'resume' as const, label: 'Resume plan' },
  { action: 'complete' as const, label: 'Complete plan' },
  { action: 'duplicate' as const, label: 'Duplicate plan' },
  { action: 'archive' as const, label: 'Archive plan' }
];

const feedbackOptions = [
  { category: 'too_hard' as const, label: 'Too hard' },
  { category: 'too_easy' as const, label: 'Too easy' },
  { category: 'blocked' as const, label: 'Blocked' },
  { category: 'resource_mismatch' as const, label: 'Bad resources' },
  { category: 'replan' as const, label: 'Replan this' },
  { category: 'other' as const, label: 'Other feedback' }
];

function safeStageList(value: unknown) {
  return Array.isArray(value) ? value.map(cleanPlanText).filter(Boolean) : [];
}

function ResourceRow({
  resource,
  sectionKey,
  isActive,
  isMenuOpen,
  hasOpenEditor,
  orderedResources,
  onActivateEditor,
  onResourceOpen,
  onSetOpenResourceMenuId,
  onResourceDuplicate,
  onResourceDelete,
  onReorder
}: {
  resource: ResourceReference;
  sectionKey: ResourceSectionKey;
  isActive: boolean;
  isMenuOpen: boolean;
  hasOpenEditor: boolean;
  orderedResources: ResourceReference[];
  onActivateEditor: () => void;
  onResourceOpen: (resource: ResourceReference) => void;
  onSetOpenResourceMenuId: (id: string | null) => void;
  onResourceDuplicate: (resource: ResourceReference) => void;
  onResourceDelete: (resource: ResourceReference) => void;
  onReorder: (next: ResourceReference[]) => void;
}) {
  const fileSize = getResourceSize(resource);
  const capsuleType = getResourceCapsuleType(resource, sectionKey);
  const [{ isDragging }, dragRef] = useDrag<DragResourceItem, void, { isDragging: boolean }>(
    () => ({
      type: WORKBENCH_RESOURCE_ITEM_TYPE,
      item: { type: 'WORKBENCH_RESOURCE', resourceId: resource.id, resource },
      collect: (monitor) => ({ isDragging: monitor.isDragging() })
    }),
    [resource.id, resource]
  );
  const [, dropRef] = useDrop<DragResourceItem, void, unknown>(
    () => ({
      accept: WORKBENCH_RESOURCE_ITEM_TYPE,
      drop: (item) => {
        if (item.resourceId === resource.id) return;
        const currentIds = orderedResources.map((entry) => entry.id);
        const from = currentIds.indexOf(item.resourceId);
        const to = currentIds.indexOf(resource.id);
        if (from < 0 || to < 0 || from === to) return;
        const next = [...orderedResources];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        onReorder(next);
      }
    }),
    [orderedResources, resource.id, onReorder]
  );

  return (
    <div
      className={`relative ${isDragging ? 'opacity-40' : 'opacity-100'}`}
      ref={(node) => {
        dragRef(node);
        dropRef(node);
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (hasOpenEditor) onActivateEditor();
          onResourceOpen(resource);
        }}
        className={`relative group/resource w-full flex items-center gap-3 bg-white border border-gray-50/30 rounded-xl p-2 text-left ${
          isActive ? 'ring-1 ring-gray-100' : ''
        }`}
      >
        <div className="pl-1.5">
          <OWDocumentPageIcon className="size-4" />
        </div>

        <div className="flex flex-col justify-center -space-y-0.5 px-1 w-full min-w-0">
          <div className="text-sm flex justify-between items-center">
            <div className="font-medium line-clamp-1 flex-1 pr-1">{resource.name}</div>

            <div className="text-gray-500 text-xs capitalize shrink-0">
              {fileSize ? formatFileSize(fileSize) : capsuleType}
            </div>
          </div>
        </div>
        {hasOpenEditor ? <span className="sr-only">Open</span> : null}
      </button>
      <button
        type="button"
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onSetOpenResourceMenuId(isMenuOpen ? null : resource.id);
        }}
        className="absolute -right-1 -top-1 rounded-full border border-gray-50 bg-white text-black invisible transition group-hover/resource:visible"
        title="More"
        aria-label="More Options"
      >
        <OWEllipsisHorizontalIcon className="size-4" />
      </button>
      {isMenuOpen ? (
        <div
          className="absolute right-2 top-8 z-20 min-w-[136px] overflow-hidden rounded-lg border border-[#e5e4de] bg-white p-1 shadow-[0_12px_30px_rgba(0,0,0,0.12)]"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              onSetOpenResourceMenuId(null);
              onResourceOpen(resource);
            }}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs text-[#3f4348] hover:bg-[#f5f5f2]"
          >
            Open
          </button>
          <button
            type="button"
            onClick={() => {
              onSetOpenResourceMenuId(null);
              onResourceDuplicate(resource);
            }}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs text-[#3f4348] hover:bg-[#f5f5f2]"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => {
              onSetOpenResourceMenuId(null);
              onResourceDelete(resource);
            }}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs text-[#b33d3d] hover:bg-[#fdf1f1]"
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

const getWorkbenchEmoji = (title: string) => {
  const normalized = title.toLowerCase();
  if (/sql|database|db|query|table|relation|关系|数据|表/.test(normalized)) return '🧮';
  if (/code|program|算法|开发|工程|debug/.test(normalized)) return '💻';
  if (/math|calculus|algebra|数学|代数/.test(normalized)) return '📐';
  if (/read|paper|note|文献|阅读|笔记/.test(normalized)) return '📘';
  if (/plan|roadmap|目标|计划/.test(normalized)) return '🎯';
  if (/write|essay|draft|写作|论文/.test(normalized)) return '✍️';
  return '✨';
};

export default function WorkbenchSidebar({
  editors,
  resources,
  plans = [],
  activeEditorId,
  currentWorkbenchTitle,
  isExpanded,
  onActivateEditor,
  onResourceOpen,
  onNewChat,
  onNewNote,
  onNewPlan,
  onOpenAIStudio,
  onUploadResources,
  onSearch,
  onResourceDuplicate,
  onResourceDelete,
  onResourceReorder,
  onToggleSidebar,
  onPlanStepStatusChange,
  onPlanAction,
  onPlanStepUpdate,
  onPlanFeedback
}: WorkbenchSidebarProps) {
  const [activeSection, setActiveSection] = useState<WorkbenchSidebarSectionKey>('source');
  const [visualState, setVisualState] = useState<SidebarVisualState>(isExpanded ? 'expanded' : 'collapsed');
  const [openResourceMenuId, setOpenResourceMenuId] = useState<string | null>(null);
  const [openPlanStepMenuId, setOpenPlanStepMenuId] = useState<string | null>(null);
  const [openPlanActionMenu, setOpenPlanActionMenu] = useState(false);
  const [updatingPlanStepId, setUpdatingPlanStepId] = useState<string | null>(null);
  const [updatingPlanId, setUpdatingPlanId] = useState<string | null>(null);
  const [planActionError, setPlanActionError] = useState<string | null>(null);
  const [expandedPlanStepId, setExpandedPlanStepId] = useState<string | null>(null);
  const [showArchivedSteps, setShowArchivedSteps] = useState(false);

  useEffect(() => {
    if (isExpanded) {
      setVisualState((current) => (current === 'expanded' ? current : 'opening'));
      const timer = window.setTimeout(() => setVisualState('expanded'), SIDEBAR_SLIDE_MS);
      return () => window.clearTimeout(timer);
    }

    setVisualState((current) => {
      if (current === 'collapsed') return current;
      return 'closing';
    });
    const timer = window.setTimeout(() => setVisualState('collapsed'), SIDEBAR_SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [isExpanded]);

  useEffect(() => {
    if (visualState !== 'closing') return;
    setOpenResourceMenuId(null);
    setOpenPlanActionMenu(false);
    setOpenPlanStepMenuId(null);
  }, [visualState]);

  useEffect(() => {
    if (!openResourceMenuId) return;
    const closeMenu = () => setOpenResourceMenuId(null);
    window.addEventListener('pointerdown', closeMenu);
    return () => window.removeEventListener('pointerdown', closeMenu);
  }, [openResourceMenuId]);

  useEffect(() => {
    if (!openPlanStepMenuId) return;
    const closeMenu = () => setOpenPlanStepMenuId(null);
    window.addEventListener('pointerdown', closeMenu);
    return () => window.removeEventListener('pointerdown', closeMenu);
  }, [openPlanStepMenuId]);

  useEffect(() => {
    if (!openPlanActionMenu) return;
    const closeMenu = () => setOpenPlanActionMenu(false);
    window.addEventListener('pointerdown', closeMenu);
    return () => window.removeEventListener('pointerdown', closeMenu);
  }, [openPlanActionMenu]);

  const resourceActionClass =
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 hover:text-gray-900';

  const sectionTabs: Array<{
    key: WorkbenchSidebarSectionKey;
    title: string;
  }> = [
    { key: 'source', title: 'Sources' },
    { key: 'workspace', title: 'Files' },
    { key: 'generated', title: 'Generates' },
    { key: 'plans', title: 'Plans' }
  ];

  const resourceSections: Array<{
    key: 'source' | 'workspace' | 'generated';
    title: string;
    empty: string;
  }> = [
    {
      key: 'source',
      title: 'Sources',
      empty: 'Add PDFs, links, or pasted text as learning sources.'
    },
    {
      key: 'workspace',
      title: 'Files',
      empty: 'Create a note or upload a working file.'
    },
    {
      key: 'generated',
      title: 'Generates',
      empty: 'AI outputs will appear here.'
    }
  ];

  const activeResourceSection = resourceSections.find((section) => section.key === activeSection);
  const primaryPlan = getPrimaryPlan(plans);
  const primaryPlanProgress = getPlanProgress(primaryPlan);
  const activePlanSteps = primaryPlanProgress.steps.filter((step) => !isArchivedPlanStep(step.status));
  const archivedPlanSteps = primaryPlanProgress.steps.filter((step) => isArchivedPlanStep(step.status));
  const secondaryPlans = plans.filter((plan) => plan.id !== primaryPlan?.id);
  const primaryPlanFeedbackCount = Array.isArray(primaryPlan?.knowledgeGraphSnapshot?.planFeedback)
    ? primaryPlan.knowledgeGraphSnapshot.planFeedback.length
    : 0;
  const [showPlanHistory, setShowPlanHistory] = useState(false);
  const runPlanStepStatusChange = async (
    planId: string,
    stepId: string,
    status: 'pending' | 'active' | 'done' | 'skipped' | 'blocked'
  ) => {
    if (!onPlanStepStatusChange) return;
    setUpdatingPlanStepId(`${planId}:${stepId}`);
    setPlanActionError(null);
    setOpenPlanStepMenuId(null);
    try {
      await onPlanStepStatusChange(planId, stepId, status);
    } catch (error: any) {
      setPlanActionError(error?.message || 'Failed to update step status.');
    } finally {
      setUpdatingPlanStepId(null);
    }
  };
  const runPlanAction = async (
    planId: string,
    action: 'start' | 'pause' | 'resume' | 'complete' | 'archive' | 'restore' | 'supersede' | 'set_primary' | 'reopen' | 'duplicate' | 'replan',
    options?: { targetPlanId?: string; title?: string; note?: string }
  ) => {
    if (!onPlanAction) return;
    setUpdatingPlanId(planId);
    setPlanActionError(null);
    setOpenPlanActionMenu(false);
    try {
      await onPlanAction(planId, action, options);
    } catch (error: any) {
      setPlanActionError(error?.message || 'Failed to update plan.');
    } finally {
      setUpdatingPlanId(null);
    }
  };
  const runPlanStepUpdate = async (planId: string, stepId: string, currentTitle: string, currentNote?: string) => {
    if (!onPlanStepUpdate) return;
    const title = window.prompt('Step title', currentTitle);
    if (title == null) return;
    const note = window.prompt('Step note', currentNote || '');
    if (note == null) return;
    setPlanActionError(null);
    try {
      await onPlanStepUpdate(planId, stepId, { title, note });
    } catch (error: any) {
      setPlanActionError(error?.message || 'Failed to update step.');
    }
  };
  const runPlanFeedback = async (
    planId: string,
    stepId: string | null,
    category: 'too_hard' | 'too_easy' | 'blocked' | 'resource_mismatch' | 'replan' | 'other'
  ) => {
    if (!onPlanFeedback) return;
    const note = window.prompt('Feedback note', '');
    if (note == null) return;
    setPlanActionError(null);
    try {
      await onPlanFeedback(planId, { stepId, category, note });
    } catch (error: any) {
      setPlanActionError(error?.message || 'Failed to record feedback.');
    }
  };
  const shouldShowResourceSearch = activeSection === 'source';
  const activeResourceId = activeEditorId
    ? editors.find((editor) => editor.id === activeEditorId)?.resourceId
    : null;

  const [orderedResources, setOrderedResources] = useState<ResourceReference[]>([]);
  useEffect(() => {
    setOrderedResources(resources);
  }, [resources]);
  const orderedBySection = resourceSections.reduce<Record<ResourceSectionKey, ResourceReference[]>>(
    (groups, section) => {
      groups[section.key] = orderedResources.filter((resource) => getResourceSection(resource) === section.key);
      return groups;
    },
    { source: [], workspace: [], generated: [] }
  );

  const renderResourceList = (
    section: (typeof resourceSections)[number],
    options: { compact?: boolean } = {}
  ) => {
    const sectionResources = orderedBySection[section.key];
    const visibleResources = options.compact ? sectionResources.slice(0, 4) : sectionResources;

    if (sectionResources.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-[#e2e1dc] bg-white/55 px-3 py-4 text-sm text-[#85898f]">
          {section.empty}
        </div>
      );
    }

    return (
      <div className="my-2 grid grid-cols-1 gap-2">
        {visibleResources.map((resource) => {
          const boundEditor = editors.find((editor) => editor.resourceId === resource.id);
          const isActive = activeResourceId === resource.id;

          return (
            <ResourceRow
              key={resource.id}
              resource={resource}
              sectionKey={section.key}
              isActive={isActive}
              isMenuOpen={openResourceMenuId === resource.id}
              hasOpenEditor={Boolean(boundEditor)}
              orderedResources={orderedResources}
              onActivateEditor={() => {
                if (boundEditor) onActivateEditor(boundEditor.id);
              }}
              onResourceOpen={onResourceOpen}
              onSetOpenResourceMenuId={setOpenResourceMenuId}
              onResourceDuplicate={onResourceDuplicate}
              onResourceDelete={onResourceDelete}
              onReorder={(next) => {
                setOrderedResources(next);
                onResourceReorder(next.map((entry) => entry.id));
              }}
            />
          );
        })}
        {options.compact && sectionResources.length > visibleResources.length && (
          <button
            type="button"
            onClick={() => setActiveSection(section.key)}
            className="px-3 py-1 text-left text-xs font-medium text-[#8a8e94] hover:text-[#303338]"
          >
            View {sectionResources.length - visibleResources.length} more
          </button>
        )}
      </div>
    );
  };

  const workbenchEmoji = getWorkbenchEmoji(currentWorkbenchTitle);
  const isExpandedSidebarVisible = visualState !== 'collapsed';
  const shouldShowCollapsedRail = visualState === 'collapsed';
  const shouldReserveExpandedWidth = visualState !== 'collapsed';
  const sidebarSlideClass = visualState === 'closing' ? 'openwebui-sidebar-slide-out' : 'openwebui-sidebar-slide-in';
  const shouldRenderExpandedContent = isExpandedSidebarVisible;

  const collapsedRail = shouldShowCollapsedRail ? (
      <div
        className="z-10 flex h-full shrink-0 flex-col justify-between border-r-[0.5px] border-gray-50 bg-white px-2 pb-2 pt-[7px] text-black transition-all hover:bg-gray-50/30"
        id="sidebar"
      >
        <div className="flex flex-col">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="flex rounded-xl transition hover:bg-gray-100"
            title="Open Sidebar"
            aria-label="Open Sidebar"
          >
            <div className="flex size-9 items-center justify-center self-center">
              <span className="flex size-6 translate-y-px items-center justify-center rounded-full bg-white text-[13px] leading-none text-gray-900 shadow-sm ring-1 ring-gray-200">
                {workbenchEmoji}
              </span>
            </div>
          </button>
          <button
            type="button"
            onClick={onNewChat}
            className="flex rounded-xl transition hover:bg-gray-100"
            title="New chat"
            aria-label="New chat"
          >
            <div className="flex size-9 items-center justify-center self-center">
              <OWPencilSquareIcon className="size-[1.125rem]" strokeWidth={2} />
            </div>
          </button>
          <button
            type="button"
            onClick={onSearch}
            className="flex rounded-xl transition hover:bg-gray-100"
            title="Search"
            aria-label="Search"
          >
            <div className="flex size-9 items-center justify-center self-center">
              <OWSearchIcon className="size-[1.125rem]" strokeWidth={2} />
            </div>
          </button>
          <button
            type="button"
            onClick={onNewNote}
            className="flex rounded-xl transition hover:bg-gray-100"
            title="New note"
            aria-label="New note"
          >
            <div className="flex size-9 items-center justify-center self-center">
              <OWDocumentPageIcon className="size-[1.125rem]" strokeWidth={2} />
            </div>
          </button>
          <button
            type="button"
            onClick={onOpenAIStudio}
            className="flex rounded-xl transition hover:bg-gray-100"
            title="AI Studio"
            aria-label="AI Studio"
          >
            <div className="flex size-9 items-center justify-center self-center">
              <OWWorkspaceIcon className="size-[1.125rem]" strokeWidth={2} />
            </div>
          </button>
          <button
            type="button"
            onClick={onNewPlan}
            className="flex rounded-xl transition hover:bg-gray-100"
            title="New plan"
            aria-label="New plan"
          >
            <div className="flex size-9 items-center justify-center self-center">
              <Target className="size-[1.125rem]" strokeWidth={2} />
            </div>
          </button>
        </div>
      </div>
  ) : null;

  return (
    <div
      className="relative z-50 h-full shrink-0 overflow-hidden"
      style={{ width: shouldReserveExpandedWidth ? 292 : 56 }}
    >
    {collapsedRail}
    {isExpandedSidebarVisible ? (
    <aside
      className={`openwebui-shell openwebui-sidebar ${sidebarSlideClass} absolute inset-y-0 left-0 my-auto flex h-full max-h-[100dvh] w-[292px] select-none flex-col justify-between overflow-x-hidden border-r-[0.5px] border-gray-50 bg-gray-50/70 text-sm text-gray-900`}
      id="sidebar"
      data-state={isExpanded}
    >
      {shouldRenderExpandedContent ? (
        <button
          type="button"
          onClick={onToggleSidebar}
          className="absolute right-[0.5625rem] top-2 z-30 flex size-[2.125rem] shrink-0 cursor-[w-resize] items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100/50 hover:text-gray-900"
          title="Close Sidebar"
          aria-label="Close Sidebar"
        >
          <div className="self-center p-1.5">
            <OpenWebUISidebarIcon className="size-5" />
          </div>
        </button>
      ) : null}
      <div className="relative z-10 min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-hidden pb-2 pt-[7px]">
          <div
            className={`sidebar sticky top-0 z-10 flex min-h-12 w-full shrink-0 justify-between space-x-1 px-[0.5625rem] pb-1.5 pt-2 text-gray-600 ${
              shouldRenderExpandedContent ? '-mb-3 pr-12' : 'mb-0'
            }`}
          >
            <button
              type="button"
              onClick={onToggleSidebar}
              className="no-drag-region flex h-[2.125rem] w-[2.125rem] shrink-0 items-center justify-center rounded-xl transition hover:bg-gray-100/50"
              title={shouldRenderExpandedContent ? currentWorkbenchTitle : 'Open Sidebar'}
              aria-label={shouldRenderExpandedContent ? currentWorkbenchTitle : 'Open Sidebar'}
            >
              <span className="flex size-6 translate-y-px items-center justify-center rounded-full bg-white text-[13px] leading-none text-gray-900 shadow-sm ring-1 ring-gray-200">
                {workbenchEmoji}
              </span>
            </button>

            {shouldRenderExpandedContent ? (
              <div
                className="flex min-w-0 flex-1 px-0.5 text-left"
                title={currentWorkbenchTitle}
              >
                <span id="sidebar-webui-name" className="self-center truncate font-primary font-medium text-gray-850">
                  {currentWorkbenchTitle}
                </span>
              </div>
            ) : null}

            <div className="sidebar-bg-gradient-to-b pointer-events-none invisible absolute inset-0 -z-10 -mb-6 bg-gradient-to-b from-gray-50/70 from-50% to-transparent" />
          </div>

          {shouldRenderExpandedContent ? (
            <>
              <div className="pb-1.5">
                <div className="px-[0.4375rem] flex justify-center text-gray-800">
                  <button
                    type="button"
                    onClick={onNewChat}
                    className="group flex grow items-center space-x-3 rounded-2xl px-2.5 py-2 text-left outline-none transition hover:bg-gray-100"
                    aria-label="New chat"
                  >
                    <div className="self-center">
                      <OWPencilSquareIcon className="size-[1.125rem]" strokeWidth={2} />
                    </div>
                    <div className="flex flex-1 self-center translate-y-[0.5px]">
                      <div className="self-center font-primary text-sm">New Chat</div>
                    </div>
                  </button>
                </div>

                <div className="px-[0.4375rem] flex justify-center text-gray-800">
                  <button
                    type="button"
                    onClick={onSearch}
                    className="group flex grow items-center space-x-3 rounded-2xl px-2.5 py-2 text-left outline-none transition hover:bg-gray-100"
                    aria-label="Search"
                  >
                    <div className="self-center">
                      <OWSearchIcon className="size-[1.125rem]" strokeWidth={2} />
                    </div>
                    <div className="flex flex-1 self-center translate-y-[0.5px]">
                      <div className="self-center font-primary text-sm">Search</div>
                    </div>
                  </button>
                </div>

                <div className="px-[0.4375rem] flex justify-center text-gray-800">
                  <button
                    type="button"
                    onClick={onNewNote}
                    className="flex grow items-center space-x-3 rounded-2xl px-2.5 py-2 text-left transition hover:bg-gray-100"
                    aria-label="New note"
                  >
                    <div className="self-center">
                      <OWDocumentPageIcon className="size-[1.125rem]" strokeWidth={2} />
                    </div>
                    <div className="flex flex-1 self-center translate-y-[0.5px]">
                      <div className="self-center font-primary text-sm">Notes</div>
                    </div>
                  </button>
                </div>

                <div className="px-[0.4375rem] flex justify-center text-gray-800">
                  <button
                    type="button"
                    onClick={onOpenAIStudio}
                    className="flex grow items-center space-x-3 rounded-2xl px-2.5 py-2 text-left transition hover:bg-gray-100"
                    aria-label="AI Studio"
                  >
                    <div className="self-center">
                      <OWWorkspaceIcon className="size-[1.125rem]" strokeWidth={2} />
                    </div>
                    <div className="flex flex-1 self-center translate-y-[0.5px]">
                      <div className="self-center font-primary text-sm">AI Studio</div>
                    </div>
                  </button>
                </div>

                <div className="px-[0.4375rem] flex justify-center text-gray-800">
                  <button
                    type="button"
                    onClick={onNewPlan}
                    className="flex grow items-center space-x-3 rounded-2xl px-2.5 py-2 text-left transition hover:bg-gray-100"
                    aria-label="New plan"
                  >
                    <div className="self-center">
                      <Target className="size-[1.125rem]" strokeWidth={2} />
                    </div>
                    <div className="flex flex-1 self-center translate-y-[0.5px]">
                      <div className="self-center font-primary text-sm">New Plan</div>
                    </div>
                  </button>
                </div>
              </div>

              <section className="mb-3 flex shrink-0 items-center gap-1 px-[0.4375rem] pt-1">
                <div className="flex gap-1 scrollbar-none overflow-x-auto w-fit text-center text-sm font-medium rounded-full bg-transparent py-1 touch-auto pointer-events-auto">
                  {sectionTabs.map((section) => {
                    const isActive = activeSection === section.key;
                    return (
                      <button
                        key={section.key}
                        type="button"
                        onClick={() => setActiveSection(section.key)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`min-w-fit p-1.5 ${isActive ? '' : 'text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'} transition select-none`}
                        title={section.title}
                      >
                        {section.title}
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          ) : null}

          {shouldRenderExpandedContent ? (
          <section className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pb-3">
            {shouldShowResourceSearch && (
            <div className="px-[0.4375rem]">
              <button
                type="button"
                onClick={onUploadResources}
                className="flex h-10 w-full items-center gap-2 rounded-xl border border-[#e7e6e1] bg-white/80 px-3 text-left text-sm text-[#666b72] transition-all duration-200 ease-out hover:-translate-y-px hover:border-[#d9d8d2] hover:bg-white hover:shadow-[0_8px_22px_rgba(0,0,0,0.055)]"
              >
                <OWSearchIcon className="h-4 w-4 text-[#8a8e94]" strokeWidth={2} />
                <span className="min-w-0 flex-1 truncate">Search or upload resources</span>
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#7f8388] hover:bg-[#f3f2ee]">
                  <Upload className="h-4 w-4" />
                </span>
              </button>
            </div>
            )}

            {activeResourceSection && (
              <div className="flex min-h-0 flex-col overflow-visible px-[0.4375rem]">
                <div className="mb-2 flex items-center justify-between px-2.5">
                  <h2 className="text-sm font-medium text-[#464a50]">{activeResourceSection.title}</h2>
                  {activeResourceSection.key === 'source' ? (
                    <button
                      onClick={onUploadResources}
                      className={resourceActionClass}
                      title="Add source"
                    >
                      <Upload className="h-4 w-4" />
                    </button>
                  ) : activeResourceSection.key === 'workspace' ? (
                    <button
                      onClick={onUploadResources}
                      className={resourceActionClass}
                      title="Upload file"
                    >
                      <Upload className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                <div className="min-h-0">
                  {renderResourceList(activeResourceSection)}
                </div>
              </div>
            )}

            {activeSection === 'plans' && (
              <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
                {primaryPlan ? (
                  <div className="space-y-2">
                    <div className="px-2 pb-3 pt-1">
                      <div className="flex items-start gap-2.5">
                        <Target className="mt-0.5 h-4 w-4 shrink-0 text-[#74787e]" />
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-[13px] font-semibold leading-5 text-[#2f3338]">
                            {getPlanTitle(primaryPlan)}
                          </p>
                          <p className="mt-1 truncate text-[11px] text-[#9a9ea4]">
                            Primary active plan · {activePlanSteps.length} open · {primaryPlanProgress.completed}/{primaryPlanProgress.total} archived
                            {formatPlanDate(primaryPlan.updatedAt) ? ` · ${formatPlanDate(primaryPlan.updatedAt)}` : ''}
                          </p>
                        </div>
                        <div className="relative shrink-0" onPointerDown={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenPlanActionMenu((value) => !value);
                            }}
                            disabled={updatingPlanId === primaryPlan.id}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-[#e2e1dc] bg-white px-2 text-[10px] font-medium text-[#55585d] transition hover:bg-[#f1f1ef] disabled:opacity-60"
                          >
                            {updatingPlanId === primaryPlan.id ? 'Updating' : 'Plan'}
                            <ChevronDown className="h-3 w-3" />
                          </button>
                          {openPlanActionMenu ? (
                            <div className="absolute right-0 top-8 z-40 w-44 overflow-hidden rounded-xl border border-[#e5e4de] bg-white p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.14)]">
                              {planActionOptions.map((option) => (
                                <button
                                  key={option.action}
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void runPlanAction(primaryPlan.id, option.action);
                                  }}
                                  className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs text-[#3f4348] hover:bg-[#f5f5f2]"
                                >
                                  {option.label}
                                </button>
                              ))}
                              <div className="my-1 border-t border-[#eeeeeb]" />
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenPlanActionMenu(false);
                                  void runPlanFeedback(primaryPlan.id, null, 'other');
                                }}
                                className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs text-[#3f4348] hover:bg-[#f5f5f2]"
                              >
                                Plan feedback
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenPlanActionMenu(false);
                                  void runPlanFeedback(primaryPlan.id, null, 'replan');
                                }}
                                className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs text-[#3f4348] hover:bg-[#f5f5f2]"
                              >
                                Request replan
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-3">
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#ecebe6]">
                          <div className="h-full rounded-full bg-[#202124]" style={{ width: `${primaryPlanProgress.percent}%` }} />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-[#8a8e94]">
                          <span>{primaryPlanProgress.percent}% complete</span>
                          <span>
                            {primaryPlan.status || 'active'}
                            {primaryPlanFeedbackCount ? ` · ${primaryPlanFeedbackCount} feedback` : ''}
                          </span>
                        </div>
                      </div>
                      {primaryPlanProgress.nextStep ? (
                        <button
                          type="button"
                          onClick={() => setExpandedPlanStepId(primaryPlanProgress.nextStep ? `${primaryPlan.id}:${primaryPlanProgress.nextStep.id}` : null)}
                          className="mt-3 flex w-full items-center gap-2 rounded-lg bg-white/55 px-3 py-2 text-left transition hover:bg-white"
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#96999d]">Next step</p>
                          <p className="min-w-0 flex-1 truncate text-[12px] font-medium leading-5 text-[#34373c]">{primaryPlanProgress.nextStep.title}</p>
                        </button>
                      ) : null}
                    </div>

                    <div className="space-y-0.5">
                      {planActionError ? (
                        <div className="rounded-lg border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[11px] leading-5 text-[#b54708]">
                          {planActionError}
                        </div>
                      ) : null}
                      {activePlanSteps.map((step, index) => {
                        const stepKey = `${primaryPlan.id}:${step.id}`;
                        const expanded = expandedPlanStepId === stepKey;
                        return (
                        <div key={`${primaryPlan.id}-step-${step.id}`} className="group/plan-step relative">
                          {index < activePlanSteps.length - 1 ? (
                            <span className="absolute left-[17px] top-8 h-[calc(100%-18px)] w-px bg-[#e5e4de]" />
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setExpandedPlanStepId(expanded ? null : stepKey)}
                            className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-all duration-200 hover:bg-white/75 ${step.status === 'active' ? 'bg-white/70' : ''}`}
                          >
                            <span className={`relative z-[1] mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[10px] font-semibold transition-colors ${stepStatusClass(step.status)}`}>
                              {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-2">
                                <p className="min-w-0 flex-1 text-[12px] font-medium leading-5 text-[#2f3338]">
                                  {step.title}
                                </p>
                                <ChevronDown className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-[#a0a4aa] transition-transform ${expanded ? '' : '-rotate-90'}`} />
                              </div>
                              <p className="mt-0.5 text-[11px] text-[#9a9ea4]">{planStatusLabel(step.status)}</p>
                            </div>
                          </button>
                          {expanded ? (
                            <div className="ml-8 min-w-0 pb-3 pr-2">
                              {step.description ? (
                                <p className="text-[11px] leading-5 text-[#757b82]">{step.description}</p>
                              ) : null}
                              {step.bullets.length ? (
                                <ul className="mt-2 space-y-1">
                                  {step.bullets.map((item, bulletIndex) => (
                                    <li key={`${primaryPlan.id}-step-${step.id}-bullet-${bulletIndex}`} className="text-[11px] leading-5 text-[#8a8e94]">
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              {(step as any).note ? (
                                <p className="mt-2 rounded-md bg-white/70 px-2 py-1.5 text-[11px] leading-5 text-[#6e7278]">
                                  {(step as any).note}
                                </p>
                              ) : null}
                              <div className="relative mt-2 inline-flex" onPointerDown={(event) => event.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setOpenPlanStepMenuId(openPlanStepMenuId === `${primaryPlan.id}:${step.id}` ? null : `${primaryPlan.id}:${step.id}`);
                                    }}
                                    disabled={updatingPlanStepId === `${primaryPlan.id}:${step.id}`}
                                    className="inline-flex h-7 items-center gap-1 rounded-md border border-[#e2e1dc] bg-white px-2 text-[10px] font-medium text-[#55585d] transition hover:bg-[#f1f1ef] disabled:opacity-60"
                                    title="Step actions"
                                  >
                                    {updatingPlanStepId === `${primaryPlan.id}:${step.id}` ? 'Updating' : 'Actions'}
                                    <ChevronDown className="h-3 w-3" />
                                  </button>
                                  {openPlanStepMenuId === `${primaryPlan.id}:${step.id}` ? (
                                    <div className="absolute right-0 top-8 z-40 w-44 overflow-hidden rounded-xl border border-[#e5e4de] bg-white p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.14)]">
                                      {planStepStatusOptions.map((option) => (
                                        <button
                                          key={option.status}
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void runPlanStepStatusChange(primaryPlan.id, step.id, option.status);
                                          }}
                                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[#3f4348] hover:bg-[#f5f5f2]"
                                        >
                                          {step.status === option.status ? <CheckCircle2 className="h-3.5 w-3.5 text-[#2f6f46]" /> : <span className="h-3.5 w-3.5" />}
                                          {option.label}
                                        </button>
                                      ))}
                                      <div className="my-1 border-t border-[#eeeeeb]" />
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setOpenPlanStepMenuId(null);
                                          void runPlanStepUpdate(primaryPlan.id, step.id, step.title, (step as any).note);
                                        }}
                                        className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs text-[#3f4348] hover:bg-[#f5f5f2]"
                                      >
                                        Edit title/note
                                      </button>
                                      {feedbackOptions.map((option) => (
                                        <button
                                          key={option.category}
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setOpenPlanStepMenuId(null);
                                            void runPlanFeedback(primaryPlan.id, step.id, option.category);
                                          }}
                                          className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs text-[#3f4348] hover:bg-[#f5f5f2]"
                                        >
                                          {option.label}
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        );
                      })}
                      {!activePlanSteps.length ? (
                        <p className="px-3 py-4 text-sm text-[#6e7278]">No open steps. Archived steps are below.</p>
                      ) : null}
                    </div>

                    {archivedPlanSteps.length ? (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => setShowArchivedSteps((value) => !value)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12px] font-medium text-[#6e7278] transition hover:bg-white/70"
                        >
                          <ChevronDown className={`h-3.5 w-3.5 text-[#9ba0a6] transition-transform ${showArchivedSteps ? '' : '-rotate-90'}`} />
                          Archived steps
                          <span className="ml-auto text-[11px] text-[#9a9ea4]">{archivedPlanSteps.length}</span>
                        </button>
                        {showArchivedSteps ? (
                          <div className="space-y-0.5 pl-3">
                            {archivedPlanSteps.map((step, index) => {
                              const stepKey = `${primaryPlan.id}:${step.id}`;
                              const expanded = expandedPlanStepId === stepKey;
                              return (
                                <div key={`${primaryPlan.id}-archived-${step.id}`} className="group/archived-step">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedPlanStepId(expanded ? null : stepKey)}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/70"
                                  >
                                    <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1.5 text-[10px] font-semibold ${stepStatusClass(step.status)}`}>
                                      {index + 1}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-[12px] text-[#6e7278]">{step.title}</span>
                                    <span className="text-[10px] text-[#9a9ea4]">{planStatusLabel(step.status)}</span>
                                  </button>
                                  {expanded ? (
                                    <div className="ml-9 pb-2 pr-2">
                                      {step.description ? <p className="text-[11px] leading-5 text-[#8a8e94]">{step.description}</p> : null}
                                      <button
                                        type="button"
                                        onClick={() => void runPlanStepStatusChange(primaryPlan.id, step.id, 'pending')}
                                        className="mt-2 rounded-md border border-[#e2e1dc] bg-white px-2 py-1 text-[10px] font-medium text-[#55585d] transition hover:bg-[#f1f1ef]"
                                      >
                                        Restore to open
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {secondaryPlans.length ? (
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowPlanHistory((value) => !value)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12px] font-medium text-[#6e7278] transition hover:bg-white/70"
                        >
                          <ChevronDown className={`h-3.5 w-3.5 text-[#9ba0a6] transition-transform ${showPlanHistory ? '' : '-rotate-90'}`} />
                          History / candidates
                          <span className="ml-auto text-[11px] text-[#9a9ea4]">{secondaryPlans.length}</span>
                        </button>
                        {showPlanHistory ? (
                          <div className="px-3 py-1">
                            {secondaryPlans.map((plan) => (
                              <div key={plan.id} className="py-2">
                                <p className="line-clamp-2 text-[12px] font-medium text-[#3f4348]">{getPlanTitle(plan)}</p>
                                <p className="mt-1 text-[11px] text-[#9a9ea4]">
                                  {getPlanStageCount(plan)} steps · {plan.status || 'candidate'}
                                  {formatPlanDate(plan.updatedAt) ? ` · ${formatPlanDate(plan.updatedAt)}` : ''}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  <button
                                    type="button"
                                    onClick={() => void runPlanAction(plan.id, 'set_primary')}
                                    className="rounded-md border border-[#e2e1dc] bg-white px-2 py-1 text-[10px] font-medium text-[#55585d] transition hover:bg-[#f1f1ef]"
                                  >
                                    Set primary
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void runPlanAction(primaryPlan.id, 'restore', { targetPlanId: plan.id })}
                                    className="rounded-md border border-[#e2e1dc] bg-white px-2 py-1 text-[10px] font-medium text-[#55585d] transition hover:bg-[#f1f1ef]"
                                  >
                                    Restore
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl bg-white/70 px-4 py-4 text-sm text-[#6e7278]">
                    No plans applied to this workbench yet.
                  </div>
                )}
              </div>
            )}

          </section>
          ) : null}
        </div>
      </div>
    </aside>
    ) : null}
    </div>
  );
}
