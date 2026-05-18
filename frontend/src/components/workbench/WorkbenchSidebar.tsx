import {
  ChevronDown,
  Code,
  Ellipsis,
  File,
  CheckCircle2,
  FileText,
  FileSpreadsheet,
  FileCode2,
  FileImage,
  FileJson2,
  FileVideo,
  FileArchive,
  FolderKanban,
  FolderOpen,
  Home,
  Image,
  LibraryBig,
  MessageCirclePlus,
  PencilLine,
  Search,
  Target,
  Upload,
  WandSparkles
} from 'lucide-react';
import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { EditorState, ResourceReference, Workbench } from '../../types';

interface WorkbenchSidebarProps {
  editors: EditorState[];
  resources: ResourceReference[];
  workbenches: Workbench[];
  plans?: WorkbenchSidebarPlan[];
  currentWorkbenchId: string;
  activeEditorId: string | null;
  currentWorkbenchTitle: string;
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
  onResourceDropToPane: (resource: ResourceReference) => void;
  onResourceReorder: (orderedIds: string[]) => void;
  onOpenWorkbench: (workbenchId: string) => void;
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
  width: number;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  variant?: 'pinned' | 'preview';
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
type SidebarSectionState = Record<ResourceSectionKey, boolean>;
type DragResourceItem = {
  type: 'WORKBENCH_RESOURCE';
  resourceId: string;
  resource: ResourceReference;
};

const WORKBENCH_RESOURCE_ITEM_TYPE = 'WORKBENCH_RESOURCE';

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

const getResourceIcon = (resource: ResourceReference) => {
  const extension = (resource.extension || resource.name.split('.').pop() || '').toLowerCase();
  const section = getResourceSection(resource);

  if (section === 'generated') return <FolderKanban className="h-4 w-4" />;
  if (section === 'source' && resource.origin === 'web') return <LibraryBig className="h-4 w-4" />;
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'cpp', 'c', 'html', 'css', 'yaml', 'yml'].includes(extension)) return <FileCode2 className="h-4 w-4" />;
  if (extension === 'json') return <FileJson2 className="h-4 w-4" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(extension)) return <FileImage className="h-4 w-4" />;
  if (['pdf'].includes(extension)) return <FileText className="h-4 w-4" />;
  if (['csv', 'xlsx', 'xls', 'tsv'].includes(extension)) return <FileSpreadsheet className="h-4 w-4" />;
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(extension)) return <FileVideo className="h-4 w-4" />;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return <FileArchive className="h-4 w-4" />;
  if (['md', 'markdown', 'txt'].includes(extension) || resource.fileCategory?.includes('note')) {
    return <FileText className="h-4 w-4" />;
  }
  if (section === 'source') return <LibraryBig className="h-4 w-4" />;
  if (['xml', 'sql'].includes(extension)) return <Code className="h-4 w-4" />;
  return <File className="h-4 w-4 text-[#8b8f95]" />;
};

const getResourceMeta = (resource: ResourceReference) => {
  const extension = (resource.extension || resource.name.split('.').pop() || '').toLowerCase();
  if (resource.origin === 'web') return 'Web source';
  if (resource.origin === 'upload') return extension ? `Uploaded ${extension.toUpperCase()}` : 'Uploaded file';
  if (resource.resourceType === 'generated') return 'AI generated';
  if (resource.resourceType === 'note' || resource.fileCategory?.includes('note')) return 'Note';
  return extension ? extension.toUpperCase() : resource.type;
};

