import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import api, { workspaceApi } from '../api/client';
import { LearningTerminalMessage, Workspace, WorkspaceOverview, Workbench, WorkbenchItem } from '../types';
import { fileSystemApi } from '../services/fileSystemApi';
import WorkspaceSettingsDialog from '../components/workspace/WorkspaceSettingsDialog';
import { workbenchApi } from '../services/workbenchApi';
import { workbenchTableApi } from '../services/workbenchTableApi';
import { useAuthStore } from '../store/authStore';
import LearningTerminal from '../components/workspace/LearningTerminal';
import MemoryDebugPanel from '../components/workspace/MemoryDebugPanel';
import LearningIntelligenceDashboard, {
  IntelligenceSection,
  learningIntelligenceSectionItems
} from '../components/workspace/LearningIntelligenceDashboard';
import { learningApi } from '../services/learningApi';
import {
  ArrowLeft,
  ArrowUpDown,
  BookOpen,
  CalendarClock,
  ChevronRight,
  Code,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileJson2,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderKanban,
  FolderTree,
  LayoutGrid,
  LibraryBig,
  List,
  MoreHorizontal,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Settings,
  Trash2,
  Upload,
  Workflow,
  BrainCircuit
} from 'lucide-react';
interface WorkspaceChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: LearningTerminalMessage[];
}
type WorkspaceView = 'status' | 'workbenches' | 'assets' | 'intelligence' | 'terminal';
type WorkbenchFilter = 'all' | 'active' | 'recent';
type WorkbenchSort = 'updated_desc' | 'updated_asc' | 'title_asc';
type WorkbenchViewMode = 'list' | 'grid';
type WorkbenchPropertyType =
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'checkbox'
  | 'ai_summary';
interface WorkbenchTableProperty {
  id: string;
  name: string;
  type: WorkbenchPropertyType;
  source?: 'system' | 'custom';
  visible: boolean;
  orderIndex?: number;
  widthPx?: number;
  options?: string[];
}
interface WorkbenchTableConfig {
  properties: WorkbenchTableProperty[];
  values: Record<string, Record<string, string | number | boolean | string[] | null>>;
}
interface CourseHomeSummary {
  latestTopic: string;
  latestActivitySummary: string;
  coursePosition: string[];
  reinforcementReminders: Array<{ label: string; prompt: string }>;
  aiActions: Array<{ label: string; prompt: string }>;
}
type CourseAsset = NonNullable<Workspace['fileObjects']>[number];
type CourseAssetSection = 'source' | 'file' | 'generated';
interface CourseAssetProperty {
  id: string;
  name: string;
  source?: 'system' | 'custom';
  type?: WorkbenchPropertyType;
  visible?: boolean;
  orderIndex?: number;
  options?: string[];
  widthPx?: number;
}
const DEFAULT_COURSE_ASSET_PROPERTIES: CourseAssetProperty[] = [
  { id: 'path', name: '路径', source: 'system', type: 'text', widthPx: 380 },
  { id: 'updatedAt', name: '时间', source: 'system', type: 'date', widthPx: 180 }
];
const DEFAULT_WORKBENCH_TABLE_PROPERTIES: WorkbenchTableProperty[] = [
  { id: 'topic', name: '主题', type: 'text', source: 'system', visible: true, orderIndex: 0, widthPx: 220 },
  { id: 'status', name: '状态', type: 'status', source: 'custom', visible: true, orderIndex: 1, widthPx: 160, options: ['进行中', '待整理', '已完成'] },
  { id: 'updatedAt', name: '最近活动', type: 'date', source: 'system', visible: true, orderIndex: 2, widthPx: 160 },
  { id: 'content', name: '内容', type: 'text', source: 'system', visible: true, orderIndex: 3, widthPx: 180 }
];
const WORKBENCH_PROPERTY_PRESETS: WorkbenchTableProperty[] = [
  { id: 'summary', name: '学习小结', type: 'ai_summary', source: 'custom', visible: true },
  { id: 'dueDate', name: '计划日期', type: 'date', source: 'custom', visible: true },
  { id: 'tags', name: '标签', type: 'multi_select', source: 'custom', visible: true, options: ['复习', '作业', '项目', '资料整理'] },
  { id: 'priority', name: '重要程度', type: 'select', source: 'custom', visible: true, options: ['高', '中', '低'] },
  { id: 'note', name: '备注', type: 'text', source: 'custom', visible: true }
];
const WORKBENCH_PROPERTY_TYPES: Array<{ type: WorkbenchPropertyType; label: string; icon: string }> = [
  { type: 'text', label: '文本', icon: '☰' },
  { type: 'number', label: '数字', icon: '#' },
  { type: 'select', label: '选择', icon: '▽' },
  { type: 'multi_select', label: '多选', icon: '☷' },
  { type: 'status', label: '状态', icon: '✣' },
  { type: 'date', label: '日期', icon: '□' },
  { type: 'checkbox', label: '复选框', icon: '☑' },
  { type: 'ai_summary', label: 'AI 摘要', icon: '☰' }
];
const getWorkbenchPropertyTypeMeta = (type: WorkbenchPropertyType | string) =>
  WORKBENCH_PROPERTY_TYPES.find((item) => item.type === type) ||
  (type === 'ai_summary' ? { type: 'ai_summary', label: '总结', icon: '☰' } : null) ||
  { type: 'text', label: '文本', icon: '☰' };