const getSourceHost = (resource: ResourceReference) => {
  const sourceUrl = String(resource.metadata?.sourceUrl || '');
  if (!sourceUrl) return '';
  try {
    const parsed = new URL(sourceUrl);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const getFaviconUrl = (resource: ResourceReference) => {
  const sourceUrl = String(resource.metadata?.sourceUrl || '');
  if (!sourceUrl) return '';
  try {
    const parsed = new URL(sourceUrl);
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`;
  } catch {
    return '';
  }
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
  index,
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
  index: number;
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
  const faviconUrl = getFaviconUrl(resource);
  const sourceHost = getSourceHost(resource);
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
      className={`group/resource relative ${isDragging ? 'opacity-40' : 'opacity-100'}`}
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
        className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 ${
          isActive ? 'bg-white text-[#202124]' : 'text-[#3d4147] hover:bg-white/70'
        }`}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[#8a8e94]">
          {sectionKey === 'source' && faviconUrl ? (
            <img src={faviconUrl} alt="" className="h-4 w-4 rounded-sm" />
          ) : (
            getResourceIcon(resource)
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{resource.name}</span>
          <span className="block truncate text-[11px] text-[#9a9ea4]">
            {sourceHost || getResourceMeta(resource)}
          </span>
        </span>
        {hasOpenEditor ? (
          <span className="shrink-0 text-[10px] font-medium text-[#9ba0a6]">Open</span>
        ) : null}
        <span className="shrink-0 text-[10px] text-[#b0b4bb]">{index + 1}</span>
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
        className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-[#9a9ea4] opacity-0 transition-all duration-150 hover:bg-white hover:text-[#303338] group-hover/resource:opacity-100"
        title="More"
      >
        <Ellipsis className="h-4 w-4" />
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

export default function WorkbenchSidebar({
  editors,
  resources,
  workbenches,
  plans = [],
  currentWorkbenchId,
  activeEditorId,
  currentWorkbenchTitle,
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
  onResourceDropToPane,
  onResourceReorder,
  onOpenWorkbench,
  onPlanStepStatusChange,
  onPlanAction,
  onPlanStepUpdate,
  onPlanFeedback,
  width,
  onResizeStart,
  variant = 'pinned'
}: WorkbenchSidebarProps) {
  const [isWorkbenchMenuOpen, setIsWorkbenchMenuOpen] = useState(false);
  const [isAiNewMenuOpen, setIsAiNewMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<'home' | 'source' | 'workspace' | 'generated' | 'plans'>('home');
  const [openResourceMenuId, setOpenResourceMenuId] = useState<string | null>(null);
  const [openPlanStepMenuId, setOpenPlanStepMenuId] = useState<string | null>(null);
  const [openPlanActionMenu, setOpenPlanActionMenu] = useState(false);
  const [updatingPlanStepId, setUpdatingPlanStepId] = useState<string | null>(null);
  const [updatingPlanId, setUpdatingPlanId] = useState<string | null>(null);
  const [planActionError, setPlanActionError] = useState<string | null>(null);
  const [expandedPlanStepId, setExpandedPlanStepId] = useState<string | null>(null);
  const [showArchivedSteps, setShowArchivedSteps] = useState(false);
  const aiNewMenuRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!isAiNewMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (aiNewMenuRef.current?.contains(event.target as Node)) return;
      setIsAiNewMenuOpen(false);
    };
    window.addEventListener('pointerdown', closeMenu);
    return () => window.removeEventListener('pointerdown', closeMenu);
  }, [isAiNewMenuOpen]);

  const actionItems = [
    { label: 'New note', icon: FileText, onClick: onNewNote },
    { label: 'New plan', icon: Target, onClick: onNewPlan },
    { label: 'New chat', icon: MessageCirclePlus, onClick: onNewChat }
  ];
  const isPreview = variant === 'preview';
  const resourceActionClass =
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#85898f] transition-all duration-200 ease-out hover:-translate-y-px hover:bg-white hover:text-[#25282d] hover:shadow-[0_5px_14px_rgba(0,0,0,0.07)]';

  const sectionTabs: Array<{
    key: 'home' | 'source' | 'workspace' | 'generated' | 'plans';
    title: string;
    icon: typeof Home;
  }> = [
    { key: 'home', title: 'Home', icon: Home },
    { key: 'source', title: 'Sources', icon: LibraryBig },
    { key: 'workspace', title: 'Files', icon: FolderOpen },
    { key: 'generated', title: 'Generates', icon: FolderKanban },
    { key: 'plans', title: 'Plans', icon: Target }
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
  const shouldShowResourceSearch = activeSection === 'home' || activeSection === 'source';
  const shouldShowChats = activeSection === 'home';
  const resourcesBySection = resourceSections.reduce<Record<ResourceSectionKey, ResourceReference[]>>(
    (groups, section) => {
      groups[section.key] = resources
        .filter((resource) => getResourceSection(resource) === section.key)
        .sort((left, right) => left.name.localeCompare(right.name));
      return groups;
    },
    { source: [], workspace: [], generated: [] }
  );
  const activeResourceId = activeEditorId
    ? editors.find((editor) => editor.id === activeEditorId)?.resourceId
    : null;
  const [sectionState, setSectionState] = useState<SidebarSectionState>({
    source: true,
    workspace: true,
    generated: true
  });
  const sectionStorageKey = `workbench:sidebar:sections:${currentWorkbenchId}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(sectionStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SidebarSectionState>;
      setSectionState((current) => ({
        source: typeof parsed.source === 'boolean' ? parsed.source : current.source,
        workspace: typeof parsed.workspace === 'boolean' ? parsed.workspace : current.workspace,
        generated: typeof parsed.generated === 'boolean' ? parsed.generated : current.generated
      }));
    } catch {
      // ignore invalid local sidebar state
    }
  }, [sectionStorageKey]);

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

  const persistSectionState = (nextState: SidebarSectionState) => {
    setSectionState(nextState);
    try {
      window.localStorage.setItem(sectionStorageKey, JSON.stringify(nextState));
    } catch {
      // ignore write failures
    }
  };

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
      <div className="space-y-0.5">
        {visibleResources.map((resource, index) => {
          const boundEditor = editors.find((editor) => editor.resourceId === resource.id);
          const isActive = activeResourceId === resource.id;

          return (
            <ResourceRow
              key={resource.id}
              resource={resource}
              index={index}
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

  return (
    <aside
      className={`workspace-slide-right relative flex shrink-0 flex-col overflow-hidden border bg-[rgba(250,250,248,0.96)] backdrop-blur-xl transition-[width,box-shadow,background-color,border-color] duration-300 ease-out ${
        isPreview
          ? 'h-full rounded-xl border-[#dddcd7] shadow-[0_18px_44px_rgba(0,0,0,0.12)]'
          : 'h-full rounded-none border-[#e2e1dc] shadow-none'
      }`}
      style={{ width }}
    >
      {isWorkbenchMenuOpen && (
        <button
          type="button"
          className="absolute inset-0 z-20 cursor-default"
          onClick={() => setIsWorkbenchMenuOpen(false)}
          aria-label="Close workbench menu"
        />
      )}

      <div className="relative z-10 min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-hidden px-3 py-3">
          <div className="relative mb-3">
            <button
              type="button"
              onClick={() => setIsWorkbenchMenuOpen((value) => !value)}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all duration-200 ease-out hover:bg-white/75 hover:shadow-[0_7px_24px_rgba(0,0,0,0.045)]"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#f0efea] text-[#686c72]">
                <FileText className="h-4 w-4" />
              </div>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[#2b2f33]">
                  {currentWorkbenchTitle}
                </span>
                <span className="block truncate text-xs text-[#95989d]">
                  Switch workbench
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-[#8f9399] transition-transform ${
                  isWorkbenchMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isWorkbenchMenuOpen && (
              <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-[#e5e4de] bg-white p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.14)]">
                {workbenches.map((item) => {
                  const isCurrent = item.id === currentWorkbenchId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setIsWorkbenchMenuOpen(false);
                        if (!isCurrent) onOpenWorkbench(item.id);
                      }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all duration-200 ease-out ${
                      isCurrent ? 'bg-[#f3f2ee]' : 'hover:bg-[#f7f7f5]'
                    }`}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-[#8e9298]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[#2b2f33]">
                          {item.title}
                        </span>
                        <span className="block truncate text-xs text-[#9a9da2]">
                          {item.panelCount ?? item.state?.editors?.length ?? 0} tabs
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <section className="mb-3 flex shrink-0 items-center gap-1 px-1">
            <div className="flex min-w-0 flex-1 items-center justify-start gap-1">
              {sectionTabs.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.key;
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => setActiveSection(section.key)}
                    className={`flex h-9 items-center justify-center overflow-hidden rounded-xl transition-all duration-300 ease-out ${
                      isActive
                        ? 'w-[104px] bg-white px-3 text-[#202124] shadow-[0_8px_24px_rgba(0,0,0,0.07)]'
                        : 'w-9 px-0 text-[#7a7e84] hover:bg-white/70 hover:text-[#202124]'
                    }`}
                    title={section.title}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span
                      className={`whitespace-nowrap text-sm font-semibold transition-all duration-300 ease-out ${
                        isActive ? 'ml-2 max-w-[72px] opacity-100' : 'ml-0 max-w-0 opacity-0'
                      }`}
                    >
                      {section.title}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={onSearch}
              className="ml-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#7a7e84] transition-all duration-200 ease-out hover:bg-white/70 hover:text-[#202124]"
              title="Search"
            >
              <Search className="h-4 w-4" />
            </button>
          </section>

          {activeSection === 'home' && (
            <nav className="space-y-1">
              {actionItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    onClick={item.onClick}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-[#464a50] transition-all duration-200 ease-out hover:translate-x-0.5 hover:bg-white/75"
                  >
                    <Icon className="h-4 w-4 text-[#74787e]" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          )}

          <section className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pb-3">
            {shouldShowResourceSearch && (
            <div className="px-1">
              <button
                type="button"
                onClick={onUploadResources}
                className="flex h-10 w-full items-center gap-2 rounded-xl border border-[#e7e6e1] bg-white/80 px-3 text-left text-sm text-[#666b72] transition-all duration-200 ease-out hover:-translate-y-px hover:border-[#d9d8d2] hover:bg-white hover:shadow-[0_8px_22px_rgba(0,0,0,0.055)]"
              >
                <Search className="h-4 w-4 text-[#8a8e94]" />
                <span className="min-w-0 flex-1 truncate">Search or upload resources</span>
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#7f8388] hover:bg-[#f3f2ee]">
                  <Upload className="h-4 w-4" />
                </span>
              </button>
            </div>
            )}

            {activeSection === 'home' && (
              <div className="min-h-0 px-1">
                <div className="space-y-0.5">
                  {resourceSections.map((section) => {
                    const count = resourcesBySection[section.key].length;
                    const expanded = sectionState[section.key];
                    return (
                      <div key={section.key} className="min-w-0">
                        <div className="group flex items-center rounded-lg hover:bg-white/60">
                          <button
                            type="button"
                            onClick={() => {
                              const next = { ...sectionState, [section.key]: !expanded };
                              persistSectionState(next);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-[#4a4e54]"
                          >
                            <ChevronDown className={`h-3.5 w-3.5 text-[#9ba0a6] transition-transform ${expanded ? '' : '-rotate-90'}`} />
                            {section.key === 'source' ? (
                              <LibraryBig className="h-4 w-4 text-[#74787e]" />
                            ) : section.key === 'workspace' ? (
                              <FolderOpen className="h-4 w-4 text-[#74787e]" />
                            ) : (
                              <FolderKanban className="h-4 w-4 text-[#74787e]" />
                            )}
                            <span className="min-w-0 flex-1 truncate">{section.title}</span>
                            <span className="text-[11px] font-medium text-[#98a0a8]">{count}</span>
                          </button>
                        </div>
                        {expanded ? <div className="pl-5">{renderResourceList(section, { compact: false })}</div> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeResourceSection && (
              <div className="flex min-h-0 flex-col overflow-visible px-1">
                <div className="mb-2 flex items-center justify-between px-2">
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

          {shouldShowChats && (
            <div ref={aiNewMenuRef} className="relative shrink-0 border-t border-[#ecebe6] px-1 pt-3">
              {isAiNewMenuOpen ? (
                <div className="absolute bottom-[58px] left-1 right-1 z-30 overflow-hidden rounded-2xl border border-[#e5e4de] bg-white p-1.5 shadow-[0_18px_46px_rgba(0,0,0,0.14)]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAiNewMenuOpen(false);
                      onNewChat();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[#3f4247] transition hover:bg-[#f6f6f4]"
                  >
                    <MessageCirclePlus className="h-4 w-4 text-[#6f7379]" />
                    New chat
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAiNewMenuOpen(false);
                      onOpenAIStudio();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[#3f4247] transition hover:bg-[#f6f6f4]"
                  >
                    <WandSparkles className="h-4 w-4 text-[#6f7379]" />
                    AI Studio
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setIsAiNewMenuOpen((value) => !value)}
                className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-[#e0dfda] bg-white text-sm font-semibold text-[#3f4247] shadow-[0_8px_28px_rgba(0,0,0,0.06)] transition-all duration-200 ease-out hover:-translate-y-px hover:bg-[#fbfbfa] hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)]"
                title="New"
              >
                <PencilLine className="h-4 w-4 text-[#6f7379]" />
                New
                <span className="rounded-lg bg-[#f0efed] px-1.5 py-0.5 text-xs font-semibold text-[#8a8e94]">
                  AI
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-transparent"
        onPointerDown={onResizeStart}
        title="Resize sidebar"
      />
    </aside>
  );
}