const getCourseAssetSection = (file: CourseAsset): CourseAssetSection => {
  const resourceType = (file.resourceType || file.type || '').toLowerCase();
  const fileCategory = (file.fileCategory || '').toLowerCase();
  const extension = (file.extension || file.name.split('.').pop() || '').toLowerCase();
  if (resourceType === 'generated' || fileCategory.includes('generated')) return 'generated';
  if (
    resourceType === 'source' ||
    resourceType === 'resource' ||
    fileCategory.includes('source') ||
    fileCategory.includes('web') ||
    extension === 'source'
  ) {
    return 'source';
  }
  return 'file';
};
const getCourseAssetSectionLabel = (section: CourseAssetSection) => {
  if (section === 'source') return 'Sources';
  if (section === 'generated') return 'Generated';
  return 'Files';
};
const getCourseAssetIcon = (file: CourseAsset, className = 'h-4 w-4') => {
  const extension = (file.extension || file.name.split('.').pop() || '').toLowerCase();
  const section = getCourseAssetSection(file);
  if (section === 'generated') return <FolderKanban className={className} />;
  if (section === 'source' && file.origin === 'web') return <LibraryBig className={className} />;
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'cpp', 'c', 'html', 'css', 'yaml', 'yml'].includes(extension)) return <FileCode2 className={className} />;
  if (extension === 'json') return <FileJson2 className={className} />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(extension)) return <FileImage className={className} />;
  if (extension === 'pdf') return <FileText className={className} />;
  if (['csv', 'xlsx', 'xls', 'tsv'].includes(extension)) return <FileSpreadsheet className={className} />;
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(extension)) return <FileVideo className={className} />;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return <FileArchive className={className} />;
  if (['md', 'markdown', 'txt'].includes(extension) || file.fileCategory?.includes('note')) return <FileText className={className} />;
  if (section === 'source') return <LibraryBig className={className} />;
  if (['xml', 'sql'].includes(extension)) return <Code className={className} />;
  return <File className={`${className} text-[#8b8f95]`} />;
};
const getCourseAssetHost = (file: CourseAsset) => {
  const sourceUrl = String(file.metadata?.sourceUrl || file.metadata?.url || '');
  if (!sourceUrl) return '';
  try {
    const parsed = new URL(sourceUrl);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const getCourseAssetFaviconUrl = (file: CourseAsset) => {
  const sourceUrl = String(file.metadata?.sourceUrl || file.metadata?.url || '');
  if (!sourceUrl) return '';
  try {
    const parsed = new URL(sourceUrl);
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`;
  } catch {
    return '';
  }
};
const getCourseAssetCoverUrl = (file: CourseAsset) => {
  const metadata = file.metadata || {};
  const explicitCover =
    metadata.coverImage ||
    metadata.coverImageUrl ||
    metadata.thumbnail ||
    metadata.thumbnailUrl ||
    metadata.image ||
    metadata.imageUrl ||
    metadata.ogImage;
  if (typeof explicitCover === 'string' && explicitCover.trim()) return explicitCover.trim();
  const images = metadata.images;
  if (Array.isArray(images)) {
    const firstImage = images.find((image) => {
      if (typeof image === 'string') return image.trim();
      return image && typeof image === 'object' && typeof (image as { src?: unknown }).src === 'string';
    });
    if (typeof firstImage === 'string') return firstImage.trim();
    if (firstImage && typeof firstImage === 'object') {
      const src = (firstImage as { src?: unknown }).src;
      if (typeof src === 'string' && src.trim()) return src.trim();
    }
  }
  return '';
};
const getCourseAssetMeta = (file: CourseAsset) => {
  const extension = (file.extension || file.name.split('.').pop() || '').toLowerCase();
  if (file.origin === 'web') return 'Web source';
  if (file.origin === 'upload') return extension ? `Uploaded ${extension.toUpperCase()}` : 'Uploaded file';
  if (file.resourceType === 'generated') return 'AI generated';
  if (file.resourceType === 'note' || file.fileCategory?.includes('note')) return 'Note';
  return extension ? extension.toUpperCase() : file.type || 'File';
};
export default function WorkspaceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workbenches, setWorkbenches] = useState<Workbench[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<WorkspaceChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  
  // UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>('status');
  const [activeIntelligenceSection, setActiveIntelligenceSection] = useState<IntelligenceSection>('overview');
  const [assetQuery, setAssetQuery] = useState('');
  const [isAssetSearchOpen, setIsAssetSearchOpen] = useState(false);
  const [assetProperties, setAssetProperties] = useState<CourseAssetProperty[]>(DEFAULT_COURSE_ASSET_PROPERTIES);
  const [assetPropertyValues, setAssetPropertyValues] = useState<Record<string, Record<string, string | boolean | string[]>>>({});
  const [assetResizingPropertyId, setAssetResizingPropertyId] = useState<string | null>(null);
  const [draggingAssetPropertyId, setDraggingAssetPropertyId] = useState<string | null>(null);
  const [dragOverAssetPropertyId, setDragOverAssetPropertyId] = useState<string | null>(null);
  const [editingAssetPropertyId, setEditingAssetPropertyId] = useState<string | null>(null);
  const [assetPropertyEditorPosition, setAssetPropertyEditorPosition] = useState<{ left: number; top: number } | null>(null);
  const [assetValueMenu, setAssetValueMenu] = useState<{ fileId: string; propertyId: string; left: number; top: number } | null>(null);
  const [openAssetMenuId, setOpenAssetMenuId] = useState<string | null>(null);
  const [assetMenuPosition, setAssetMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [workbenchQuery, setWorkbenchQuery] = useState('');
  const [workbenchFilter, setWorkbenchFilter] = useState<WorkbenchFilter>('all');
  const [workbenchSort, setWorkbenchSort] = useState<WorkbenchSort>('updated_desc');
  const [workbenchViewMode, setWorkbenchViewMode] = useState<WorkbenchViewMode>('list');
  const [deletingWorkbenchId, setDeletingWorkbenchId] = useState<string | null>(null);
  const [bulkDeletingWorkbenches, setBulkDeletingWorkbenches] = useState(false);
  const [workbenchActionError, setWorkbenchActionError] = useState<string | null>(null);
  const [isWorkbenchSearchOpen, setIsWorkbenchSearchOpen] = useState(false);
  const [isWorkbenchFiltersOpen, setIsWorkbenchFiltersOpen] = useState(false);
  const [isWorkbenchColumnsOpen, setIsWorkbenchColumnsOpen] = useState(false);
  const [isWorkbenchPropertyMenuOpen, setIsWorkbenchPropertyMenuOpen] = useState(false);
  const [workbenchPropertyMenuPosition, setWorkbenchPropertyMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [editingWorkbenchPropertyId, setEditingWorkbenchPropertyId] = useState<string | null>(null);
  const [workbenchPropertyEditorPosition, setWorkbenchPropertyEditorPosition] = useState<{ left: number; top: number } | null>(null);
  const [workbenchValueMenu, setWorkbenchValueMenu] = useState<{ workbenchId: string; propertyId: string; left: number; top: number } | null>(null);
  const [previewWorkbenchId, setPreviewWorkbenchId] = useState<string | null>(null);
  const [previewPosition, setPreviewPosition] = useState<{ left: number; top: number } | null>(null);
  const [hoveredWorkbenchId, setHoveredWorkbenchId] = useState<string | null>(null);
  const [resizingPropertyId, setResizingPropertyId] = useState<string | null>(null);
  const [draggingWorkbenchPropertyId, setDraggingWorkbenchPropertyId] = useState<string | null>(null);
  const [dragOverWorkbenchPropertyId, setDragOverWorkbenchPropertyId] = useState<string | null>(null);
  const [openWorkbenchMenuId, setOpenWorkbenchMenuId] = useState<string | null>(null);
  const [workbenchMenuPosition, setWorkbenchMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [selectedWorkbenchIds, setSelectedWorkbenchIds] = useState<Set<string>>(() => new Set());
  const [generatingSummaryKey, setGeneratingSummaryKey] = useState<string | null>(null);
  const [creatingWorkbenchInline, setCreatingWorkbenchInline] = useState(false);
  const [newWorkbenchTitle, setNewWorkbenchTitle] = useState('');
  const [creatingWorkbench, setCreatingWorkbench] = useState(false);
  const [propertyOptionDrafts, setPropertyOptionDrafts] = useState<Record<string, string>>({});
  const [workbenchTableConfig, setWorkbenchTableConfig] = useState<WorkbenchTableConfig>({
    properties: DEFAULT_WORKBENCH_TABLE_PROPERTIES,
    values: {}
  });
  const [customPropertyDraft, setCustomPropertyDraft] = useState<{ name: string; type: WorkbenchPropertyType }>({
    name: '',
    type: 'text'
  });
  const workbenchToolbarRef = useRef<HTMLDivElement | null>(null);
  const workbenchPropertyMenuRef = useRef<HTMLDivElement | null>(null);
  const workbenchPropertyEditorRef = useRef<HTMLDivElement | null>(null);
  const assetPropertyEditorRef = useRef<HTMLDivElement | null>(null);
  const assetValueMenuRef = useRef<HTMLDivElement | null>(null);
  const workbenchValueMenuRef = useRef<HTMLDivElement | null>(null);
  const workbenchColumnsMenuRef = useRef<HTMLDivElement | null>(null);
  const workbenchMenuRef = useRef<HTMLDivElement | null>(null);
  const assetMenuRef = useRef<HTMLDivElement | null>(null);
  const customPropertyNameInputRef = useRef<HTMLInputElement | null>(null);
  const inlineWorkbenchTitleRef = useRef<HTMLInputElement | null>(null);
  const resizeDraftRef = useRef<{ propertyId: string; startX: number; startWidth: number; width: number } | null>(null);
  const enteredCourseRecordedRef = useRef<string | null>(null);
  const [courseHomeSummary, setCourseHomeSummary] = useState<CourseHomeSummary | null>(null);
  const [courseHomeLoading, setCourseHomeLoading] = useState(false);
  const [terminalDraftPrompt, setTerminalDraftPrompt] = useState(searchParams.get('terminalPrompt') || '');
  const user = useAuthStore((state) => state.user);
  const hydrated = useAuthStore((state) => state.hydrated);
  const hydrate = useAuthStore((state) => state.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  useEffect(() => {
    if (!hydrated) return;
    if (user === null) {
      navigate('/', { replace: true });
    }
  }, [hydrated, navigate, user]);
  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void fetchWorkspace();
  }, [hydrated, id, user]);
  useEffect(() => {
    if (!id) return;
    const storageKey = `workspace:${id}:chats`;
    const stored = localStorage.getItem(storageKey);
    const parsed = stored ? JSON.parse(stored) as WorkspaceChatSession[] : [];
    const initialChats = parsed.length > 0
      ? parsed
      : [{
          id: crypto.randomUUID(),
          title: 'New chat',
          updatedAt: new Date().toISOString(),
          messages: []
        }];
    setChatSessions(initialChats);
    setCurrentChatId(initialChats[0]?.id || null);
  }, [id]);
  useEffect(() => {
    if (!id || chatSessions.length === 0) return;
    localStorage.setItem(`workspace:${id}:chats`, JSON.stringify(chatSessions));
  }, [chatSessions, id]);
  useEffect(() => {
    const terminalPrompt = searchParams.get('terminalPrompt');
    const openView = searchParams.get('openView');
    if (openView !== 'terminal') return;
    setActiveView('terminal');
    if (terminalPrompt) setTerminalDraftPrompt(terminalPrompt);
    setSearchParams((params) => {
      params.delete('openView');
      params.delete('terminalPrompt');
      return params;
    }, { replace: true });
  }, [searchParams, setSearchParams]);
  useEffect(() => {
    if (!id || !workspace) return;
    void loadCourseHome(workbenches[0]?.id);
  }, [id, workspace?.id, workbenches[0]?.id]);
  useEffect(() => {
    if (!workspace?.id || enteredCourseRecordedRef.current === workspace.id) return;
    enteredCourseRecordedRef.current = workspace.id;
    recordUiLearningEvent({
      eventType: 'course.entered',
      object: { type: 'course', id: workspace.id, title: workspace.name },
      source: { component: 'workspace_detail', route: `/workspaces/${workspace.id}` },
      confidence: 0.72
    });
  }, [workspace?.id]);
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const isInsideToolbar = workbenchToolbarRef.current?.contains(target);
      const isInsidePropertyMenu = workbenchPropertyMenuRef.current?.contains(target);
      const isInsidePropertyEditor = workbenchPropertyEditorRef.current?.contains(target);
      const isInsideAssetPropertyEditor = assetPropertyEditorRef.current?.contains(target);
      const isInsideValueMenu = workbenchValueMenuRef.current?.contains(target);
      const isInsideAssetValueMenu = assetValueMenuRef.current?.contains(target);
      const isInsideColumnsMenu = workbenchColumnsMenuRef.current?.contains(target);
      const isInsideWorkbenchMenu = workbenchMenuRef.current?.contains(target);
      const isInsideAssetMenu = assetMenuRef.current?.contains(target);
      if (
        !isInsideToolbar &&
        !isInsidePropertyMenu &&
        !isInsidePropertyEditor &&
        !isInsideAssetPropertyEditor &&
        !isInsideValueMenu &&
        !isInsideAssetValueMenu &&
        !isInsideColumnsMenu &&
        !isInsideWorkbenchMenu &&
        !isInsideAssetMenu
      ) {
        setIsWorkbenchSearchOpen(false);
        setIsWorkbenchFiltersOpen(false);
        setIsWorkbenchColumnsOpen(false);
        setIsWorkbenchPropertyMenuOpen(false);
        setWorkbenchPropertyMenuPosition(null);
        setEditingWorkbenchPropertyId(null);
        setWorkbenchPropertyEditorPosition(null);
        setEditingAssetPropertyId(null);
        setAssetPropertyEditorPosition(null);
        setWorkbenchValueMenu(null);
        setAssetValueMenu(null);
        setOpenWorkbenchMenuId(null);
        setWorkbenchMenuPosition(null);
        setOpenAssetMenuId(null);
        setAssetMenuPosition(null);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, []);
  useEffect(() => {
    if (!workspace) return;
    void loadWorkbenchTableConfig(workspace.id);
  }, [workspace?.id]);
  useEffect(() => {
    if (!workspace?.id) return;
    try {
      const raw = window.localStorage.getItem(`workspace:${workspace.id}:asset-table`);
      if (!raw) {
        setAssetProperties(DEFAULT_COURSE_ASSET_PROPERTIES);
        setAssetPropertyValues({});
        return;
      }
      const parsed = JSON.parse(raw) as {
        properties?: CourseAssetProperty[];
        values?: Record<string, Record<string, string | boolean | string[]>>;
      };
      const storedProperties = Array.isArray(parsed.properties) ? parsed.properties : [];
      const normalizedProperties: CourseAssetProperty[] = storedProperties.length
        ? storedProperties.map((property) => ({
            ...property,
            source: property.source === 'system' ? 'system' : 'custom' as 'system' | 'custom',
            visible: property.visible !== false,
            orderIndex: typeof property.orderIndex === 'number' ? property.orderIndex : 0
          }))
        : DEFAULT_COURSE_ASSET_PROPERTIES;
      const existingIds = new Set(normalizedProperties.map((property) => property.id));
      setAssetProperties([
        ...normalizedProperties,
        ...DEFAULT_COURSE_ASSET_PROPERTIES.filter((property) => !existingIds.has(property.id))
      ]);
      setAssetPropertyValues(parsed.values && typeof parsed.values === 'object' ? parsed.values : {});
    } catch {
      setAssetProperties(DEFAULT_COURSE_ASSET_PROPERTIES);
      setAssetPropertyValues({});
    }
  }, [workspace?.id]);
  useEffect(() => {
    if (!workspace?.id) return;
    try {
      window.localStorage.setItem(
        `workspace:${workspace.id}:asset-table`,
        JSON.stringify({ properties: assetProperties, values: assetPropertyValues })
      );
    } catch {
      // ignore local preference write failures
    }
  }, [assetProperties, assetPropertyValues, workspace?.id]);
  useEffect(() => {
    if (!resizingPropertyId) return;
    const handlePointerMove = (event: PointerEvent) => {
      const draft = resizeDraftRef.current;
      if (!draft) return;
      const nextWidth = Math.max(120, Math.min(520, draft.startWidth + event.clientX - draft.startX));
      draft.width = nextWidth;
      setWorkbenchTableConfig((config) => ({
        ...config,
        properties: config.properties.map((property) =>
          property.id === draft.propertyId ? { ...property, widthPx: Math.round(nextWidth) } : property
        )
      }));
    };
    const handlePointerUp = () => {
      const draft = resizeDraftRef.current;
      setResizingPropertyId(null);
      resizeDraftRef.current = null;
      if (workspace && draft) {
        void workbenchTableApi.updateProperty(workspace.id, draft.propertyId, { widthPx: Math.round(draft.width) }).catch((error) => {
          console.error('Failed to save column width:', error);
          void loadWorkbenchTableConfig(workspace.id);
        });
      }
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resizingPropertyId, workspace?.id]);
  useEffect(() => {
    if (!hoveredWorkbenchId) return;
    const timer = window.setTimeout(() => {
      setPreviewWorkbenchId(hoveredWorkbenchId);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [hoveredWorkbenchId]);
  useEffect(() => {
    if (!creatingWorkbenchInline) return;
    window.setTimeout(() => inlineWorkbenchTitleRef.current?.focus(), 0);
  }, [creatingWorkbenchInline]);
  useEffect(() => {
    if (!assetResizingPropertyId) return;
    const handlePointerMove = (event: PointerEvent) => {
      const draft = resizeDraftRef.current;
      if (!draft) return;
      const nextWidth = Math.max(120, Math.min(520, draft.startWidth + event.clientX - draft.startX));
      draft.width = nextWidth;
      setAssetProperties((properties) =>
        properties.map((property) =>
          property.id === draft.propertyId ? { ...property, widthPx: Math.round(nextWidth) } : property
        )
      );
    };
    const handlePointerUp = () => {
      setAssetResizingPropertyId(null);
      resizeDraftRef.current = null;
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [assetResizingPropertyId]);
  const fetchWorkspace = async () => {
    try {
      if (!id) return;
      setLoading(true);
      setLoadError(null);
      const res = await api.get(`/workspaces/${id}`);
      setWorkspace(res.data.workspace);
      setWorkbenches(await workbenchApi.listByWorkspace(id));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 404) {
          setLoadError('Workspace 不存在或已被删除。');
        } else if (error.code === 'ECONNABORTED') {
          setLoadError('后端响应超时，请确认 backend dev server 正在运行。');
        } else if (!error.response) {
          setLoadError('无法连接到后端服务，请确认 http://127.0.0.1:3001 可访问。');
        } else {
          setLoadError(error.response.data?.error || '加载 Workspace 失败。');
        }
      } else {
        setLoadError('加载 Workspace 失败。');
      }
    } finally {
      setLoading(false);
    }
  };
  const handleUpdateSettings = async (data: any) => {
    if (!id) return;
    try {
      const updated = await workspaceApi.updateWorkspace(id, data);
      setWorkspace(prev => prev ? { ...prev, ...updated } : updated as Workspace);
      setIsSettingsOpen(false);
    } catch (error) {
      console.error('Failed to update workspace:', error);
    }
  };
  const loadCourseHome = async (workbenchId?: string) => {
    if (!id) return;
    setCourseHomeLoading(true);
    try {
      const result = await learningApi.getCourseHome(id, { workbenchId });
      setCourseHomeSummary(result.summary || null);
    } catch (error) {
      console.error('Failed to load course home summary:', error);
      setCourseHomeSummary(null);
    } finally {
      setCourseHomeLoading(false);
    }
  };
  const recordUiLearningEvent = (data: {
    eventType: string;
    workbenchId?: string | null;
    goalId?: string | null;
    payload?: Record<string, unknown>;
    object?: { type?: string; id?: string | null; title?: string | null };
    interaction?: Record<string, unknown>;
    source?: Record<string, unknown>;
    confidence?: number;
  }) => {
    if (!id) return;
    void learningApi.recordLearningEvent({
      workspaceId: id,
      workbenchId: data.workbenchId || undefined,
      goalId: data.goalId || undefined,
      eventType: data.eventType,
      actor: 'user',
      payload: data.payload,
      object: {
        type: data.object?.type,
        id: data.object?.id || undefined,
        title: data.object?.title || undefined
      },
      interaction: data.interaction,
      source: data.source || { component: 'workspace_detail', route: `/workspaces/${id}` },
      confidence: data.confidence
    }).catch((error) => {
      console.warn('Failed to record learning event:', error);
    });
  };
  const openWorkbenchWithEvent = (
    workbench: Pick<Workbench, 'id' | 'title'> | Pick<WorkbenchItem, 'id' | 'title'>,
    sourceComponent: string
  ) => {
    recordUiLearningEvent({
      workbenchId: workbench.id,
      eventType: 'workbench.opened',
      object: { type: 'workbench', id: workbench.id, title: workbench.title },
      source: { component: sourceComponent, route: `/workspaces/${id}` },
      confidence: 0.76
    });
    navigate(`/workbenches/${workbench.id}`);
  };
  const startInlineWorkbenchCreate = () => {
    setCreatingWorkbenchInline(true);
    setNewWorkbenchTitle('');
    setActiveView('workbenches');
    setWorkbenchViewMode('list');
  };
  const createWorkbench = async (title?: string) => {
    if (!id) return;
    try {
      setCreatingWorkbench(true);
      const workbench = await workbenchApi.create({
        workspaceId: id,
        title: title?.trim() || undefined
      });
      await fetchWorkspace();
      setCreatingWorkbenchInline(false);
      setNewWorkbenchTitle('');
      setPreviewWorkbenchId(null);
      setPreviewPosition(null);
      setHoveredWorkbenchId(null);
    } catch (e) {
      console.error(e);
    } finally {
      setCreatingWorkbench(false);
    }
  };
  const submitInlineWorkbenchCreate = () => {
    const title = newWorkbenchTitle.trim();
    if (!title) return;
    void createWorkbench(title);
  };
  const deleteWorkbench = async (workbenchId: string) => {
    const target = workbenches.find((workbench) => workbench.id === workbenchId);
    const title = target?.title || '这个学习现场';
    if (!confirm(`删除「${title}」？相关布局、面板和笔记会一起删除。`)) {
      return;
    }
    setDeletingWorkbenchId(workbenchId);
    setWorkbenchActionError(null);
    try {
      await workbenchApi.delete(workbenchId);
      await fetchWorkspace();
      setOpenWorkbenchMenuId(null);
      setWorkbenchMenuPosition(null);
      setSelectedWorkbenchIds((current) => {
        const next = new Set(current);
        next.delete(workbenchId);
        return next;
      });
    } catch (error) {
      console.error('Failed to delete workbench:', error);
      const message = axios.isAxiosError(error)
        ? error.response?.data?.error || error.message
        : '删除学习现场失败。';
      setWorkbenchActionError(message || '删除学习现场失败。');
    } finally {
      setDeletingWorkbenchId(null);
    }
  };
  const deleteSelectedWorkbenches = async () => {
    const ids = Array.from(selectedWorkbenchIds).filter((workbenchId) =>
      workbenches.some((workbench) => workbench.id === workbenchId)
    );
    if (!ids.length) return;
    if (!confirm(`删除选中的 ${ids.length} 个学习现场？相关布局、面板和笔记会一起删除。`)) {
      return;
    }
    setBulkDeletingWorkbenches(true);
    setWorkbenchActionError(null);
    try {
      await Promise.all(ids.map((workbenchId) => workbenchApi.delete(workbenchId)));
      setSelectedWorkbenchIds(new Set());
      setOpenWorkbenchMenuId(null);
      setWorkbenchMenuPosition(null);
      await fetchWorkspace();
    } catch (error) {
      console.error('Failed to delete selected workbenches:', error);
      const message = axios.isAxiosError(error)
        ? error.response?.data?.error || error.message
        : '批量删除学习现场失败。';
      setWorkbenchActionError(message || '批量删除学习现场失败。');
    } finally {
      setBulkDeletingWorkbenches(false);
    }
  };
  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0 && id) {
        try {
          await fileSystemApi.upload(id, Array.from(files), undefined, undefined, {
            resourceRole: 'source',
            resourceType: 'source',
            scope: 'workspace',
            origin: 'upload'
          });
          await fetchWorkspace();
        } catch (error) {
          console.error('Failed to upload files:', error);
        }
      }
    };
    input.click();
  };
  const createChat = () => {
    const nextChat: WorkspaceChatSession = {
      id: crypto.randomUUID(),
      title: 'New chat',
      updatedAt: new Date().toISOString(),
      messages: []
    };
    setChatSessions((sessions) => [nextChat, ...sessions]);
    setCurrentChatId(nextChat.id);
  };
  const openTerminalWithPrompt = (prompt: string) => {
    setTerminalDraftPrompt(prompt);
    setActiveView('terminal');
  };
  const deleteChat = (chatId: string) => {
    setChatSessions((sessions) => {
      const remaining = sessions.filter((session) => session.id !== chatId);
      const nextSessions = remaining.length > 0
        ? remaining
        : [{
            id: crypto.randomUUID(),
            title: 'New chat',
            updatedAt: new Date().toISOString(),
            messages: []
          }];
      if (currentChatId === chatId) {
        setCurrentChatId(nextSessions[0]?.id || null);
      }
      return nextSessions;
    });
  };
  const updateCurrentChatMessages = (messages: WorkspaceChatSession['messages']) => {
    const targetChatId = currentChatId;
    if (!targetChatId) return;
    setChatSessions((sessions) =>
      sessions.map((session) =>
        session.id === targetChatId
          ? {
              ...session,
              messages,
              updatedAt: new Date().toISOString()
            }
          : session
      )
    );
  };
  const nameCurrentChat = (title: string) => {
    const targetChatId = currentChatId;
    if (!targetChatId) return;
    setChatSessions((sessions) =>
      sessions.map((session) =>
        session.id === targetChatId && session.title === 'New chat'
          ? {
              ...session,
              title: title.slice(0, 42),
              updatedAt: new Date().toISOString()
            }
          : session
      )
    );
  };
  const normalizeWorkbenchTableConfig = (raw: any): WorkbenchTableConfig => ({
    properties: Array.isArray(raw?.properties)
      ? raw.properties.map((property: any): WorkbenchTableProperty => ({
          id: String(property.id),
          name: String(property.name || '未命名'),
          type: property.type || 'text',
          source: property.source === 'system' ? 'system' : 'custom',
          visible: property.visible !== false,
          orderIndex: Number(property.orderIndex || 0),
          widthPx: Number(property.widthPx || 220),
          options: Array.isArray(property.options) ? property.options : []
        }))
      : DEFAULT_WORKBENCH_TABLE_PROPERTIES,
    values: raw?.values && typeof raw.values === 'object' ? raw.values : {}
  });
  const loadWorkbenchTableConfig = async (workspaceId: string) => {
    try {
      const config = await workbenchTableApi.getConfig(workspaceId);
      setWorkbenchTableConfig(normalizeWorkbenchTableConfig(config));
    } catch (error) {
      console.error('Failed to load workbench table config:', error);
      setWorkbenchTableConfig({ properties: DEFAULT_WORKBENCH_TABLE_PROPERTIES, values: {} });
    }
  };
  const addWorkbenchProperty = (property: WorkbenchTableProperty) => {
    setIsWorkbenchPropertyMenuOpen(false);
    setWorkbenchPropertyMenuPosition(null);
    if (activeView === 'assets') {
      const name = customPropertyDraft.name.trim() || property.name;
      const nextIndex = assetProperties.length;
      setAssetProperties((properties) => [
        ...properties,
        {
          id: `asset_property_${Date.now()}`,
          name,
          source: 'custom',
          type: property.type,
          options: property.options,
          orderIndex: nextIndex,
          widthPx: property.widthPx || 220
        }
      ]);
      setCustomPropertyDraft({ name: '', type: 'text' });
      return;
    }
    const exists = workbenchTableConfig.properties.some((item) => item.id === property.id);
    if (!workspace || exists) return;
    void workbenchTableApi.createProperty(workspace.id, {
      name: property.name,
      type: property.type,
      options: property.options,
      widthPx: property.widthPx
    }).then(() => loadWorkbenchTableConfig(workspace.id));
  };
  const updateAssetProperty = (
    propertyId: string,
    data: { name?: string; type?: WorkbenchPropertyType; visible?: boolean; orderIndex?: number; widthPx?: number; options?: string[] }
  ) => {
    setAssetProperties((properties) =>
      properties.map((property) =>
        property.id === propertyId
          ? {
              ...property,
              ...data,
              options: data.options ?? property.options
            }
          : property
      )
    );
  };
  const deleteAssetProperty = (property: CourseAssetProperty) => {
    if (property.source === 'system') return;
    if (!confirm(`删除属性「${property.name}」？这一列中填写的内容也会一起删除。`)) return;
    setAssetProperties((properties) => properties.filter((item) => item.id !== property.id));
    setAssetPropertyValues((values) => {
      const next: typeof values = {};
      Object.entries(values).forEach(([fileId, fileValues]) => {
        const { [property.id]: _removed, ...rest } = fileValues;
        next[fileId] = rest;
      });
      return next;
    });
    setEditingAssetPropertyId(null);
    setAssetPropertyEditorPosition(null);
  };
  const addAssetPropertyOption = (property: CourseAssetProperty, optionText?: string) => {
    const option = (optionText ?? propertyOptionDrafts[property.id] ?? '').trim();
    if (!option) return;
    const nextOptions = [...new Set([...(property.options || []), option])];
    setPropertyOptionDrafts((drafts) => ({ ...drafts, [property.id]: '' }));
    updateAssetProperty(property.id, { options: nextOptions });
  };
  const updateWorkbenchProperty = async (
    propertyId: string,
    data: { name?: string; type?: WorkbenchPropertyType; visible?: boolean; orderIndex?: number; widthPx?: number; options?: string[] }
  ) => {
    if (!workspace) return;
    setWorkbenchTableConfig((config) => ({
      ...config,
      properties: config.properties.map((property) =>
        property.id === propertyId
          ? {
              ...property,
              ...data,
              options: data.options ?? property.options
            }
          : property
      )
    }));
    try {
      await workbenchTableApi.updateProperty(workspace.id, propertyId, data);
      await loadWorkbenchTableConfig(workspace.id);
    } catch (error) {
      console.error('Failed to update property:', error);
      setWorkbenchActionError('更新属性失败，请稍后重试。');
      await loadWorkbenchTableConfig(workspace.id);
    }
  };
  const deleteWorkbenchProperty = async (property: WorkbenchTableProperty) => {
    if (!workspace || property.source === 'system') return;
    if (!confirm(`删除属性「${property.name}」？这一列中填写的内容也会一起删除。`)) return;
    try {
      await workbenchTableApi.deleteProperty(workspace.id, property.id);
      setEditingWorkbenchPropertyId(null);
      setWorkbenchPropertyEditorPosition(null);
      await loadWorkbenchTableConfig(workspace.id);
    } catch (error) {
      console.error('Failed to delete property:', error);
      setWorkbenchActionError('删除属性失败，请稍后重试。');
    }
  };
  const addWorkbenchPropertyOption = async (property: WorkbenchTableProperty, optionText?: string) => {
    const option = (optionText ?? propertyOptionDrafts[property.id] ?? '').trim();
    if (!option) return;
    const nextOptions = [...new Set([...(property.options || []), option])];
    setPropertyOptionDrafts((drafts) => ({ ...drafts, [property.id]: '' }));
    await updateWorkbenchProperty(property.id, { options: nextOptions });
  };
  const reorderWorkbenchProperty = async (propertyId: string, direction: -1 | 1) => {
    if (!workspace) return;
    const sorted = [...workbenchTableConfig.properties].sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
    const currentIndex = sorted.findIndex((property) => property.id === propertyId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= sorted.length) return;
    const reordered = [...sorted];
    [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
    const nextProperties = reordered.map((property, index) => ({ ...property, orderIndex: index }));
    setWorkbenchTableConfig((config) => ({ ...config, properties: nextProperties }));
    try {
      await Promise.all(
        nextProperties.map((property) =>
          workbenchTableApi.updateProperty(workspace.id, property.id, { orderIndex: property.orderIndex })
        )
      );
      await loadWorkbenchTableConfig(workspace.id);
    } catch (error) {
      console.error('Failed to reorder properties:', error);
      setWorkbenchActionError('调整列顺序失败，请稍后重试。');
      await loadWorkbenchTableConfig(workspace.id);
    }
  };
  const beginResizeWorkbenchProperty = (event: React.PointerEvent, property: WorkbenchTableProperty) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startWidth = property.widthPx || 220;
    resizeDraftRef.current = {
      propertyId: property.id,
      startX: event.clientX,
      startWidth,
      width: startWidth
    };
    setResizingPropertyId(property.id);
  };
  const moveWorkbenchPropertyTo = async (sourcePropertyId: string, targetPropertyId: string) => {
    if (!workspace || sourcePropertyId === targetPropertyId) return;
    const sorted = [...workbenchTableConfig.properties].sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
    const sourceIndex = sorted.findIndex((property) => property.id === sourcePropertyId);
    const targetIndex = sorted.findIndex((property) => property.id === targetPropertyId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const reordered = [...sorted];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    const nextProperties = reordered.map((property, index) => ({ ...property, orderIndex: index }));
    setWorkbenchTableConfig((config) => ({ ...config, properties: nextProperties }));
    setDragOverWorkbenchPropertyId(null);
    try {
      await Promise.all(
        nextProperties.map((property) =>
          workbenchTableApi.updateProperty(workspace.id, property.id, { orderIndex: property.orderIndex })
        )
      );
      await loadWorkbenchTableConfig(workspace.id);
    } catch (error) {
      console.error('Failed to move property:', error);
      setWorkbenchActionError('调整列顺序失败，请稍后重试。');
      await loadWorkbenchTableConfig(workspace.id);
    }
  };
  const addCustomWorkbenchProperty = () => {
    const name = customPropertyDraft.name.trim();
    if (!name) return;
    addWorkbenchProperty({
      id: `custom_${Date.now()}`,
      name,
      type: customPropertyDraft.type,
      source: 'custom',
      visible: true,
      options: customPropertyDraft.type === 'select' || customPropertyDraft.type === 'multi_select' ? ['选项'] : undefined
    });
    setCustomPropertyDraft({ name: '', type: 'text' });
  };
  const startCustomWorkbenchProperty = () => {
    setCustomPropertyDraft((draft) => ({
      name: draft.name || '',
      type: draft.type || 'text'
    }));
    window.setTimeout(() => customPropertyNameInputRef.current?.focus(), 0);
  };
  const updateWorkbenchPropertyValue = (
    workbenchId: string,
    propertyId: string,
    value: string | number | boolean | string[] | null
  ) => {
    const nextConfig = {
      ...workbenchTableConfig,
      values: {
        ...workbenchTableConfig.values,
        [workbenchId]: {
          ...(workbenchTableConfig.values[workbenchId] || {}),
          [propertyId]: value
        }
      }
    };
    setWorkbenchTableConfig(nextConfig);
    if (workspace) {
      void workbenchTableApi.setValue(workspace.id, workbenchId, propertyId, value).catch((error) => {
        console.error('Failed to save property value:', error);
        void loadWorkbenchTableConfig(workspace.id);
      });
    }
  };
  const generateWorkbenchSummaryValue = async (workbenchId: string, propertyId: string) => {
    if (!workspace) return;
    const key = `${workbenchId}:${propertyId}`;
    setGeneratingSummaryKey(key);
    try {
      const result = await workbenchTableApi.generateSummary(workspace.id, workbenchId, propertyId);
      const value = result.value || '';
      setWorkbenchTableConfig((config) => ({
        ...config,
        values: {
          ...config.values,
          [workbenchId]: {
            ...(config.values[workbenchId] || {}),
            [propertyId]: value
          }
        }
      }));
    } catch (error) {
      console.error('Failed to generate AI summary:', error);
      setWorkbenchActionError('生成总结失败，请稍后重试。');
    } finally {
      setGeneratingSummaryKey(null);
    }
  };
  const openFileInWorkbench = async (fileId: string) => {
    if (!id || !workspace) return;
    let workbenchId = '';
    if (workbenches.length > 0) {
      workbenchId = workbenches[0].id;
    } else {
      try {
        const sourceFile = (workspace.fileObjects || []).find((file) => file.id === fileId);
        const workbench = await workbenchApi.create({
          title: sourceFile?.name ? `${sourceFile.name.replace(/\.[^.]+$/, '')}整理` : undefined,
          description: sourceFile?.name ? `围绕「${sourceFile.name}」继续学习和整理。` : undefined,
          workspaceId: id
        });
        workbenchId = workbench.id;
        await fetchWorkspace();
      } catch (e) {
        console.error('Failed to create workbench', e);
        return;
      }
    }
    const sourceFile = (workspace.fileObjects || []).find((file) => file.id === fileId);
    recordUiLearningEvent({
      workbenchId,
      eventType: 'resource.viewed',
      object: { type: 'resource', id: fileId, title: sourceFile?.name || 'Course resource' },
      payload: {
        fileCategory: sourceFile?.fileCategory || null,
        resourceType: sourceFile?.resourceType || null,
        path: sourceFile?.path || null,
        openedInWorkbenchId: workbenchId
      },
      source: { component: 'workspace_assets', route: `/workspaces/${id}` },
      confidence: 0.74
    });
    navigate(`/workbenches/${workbenchId}?resourceId=${encodeURIComponent(fileId)}`);
  };
  if (loading || (!loadError && !workspace)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--app-bg)]">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }
  if (loadError || !workspace) {
    return (
      <div className="workspace-shell flex min-h-0 flex-1 items-center justify-center bg-[#fbfbfa] px-6 text-[#202124]">
        <div className="w-full max-w-md border-y border-[#e8e8e4] py-8">
          <p className="text-sm font-medium text-[#96999d]">Workspace</p>
          <h1 className="mt-2 text-2xl font-semibold">暂时无法打开这个 Workspace</h1>
          <p className="mt-3 text-sm leading-6 text-[#666a70]">
            {loadError || '加载 Workspace 失败。'}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={() => void fetchWorkspace()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black"
            >
              <RefreshCw className="h-4 w-4" />
              重试
            </button>
            <button
              onClick={() => navigate('/workspaces')}
              className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef]"
            >
              返回列表
            </button>
          </div>
        </div>
      </div>
    );
  }
  const formatActivityTime = (value?: string) => {
    if (!value) return 'never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'unknown';
    const diffMs = Date.now() - date.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diffMs < minute) return 'just now';
    if (diffMs < hour) return `${Math.floor(diffMs / minute)} min ago`;
    if (diffMs < day) return `${Math.floor(diffMs / hour)} hours ago`;
    if (diffMs < day * 7) return `${Math.floor(diffMs / day)} days ago`;
    return date.toLocaleDateString();
  };
  // Convert raw data to UI models
  const latestWorkbench = workbenches[0];
  const overview: WorkspaceOverview = {
    id: workspace.id,
    courseName: workspace.name,
    description: workspace.description || '',
    major: workspace.major || 'General',
    updatedAt: formatActivityTime(workspace.updatedAt),
    workbenchCount: workbenches.length,
    fileCount: workspace.fileObjects?.length || 0,
    recentActivity: latestWorkbench
      ? `Workbench updated ${formatActivityTime(latestWorkbench.updatedAt)}`
      : `Workspace updated ${formatActivityTime(workspace.updatedAt)}`
  };
  const workbenchItems: WorkbenchItem[] = workbenches.map((wb) => ({
    id: wb.id,
    title: wb.title,
    updatedAt: formatActivityTime(wb.updatedAt),
    panelCount: wb.panelCount || wb.state?.editors.length || wb.state?.panels?.length || 0,
    resourceCount: wb.resourceCount || 0,
    description: wb.description
  }));
  const currentChat = chatSessions.find((session) => session.id === currentChatId) || chatSessions[0];
  const latestWorkbenchItem = workbenchItems[0];
  const workbenchUpdatedAtMap = new Map(workbenches.map((wb) => [wb.id, wb.updatedAt]));
  const parsedWorkbenchDate = (workbenchId: string) => {
    const time = new Date(workbenchUpdatedAtMap.get(workbenchId) || '').getTime();
    return Number.isNaN(time) ? 0 : time;
  };
  const filteredWorkbenchItems = workbenchItems
    .filter((item) => {
      const q = workbenchQuery.trim().toLowerCase();
      if (!q) return true;
      return item.title.toLowerCase().includes(q) || (item.description || '').toLowerCase().includes(q);
    })
    .filter((item) => {
      if (workbenchFilter === 'active') return item.panelCount > 0;
      if (workbenchFilter === 'recent') return parsedWorkbenchDate(item.id) >= Date.now() - 7 * 24 * 60 * 60 * 1000;
      return true;
    })
    .sort((a, b) => {
      if (workbenchSort === 'title_asc') return a.title.localeCompare(b.title);
      if (workbenchSort === 'updated_asc') return parsedWorkbenchDate(a.id) - parsedWorkbenchDate(b.id);
      return parsedWorkbenchDate(b.id) - parsedWorkbenchDate(a.id);
    });
  const workbenchResourceCountMap = new Map(workbenches.map((workbench) => [workbench.id, workbench.resourceCount || 0]));
  const getWorkbenchResourceCount = (workbenchId: string) => workbenchResourceCountMap.get(workbenchId) || 0;
  const getWorkbenchAbsoluteUpdatedAt = (workbenchId: string) => {
    const value = workbenchUpdatedAtMap.get(workbenchId);
    if (!value) return '暂无更新时间';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '暂无更新时间';
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  const getWorkbenchDescription = (workbench: WorkbenchItem) =>
    /persisted task desktop for this learning objective/i.test(workbench.description || '')
      ? ''
      : workbench.description || '';
  const visibleWorkbenchProperties = workbenchTableConfig.properties.filter((property) => property.visible);
  const nameColumnWidth = 430;
  const addPropertyColumnWidth = 56;
  const propertyColumnWidths = visibleWorkbenchProperties.map((property) => property.widthPx || 220);
  const workbenchTableGridTemplate = `${nameColumnWidth}px ${propertyColumnWidths.map((width) => `${width}px`).join(' ')} ${addPropertyColumnWidth}px`;
  const workbenchTableMinWidth = nameColumnWidth + propertyColumnWidths.reduce((sum, width) => sum + width, 0) + addPropertyColumnWidth;
  const selectedWorkbenchCount = selectedWorkbenchIds.size;
  const allVisibleWorkbenchesSelected = filteredWorkbenchItems.length > 0
    && filteredWorkbenchItems.every((workbench) => selectedWorkbenchIds.has(workbench.id));
  const previewWorkbench = previewWorkbenchId
    ? workbenchItems.find((workbench) => workbench.id === previewWorkbenchId) || null
    : null;
  const openHoverWorkbenchPreview = (workbenchId: string, event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoveredWorkbenchId(workbenchId);
    setPreviewPosition({
      left: Math.min(Math.max(rect.left + 18, 16), window.innerWidth - 300),
      top: Math.min(rect.bottom + 10, window.innerHeight - 230)
    });
  };
  const closeHoverWorkbenchPreview = (workbenchId?: string) => {
    setHoveredWorkbenchId((current) => {
      if (workbenchId && current !== workbenchId) return current;
      return null;
    });
    setPreviewWorkbenchId((current) => {
      if (workbenchId && current !== workbenchId) return current;
      return null;
    });
    setPreviewPosition(null);
  };
  const openWorkbenchPropertyMenu = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setWorkbenchPropertyMenuPosition({
      left: Math.min(Math.max(rect.left, 16), window.innerWidth - 440),
      top: Math.min(rect.bottom + 8, window.innerHeight - 560)
    });
    setIsWorkbenchPropertyMenuOpen((value) => !value);
    setEditingWorkbenchPropertyId(null);
    setWorkbenchPropertyEditorPosition(null);
  };
  const openWorkbenchActionMenu = (workbenchId: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    closeHoverWorkbenchPreview();
    setOpenWorkbenchMenuId((current) => {
      const isClosing = current === workbenchId;
      if (isClosing) {
        setWorkbenchMenuPosition(null);
        return null;
      }
      setWorkbenchMenuPosition({
        left: Math.min(Math.max(rect.right - 160, 16), window.innerWidth - 176),
        top: Math.min(rect.bottom + 8, window.innerHeight - 84)
      });
      return workbenchId;
    });
  };
  const toggleWorkbenchSelection = (workbenchId: string) => {
    setSelectedWorkbenchIds((current) => {
      const next = new Set(current);
      if (next.has(workbenchId)) {
        next.delete(workbenchId);
      } else {
        next.add(workbenchId);
      }
      return next;
    });
  };
  const getStatusClassName = (value: unknown) => {
    const text = String(value || '');
    if (text.includes('已完成')) return 'bg-[#edf6ee] text-[#3f6f48] ring-[#d9eadc]';
    if (text.includes('待整理')) return 'bg-[#fff6df] text-[#87621b] ring-[#f1dfac]';
    if (text.includes('进行中')) return 'bg-[#eef4fb] text-[#456d92] ring-[#d8e6f3]';
    return 'bg-[#f1f1ef] text-[#55585d] ring-[#e5e5df]';
  };
  const getInferredWorkbenchTopic = (workbench: WorkbenchItem) => {
    const description = getWorkbenchDescription(workbench);
    if (description) return description.length > 28 ? `${description.slice(0, 28)}...` : description;
    return workbench.title;
  };
  const getWorkbenchPropertyValue = (workbench: WorkbenchItem, property: WorkbenchTableProperty) => {
    const stored = workbenchTableConfig.values[workbench.id]?.[property.id];
    if (stored !== undefined && stored !== null && stored !== '') return stored;
    if (property.source === 'system' && property.name === '主题') return getInferredWorkbenchTopic(workbench);
    if (property.source === 'system' && property.name === '最近活动') return workbench.updatedAt;
    if (property.source === 'system' && property.name === '内容') return `${workbench.panelCount} 面板 · ${getWorkbenchResourceCount(workbench.id)} 资源`;
    return '';
  };
  const openWorkbenchPropertyEditor = (property: WorkbenchTableProperty, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setEditingWorkbenchPropertyId((current) => (current === property.id ? null : property.id));
    setWorkbenchPropertyEditorPosition({
      left: Math.min(Math.max(rect.left, 16), window.innerWidth - 360),
      top: Math.min(rect.bottom + 8, window.innerHeight - 420)
    });
    setIsWorkbenchPropertyMenuOpen(false);
    setWorkbenchPropertyMenuPosition(null);
    setWorkbenchValueMenu(null);
  };
  const openWorkbenchValueMenu = (workbenchId: string, propertyId: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setWorkbenchValueMenu({
      workbenchId,
      propertyId,
      left: Math.min(Math.max(rect.left, 16), window.innerWidth - 280),
      top: Math.min(rect.bottom + 6, window.innerHeight - 360)
    });
    setEditingWorkbenchPropertyId(null);
    setWorkbenchPropertyEditorPosition(null);
    setIsWorkbenchPropertyMenuOpen(false);
    setWorkbenchPropertyMenuPosition(null);
  };
  const assetNameColumnWidth = 430;
  const assetAddPropertyColumnWidth = 56;
  const visibleAssetProperties = assetProperties.filter((property) => property.visible !== false);
  const assetColumnWidths = visibleAssetProperties.map((property) => property.widthPx || 220);
  const assetTableGridTemplate = `${assetNameColumnWidth}px ${assetColumnWidths.map((width) => `${width}px`).join(' ')} ${assetAddPropertyColumnWidth}px`;
  const assetTableMinWidth =
    assetNameColumnWidth +
    assetColumnWidths.reduce((sum, width) => sum + width, 0) +
    assetAddPropertyColumnWidth;
  const beginResizeAssetProperty = (event: React.PointerEvent, property: CourseAssetProperty) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startWidth = property.widthPx || 220;
    resizeDraftRef.current = {
      propertyId: property.id,
      startX: event.clientX,
      startWidth,
      width: startWidth
    };
    setAssetResizingPropertyId(property.id);
  };
  const moveAssetPropertyTo = (sourcePropertyId: string, targetPropertyId: string) => {
    if (sourcePropertyId === targetPropertyId) return;
    setAssetProperties((properties) => {
      const sourceIndex = properties.findIndex((property) => property.id === sourcePropertyId);
      const targetIndex = properties.findIndex((property) => property.id === targetPropertyId);
      if (sourceIndex < 0 || targetIndex < 0) return properties;
      const next = [...properties];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };
  const updateAssetPropertyValue = (fileId: string, propertyId: string, value: string | boolean | string[]) => {
    setAssetPropertyValues((current) => ({
      ...current,
      [fileId]: {
        ...(current[fileId] || {}),
        [propertyId]: value
      }
    }));
  };
  const openAssetPropertyEditor = (property: CourseAssetProperty, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setEditingWorkbenchPropertyId(null);
    setWorkbenchPropertyEditorPosition(null);
    setEditingAssetPropertyId((current) => (current === property.id ? null : property.id));
    setAssetPropertyEditorPosition({
      left: Math.min(rect.left, window.innerWidth - 360),
      top: Math.min(rect.bottom + 8, window.innerHeight - 420)
    });
  };
  const openAssetValueMenu = (fileId: string, propertyId: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setAssetValueMenu({
      fileId,
      propertyId,
      left: Math.min(rect.left, window.innerWidth - 280),
      top: Math.min(rect.bottom + 6, window.innerHeight - 360)
    });
  };
  const openAssetActionMenu = (file: CourseAsset, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setOpenAssetMenuId((current) => (current === file.id ? null : file.id));
    setAssetMenuPosition({
      left: Math.min(rect.right - 160, window.innerWidth - 176),
      top: Math.min(rect.bottom + 6, window.innerHeight - 140)
    });
  };
  const deleteCourseAsset = async (file: CourseAsset) => {
    if (!id) return;
    if (!confirm(`删除课程资产「${file.name}」？`)) return;
    setDeletingAssetId(file.id);
    setOpenAssetMenuId(null);
    setAssetMenuPosition(null);
    try {
      await fileSystemApi.remove(id, file.id);
      setAssetPropertyValues((values) => {
        const { [file.id]: _removed, ...rest } = values;
        return rest;
      });
      await fetchWorkspace();
    } catch (error) {
      console.error('Failed to delete course asset:', error);
      setWorkbenchActionError('删除课程资产失败，请稍后重试。');
    } finally {
      setDeletingAssetId(null);
    }
  };
  const getAssetPropertyValue = (file: CourseAsset, property: CourseAssetProperty) => {
    if (property.source === 'system' && property.id === 'path') return file.path || '/';
    if (property.source === 'system' && property.id === 'updatedAt') return formatActivityTime(file.updatedAt);
    return assetPropertyValues[file.id]?.[property.id] || '';
  };
  const renderAssetPropertyCell = (file: CourseAsset, property: CourseAssetProperty) => {
    const value = getAssetPropertyValue(file, property);
    if (property.source === 'system') {
      return <span className="block h-9 truncate leading-9">{String(value || '空')}</span>;
    }
    if (property.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => updateAssetPropertyValue(file.id, property.id, event.target.checked)}
          className="h-4 w-4 rounded border-[#d6d6d1]"
        />
      );
    }
    if (property.type === 'date') {
      return (
        <input
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => updateAssetPropertyValue(file.id, property.id, event.target.value)}
          className="h-9 w-full bg-transparent text-sm text-[#666a70] outline-none"
        />
      );
    }
    if (property.type === 'number') {
      return (
        <input
          type="number"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => updateAssetPropertyValue(file.id, property.id, event.target.value)}
          placeholder="空"
          className="h-9 w-full bg-transparent text-sm text-[#666a70] outline-none placeholder:text-[#b3b3af]"
        />
      );
    }
    if (property.type === 'select' || property.type === 'status') {
      const stringValue = typeof value === 'string' ? value : '';
      return (
        <button
          type="button"
          onClick={(event) => openAssetValueMenu(file.id, property.id, event.currentTarget)}
          className="flex h-9 max-w-full items-center text-left"
        >
          {stringValue ? (
            <span className="max-w-full truncate rounded-full bg-[#f1f1ef] px-2 py-0.5 text-xs text-[#34373c]">{stringValue}</span>
          ) : (
            <span className="text-[#b3b3af]">空</span>
          )}
        </button>
      );
    }
    if (property.type === 'multi_select') {
      const selected = Array.isArray(value)
        ? value
        : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
      return (
        <button
          type="button"
          onClick={(event) => openAssetValueMenu(file.id, property.id, event.currentTarget)}
          className="flex min-h-9 max-w-full items-center text-left"
        >
          {selected.length ? (
            <span className="flex max-w-full flex-wrap gap-1">
              {selected.slice(0, 3).map((item) => (
                <span key={item} className="max-w-[120px] truncate rounded-full bg-[#f1f1ef] px-2 py-0.5 text-xs text-[#34373c]">{item}</span>
              ))}
              {selected.length > 3 ? <span className="text-xs text-[#96999d]">+{selected.length - 3}</span> : null}
            </span>
          ) : (
            <span className="text-[#b3b3af]">空</span>
          )}
        </button>
      );
    }
    return (
      <input
        type="text"
        value={Array.isArray(value) ? value.join(', ') : String(value || '')}
        onChange={(event) => updateAssetPropertyValue(file.id, property.id, event.target.value)}
        placeholder="空"
        className="h-9 w-full bg-transparent text-sm text-[#666a70] outline-none placeholder:text-[#b3b3af]"
      />
    );
  };
  const renderNotionPropertyHeader = <T extends { id: string; name: string },>(options: {
    property: T;
    draggingPropertyId: string | null;
    dragOverPropertyId: string | null;
    resizingPropertyId: string | null;
    onOpenProperty?: (property: T, element: HTMLElement) => void;
    onResizeStart: (event: React.PointerEvent, property: T) => void;
    onMovePropertyTo: (sourcePropertyId: string, targetPropertyId: string) => void;
    setDraggingPropertyId: (id: string | null) => void;
    setDragOverPropertyId: React.Dispatch<React.SetStateAction<string | null>>;
    resizeLabelPrefix: string;
  }) => {
    const {
      property,
      draggingPropertyId,
      dragOverPropertyId,
      resizingPropertyId,
      onOpenProperty,
      onResizeStart,
      onMovePropertyTo,
      setDraggingPropertyId,
      setDragOverPropertyId,
      resizeLabelPrefix
    } = options;
    return (
      <div
        key={property.id}
        draggable
        onDragStart={(event) => {
          setDraggingPropertyId(property.id);
          setDragOverPropertyId(null);
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', property.id);
        }}
        onDragOver={(event) => {
          if (!draggingPropertyId || draggingPropertyId === property.id) return;
          event.preventDefault();
          setDragOverPropertyId(property.id);
          event.dataTransfer.dropEffect = 'move';
        }}
        onDragLeave={() => {
          setDragOverPropertyId((current) => (current === property.id ? null : current));
        }}
        onDrop={(event) => {
          event.preventDefault();
          const sourcePropertyId = draggingPropertyId || event.dataTransfer.getData('text/plain');
          setDraggingPropertyId(null);
          setDragOverPropertyId(null);
          if (sourcePropertyId) onMovePropertyTo(sourcePropertyId, property.id);
        }}
        onDragEnd={() => {
          setDraggingPropertyId(null);
          setDragOverPropertyId(null);
        }}
        className={`group/col relative flex h-11 min-w-0 items-center normal-case tracking-normal transition-all duration-200 hover:bg-[#f3f3f1] ${
          resizingPropertyId === property.id || draggingPropertyId === property.id ? 'scale-[0.985] bg-[#f3f3f1] opacity-70' : ''
        } ${
          dragOverPropertyId === property.id ? 'translate-y-0.5 bg-white shadow-[inset_3px_0_0_#b9bab2,0_8px_22px_rgba(32,33,36,0.08)]' : ''
        }`}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenProperty?.(property, event.currentTarget);
          }}
          className="flex h-full min-w-0 flex-1 cursor-grab items-center px-4 text-left active:cursor-grabbing"
        >
          <span className="truncate font-medium text-[#8a8e94]">{property.name}</span>
        </button>
        <button
          type="button"
          onPointerDown={(event) => onResizeStart(event, property)}
          className="absolute right-[-6px] top-0 z-20 flex h-full w-3 cursor-col-resize items-center justify-center opacity-0 transition hover:opacity-100 group-hover/col:opacity-100"
          aria-label={`${resizeLabelPrefix}${property.name}列宽`}
        >
          <span className="block h-7 w-px rounded-full bg-[#b9bab2]" />
        </button>
      </div>
    );
  };
  const renderWorkbenchPropertyCell = (workbench: WorkbenchItem, property: WorkbenchTableProperty) => {
    const value = getWorkbenchPropertyValue(workbench, property);
    const isSystemReadonly = property.source === 'system' && property.name !== '主题';
    if (isSystemReadonly) {
      return <span className="block truncate text-[#777b80]">{String(value || '空')}</span>;
    }
    if (property.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => updateWorkbenchPropertyValue(workbench.id, property.id, event.target.checked)}
          className="h-4 w-4 rounded border-[#d6d6d1]"
        />
      );
    }
    if (property.type === 'ai_summary') {
      const key = `${workbench.id}:${property.id}`;
      return (
        <div className="group/summary flex h-9 items-center gap-2">
          <span className={`min-w-0 flex-1 truncate ${value ? 'text-[#55585d]' : 'text-[#b3b3af]'}`}>
            {String(value || '还没有小结')}
          </span>
          <button
            type="button"
            onClick={() => void generateWorkbenchSummaryValue(workbench.id, property.id)}
            disabled={generatingSummaryKey === key}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-[#55585d] opacity-0 transition hover:bg-[#eeeeeb] disabled:opacity-60 group-hover/summary:opacity-100 group-focus-within/summary:opacity-100"
            title={value ? '更新学习小结' : '生成学习小结'}
          >
            {generatingSummaryKey === key ? '整理中' : value ? '更新' : '生成'}
          </button>
        </div>
      );
    }
    if (property.type === 'select' || property.type === 'status') {
      return (
        <button
          type="button"
          onClick={(event) => openWorkbenchValueMenu(workbench.id, property.id, event.currentTarget)}
          className="flex h-9 w-full min-w-0 items-center bg-transparent text-left text-sm text-[#666a70] outline-none"
        >
          <span className={`truncate ${value ? `rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${getStatusClassName(value)}` : 'text-[#b3b3af]'}`}>
            {String(value || '空')}
          </span>
        </button>
      );
    }
    if (property.type === 'multi_select') {
      const selected = Array.isArray(value) ? value : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
      return (
        <button
          type="button"
          onClick={(event) => openWorkbenchValueMenu(workbench.id, property.id, event.currentTarget)}
          className="flex h-9 w-full min-w-0 items-center gap-1 bg-transparent text-left outline-none"
        >
          {selected.length ? (
            selected.slice(0, 2).map((item) => (
              <span key={item} className="max-w-[80px] truncate rounded-full bg-[#f1f1ef] px-2 py-0.5 text-xs text-[#34373c]">{item}</span>
            ))
          ) : (
            <span className="text-sm text-[#b3b3af]">空</span>
          )}
          {selected.length > 2 ? <span className="text-xs text-[#96999d]">+{selected.length - 2}</span> : null}
        </button>
      );
    }
    if (property.type === 'date') {
      return (
        <input
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => updateWorkbenchPropertyValue(workbench.id, property.id, event.target.value)}
          className="h-9 w-full bg-transparent text-sm text-[#666a70] outline-none"
        />
      );
    }
    if (property.type === 'number') {
      return (
        <input
          type="number"
          value={typeof value === 'number' || typeof value === 'string' ? value : ''}
          onChange={(event) => updateWorkbenchPropertyValue(workbench.id, property.id, event.target.value)}
          placeholder="空"
          className="h-9 w-full bg-transparent text-sm text-[#666a70] outline-none placeholder:text-[#b3b3af]"
        />
      );
    }
    return (
      <input
        type="text"
        value={Array.isArray(value) ? value.join(', ') : String(value || '')}
        onChange={(event) => updateWorkbenchPropertyValue(workbench.id, property.id, event.target.value)}
        placeholder={
          property.source === 'system' && property.name === '主题' ? getInferredWorkbenchTopic(workbench) : '空'
        }
        className="h-9 w-full bg-transparent text-sm text-[#666a70] outline-none placeholder:text-[#b3b3af]"
      />
    );
  };
  const recentWorkbenchItems = workbenchItems.slice(0, 3);
  const courseAssetFiles = (workspace.fileObjects || [])
    .filter((file) => file.nodeType === 'file')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .filter((file) => {
      const query = assetQuery.trim().toLowerCase();
      if (!query) return true;
      return (
        file.name.toLowerCase().includes(query) ||
        file.path.toLowerCase().includes(query) ||
        getCourseAssetSectionLabel(getCourseAssetSection(file)).toLowerCase().includes(query)
      );
    });
  const statusItems = [
    { label: 'Workbench', value: overview.workbenchCount },
    { label: 'Resources', value: overview.fileCount },
    { label: 'Updated', value: overview.updatedAt }
  ];
  const workspaceViews: Array<{
    id: WorkspaceView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'status', label: '概览', icon: Sparkles },
    { id: 'workbenches', label: '学习现场', icon: Workflow },
    { id: 'assets', label: '课程资产', icon: FolderTree },
    { id: 'intelligence', label: 'Learning Intelligence', icon: BrainCircuit },
    { id: 'terminal', label: 'AI Terminal', icon: PencilLine }
  ];
  const editingWorkbenchProperty = visibleWorkbenchProperties.find((property) => property.id === editingWorkbenchPropertyId)
    || workbenchTableConfig.properties.find((property) => property.id === editingWorkbenchPropertyId)
    || null;
  const editingAssetProperty = visibleAssetProperties.find((property) => property.id === editingAssetPropertyId)
    || assetProperties.find((property) => property.id === editingAssetPropertyId)
    || null;
  const valueMenuProperty = workbenchValueMenu
    ? workbenchTableConfig.properties.find((property) => property.id === workbenchValueMenu.propertyId) || null
    : null;
  const valueMenuWorkbench = workbenchValueMenu
    ? workbenchItems.find((workbench) => workbench.id === workbenchValueMenu.workbenchId) || null
    : null;
  const assetValueMenuProperty = assetValueMenu
    ? assetProperties.find((property) => property.id === assetValueMenu.propertyId) || null
    : null;
  const assetValueMenuFile = assetValueMenu
    ? courseAssetFiles.find((file) => file.id === assetValueMenu.fileId) || null
    : null;
  const actionMenuAsset = openAssetMenuId
    ? courseAssetFiles.find((file) => file.id === openAssetMenuId) || null
    : null;
  const previewStyle = createPortal(
    <style>
      {'@keyframes workspacePreviewIn{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}'}
    </style>,
    document.head
  );
  const workbenchValueEditor = workbenchValueMenu && valueMenuProperty && valueMenuWorkbench
    ? createPortal(
        <div
          ref={workbenchValueMenuRef}
          className="fixed z-[90] w-[260px] rounded-2xl border border-[#e6e6e1] bg-white p-2 text-sm text-[#202124] shadow-[0_22px_60px_rgba(32,33,36,0.14)]"
          style={{
            left: workbenchValueMenu.left,
            top: workbenchValueMenu.top
          }}
        >
          <div className="max-h-56 overflow-y-auto p-1">
            {(() => {
              const currentValue = getWorkbenchPropertyValue(valueMenuWorkbench, valueMenuProperty);
              const selected = Array.isArray(currentValue)
                ? currentValue
                : String(currentValue || '').split(',').map((item) => item.trim()).filter(Boolean);
              return (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      updateWorkbenchPropertyValue(valueMenuWorkbench.id, valueMenuProperty.id, valueMenuProperty.type === 'multi_select' ? [] : '');
                      setWorkbenchValueMenu(null);
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[#777b80] transition hover:bg-[#f6f6f4]"
                  >
                    <span>空</span>
                    {!currentValue || (Array.isArray(currentValue) && currentValue.length === 0) ? <span>✓</span> : null}
                  </button>
                  {(valueMenuProperty.options || []).map((option) => {
                    const isSelected = valueMenuProperty.type === 'multi_select'
                      ? selected.includes(option)
                      : String(currentValue || '') === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          if (valueMenuProperty.type === 'multi_select') {
                            const next = isSelected ? selected.filter((item) => item !== option) : [...selected, option];
                            updateWorkbenchPropertyValue(valueMenuWorkbench.id, valueMenuProperty.id, next);
                            return;
                          }
                          updateWorkbenchPropertyValue(valueMenuWorkbench.id, valueMenuProperty.id, option);
                          setWorkbenchValueMenu(null);
                        }}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition hover:bg-[#f6f6f4]"
                      >
                        <span className="truncate rounded-full bg-[#f1f1ef] px-2 py-0.5 text-xs text-[#34373c]">{option}</span>
                        {isSelected ? <span className="text-[#55585d]">✓</span> : null}
                      </button>
                    );
                  })}
                  {!valueMenuProperty.options?.length ? (
                    <p className="px-3 py-2 text-xs leading-5 text-[#96999d]">还没有选项，可以在下面直接新增。</p>
                  ) : null}
                </>
              );
            })()}
          </div>
          <div className="border-t border-[#eeeeeb] p-2">
            <div className="flex gap-2">
              <input
                value={propertyOptionDrafts[valueMenuProperty.id] || ''}
                onChange={(event) => setPropertyOptionDrafts((drafts) => ({ ...drafts, [valueMenuProperty.id]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const option = propertyOptionDrafts[valueMenuProperty.id]?.trim();
                    if (!option) return;
                    void addWorkbenchPropertyOption(valueMenuProperty, option).then(() => {
                      updateWorkbenchPropertyValue(
                        valueMenuWorkbench.id,
                        valueMenuProperty.id,
                        valueMenuProperty.type === 'multi_select'
                          ? [...new Set([
                              ...(
                                Array.isArray(getWorkbenchPropertyValue(valueMenuWorkbench, valueMenuProperty))
                                  ? getWorkbenchPropertyValue(valueMenuWorkbench, valueMenuProperty) as string[]
                                  : []
                              ),
                              option
                            ])]
                          : option
                      );
                    });
                  }
                }}
                placeholder="新增选项"
                className="h-9 min-w-0 flex-1 rounded-xl border border-[#eeeeeb] px-3 text-sm outline-none transition focus:border-[#b9bab2]"
              />
              <button
                type="button"
                onClick={() => {
                  const option = propertyOptionDrafts[valueMenuProperty.id]?.trim();
                  if (!option) return;
                  void addWorkbenchPropertyOption(valueMenuProperty, option).then(() => {
                    updateWorkbenchPropertyValue(
                      valueMenuWorkbench.id,
                      valueMenuProperty.id,
                      valueMenuProperty.type === 'multi_select'
                        ? [...new Set([
                            ...(
                              Array.isArray(getWorkbenchPropertyValue(valueMenuWorkbench, valueMenuProperty))
                                ? getWorkbenchPropertyValue(valueMenuWorkbench, valueMenuProperty) as string[]
                                : []
                            ),
                            option
                          ])]
                        : option
                    );
                  });
                }}
                className="h-9 rounded-xl bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black"
              >
                添加
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;
  const assetValueEditor = assetValueMenu && assetValueMenuProperty && assetValueMenuFile
    ? createPortal(
        <div
          ref={assetValueMenuRef}
          className="fixed z-[90] w-[260px] rounded-2xl border border-[#e6e6e1] bg-white p-2 text-sm text-[#202124] shadow-[0_22px_60px_rgba(32,33,36,0.14)]"
          style={{
            left: assetValueMenu.left,
            top: assetValueMenu.top
          }}
        >
          <div className="max-h-56 overflow-y-auto p-1">
            {(() => {
              const currentValue = getAssetPropertyValue(assetValueMenuFile, assetValueMenuProperty);
              const selected = Array.isArray(currentValue)
                ? currentValue
                : String(currentValue || '').split(',').map((item) => item.trim()).filter(Boolean);
              return (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      updateAssetPropertyValue(assetValueMenuFile.id, assetValueMenuProperty.id, assetValueMenuProperty.type === 'multi_select' ? [] : '');
                      setAssetValueMenu(null);
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[#777b80] transition hover:bg-[#f6f6f4]"
                  >
                    <span>空</span>
                    {!currentValue || (Array.isArray(currentValue) && currentValue.length === 0) ? <span>✓</span> : null}
                  </button>
                  {(assetValueMenuProperty.options || []).map((option) => {
                    const isSelected = assetValueMenuProperty.type === 'multi_select'
                      ? selected.includes(option)
                      : String(currentValue || '') === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          if (assetValueMenuProperty.type === 'multi_select') {
                            const next = isSelected ? selected.filter((item) => item !== option) : [...selected, option];
                            updateAssetPropertyValue(assetValueMenuFile.id, assetValueMenuProperty.id, next);
                            return;
                          }
                          updateAssetPropertyValue(assetValueMenuFile.id, assetValueMenuProperty.id, option);
                          setAssetValueMenu(null);
                        }}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition hover:bg-[#f6f6f4]"
                      >
                        <span className="truncate rounded-full bg-[#f1f1ef] px-2 py-0.5 text-xs text-[#34373c]">{option}</span>
                        {isSelected ? <span className="text-[#55585d]">✓</span> : null}
                      </button>
                    );
                  })}
                  {!assetValueMenuProperty.options?.length ? (
                    <p className="px-3 py-2 text-xs leading-5 text-[#96999d]">还没有选项，可以在下面直接新增。</p>
                  ) : null}
                </>
              );
            })()}
          </div>
          <div className="border-t border-[#eeeeeb] p-2">
            <div className="flex gap-2">
              <input
                value={propertyOptionDrafts[assetValueMenuProperty.id] || ''}
                onChange={(event) => setPropertyOptionDrafts((drafts) => ({ ...drafts, [assetValueMenuProperty.id]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const option = propertyOptionDrafts[assetValueMenuProperty.id]?.trim();
                    if (!option) return;
                    addAssetPropertyOption(assetValueMenuProperty, option);
                    updateAssetPropertyValue(
                      assetValueMenuFile.id,
                      assetValueMenuProperty.id,
                      assetValueMenuProperty.type === 'multi_select'
                        ? [...new Set([...(Array.isArray(getAssetPropertyValue(assetValueMenuFile, assetValueMenuProperty)) ? getAssetPropertyValue(assetValueMenuFile, assetValueMenuProperty) as string[] : []), option])]
                        : option
                    );
                  }
                }}
                placeholder="新增选项"
                className="h-9 min-w-0 flex-1 rounded-xl border border-[#eeeeeb] px-3 text-sm outline-none transition focus:border-[#b9bab2]"
              />
              <button
                type="button"
                onClick={() => {
                  const option = propertyOptionDrafts[assetValueMenuProperty.id]?.trim();
                  if (!option) return;
                  addAssetPropertyOption(assetValueMenuProperty, option);
                  updateAssetPropertyValue(
                    assetValueMenuFile.id,
                    assetValueMenuProperty.id,
                    assetValueMenuProperty.type === 'multi_select'
                      ? [...new Set([...(Array.isArray(getAssetPropertyValue(assetValueMenuFile, assetValueMenuProperty)) ? getAssetPropertyValue(assetValueMenuFile, assetValueMenuProperty) as string[] : []), option])]
                      : option
                  );
                }}
                className="h-9 rounded-xl bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black"
              >
                添加
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;
  const workbenchPropertyAddMenu = isWorkbenchPropertyMenuOpen && workbenchPropertyMenuPosition
    ? createPortal(
        <div
          ref={workbenchPropertyMenuRef}
          className="fixed z-[80] flex w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-[#e6e6e1] bg-white text-sm text-[#202124] shadow-[0_22px_60px_rgba(32,33,36,0.14)]"
          style={{
            left: workbenchPropertyMenuPosition.left,
            top: workbenchPropertyMenuPosition.top,
            maxHeight: `min(620px, calc(100vh - ${workbenchPropertyMenuPosition.top + 16}px))`
          }}
        >
          <div className="shrink-0 space-y-2 border-b border-[#eeeeeb] p-4 pb-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[#777b80]">属性名称</span>
              <input
                ref={customPropertyNameInputRef}
                value={customPropertyDraft.name}
                onChange={(event) => setCustomPropertyDraft((draft) => ({ ...draft, name: event.target.value }))}
                placeholder="例如：考试重点、资料链接、负责人"
                className="h-10 w-full rounded-xl border border-transparent bg-[#f7f7f5] px-3 text-sm outline-none transition focus:border-[#b9bab2] focus:bg-white"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[#777b80]">属性类型</span>
              <select
                value={customPropertyDraft.type}
                onChange={(event) => setCustomPropertyDraft((draft) => ({ ...draft, type: event.target.value as WorkbenchPropertyType }))}
                className="h-10 w-full rounded-xl border border-[#eeeeeb] bg-white px-3 text-sm text-[#202124] outline-none transition focus:border-[#b9bab2] focus:shadow-[0_0_0_4px_rgba(32,33,36,0.04)]"
              >
                {WORKBENCH_PROPERTY_TYPES.map((item) => (
                  <option key={item.type} value={item.type}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <p className="px-1 pb-2 text-xs font-medium text-[#777b80]">推荐属性</p>
            <div className="grid grid-cols-2 gap-1 pb-1">
              {WORKBENCH_PROPERTY_PRESETS.map((property) => {
                const meta = getWorkbenchPropertyTypeMeta(property.type);
                return (
                  <button
                    key={property.id}
                    type="button"
                    onClick={() => addWorkbenchProperty({ ...property, name: customPropertyDraft.name.trim() || property.name })}
                    className="flex items-center justify-between rounded-xl px-3 py-2 text-left transition hover:bg-[#f6f6f4]"
                  >
                    <span className="truncate">{property.name}</span>
                    <span className="text-xs text-[#96999d]">{meta.label}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={startCustomWorkbenchProperty}
                className="flex items-center justify-between rounded-xl px-3 py-2 text-left transition hover:bg-[#f6f6f4]"
              >
                <span className="truncate">自定义</span>
                <span className="text-xs text-[#96999d]">文本</span>
              </button>
            </div>
            <p className="px-1 pt-4 pb-2 text-xs font-medium text-[#777b80]">更多属性类型</p>
            <div className="grid grid-cols-2 gap-1">
              {WORKBENCH_PROPERTY_TYPES.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => setCustomPropertyDraft((draft) => ({ ...draft, type: item.type }))}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-[#f6f6f4] ${
                    customPropertyDraft.type === item.type ? 'bg-[#f1f1ef]' : ''
                  }`}
                >
                  <span className="w-8 text-lg text-[#8a8e94]">{item.icon}</span>
                  <span className="font-medium">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="shrink-0 border-t border-[#eeeeeb] bg-white p-3">
            <button
              type="button"
              onClick={addCustomWorkbenchProperty}
              className="h-9 w-full rounded-xl bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black disabled:opacity-50"
              disabled={!customPropertyDraft.name.trim()}
            >
              创建属性
            </button>
          </div>
        </div>,
        document.body
      )
    : null;
  const workbenchPropertyEditor = editingWorkbenchProperty && workbenchPropertyEditorPosition
    ? createPortal(
        <div
          ref={workbenchPropertyEditorRef}
          className="fixed z-[80] w-[340px] rounded-2xl border border-[#e6e6e1] bg-white p-2 text-sm text-[#202124] shadow-[0_22px_60px_rgba(32,33,36,0.14)]"
          style={{
            left: workbenchPropertyEditorPosition.left,
            top: workbenchPropertyEditorPosition.top
          }}
        >
          <div className="space-y-2 p-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[#777b80]">属性名称</span>
              <input
                defaultValue={editingWorkbenchProperty.name}
                disabled={editingWorkbenchProperty.source === 'system'}
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (name && name !== editingWorkbenchProperty.name) {
                    void updateWorkbenchProperty(editingWorkbenchProperty.id, { name });
                  }
                }}
                className="h-10 w-full rounded-xl border border-[#eeeeeb] bg-white px-3 text-sm outline-none transition disabled:bg-[#f7f7f5] disabled:text-[#96999d] focus:border-[#b9bab2] focus:shadow-[0_0_0_4px_rgba(32,33,36,0.04)]"
              />
            </label>
            <label className="flex items-center justify-between rounded-xl px-3 py-2.5 transition hover:bg-[#f6f6f4]">
              <span>
                <span className="block text-sm font-medium text-[#34373c]">属性可见性</span>
                <span className="mt-0.5 block text-xs text-[#96999d]">控制这一列是否显示在学习现场列表里。</span>
              </span>
              <input
                type="checkbox"
                checked={editingWorkbenchProperty.visible}
                onChange={(event) => void updateWorkbenchProperty(editingWorkbenchProperty.id, { visible: event.target.checked })}
                className="h-4 w-4 rounded border-[#d6d6d1]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[#777b80]">属性类型</span>
              <select
                value={editingWorkbenchProperty.type}
              disabled={editingWorkbenchProperty.source === 'system'}
              onChange={(event) => void updateWorkbenchProperty(editingWorkbenchProperty.id, { type: event.target.value as WorkbenchPropertyType })}
              className="h-10 w-full rounded-xl border border-[#eeeeeb] bg-white px-3 text-sm text-[#202124] outline-none transition disabled:bg-[#f7f7f5] disabled:text-[#96999d] focus:border-[#b9bab2] focus:shadow-[0_0_0_4px_rgba(32,33,36,0.04)]"
            >
                {WORKBENCH_PROPERTY_TYPES.map((item) => (
                  <option key={item.type} value={item.type}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>
          {['select', 'multi_select', 'status'].includes(editingWorkbenchProperty.type) ? (
            <div className="border-t border-[#eeeeeb] p-2">
              <p className="mb-2 text-xs font-medium text-[#777b80]">选项</p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {(editingWorkbenchProperty.options || []).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      const nextOptions = (editingWorkbenchProperty.options || []).filter((item) => item !== option);
                      void updateWorkbenchProperty(editingWorkbenchProperty.id, { options: nextOptions });
                    }}
                    className="rounded-full bg-[#f1f1ef] px-2.5 py-1 text-xs text-[#55585d] transition hover:bg-[#ffe8e8] hover:text-[#b42318]"
                    title="点击移除选项"
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={propertyOptionDrafts[editingWorkbenchProperty.id] || ''}
                  onChange={(event) => setPropertyOptionDrafts((drafts) => ({ ...drafts, [editingWorkbenchProperty.id]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void addWorkbenchPropertyOption(editingWorkbenchProperty);
                    }
                  }}
                  placeholder="新增选项"
                  className="h-9 min-w-0 flex-1 rounded-xl border border-[#eeeeeb] px-3 text-sm outline-none transition focus:border-[#b9bab2]"
                />
                <button
                  type="button"
                  onClick={() => void addWorkbenchPropertyOption(editingWorkbenchProperty)}
                  className="h-9 rounded-xl bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black"
                >
                  添加
                </button>
              </div>
            </div>
          ) : null}
          <div className="border-t border-[#eeeeeb] p-1">
            {editingWorkbenchProperty.source === 'system' ? (
              <p className="px-2 py-2 text-xs leading-5 text-[#96999d]">系统属性用于展示课程现场的基础信息，不能删除或改类型。</p>
            ) : (
              <button
                type="button"
                onClick={() => void deleteWorkbenchProperty(editingWorkbenchProperty)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-[#b42318] transition hover:bg-[#fff1f1]"
              >
                <Trash2 className="h-4 w-4" />
                删除属性
              </button>
            )}
          </div>
        </div>,
        document.body
      )
    : null;
  const assetPropertyEditor = editingAssetProperty && assetPropertyEditorPosition
    ? createPortal(
        <div
          ref={assetPropertyEditorRef}
          className="fixed z-[80] w-[340px] rounded-2xl border border-[#e6e6e1] bg-white p-2 text-sm text-[#202124] shadow-[0_22px_60px_rgba(32,33,36,0.14)]"
          style={{
            left: assetPropertyEditorPosition.left,
            top: assetPropertyEditorPosition.top
          }}
        >
          <div className="space-y-2 p-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[#777b80]">属性名称</span>
              <input
                defaultValue={editingAssetProperty.name}
                disabled={editingAssetProperty.source === 'system'}
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (name && name !== editingAssetProperty.name) {
                    updateAssetProperty(editingAssetProperty.id, { name });
                  }
                }}
                className="h-10 w-full rounded-xl border border-[#eeeeeb] bg-white px-3 text-sm outline-none transition disabled:bg-[#f7f7f5] disabled:text-[#96999d] focus:border-[#b9bab2] focus:shadow-[0_0_0_4px_rgba(32,33,36,0.04)]"
              />
            </label>
            <label className="flex items-center justify-between rounded-xl px-3 py-2.5 transition hover:bg-[#f6f6f4]">
              <span>
                <span className="block text-sm font-medium text-[#34373c]">属性可见性</span>
                <span className="mt-0.5 block text-xs text-[#96999d]">控制这一列是否显示在课程资产列表里。</span>
              </span>
              <input
                type="checkbox"
                checked={editingAssetProperty.visible !== false}
                onChange={(event) => updateAssetProperty(editingAssetProperty.id, { visible: event.target.checked })}
                className="h-4 w-4 rounded border-[#d6d6d1]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[#777b80]">属性类型</span>
              <select
                value={editingAssetProperty.type || 'text'}
                disabled={editingAssetProperty.source === 'system'}
                onChange={(event) => updateAssetProperty(editingAssetProperty.id, { type: event.target.value as WorkbenchPropertyType })}
                className="h-10 w-full rounded-xl border border-[#eeeeeb] bg-white px-3 text-sm text-[#202124] outline-none transition disabled:bg-[#f7f7f5] disabled:text-[#96999d] focus:border-[#b9bab2] focus:shadow-[0_0_0_4px_rgba(32,33,36,0.04)]"
              >
                {WORKBENCH_PROPERTY_TYPES.map((item) => (
                  <option key={item.type} value={item.type}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>
          {['select', 'multi_select', 'status'].includes(editingAssetProperty.type || '') ? (
            <div className="border-t border-[#eeeeeb] p-2">
              <p className="mb-2 text-xs font-medium text-[#777b80]">选项</p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {(editingAssetProperty.options || []).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      const nextOptions = (editingAssetProperty.options || []).filter((item) => item !== option);
                      updateAssetProperty(editingAssetProperty.id, { options: nextOptions });
                    }}
                    className="rounded-full bg-[#f1f1ef] px-2.5 py-1 text-xs text-[#55585d] transition hover:bg-[#ffe8e8] hover:text-[#b42318]"
                    title="点击移除选项"
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={propertyOptionDrafts[editingAssetProperty.id] || ''}
                  onChange={(event) => setPropertyOptionDrafts((drafts) => ({ ...drafts, [editingAssetProperty.id]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addAssetPropertyOption(editingAssetProperty);
                    }
                  }}
                  placeholder="新增选项"
                  className="h-9 min-w-0 flex-1 rounded-xl border border-[#eeeeeb] px-3 text-sm outline-none transition focus:border-[#b9bab2]"
                />
                <button
                  type="button"
                  onClick={() => addAssetPropertyOption(editingAssetProperty)}
                  className="h-9 rounded-xl bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black"
                >
                  添加
                </button>
              </div>
            </div>
          ) : null}
          <div className="border-t border-[#eeeeeb] p-1">
            {editingAssetProperty.source === 'system' ? (
              <p className="px-2 py-2 text-xs leading-5 text-[#96999d]">系统属性用于展示课程资产的基础信息，不能删除或改类型。</p>
            ) : (
              <button
                type="button"
                onClick={() => deleteAssetProperty(editingAssetProperty)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-[#b42318] transition hover:bg-[#fff1f1]"
              >
                <Trash2 className="h-4 w-4" />
                删除属性
              </button>
            )}
          </div>
        </div>,
        document.body
      )
    : null;
  const workbenchPreviewPanel = previewWorkbench && previewPosition
    ? createPortal(
        <div
          className="pointer-events-none fixed z-[100] w-[280px] animate-[workspacePreviewIn_150ms_ease-out] rounded-[22px] border border-[#e6e6e1] bg-white/95 p-4 text-[#202124] shadow-[0_24px_60px_rgba(32,33,36,0.14)] backdrop-blur"
          style={{ left: previewPosition.left, top: previewPosition.top }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-[#96999d]">学习现场</p>
              <h3 className="mt-1 truncate text-base font-semibold tracking-[-0.01em]">{previewWorkbench.title}</h3>
            </div>
            <span className="shrink-0 rounded-full bg-[#f6f6f4] px-2 py-1 text-[11px] text-[#777b80]">{previewWorkbench.updatedAt}</span>
          </div>
          <p className="mt-3 line-clamp-3 text-sm leading-6 text-[#55585d]">
            {getWorkbenchDescription(previewWorkbench) || getInferredWorkbenchTopic(previewWorkbench)}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-[#777b80]">
            <span className="rounded-full bg-[#f6f6f4] px-2 py-1">{previewWorkbench.panelCount} 面板</span>
            <span className="rounded-full bg-[#f6f6f4] px-2 py-1">{getWorkbenchResourceCount(previewWorkbench.id)} 资源</span>
          </div>
        </div>,
        document.body
      )
    : null;
  const actionMenuWorkbench = openWorkbenchMenuId
    ? workbenchItems.find((workbench) => workbench.id === openWorkbenchMenuId) || null
    : null;
  const workbenchActionMenu = actionMenuWorkbench && workbenchMenuPosition
    ? createPortal(
        <div
          ref={workbenchMenuRef}
          className="fixed z-[120] min-w-40 animate-[workspacePreviewIn_120ms_ease-out] rounded-2xl border border-[#e6e6e1] bg-white p-1 text-sm shadow-[0_20px_50px_rgba(32,33,36,0.14)]"
          style={{ left: workbenchMenuPosition.left, top: workbenchMenuPosition.top }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void deleteWorkbench(actionMenuWorkbench.id)}
            disabled={deletingWorkbenchId === actionMenuWorkbench.id}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[#b42318] transition hover:bg-[#fff1f1] disabled:pointer-events-none disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            {deletingWorkbenchId === actionMenuWorkbench.id ? '删除中' : '删除'}
          </button>
        </div>,
        document.body
      )
    : null;
  const assetActionMenu = actionMenuAsset && assetMenuPosition
    ? createPortal(
        <div
          ref={assetMenuRef}
          className="fixed z-[120] min-w-40 animate-[workspacePreviewIn_120ms_ease-out] rounded-2xl border border-[#e6e6e1] bg-white p-1 text-sm shadow-[0_20px_50px_rgba(32,33,36,0.14)]"
          style={{ left: assetMenuPosition.left, top: assetMenuPosition.top }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setOpenAssetMenuId(null);
              setAssetMenuPosition(null);
              void openFileInWorkbench(actionMenuAsset.id);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[#34373c] transition hover:bg-[#f6f6f4]"
          >
            <ChevronRight className="h-4 w-4" />
            打开
          </button>
          <button
            type="button"
            onClick={() => void deleteCourseAsset(actionMenuAsset)}
            disabled={deletingAssetId === actionMenuAsset.id}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[#b42318] transition hover:bg-[#fff1f1] disabled:pointer-events-none disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            {deletingAssetId === actionMenuAsset.id ? '删除中' : '删除'}
          </button>
        </div>,
        document.body
      )
    : null;
  return (
    <div className="workspace-shell flex min-h-0 flex-1 flex-col overflow-hidden bg-[#fbfbfa] text-[#202124] lg:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-[#e8e8e4] bg-[#f6f6f4] px-3 py-3 lg:h-full lg:w-[272px] lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/workspaces')}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#666a70] transition hover:bg-[#eeeeeb] hover:text-[#202124]"
            title="Back to workspaces"
            aria-label="Back to workspaces"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-[#202124]">{overview.courseName}</h1>
            <p className="truncate text-xs text-[#777b80]">{overview.major}</p>
          </div>
        </div>
        {overview.description ? (
          <p className="mt-3 hidden text-xs leading-5 text-[#666a70] lg:line-clamp-3">{overview.description}</p>
        ) : null}
        <dl className="mt-3 hidden grid-cols-3 gap-2 lg:grid">
          {statusItems.map((item) => (
            <div key={item.label} className="min-w-0 rounded-lg bg-white/70 px-2 py-2">
              <dt className="truncate text-[10px] text-[#96999d]">{item.label}</dt>
              <dd className="mt-1 truncate text-xs font-medium text-[#202124]">{item.value}</dd>
            </div>
          ))}
        </dl>
        <nav className="mt-3 flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {workspaceViews.map((view) => {
            const Icon = view.icon;
            const isActive = activeView === view.id;
            return (
              <div key={view.id} className="shrink-0 lg:w-full">
                <button
                  onClick={() => setActiveView(view.id)}
                  className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition lg:w-full ${
                    isActive
                      ? 'bg-white text-[#202124] shadow-[0_1px_3px_rgba(32,33,36,0.08)]'
                      : 'text-[#666a70] hover:bg-[#eeeeeb] hover:text-[#202124]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="whitespace-nowrap">{view.label}</span>
                </button>
                {view.id === 'intelligence' ? (
                  <div className={`${activeView === 'intelligence' ? 'flex' : 'hidden'} mt-1 gap-1 pl-0 lg:block lg:space-y-0.5 lg:pl-3`}>
                    {learningIntelligenceSectionItems.map((item) => {
                      const SubIcon = item.icon;
                      const selected = activeView === 'intelligence' && activeIntelligenceSection === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setActiveView('intelligence');
                            setActiveIntelligenceSection(item.id);
                          }}
                          className={`flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-left text-xs font-medium transition lg:w-full ${
                            selected
                              ? 'bg-white/80 text-[#202124]'
                              : 'text-[#777b80] hover:bg-[#eeeeeb] hover:text-[#202124]'
                          }`}
                          title={item.description}
                        >
                          <SubIcon className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
        <div className="mt-auto hidden gap-2 pt-4 lg:grid">
          <button
            onClick={handleUpload}
            className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#eeeeeb]"
          >
            <Upload className="h-4 w-4" />
            上传资料
          </button>
          <button
            onClick={startInlineWorkbenchCreate}
            className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#eeeeeb]"
          >
            <Plus className="h-4 w-4" />
            新建学习现场
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#eeeeeb]"
          >
            <Settings className="h-4 w-4" />
            设置
          </button>
        </div>
      </aside>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <main className="w-full px-4 py-5 sm:px-6 lg:px-8">
          {activeView === 'status' ? (
            <section>
            <div className="grid gap-4">
              <article className="rounded-xl border border-[#e6e6e1] bg-white p-5">
                {latestWorkbenchItem ? (
                  <>
                    <p className="text-xs text-[#96999d]">最近学习：{courseHomeSummary?.latestTopic || latestWorkbenchItem.title}</p>
                    <h3 className="mt-2 text-lg font-semibold text-[#202124]">{latestWorkbenchItem.title}</h3>
                    <p className="mt-1 text-sm text-[#777b80]">上次更新：{latestWorkbenchItem.updatedAt}</p>
                    <p className="mt-2 text-sm leading-6 text-[#55585d]">
                      {courseHomeSummary?.latestActivitySummary || latestWorkbenchItem.description || '正在根据最近学习现场整理摘要。'}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={() => openWorkbenchWithEvent(latestWorkbenchItem, 'course_home_latest')} className="inline-flex h-9 items-center rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black">继续上次现场</button>
                      <button
                        onClick={() => openTerminalWithPrompt(`请结合当前 workspace 和「${latestWorkbenchItem.title}」这个学习现场，帮我总结上次进展、关键结论和下一步建议。`)}
                        className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef]"
                      >
                        总结这个现场
                      </button>
                      <button onClick={startInlineWorkbenchCreate} className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef]">新建学习现场</button>
                    </div>
                  </>
                ) : (
                  <div className="mt-2">
                    <p className="text-sm text-[#777b80]">还没有学习现场，先创建一个开始学习工作流。</p>
                    <button onClick={startInlineWorkbenchCreate} className="mt-3 inline-flex h-9 items-center rounded-lg bg-[#202124] px-3 text-sm font-medium text-white transition hover:bg-black">新建学习现场</button>
                  </div>
                )}
              </article>
              <article className="rounded-xl border border-[#e6e6e1] bg-white p-5">
                <h3 className="text-sm font-semibold text-[#202124]">最近学习现场</h3>
                <div className="mt-3 grid gap-2">
                  {recentWorkbenchItems.length ? recentWorkbenchItems.map((item) => (
                    <button key={item.id} onClick={() => openWorkbenchWithEvent(item, 'course_home_recent')} className="flex items-center justify-between rounded-lg px-3 py-2 text-left transition hover:bg-[#f6f6f4]">
                      <span>
                        <span className="block text-sm font-medium text-[#34373c]">{item.title}</span>
                        <span className="block text-xs text-[#96999d]">{item.updatedAt}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-[#96999d]" />
                    </button>
                  )) : <p className="text-sm text-[#777b80]">暂无学习现场。</p>}
                </div>
              </article>
              <div className="grid gap-4 lg:grid-cols-3">
                <article className="rounded-xl border border-[#e6e6e1] bg-white p-4">
                  <h3 className="text-sm font-semibold text-[#202124]">你现在在课程里的位置</h3>
                  <div className="mt-2 space-y-2">
                    {courseHomeLoading ? (
                      <p className="text-sm leading-6 text-[#777b80]">正在整理课程位置...</p>
                    ) : courseHomeSummary?.coursePosition?.length ? (
                      courseHomeSummary.coursePosition.map((step) => <p key={step} className="text-sm leading-6 text-[#55585d]">{step}</p>)
                    ) : (
                      <p className="text-sm leading-6 text-[#777b80]">打开一个学习现场后，这里会显示更具体的位置。</p>
                    )}
                  </div>
                </article>
                <article className="rounded-xl border border-[#e6e6e1] bg-white p-4">
                  <h3 className="text-sm font-semibold text-[#202124]">最近可以顺手巩固</h3>
                  <div className="mt-2 space-y-2">
                    {courseHomeLoading ? (
                      <p className="text-sm leading-6 text-[#777b80]">正在结合资料和学习现场生成提醒...</p>
                    ) : courseHomeSummary?.reinforcementReminders?.length ? (
                      courseHomeSummary.reinforcementReminders.map((item) => (
                        <button
                          key={item.label}
                          onClick={() => openTerminalWithPrompt(item.prompt)}
                          className="block w-full rounded-lg px-2 py-1.5 text-left text-sm leading-6 text-[#55585d] transition hover:bg-[#f6f6f4] hover:text-[#202124]"
                        >
                          {item.label}
                        </button>
                      ))
                    ) : (
                      <p className="text-sm leading-6 text-[#777b80]">目前还没有足够的学习记录可生成提醒。</p>
                    )}
                  </div>
                </article>
                <article className="rounded-xl border border-[#e6e6e1] bg-white p-4">
                  <h3 className="text-sm font-semibold text-[#202124]">AI 可以帮你继续做</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(courseHomeSummary?.aiActions || []).map((item) => (
                      <button key={item.label} onClick={() => openTerminalWithPrompt(item.prompt)} className="inline-flex h-8 items-center rounded-lg bg-[#f6f6f4] px-3 text-xs font-medium text-[#55585d] transition hover:bg-[#eeeeeb]">
                        {item.label}
                      </button>
                    ))}
                    {!courseHomeLoading && !courseHomeSummary?.aiActions?.length ? (
                      <p className="text-sm leading-6 text-[#777b80]">课程上下文整理好后会出现可直接发送给 AI 的操作。</p>
                    ) : null}
                  </div>
                </article>
              </div>
            </div>
          </section>
          ) : null}
          {activeView === 'workbenches' ? (
            <section>
              <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-[#202124]">学习现场</h2>
                  <p className="mt-1 text-sm leading-6 text-[#777b80]">
                    像浏览一组 Notion 数据库一样浏览你的学习现场。
                  </p>
                  <p className="mt-1 text-xs text-[#96999d]">
                    {filteredWorkbenchItems.length} / {workbenchItems.length}
                  </p>
                </div>
                <button
                  onClick={startInlineWorkbenchCreate}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-[#202124] px-4 text-sm font-medium text-white shadow-[0_8px_24px_rgba(32,33,36,0.12)] transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_12px_30px_rgba(32,33,36,0.16)] active:translate-y-0"
                >
                  <Plus className="h-4 w-4" />
                  新建工作台
                </button>
              </div>
              <div ref={workbenchToolbarRef} className="mb-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWorkbenchViewMode('list')}
                  className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-all duration-200 ${
                    workbenchViewMode === 'list'
                      ? 'bg-[#f1f1ef] text-[#202124]'
                      : 'text-[#777b80] hover:bg-[#f6f6f4] hover:text-[#202124]'
                  }`}
                  aria-pressed={workbenchViewMode === 'list'}
                >
                  <List className="h-4 w-4" />
                  列表
                </button>
                <button
                  type="button"
                  onClick={() => setWorkbenchViewMode('grid')}
                  className={`inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-all duration-200 ${
                    workbenchViewMode === 'grid'
                      ? 'bg-[#f1f1ef] text-[#202124]'
                      : 'text-[#777b80] hover:bg-[#f6f6f4] hover:text-[#202124]'
                  }`}
                  aria-pressed={workbenchViewMode === 'grid'}
                >
                  <LayoutGrid className="h-4 w-4" />
                  画廊
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setIsWorkbenchSearchOpen((value) => !value);
                        setIsWorkbenchFiltersOpen(false);
                      }}
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200 ${
                        isWorkbenchSearchOpen || workbenchQuery.trim()
                          ? 'bg-[#f1f1ef] text-[#202124]'
                          : 'text-[#8a8e94] hover:bg-[#f6f6f4] hover:text-[#202124]'
                      }`}
                      aria-label="搜索"
                      title="搜索"
                    >
                      <Search className="h-4 w-4" />
                    </button>
                    <div className={`absolute right-0 top-12 z-[95] overflow-hidden rounded-2xl border border-[#e6e6e1] bg-white shadow-[0_18px_40px_rgba(32,33,36,0.12)] transition-all duration-200 ${isWorkbenchSearchOpen ? 'visible w-72 opacity-100' : 'invisible w-0 opacity-0'}`}>
                      <label className="relative block p-2">
                        <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#96999d]" />
                        <input
                          value={workbenchQuery}
                          onChange={(event) => setWorkbenchQuery(event.target.value)}
                          placeholder="搜索现场标题或主题"
                          className="h-10 w-full rounded-xl border border-[#deded9] bg-white pl-9 pr-3 text-sm text-[#202124] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[#a4a6aa] focus:border-[#b9bab2] focus:shadow-[0_0_0_4px_rgba(32,33,36,0.04)]"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="relative" ref={workbenchColumnsMenuRef}>
                    <button
                      type="button"
                      onClick={() => {
                        setIsWorkbenchColumnsOpen((value) => !value);
                        setIsWorkbenchSearchOpen(false);
                        setIsWorkbenchFiltersOpen(false);
                      }}
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200 ${
                        isWorkbenchColumnsOpen || workbenchTableConfig.properties.some((property) => !property.visible)
                          ? 'bg-[#f1f1ef] text-[#202124]'
                          : 'text-[#8a8e94] hover:bg-[#f6f6f4] hover:text-[#202124]'
                      }`}
                      aria-label="列管理"
                      title="列管理"
                    >
                      <List className="h-4 w-4" />
                    </button>
                    <div className={`absolute right-0 top-12 z-[95] w-80 overflow-hidden rounded-2xl border border-[#e6e6e1] bg-white shadow-[0_18px_40px_rgba(32,33,36,0.12)] transition-all duration-200 ${isWorkbenchColumnsOpen ? 'visible translate-y-0 opacity-100' : 'invisible -translate-y-1 opacity-0'}`}>
                      <div className="border-b border-[#eeeeeb] px-4 py-3">
                        <p className="text-sm font-semibold text-[#202124]">列管理</p>
                        <p className="mt-1 text-xs text-[#96999d]">显示、隐藏或调整学习现场列表里的属性列。</p>
                      </div>
                      <div className="max-h-80 overflow-y-auto p-2">
                        {[...workbenchTableConfig.properties]
                          .sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0))
                          .map((property, index, arr) => (
                            <div key={property.id} className="group/column flex items-center gap-2 rounded-xl px-2 py-2 transition hover:bg-[#f6f6f4]">
                              <input
                                type="checkbox"
                                checked={property.visible}
                                onChange={(event) => void updateWorkbenchProperty(property.id, { visible: event.target.checked })}
                                className="h-4 w-4 rounded border-[#d6d6d1]"
                              />
                              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#34373c]">{property.name}</span>
                              <span className="text-xs text-[#96999d]">{property.widthPx || 220}px</span>
                              <button
                                type="button"
                                onClick={() => void reorderWorkbenchProperty(property.id, -1)}
                                disabled={index === 0}
                                className="h-7 w-7 rounded-lg text-[#8a8e94] opacity-0 transition hover:bg-[#eeeeeb] disabled:opacity-20 group-hover/column:opacity-100"
                                title="上移"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => void reorderWorkbenchProperty(property.id, 1)}
                                disabled={index === arr.length - 1}
                                className="h-7 w-7 rounded-lg text-[#8a8e94] opacity-0 transition hover:bg-[#eeeeeb] disabled:opacity-20 group-hover/column:opacity-100"
                                title="下移"
                              >
                                ↓
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setIsWorkbenchFiltersOpen((value) => !value);
                        setIsWorkbenchSearchOpen(false);
                      }}
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200 ${
                        isWorkbenchFiltersOpen || workbenchFilter !== 'all' || workbenchSort !== 'updated_desc'
                          ? 'bg-[#f1f1ef] text-[#202124]'
                          : 'text-[#8a8e94] hover:bg-[#f6f6f4] hover:text-[#202124]'
                      }`}
                      aria-label="筛选"
                      title="筛选"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                    </button>
                    <div className={`absolute right-0 top-12 z-[95] w-72 overflow-hidden rounded-2xl border border-[#e6e6e1] bg-white shadow-[0_18px_40px_rgba(32,33,36,0.12)] transition-all duration-200 ${isWorkbenchFiltersOpen ? 'visible opacity-100' : 'invisible opacity-0'}`}>
                      <div className="space-y-3 p-3">
                        <div>
                          <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">筛选</p>
                          <select
                            value={workbenchFilter}
                            onChange={(event) => setWorkbenchFilter(event.target.value as WorkbenchFilter)}
                            className="h-10 w-full rounded-xl border border-[#deded9] bg-white px-3 text-sm text-[#202124] outline-none transition-[border-color,box-shadow] duration-200 focus:border-[#b9bab2] focus:shadow-[0_0_0_4px_rgba(32,33,36,0.04)]"
                          >
                            <option value="all">全部现场</option>
                            <option value="active">有内容面板</option>
                            <option value="recent">最近 7 天</option>
                          </select>
                        </div>
                        <div>
                          <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-[#96999d]">排序</p>
                          <div className="flex items-center gap-2">
                            <ArrowUpDown className="h-4 w-4 text-[#8a8e94]" />
                            <select
                              value={workbenchSort}
                              onChange={(event) => setWorkbenchSort(event.target.value as WorkbenchSort)}
                              className="h-10 flex-1 rounded-xl border border-[#deded9] bg-white px-3 text-sm text-[#202124] outline-none transition-[border-color,box-shadow] duration-200 focus:border-[#b9bab2] focus:shadow-[0_0_0_4px_rgba(32,33,36,0.04)]"
                            >
                              <option value="updated_desc">最近更新</option>
                              <option value="updated_asc">最早更新</option>
                              <option value="title_asc">标题 A-Z</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {workbenchActionError ? (
                <div className="mb-4 rounded-xl border border-[#f4c7c3] bg-[#fff7f6] px-4 py-3 text-sm text-[#b42318]">
                  {workbenchActionError}
                </div>
              ) : null}
              <div className={workbenchViewMode === 'grid' ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3' : ''}>
                {filteredWorkbenchItems.length === 0 && !creatingWorkbenchInline ? (
                  <button
                    onClick={startInlineWorkbenchCreate}
                    className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-[#d8d8d3] bg-white p-5 text-left transition-[transform,background-color,border-color] duration-300 hover:-translate-y-0.5 hover:border-[#cfcfca] hover:bg-[#f6f6f4]"
                  >
                    <BookOpen className="h-5 w-5 text-[#777b80]" />
                    <span>
                      <span className="block text-sm font-medium text-[#34373c]">
                        {workbenchQuery.trim() ? '没有找到匹配的学习现场' : '创建第一个学习现场'}
                      </span>
                      <span className="mt-1 block text-sm text-[#777b80]">
                        {workbenchQuery.trim() ? '可以换一个关键词，或新建一个新的学习现场。' : '把某个具体任务、资料和 AI 辅助集中到一个现场里。'}
                      </span>
                    </span>
                  </button>
                ) : workbenchViewMode === 'list' ? (
                  <div className="overflow-visible">
                    {selectedWorkbenchCount > 0 ? (
                      <div className="mb-3 flex items-center justify-between rounded-2xl border border-[#e6e6e1] bg-white/90 px-3 py-2 text-sm shadow-[0_12px_32px_rgba(32,33,36,0.06)] backdrop-blur">
                        <span className="text-[#55585d]">已选择 {selectedWorkbenchCount} 个学习现场</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setSelectedWorkbenchIds(new Set())}
                            className="h-8 rounded-lg px-2.5 text-sm text-[#666a70] transition hover:bg-[#f1f1ef]"
                          >
                            取消选择
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteSelectedWorkbenches()}
                            disabled={bulkDeletingWorkbenches}
                            className="h-8 rounded-lg px-2.5 text-sm font-medium text-[#b42318] transition hover:bg-[#fff1f1] disabled:opacity-60"
                          >
                            {bulkDeletingWorkbenches ? '删除中' : '删除所选'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className="max-h-[68vh] overflow-auto">
                    <div className="min-w-max" style={{ width: workbenchTableMinWidth }}>
                    <div
                      className="sticky top-0 z-30 grid items-center bg-[#fbfbfa]/95 text-xs font-medium uppercase tracking-[0.14em] text-[#96999d] backdrop-blur"
                      style={{ gridTemplateColumns: workbenchTableGridTemplate }}
                    >
                      <div className="sticky left-0 z-40 flex h-11 items-center gap-3 bg-[#fbfbfa] px-4 normal-case tracking-normal shadow-[8px_0_16px_rgba(32,33,36,0.04)]">
                        <input
                          type="checkbox"
                          checked={allVisibleWorkbenchesSelected}
                          onChange={() => {
                            setSelectedWorkbenchIds((current) => {
                              const next = new Set(current);
                              if (allVisibleWorkbenchesSelected) {
                                filteredWorkbenchItems.forEach((workbench) => next.delete(workbench.id));
                              } else {
                                filteredWorkbenchItems.forEach((workbench) => next.add(workbench.id));
                              }
                              return next;
                            });
                          }}
                          className="h-4 w-4 rounded border-[#d6d6d1]"
                          aria-label="选择当前列表中的学习现场"
                        />
                        <span>名称</span>
                      </div>
                      {visibleWorkbenchProperties.map((property) =>
                        renderNotionPropertyHeader({
                          property,
                          draggingPropertyId: draggingWorkbenchPropertyId,
                          dragOverPropertyId: dragOverWorkbenchPropertyId,
                          resizingPropertyId,
                          onOpenProperty: openWorkbenchPropertyEditor,
                          onResizeStart: beginResizeWorkbenchProperty,
                          onMovePropertyTo: (sourcePropertyId, targetPropertyId) => {
                            void moveWorkbenchPropertyTo(sourcePropertyId, targetPropertyId);
                          },
                          setDraggingPropertyId: setDraggingWorkbenchPropertyId,
                          setDragOverPropertyId: setDragOverWorkbenchPropertyId,
                          resizeLabelPrefix: '调整'
                        })
                      )}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(event) => openWorkbenchPropertyMenu(event.currentTarget)}
                          className="flex h-11 w-full items-center justify-center text-[#8a8e94] transition hover:bg-[#f3f3f1] hover:text-[#55585d]"
                          aria-label="添加属性"
                          title="添加属性"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {creatingWorkbenchInline ? (
                      <div
                        className="relative grid min-h-14 items-center rounded-xl bg-[#fbfbfa] text-sm"
                        style={{ gridTemplateColumns: workbenchTableGridTemplate }}
                      >
                        <div className="sticky left-0 z-20 flex min-w-0 items-center gap-3 bg-[#fbfbfa] px-4 py-2 shadow-[8px_0_16px_rgba(32,33,36,0.03)]">
                          <FileText className="h-5 w-5 shrink-0 text-[#9b9c9a]" />
                          <input
                            ref={inlineWorkbenchTitleRef}
                            value={newWorkbenchTitle}
                            onChange={(event) => setNewWorkbenchTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                submitInlineWorkbenchCreate();
                              }
                              if (event.key === 'Escape') {
                                setCreatingWorkbenchInline(false);
                                setNewWorkbenchTitle('');
                              }
                            }}
                            placeholder="输入新学习现场名称"
                            className="h-9 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-sm font-medium text-[#202124] outline-none ring-1 ring-transparent transition focus:bg-white focus:ring-[#d8d8d3]"
                          />
                          <button
                            type="button"
                            onClick={submitInlineWorkbenchCreate}
                            disabled={!newWorkbenchTitle.trim() || creatingWorkbench}
                            className="inline-flex h-8 shrink-0 items-center rounded-lg px-2.5 text-sm font-medium text-[#34373c] transition hover:bg-[#eeeeeb] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {creatingWorkbench ? '创建中' : '创建'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCreatingWorkbenchInline(false);
                              setNewWorkbenchTitle('');
                            }}
                            className="inline-flex h-8 shrink-0 items-center rounded-lg px-2.5 text-sm text-[#777b80] transition hover:bg-[#eeeeeb]"
                          >
                            取消
                          </button>
                        </div>
                        {visibleWorkbenchProperties.map((property) => (
                          <div key={property.id} className="min-w-0 px-4 py-3 text-[#b3b3af]">
                            {property.name === '状态' ? '准备开始' : ''}
                          </div>
                        ))}
                        <div className="flex items-center justify-center px-3 py-2 text-[#c0c2c5]">
                          <Plus className="h-4 w-4" />
                        </div>
                      </div>
                    ) : null}
                    {filteredWorkbenchItems.map((workbench) => {
                      return (
                        <div
                          key={workbench.id}
                          className="group relative grid min-h-14 cursor-default items-center border-b border-[#eeeeeb] text-sm transition-colors duration-150 last:border-b-0 hover:bg-[#f7f7f5]"
                          style={{ gridTemplateColumns: workbenchTableGridTemplate }}
                        >
                          <div
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              openWorkbenchWithEvent(workbench, 'workbench_table_double_click');
                            }}
                            className="group/name sticky left-0 z-20 flex min-w-0 items-center gap-3 border-r border-[#eeeeeb] bg-[#fbfbfa] px-4 py-3 text-left shadow-[8px_0_16px_rgba(32,33,36,0.03)] transition-colors group-hover:bg-[#f7f7f5]"
                          >
                            <input
                              type="checkbox"
                              checked={selectedWorkbenchIds.has(workbench.id)}
                              onChange={() => toggleWorkbenchSelection(workbench.id)}
                              onClick={(event) => event.stopPropagation()}
                              className="h-4 w-4 shrink-0 rounded border-[#d6d6d1]"
                              aria-label={`选择${workbench.title}`}
                            />
                            <FileText className="h-5 w-5 shrink-0 text-[#9b9c9a]" />
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                onMouseEnter={(event) => openHoverWorkbenchPreview(workbench.id, event)}
                                onMouseLeave={() => closeHoverWorkbenchPreview(workbench.id)}
                                className="truncate font-medium text-[#202124]"
                              >
                                {workbench.title}
                              </span>
                              {workbench.id === latestWorkbenchItem?.id ? (
                                <span className="shrink-0 rounded-full bg-[#f1f1ef] px-2 py-0.5 text-[11px] font-medium text-[#666a70]">最近打开</span>
                              ) : null}
                            </span>
                            <span className="ml-auto flex shrink-0 items-center gap-1 opacity-0 transition group-hover/name:opacity-100 group-focus-within/name:opacity-100">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openWorkbenchWithEvent(workbench, 'workbench_table_open_button');
                                }}
                                className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium text-[#34373c] transition hover:bg-[#eeeeeb]"
                              >
                                打开
                              </button>
                              <span className="relative">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openWorkbenchActionMenu(workbench.id, event.currentTarget);
                                  }}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#8a8e94] outline-none transition hover:bg-[#eeeeeb] hover:text-[#202124] focus:bg-[#eeeeeb]"
                                  aria-label="更多操作"
                                  title="更多操作"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>
                              </span>
                            </span>
                          </div>
                          {visibleWorkbenchProperties.map((property) => (
                            <div
                              key={property.id}
                              onClick={(event) => {
                                if (property.type !== 'ai_summary') event.stopPropagation();
                              }}
                              className="min-w-0 border-r border-[#eeeeeb] px-4 py-2 text-[#666a70] transition-colors hover:bg-white focus-within:bg-white focus-within:shadow-[inset_0_0_0_1px_#d8d8d3]"
                            >
                              {renderWorkbenchPropertyCell(workbench, property)}
                            </div>
                          ))}
                          <div className="flex items-center justify-center px-3 py-2 text-[#c0c2c5]" />
                        </div>
                      );
                    })}
                    {!creatingWorkbenchInline ? (
                      <button
                        type="button"
                        onClick={startInlineWorkbenchCreate}
                        className="mt-2 flex h-11 w-full items-center gap-3 rounded-xl px-4 text-left text-sm text-[#9b9c9a] transition hover:bg-[#f7f7f5] hover:text-[#55585d]"
                      >
                        <Plus className="h-4 w-4" />
                        新建学习现场
                      </button>
                    ) : null}
                    </div>
                    </div>
                  </div>
                ) : (
                  filteredWorkbenchItems.map((workbench) => (
                    <article
                      key={workbench.id}
                      className={`group relative overflow-visible rounded-[24px] border border-[#ebebe7] bg-white p-5 transition-[transform,border-color,box-shadow,background-color] duration-300 ease-out hover:-translate-y-0.5 hover:border-[#dadad5] hover:shadow-[0_18px_45px_rgba(32,33,36,0.07)] ${
                        workbenchViewMode === 'grid' ? 'flex min-h-[240px] flex-col' : ''
                      }`}
                    >
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d8d8d3] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                      <div className={workbenchViewMode === 'grid' ? 'flex flex-1 flex-col' : 'flex flex-wrap items-start justify-between gap-4'}>
                        <div className="min-w-0 flex-1 pr-6">
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedWorkbenchIds.has(workbench.id)}
                              onChange={() => toggleWorkbenchSelection(workbench.id)}
                              onClick={(event) => event.stopPropagation()}
                              className="h-4 w-4 rounded border-[#d6d6d1]"
                              aria-label={`选择${workbench.title}`}
                            />
                            <p
                              onMouseEnter={(event) => openHoverWorkbenchPreview(workbench.id, event)}
                              onMouseLeave={() => closeHoverWorkbenchPreview(workbench.id)}
                              className="truncate text-[18px] font-semibold tracking-[-0.01em] text-[#202124]"
                            >
                              {workbench.title}
                            </p>
                            {workbench.id === latestWorkbenchItem?.id ? (
                              <span className="rounded-full bg-[#f1f1ef] px-2.5 py-1 text-[11px] font-medium text-[#666a70]">最近打开</span>
                            ) : null}
                          </div>
                          {getWorkbenchDescription(workbench) ? (
                            <p className="mt-2 line-clamp-3 text-[15px] leading-6 text-[#666a70]">
                              {getWorkbenchDescription(workbench)}
                            </p>
                          ) : null}
                          <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#777b80]">
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#f6f6f4] px-2.5 py-1.5">
                              <CalendarClock className="h-3.5 w-3.5" />
                              {workbench.updatedAt}
                            </span>
                            <span className="rounded-full bg-[#f6f6f4] px-2.5 py-1.5">{workbench.panelCount} 个面板</span>
                            <span className="rounded-full bg-[#f6f6f4] px-2.5 py-1.5">{getWorkbenchResourceCount(workbench.id)} 个资源</span>
                          </div>
                          <p className="mt-2 text-xs text-[#a0a3a7]">更新时间：{getWorkbenchAbsoluteUpdatedAt(workbench.id)}</p>
                        </div>
                        <div className={`mt-5 flex items-center gap-2 ${workbenchViewMode === 'grid' ? 'mt-auto pt-6' : ''}`}>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              openWorkbenchWithEvent(workbench, 'workbench_grid_continue');
                            }}
                            className="inline-flex h-10 items-center justify-center rounded-full bg-[#202124] px-4 text-sm font-medium text-white transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_10px_22px_rgba(32,33,36,0.16)] active:translate-y-0"
                          >
                            继续
                          </button>
                          <div className="relative ml-auto">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openWorkbenchActionMenu(workbench.id, event.currentTarget);
                              }}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#8a8e94] opacity-0 outline-none transition-[opacity,transform,background-color,color,box-shadow] duration-200 hover:bg-[#f6f6f4] hover:text-[#202124] focus:bg-[#f6f6f4] focus:opacity-100 focus:shadow-[0_0_0_4px_rgba(32,33,36,0.04)] group-hover:opacity-100 group-focus-within:opacity-100 sm:translate-y-0.5 sm:group-hover:translate-y-0"
                              aria-label="更多操作"
                              title="更多操作"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          ) : null}
          {activeView === 'assets' ? (
            <section>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-[#202124]">课程资产</h2>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`flex items-center overflow-hidden rounded-full border border-[#e4e4df] bg-white transition-all duration-200 ${isAssetSearchOpen ? 'w-72 opacity-100' : 'w-10 opacity-100'}`}>
                    <button
                      type="button"
                      onClick={() => setIsAssetSearchOpen((value) => !value)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center text-[#8a8e94] transition hover:bg-[#f6f6f4] hover:text-[#202124]"
                      aria-label="搜索资产"
                      title="搜索资产"
                    >
                      <Search className="h-4 w-4" />
                    </button>
                    <input
                      value={assetQuery}
                      onChange={(event) => setAssetQuery(event.target.value)}
                      className="h-10 min-w-0 flex-1 bg-transparent pr-3 text-sm text-[#202124] outline-none placeholder:text-[#b3b3af]"
                      placeholder="搜索资产"
                    />
                  </div>
                  <button
                    onClick={handleUpload}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#8a8e94] transition hover:bg-[#f6f6f4] hover:text-[#202124]"
                    aria-label="上传"
                    title="上传"
                  >
                    <Upload className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {courseAssetFiles.length > 0 ? (
                <div className="overflow-visible">
                  <div className="max-h-[68vh] overflow-auto">
                    <div className="min-w-max" style={{ width: assetTableMinWidth }}>
                      <div
                        className="sticky top-0 z-30 grid items-center bg-[#fbfbfa]/95 text-xs font-medium uppercase tracking-[0.14em] text-[#96999d] backdrop-blur"
                        style={{ gridTemplateColumns: assetTableGridTemplate }}
                      >
                        <div className="sticky left-0 z-40 flex h-11 items-center gap-3 bg-[#fbfbfa] px-4 normal-case tracking-normal shadow-[8px_0_16px_rgba(32,33,36,0.04)]">
                          <span>名称</span>
                        </div>
                        {visibleAssetProperties.map((property) =>
                          renderNotionPropertyHeader({
                            property,
                            draggingPropertyId: draggingAssetPropertyId,
                            dragOverPropertyId: dragOverAssetPropertyId,
                            resizingPropertyId: assetResizingPropertyId,
                            onOpenProperty: openAssetPropertyEditor,
                            onResizeStart: beginResizeAssetProperty,
                            onMovePropertyTo: moveAssetPropertyTo,
                            setDraggingPropertyId: setDraggingAssetPropertyId,
                            setDragOverPropertyId: setDragOverAssetPropertyId,
                            resizeLabelPrefix: '调整'
                          })
                        )}
                        <button
                          type="button"
                          onClick={(event) => openWorkbenchPropertyMenu(event.currentTarget)}
                          className="flex h-11 w-full items-center justify-center text-[#8a8e94] transition hover:bg-[#f3f3f1] hover:text-[#55585d]"
                          aria-label="添加资产属性"
                          title="添加资产属性"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      {courseAssetFiles.map((file) => {
                        const section = getCourseAssetSection(file);
                        const coverUrl = getCourseAssetCoverUrl(file);
                        const faviconUrl = getCourseAssetFaviconUrl(file);
                        const sectionLabel = getCourseAssetSectionLabel(section);
                        return (
                          <div
                            key={file.id}
                            className="group/asset grid min-h-14 items-center border-b border-[#eeeeeb] text-sm transition-colors duration-150 last:border-b-0 hover:bg-[#f7f7f5]"
                            style={{ gridTemplateColumns: assetTableGridTemplate }}
                          >
                            <button
                              type="button"
                              onClick={() => void openFileInWorkbench(file.id)}
                              className="sticky left-0 z-20 flex min-w-0 items-center gap-3 border-r border-[#eeeeeb] bg-[#fbfbfa] px-4 py-3 text-left shadow-[8px_0_16px_rgba(32,33,36,0.03)] transition-colors group-hover/asset:bg-[#f7f7f5]"
                            >
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#f6f6f4] text-[#7f8388] group-hover/asset:bg-white">
                                {section === 'source' && coverUrl ? (
                                  <img src={coverUrl} alt="" className="h-full w-full object-cover" />
                                ) : section === 'source' && faviconUrl ? (
                                  <img src={faviconUrl} alt="" className="h-4 w-4 rounded-sm" />
                                ) : (
                                  getCourseAssetIcon(file)
                                )}
                              </span>
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate font-medium text-[#202124]">{file.name}</span>
                                <span className="shrink-0 rounded-md bg-[#eef4fb] px-2 py-0.5 text-[11px] font-medium text-[#64748b]">
                                  {sectionLabel}
                                </span>
                              </span>
                            </button>
                            {visibleAssetProperties.map((property) => (
                              <div
                                key={property.id}
                                className="min-w-0 border-r border-[#eeeeeb] px-4 py-2 text-[#777b80] transition-colors hover:bg-white focus-within:bg-white focus-within:shadow-[inset_0_0_0_1px_#d8d8d3]"
                              >
                                {renderAssetPropertyCell(file, property)}
                              </div>
                            ))}
                            <div className="flex items-center justify-center px-3 py-2 text-[#c0c2c5]">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openAssetActionMenu(file, event.currentTarget);
                                }}
                                disabled={deletingAssetId === file.id}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#9a9ea4] opacity-0 transition-all duration-150 hover:bg-white hover:text-[#303338] disabled:opacity-40 group-hover/asset:opacity-100"
                                aria-label="资产操作"
                                title="资产操作"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-[#85898f]">
                  {assetQuery.trim() ? 'No resources match this filter.' : 'No course assets yet.'}
                </div>
              )}
              {(workspace.fileObjects || []).filter((file) => file.nodeType === 'file').length === 0 ? (
                <button
                  onClick={handleUpload}
                  className="mb-4 flex w-full items-center gap-3 rounded-lg border border-dashed border-[#d8d8d3] bg-white p-4 text-left transition hover:bg-[#f6f6f4]"
                >
                  <Upload className="h-5 w-5 text-[#777b80]" />
                  <span>
                    <span className="block text-sm font-medium text-[#34373c]">上传课程资料</span>
                    <span className="mt-1 block text-sm text-[#777b80]">课件、论文、代码和笔记会成为 AI Terminal 的上下文。</span>
                  </span>
                </button>
              ) : null}
            </section>
          ) : null}
          {activeView === 'intelligence' ? (
            <LearningIntelligenceDashboard
              workspaceId={id || ''}
              workbenchId={latestWorkbench?.id}
              workbenches={workbenches.map((workbench) => ({ id: workbench.id, title: workbench.title }))}
              activeSection={activeIntelligenceSection}
              hideSectionNav
              onSectionChange={setActiveIntelligenceSection}
              onOpenWorkbench={(workbenchId) => navigate(`/workbenches/${workbenchId}`)}
              onPlanApplied={fetchWorkspace}
              onOpenTerminal={openTerminalWithPrompt}
            />
          ) : null}
          {activeView === 'terminal' ? (
            <section>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[#202124]">AI Terminal</h2>
              </div>
              <button
                onClick={createChat}
                className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[#34373c] transition hover:bg-[#f1f1ef]"
              >
                <PencilLine className="h-4 w-4" />
                New chat
              </button>
            </div>
            <LearningTerminal
              workspaceId={id || ''}
              sessionId={currentChat?.id}
              workbenchId={latestWorkbench?.id}
              workspaceName={workspace.name}
              major={workspace.major || 'Course'}
              workbenches={workbenchItems}
              fileCount={workspace.fileObjects?.length || 0}
              messages={currentChat?.messages || []}
              onMessagesChange={updateCurrentChatMessages}
              onChatStarted={nameCurrentChat}
              onUploadMaterials={handleUpload}
              onRefresh={fetchWorkspace}
              onWorkbenchCreated={(workbenchId) => {
                recordUiLearningEvent({
                  workbenchId,
                  eventType: 'workbench.opened',
                  object: { type: 'workbench', id: workbenchId, title: 'New learning workbench' },
                  source: { component: 'learning_terminal_created_workbench', route: `/workspaces/${id}` },
                  confidence: 0.7
                });
                navigate(`/workbenches/${workbenchId}`);
              }}
              variant="dashboard"
              initialPrompt={terminalDraftPrompt}
            />
            </section>
          ) : null}
        </main>
      </div>
      {/* Overlays */}
      {workbenchValueEditor}
      {assetValueEditor}
      {workbenchPropertyAddMenu}
      {workbenchPropertyEditor}
      {assetPropertyEditor}
      {workbenchPreviewPanel}
      {workbenchActionMenu}
      {assetActionMenu}
      {previewStyle}
      <WorkspaceSettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialData={{ 
          name: workspace.name,
          description: workspace.description || '',
          major: workspace.major || ''
        }}
        onSave={handleUpdateSettings}
        developerMode={developerModeEnabled}
        onToggleDeveloperMode={setDeveloperModeEnabled}
        developerContent={
          id && developerModeEnabled ? (
            <MemoryDebugPanel workspaceId={id} workbenchId={latestWorkbench?.id} />
          ) : null
        }
      />
    </div>
  );
}
