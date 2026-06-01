import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ExternalLink,
  Folder,
  FileText,
  FileCode,
  FileImage,
  FileVideo,
  Globe2,
  LayoutDashboard,
  LibraryBig,
  Loader2,
  LogOut,
  MoreHorizontal,
  Plus,
  Sparkles,
  Wrench,
  Upload
} from 'lucide-react';
import { workspaceApi } from '../api/client';
import { fileSystemApi, DiscoveredResource } from '../services/fileSystemApi';
import { learningApi, TerminalChatListItem } from '../services/learningApi';
import { workbenchApi } from '../services/workbenchApi';
import { useAuthStore } from '../store/authStore';
import { FileSystemObject, LearningTerminalMessage, TerminalChatFile, Workspace, Workbench, WorkbenchItem } from '../types';
import LearningTerminal from '../components/workspace/LearningTerminal';
import { AddSourcesDialog } from '../components/workspace/AddSourcesDialog';
import LearningIntelligenceDashboard, {
  IntelligenceSection
} from '../components/workspace/LearningIntelligenceDashboard';

type WorkspaceTab = 'workbenches' | 'files' | 'knowledge' | 'planning' | 'profile' | 'intelligence' | 'terminal';

interface SidebarWorkbench extends Workbench {
  workspaceName: string;
}

interface QueuedUrlSource {
  id: string;
  title: string;
  url: string;
}

interface QueuedTextSource {
  id: string;
  title: string;
  content: string;
}

interface CreateWorkspaceDraft {
  name: string;
  background: string;
  systemPrompt: string;
  files: File[];
  urls: QueuedUrlSource[];
  texts: QueuedTextSource[];
  webQuery: string;
}

interface TerminalChatSession {
  id: string;
  title: string;
  mode: TerminalChatMode;
  selectedSources: Array<{ fileId: string; mode: 'focused' | 'full_context' }>;
  chatFiles: TerminalChatFile[];
  messages: LearningTerminalMessage[];
  checkpointThreadId?: string;
  hasMoreMessages?: boolean;
  nextBefore?: string | null;
  messagesLoading?: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastMessagePreview?: string;
}

type TerminalChatMode = 'chat' | 'agentic';

type TerminalSourceFile = {
  id: string;
  name: string;
  path: string;
  updatedAt?: string;
  indexStatusLabel?: string;
  indexStatusDetail?: string;
  indexStatusTone?: 'ready' | 'indexing' | 'degraded' | 'failed' | 'empty';
  chunkCount?: number;
};

const emptyDraft = (): CreateWorkspaceDraft => ({
  name: '',
  background: '',
  systemPrompt: '',
  files: [],
  urls: [],
  texts: [],
  webQuery: ''
});

const workspaceTabs: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'workbenches', label: 'Workbenches' },
  { id: 'files', label: 'Knowledge' },
  { id: 'knowledge', label: 'Knowledge Graph' },
  { id: 'planning', label: 'Planning' },
  { id: 'profile', label: 'Profile' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'terminal', label: 'AI Terminal' }
];

const formatDate = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
};

const formatCalendarDate = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const time = date.getTime();

  if (time >= startOfToday) {
    return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (time >= startOfYesterday) {
    return `Yesterday at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
};

const getTimeRange = (value?: string) => {
  if (!value) return 'Older';
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return 'Older';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;
  const startOfMonth = startOfToday - 30 * 24 * 60 * 60 * 1000;

  if (time >= startOfToday) return 'Today';
  if (time >= startOfYesterday) return 'Yesterday';
  if (time >= startOfWeek) return 'Previous 7 days';
  if (time >= startOfMonth) return 'Previous 30 days';
  return date.toLocaleDateString('en-US', { month: 'long' });
};

const makeTerminalChatId = () => `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeTerminalChatMode = (value: unknown): TerminalChatMode =>
  value === 'agentic' ? 'agentic' : 'chat';

const clipTerminalText = (value: unknown, maxLength = 4000) => {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
};

const getTerminalChatTitle = (messages: LearningTerminalMessage[], fallback = 'New Chat') => {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content.trim();
  if (!firstUserMessage) return fallback;
  return firstUserMessage.length > 64 ? `${firstUserMessage.slice(0, 61)}...` : firstUserMessage;
};

const terminalChatFileFromObject = (workspaceId: string, file: FileSystemObject): TerminalChatFile => ({
  id: file.id,
  name: file.name,
  path: file.path,
  mimeType: file.mimeType,
  size: file.size,
  extension: file.extension,
  fileCategory: file.fileCategory,
  resourceType: file.resourceType,
  scope: file.scope,
  origin: file.origin,
  metadata: file.metadata,
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
  status: 'ready',
  downloadUrl: fileSystemApi.downloadUrl(workspaceId, file.id)
});

const sanitizeTerminalChatFiles = (value: unknown): TerminalChatFile[] =>
  Array.isArray(value)
    ? value
        .map((item: any): TerminalChatFile => ({
          id: typeof item?.id === 'string' ? item.id : '',
          name: typeof item?.name === 'string' ? item.name : 'Attachment',
          path: typeof item?.path === 'string' ? item.path : undefined,
          mimeType: typeof item?.mimeType === 'string' ? item.mimeType : undefined,
          size: typeof item?.size === 'number' ? item.size : undefined,
          extension: typeof item?.extension === 'string' ? item.extension : undefined,
          fileCategory: typeof item?.fileCategory === 'string' ? item.fileCategory : undefined,
          resourceType: typeof item?.resourceType === 'string' ? item.resourceType : undefined,
          scope: typeof item?.scope === 'string' ? item.scope : undefined,
          origin: typeof item?.origin === 'string' ? item.origin : undefined,
          downloadUrl: typeof item?.downloadUrl === 'string' ? item.downloadUrl : undefined,
          status: item?.status === 'uploading' || item?.status === 'error' ? item.status : 'ready',
          error: typeof item?.error === 'string' ? item.error : undefined,
          createdAt: typeof item?.createdAt === 'string' ? item.createdAt : undefined,
          updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : undefined,
          metadata: item?.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? item.metadata : undefined
        }))
        .filter((item) => Boolean(item.id))
        .slice(0, 24)
    : [];

const sanitizeTerminalSessionForStorage = (session: TerminalChatSession): TerminalChatSession => ({
  ...session,
  title: clipTerminalText(session.title, 80) || 'New Chat',
  selectedSources: session.selectedSources.slice(0, 12),
  chatFiles: sanitizeTerminalChatFiles(session.chatFiles),
  messages: [],
  hasMoreMessages: session.hasMoreMessages,
  nextBefore: session.nextBefore || null,
  messagesLoading: false,
  messageCount: session.messageCount,
  lastMessagePreview: clipTerminalText(session.lastMessagePreview, 180),
  checkpointThreadId: session.checkpointThreadId
});

const sanitizeTerminalSessionsForStorage = (sessions: TerminalChatSession[]) =>
  sessions
    .map(sanitizeTerminalSessionForStorage)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 100);

const createTerminalChatSession = (
  input?: Partial<TerminalChatSession> & { messages?: LearningTerminalMessage[] }
): TerminalChatSession => {
  const now = new Date().toISOString();
  const messages = input?.messages || [];
  return {
    id: input?.id || makeTerminalChatId(),
    title: input?.title || getTerminalChatTitle(messages),
    mode: normalizeTerminalChatMode(input?.mode),
    selectedSources: Array.isArray(input?.selectedSources)
      ? input.selectedSources
          .map((item): { fileId: string; mode: 'focused' | 'full_context' } => ({
            fileId: typeof item.fileId === 'string' ? item.fileId : '',
            mode: item.mode === 'full_context' ? 'full_context' : 'focused'
          }))
          .filter((item) => Boolean(item.fileId))
          .slice(0, 12)
      : [],
    chatFiles: sanitizeTerminalChatFiles(input?.chatFiles),
    messages,
    checkpointThreadId: typeof input?.checkpointThreadId === 'string' ? input.checkpointThreadId : undefined,
    hasMoreMessages: Boolean(input?.hasMoreMessages),
    nextBefore: typeof input?.nextBefore === 'string' ? input.nextBefore : null,
    messagesLoading: false,
    messageCount: typeof input?.messageCount === 'number' ? input.messageCount : messages.length,
    lastMessagePreview: typeof input?.lastMessagePreview === 'string' ? input.lastMessagePreview : undefined,
    createdAt: input?.createdAt || now,
    updatedAt: input?.updatedAt || now
  };
};

const terminalSessionFromServer = (item: TerminalChatListItem): TerminalChatSession => createTerminalChatSession({
  id: item.id,
  title: item.title,
  mode: item.mode,
  selectedSources: item.selectedSources,
  chatFiles: item.chatFiles,
  checkpointThreadId: item.checkpointThreadId,
  messages: [],
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  messageCount: item.messageCount,
  lastMessagePreview: item.lastMessagePreview,
  hasMoreMessages: item.messageCount > 0,
  nextBefore: null
});

const sanitizeTerminalChatSessions = (value: unknown): TerminalChatSession[] => {
  if (!Array.isArray(value)) return [];

  if (value.every((item) => item && typeof item === 'object' && 'role' in item)) {
    const migratedMessages = value as LearningTerminalMessage[];
    return migratedMessages.length
      ? [createTerminalChatSession({ messages: migratedMessages })]
      : [];
  }

  return value
    .filter((item): item is Partial<TerminalChatSession> => Boolean(item && typeof item === 'object'))
    .map((item) => createTerminalChatSession({
      id: typeof item.id === 'string' ? item.id : undefined,
      title: typeof item.title === 'string' ? item.title : undefined,
      mode: normalizeTerminalChatMode(item.mode),
      selectedSources: Array.isArray(item.selectedSources)
        ? item.selectedSources
            .map((source): { fileId: string; mode: 'focused' | 'full_context' } => ({
              fileId: typeof source.fileId === 'string' ? source.fileId : '',
              mode: source.mode === 'full_context' ? 'full_context' : 'focused'
            }))
            .filter((source) => Boolean(source.fileId))
        : [],
      chatFiles: sanitizeTerminalChatFiles(item.chatFiles),
      messages: Array.isArray(item.messages) ? item.messages as LearningTerminalMessage[] : [],
      checkpointThreadId: typeof item.checkpointThreadId === 'string' ? item.checkpointThreadId : undefined,
      hasMoreMessages: Boolean(item.hasMoreMessages),
      nextBefore: typeof item.nextBefore === 'string' ? item.nextBefore : null,
      messageCount: typeof item.messageCount === 'number' ? item.messageCount : undefined,
      lastMessagePreview: typeof item.lastMessagePreview === 'string' ? item.lastMessagePreview : undefined,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
};

const formatRelative = (value?: string) => {
  if (!value) return '';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';

  const diffMs = Date.now() - time;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return 'now';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h`;
  if (diffMs < day * 7) return `${Math.floor(diffMs / day)}d`;
  return `${Math.floor(diffMs / day / 7)}w`;
};

const parseKnowledgeIndexLifecycle = (value?: string | null): Record<string, any> => {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const getKnowledgeIndexStatusInfo = (file: Pick<FileSystemObject, '_count' | 'knowledgeIndexJobs' | 'isBinary' | 'extension' | 'mimeType' | 'fileCategory'>) => {
  const chunkCount = Number(file._count?.knowledgeChunks || 0);
  const latestJob = file.knowledgeIndexJobs?.[0];
  const lifecycle = parseKnowledgeIndexLifecycle(latestJob?.errorMessage);
  const stage = String(lifecycle.stage || '').toLowerCase();
  const status = String(latestJob?.status || '').toLowerCase();
  const vectorIndexed = lifecycle.vectorIndexed === true;
  const vectorError = typeof lifecycle.vectorError === 'string' ? lifecycle.vectorError : '';

  if (status === 'queued' || status === 'pending' || status === 'running' || ['pending', 'extracting', 'chunking', 'embedding', 'upserting', 'verifying'].includes(stage)) {
    return {
      label: 'Indexing',
      detail: latestJob?.updatedAt ? `Updated ${formatRelative(latestJob.updatedAt)}` : 'Queued for processing',
      tone: 'indexing' as const,
      chunkCount
    };
  }

  if (chunkCount > 0 && (status === 'degraded' || stage === 'degraded' || vectorError || !vectorIndexed)) {
    return {
      label: 'Text ready',
      detail: `${chunkCount} chunks; vector index ${vectorIndexed ? 'ready' : 'not ready'}`,
      tone: 'degraded' as const,
      chunkCount
    };
  }

  if (chunkCount > 0) {
    return {
      label: 'Ready',
      detail: `${chunkCount} chunks indexed`,
      tone: 'ready' as const,
      chunkCount
    };
  }

  if (status === 'failed' || stage === 'failed') {
    return {
      label: 'Index failed',
      detail: vectorError || 'No searchable chunks available',
      tone: 'failed' as const,
      chunkCount
    };
  }

  if (latestJob) {
    return {
      label: 'No chunks',
      detail: 'Uploaded, but no searchable text chunks are available',
      tone: 'empty' as const,
      chunkCount
    };
  }

  return {
    label: 'Not indexed',
    detail: 'No indexing job has run for this file yet',
    tone: 'empty' as const,
    chunkCount
  };
};

const knowledgeIndexToneClass = (tone?: TerminalSourceFile['indexStatusTone']) => {
  if (tone === 'ready') return 'bg-emerald-50 text-emerald-700';
  if (tone === 'degraded') return 'bg-amber-50 text-amber-700';
  if (tone === 'indexing') return 'bg-blue-50 text-blue-700';
  if (tone === 'failed') return 'bg-red-50 text-red-700';
  return 'bg-gray-100 text-gray-600';
};

const groupRecentWorkbenches = (workbenches: SidebarWorkbench[]) => {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;

  const groups: Array<{ label: string; items: SidebarWorkbench[] }> = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] }
  ];

  workbenches.forEach((workbench) => {
    const time = new Date(workbench.updatedAt || workbench.createdAt).getTime();
    if (Number.isNaN(time) || time >= startOfToday) groups[0].items.push(workbench);
    else if (time >= startOfYesterday) groups[1].items.push(workbench);
    else if (time >= startOfWeek) groups[2].items.push(workbench);
    else groups[3].items.push(workbench);
  });

  return groups.filter((group) => group.items.length > 0);
};

const getFileSectionLabel = (file: NonNullable<Workspace['fileObjects']>[number]) => {
  const sourceUrl = getFileSourceUrl(file).toLowerCase();
  if (sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be')) return 'YouTube';
  if (sourceUrl.includes('bilibili.com')) return 'Bilibili';
  if (file.origin === 'web') return 'Web source';
  if (file.origin === 'upload') return 'Uploaded file';
  if (file.resourceType === 'generated' || file.fileCategory === 'generated') return 'Generated';
  if (file.fileCategory === 'note') return 'Note';
  if (file.fileCategory === 'code') return 'Code';
  if (file.fileCategory === 'document') return 'Document';
  if (file.nodeType === 'folder') return 'Folder';
  return file.fileCategory || file.resourceType || 'File';
};

const parseFileMetadata = (file: NonNullable<Workspace['fileObjects']>[number]) => {
  if (file.metadata && typeof file.metadata === 'object') return file.metadata as Record<string, unknown>;
  if (!file.metadataJson) return {};
  try {
    const parsed = JSON.parse(file.metadataJson);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const getFileSourceMetadata = (file: NonNullable<Workspace['fileObjects']>[number]) => {
  const content = String(file.content || '');
  const title = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
  const url = /^URL:\s*(.+)$/mi.exec(content)?.[1]?.trim();
  return { title, url };
};

const getMetadataString = (metadata: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const getFileSourceUrl = (file: NonNullable<Workspace['fileObjects']>[number]) => {
  const metadata = parseFileMetadata(file);
  const source = getFileSourceMetadata(file);
  return (
    getMetadataString(metadata, ['sourceUrl', 'url', 'externalUrl', 'canonicalUrl']) ||
    source.url ||
    ''
  );
};

const getFileDisplayName = (file: NonNullable<Workspace['fileObjects']>[number]) => {
  const metadata = parseFileMetadata(file);
  const source = getFileSourceMetadata(file);
  return (
    getMetadataString(metadata, ['title', 'pageTitle', 'videoTitle', 'name']) ||
    source.title ||
    file.name.replace(/\.source$/i, '')
  );
};

const getFileCoverUrl = (file: NonNullable<Workspace['fileObjects']>[number]) => {
  const metadata = parseFileMetadata(file);
  return getMetadataString(metadata, ['image', 'imageUrl', 'thumbnail', 'thumbnailUrl', 'coverUrl', 'coverImageUrl']) || undefined;
};

const getFileFaviconUrl = (file: NonNullable<Workspace['fileObjects']>[number]) => {
  const metadata = parseFileMetadata(file);
  const favicon = getMetadataString(metadata, ['favicon', 'faviconUrl', 'iconUrl']);
  if (favicon) return favicon;

  const sourceUrl = getFileSourceUrl(file);
  try {
    const url = new URL(/^https?:\/\//i.test(sourceUrl) ? sourceUrl : `https://${sourceUrl}`);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`;
  } catch {
    return undefined;
  }
};

const inferWorkbenchEmoji = (title?: string, description?: string) => {
  const value = `${title || ''} ${description || ''}`.toLowerCase();
  if (/sql|database|数据库|事务|trigger|函数|视图/.test(value)) return '🗄️';
  if (/java|geometry|getters?|setter|class|oop/.test(value)) return '📘';
  if (/word|文档|空格|排版/.test(value)) return '📝';
  if (/error|fix|debug|bug|修复/.test(value)) return '🛠️';
  if (/proposal|analysis|分析|研究/.test(value)) return '🎨';
  if (/knowledge|graph|知识图谱/.test(value)) return '🧠';
  if (/plan|计划|结构化/.test(value)) return '📋';
  if (/ai|学习|工作台/.test(value)) return '📚';
  return '📄';
};

const makeSourceFilename = (title: string, fallback: string) => {
  const safeBase = (title || fallback)
    .trim()
    .replace(/\.[^./]+$/, '')
    .replace(/[\\/:*?"<>|#{}[\]`]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim() || fallback;
  return `${safeBase}.source`;
};

const makeTitleFromUrl = (value: string) => {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, '') || 'web-source';
  } catch {
    return 'web-source';
  }
};

const normalizeUrl = (url: string) => /^https?:\/\//i.test(url) ? url : `https://${url}`;
const clampSidebarWidth = (value: number) => {
  const maxWidth = typeof window === 'undefined' ? 840 : Math.min(840, Math.max(420, window.innerWidth - 360));
  return Math.min(maxWidth, Math.max(244, value));
};
const getMenuPositionStyle = (anchor: DOMRect | null, width: number): React.CSSProperties => {
  if (!anchor || typeof window === 'undefined') return {};
  return {
    position: 'fixed',
    top: Math.min(anchor.bottom + 4, window.innerHeight - 12),
    left: Math.min(Math.max(16, anchor.right - width), window.innerWidth - width - 16)
  };
};
const getMenuPositionStyleStart = (anchor: DOMRect | null, width: number): React.CSSProperties => {
  if (!anchor || typeof window === 'undefined') return {};
  return {
    position: 'fixed',
    top: Math.min(anchor.bottom + 4, window.innerHeight - 12),
    left: Math.min(Math.max(16, anchor.left), window.innerWidth - width - 16),
    transformOrigin: 'top left'
  };
};

const toWorkbenchItem = (workbench: Workbench): WorkbenchItem => ({
  id: workbench.id,
  title: workbench.title,
  updatedAt: formatRelative(workbench.updatedAt),
  description: workbench.description,
  panelCount: workbench.panelCount || workbench.state?.editors?.length || workbench.state?.panels?.length || 0,
  resourceCount: workbench.resourceCount || 0
});

export default function WorkspaceShellPage() {
  const { id: routeWorkspaceId } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const hydrated = useAuthStore((state) => state.hydrated);
  const hydrate = useAuthStore((state) => state.hydrate);
  const logout = useAuthStore((state) => state.logout);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceWorkbenches, setWorkspaceWorkbenches] = useState<Record<string, Workbench[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('workbenches');
  const [activeIntelligenceSection, setActiveIntelligenceSection] = useState<IntelligenceSection>('overview');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(window.localStorage.getItem('workspace-shell:sidebar-width') || 292);
    return clampSidebarWidth(stored);
  });
  const [workspacesCollapsed, setWorkspacesCollapsed] = useState(false);
  const [workbenchesCollapsed, setWorkbenchesCollapsed] = useState(false);
  const [pinnedWorkbenchesCollapsed, setPinnedWorkbenchesCollapsed] = useState(false);
  const [sidebarScrollTop, setSidebarScrollTop] = useState(0);
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(() => new Set());
  const [openWorkspaceMenuId, setOpenWorkspaceMenuId] = useState<string | null>(null);
  const [workspaceMenuRect, setWorkspaceMenuRect] = useState<DOMRect | null>(null);
  const [openWorkbenchMenuId, setOpenWorkbenchMenuId] = useState<string | null>(null);
  const [editingWorkbenchId, setEditingWorkbenchId] = useState<string | null>(null);
  const [editingWorkbenchTitle, setEditingWorkbenchTitle] = useState('');
  const [pinnedWorkbenchIds, setPinnedWorkbenchIds] = useState<Set<string>>(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem('workspace-shell:pinned-workbenches') || '[]');
      return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null);
  const [createWorkbenchOpen, setCreateWorkbenchOpen] = useState(false);
  const [createWorkbenchError, setCreateWorkbenchError] = useState<string | null>(null);
  const [addSourcesOpen, setAddSourcesOpen] = useState(false);
  const [creatingWorkbench, setCreatingWorkbench] = useState(false);
  const [terminalDraftPrompt, setTerminalDraftPrompt] = useState('');
  const [terminalDraftMode, setTerminalDraftMode] = useState<TerminalChatMode>('chat');
  const [terminalDraftSources, setTerminalDraftSources] = useState<Array<{ fileId: string; mode: 'focused' | 'full_context' }>>([]);
  const [terminalChatSessions, setTerminalChatSessions] = useState<Record<string, TerminalChatSession[]>>({});
  const [activeTerminalChatIds, setActiveTerminalChatIds] = useState<Record<string, string | null>>({});
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      navigate('/', { replace: true });
      return;
    }
    void loadWorkspaceShell();
  }, [hydrated, user]);

  const loadWorkspaceShell = async () => {
    setLoading(true);
    try {
      const nextWorkspaces = await workspaceApi.getWorkspaces();
      const sorted = [...nextWorkspaces].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      const activeWorkspaceId = routeWorkspaceId || sorted[0]?.id;
      let hydratedWorkspace: Workspace | null = null;

      if (activeWorkspaceId) {
        try {
          hydratedWorkspace = await workspaceApi.getWorkspace(activeWorkspaceId);
        } catch (error) {
          console.error('Failed to load workspace details:', error);
        }
      }

      const mergedWorkspaces = hydratedWorkspace
        ? sorted.map((workspace) => workspace.id === hydratedWorkspace?.id ? { ...workspace, ...hydratedWorkspace } : workspace)
        : sorted;
      setWorkspaces(mergedWorkspaces);

      const workbenchEntries = await Promise.all(
        mergedWorkspaces.map(async (workspace) => {
          try {
            const list = await workbenchApi.listByWorkspace(workspace.id);
            return [workspace.id, list] as const;
          } catch (error) {
            console.error('Failed to load workbenches:', error);
            return [workspace.id, workspace.workbenches || []] as const;
          }
        })
      );

      setWorkspaceWorkbenches(Object.fromEntries(workbenchEntries));
    } catch (error) {
      console.error('Failed to load workspace shell:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === routeWorkspaceId) || workspaces[0] || null,
    [routeWorkspaceId, workspaces]
  );

  const selectedWorkbenches = selectedWorkspace ? workspaceWorkbenches[selectedWorkspace.id] || [] : [];
  const selectedWorkbenchItems = selectedWorkbenches.map(toWorkbenchItem);

  useEffect(() => {
    if (loading || routeWorkspaceId || !workspaces.length) return;
    navigate(`/workspaces/${workspaces[0].id}`, { replace: true });
  }, [loading, navigate, routeWorkspaceId, workspaces]);

  useEffect(() => {
    if (!selectedWorkspace) return;
    setActiveTab('workbenches');
  }, [selectedWorkspace?.id]);

  useEffect(() => {
    if (!selectedWorkspace?.id) return;

    let cancelled = false;
    const hydrateSelectedWorkspace = async () => {
      try {
        const workspace = await workspaceApi.getWorkspace(selectedWorkspace.id);
        if (cancelled) return;

        setWorkspaces((items) => items.map((item) => item.id === workspace.id ? { ...item, ...workspace } : item));
        if (Array.isArray(workspace.workbenches)) {
          setWorkspaceWorkbenches((current) => ({ ...current, [workspace.id]: workspace.workbenches || [] }));
        }
      } catch (error) {
        if (!cancelled) console.error('Failed to hydrate selected workspace:', error);
      }
    };

    void hydrateSelectedWorkspace();

    return () => {
      cancelled = true;
    };
  }, [selectedWorkspace?.id]);

  useEffect(() => {
    window.localStorage.setItem('workspace-shell:sidebar-width', String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem('workspace-shell:pinned-workbenches', JSON.stringify([...pinnedWorkbenchIds]));
  }, [pinnedWorkbenchIds]);

  useEffect(() => {
    if (!selectedWorkspace?.id) return;
    setExpandedWorkspaceIds((current) => {
      const next = new Set(current);
      next.add(selectedWorkspace.id);
      return next;
    });
  }, [selectedWorkspace?.id]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-workspace-menu], [data-workbench-menu], [data-resource-menu]')) return;
      setOpenWorkspaceMenuId(null);
      setOpenWorkbenchMenuId(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!selectedWorkspace?.id) return;
    let cancelled = false;
    const loadTerminalSessions = async () => {
      const storageKey = `workspace-shell:${selectedWorkspace.id}:terminal-chats`;
      let localSessions: TerminalChatSession[] = [];
      try {
        const storedSessions = window.localStorage.getItem(storageKey);
        const legacyStoredMessages = window.localStorage.getItem(`workspace-shell:${selectedWorkspace.id}:terminal`);
        localSessions = sanitizeTerminalChatSessions(JSON.parse(storedSessions || legacyStoredMessages || '[]'));
      } catch {
        localSessions = [];
      }

      try {
        const response = await learningApi.listTerminalChats(selectedWorkspace.id, { limit: 100 });
        if (cancelled) return;
        const serverSessions = response.sessions.map(terminalSessionFromServer);
        const serverIds = new Set(serverSessions.map((session) => session.id));
        setTerminalChatSessions((current) => ({
          ...current,
          [selectedWorkspace.id]: [
            ...serverSessions,
            ...localSessions.filter((session) => !serverIds.has(session.id) && session.messages.length > 0)
          ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        }));
      } catch (error) {
        if (cancelled) return;
        console.warn('Failed to load terminal chats from backend; using local index fallback.', error);
        setTerminalChatSessions((current) => ({
          ...current,
          [selectedWorkspace.id]: localSessions
        }));
      }
      setActiveTerminalChatIds((current) => ({ ...current, [selectedWorkspace.id]: null }));
    };

    void loadTerminalSessions();
    return () => {
      cancelled = true;
    };
  }, [selectedWorkspace?.id]);

  useEffect(() => {
    if (!selectedWorkspace?.id) return;
    try {
      const storageKey = `workspace-shell:${selectedWorkspace.id}:terminal-chats`;
      const sessions = sanitizeTerminalSessionsForStorage(terminalChatSessions[selectedWorkspace.id] || []);
      window.localStorage.setItem(storageKey, JSON.stringify(sessions));
    } catch (error) {
      console.warn('Failed to persist terminal chat index.', error);
    }
  }, [terminalChatSessions, selectedWorkspace?.id]);

  const allWorkbenches = useMemo(() => {
    return workspaces
      .flatMap((workspace) =>
        (workspaceWorkbenches[workspace.id] || []).map((workbench): SidebarWorkbench => ({
          ...workbench,
          workspaceName: workspace.name
        }))
      )
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  }, [workspaceWorkbenches, workspaces]);

  const filteredWorkspaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return workspaces;
    return workspaces.filter((workspace) =>
      workspace.name.toLowerCase().includes(query) ||
      (workspace.description || '').toLowerCase().includes(query)
    );
  }, [searchQuery, workspaces]);

  const filteredSidebarWorkbenches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return allWorkbenches;
    return allWorkbenches.filter((workbench) =>
      workbench.title.toLowerCase().includes(query) ||
      workbench.workspaceName.toLowerCase().includes(query) ||
      (workbench.description || '').toLowerCase().includes(query)
    );
  }, [allWorkbenches, searchQuery]);

  const pinnedSidebarWorkbenches = useMemo(
    () => filteredSidebarWorkbenches.filter((workbench) => pinnedWorkbenchIds.has(workbench.id)),
    [filteredSidebarWorkbenches, pinnedWorkbenchIds]
  );

  const unpinnedSidebarWorkbenches = useMemo(
    () => filteredSidebarWorkbenches.filter((workbench) => !pinnedWorkbenchIds.has(workbench.id)),
    [filteredSidebarWorkbenches, pinnedWorkbenchIds]
  );

  const sourceFiles = useMemo(() => {
    return (selectedWorkspace?.fileObjects || [])
      .filter((file) => file.nodeType === 'file' && file.scope !== 'chat')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [selectedWorkspace?.fileObjects]);

  const currentTerminalChatSessions = selectedWorkspace ? terminalChatSessions[selectedWorkspace.id] || [] : [];
  const activeTerminalChatId = selectedWorkspace ? activeTerminalChatIds[selectedWorkspace.id] || null : null;
  const activeTerminalChat = currentTerminalChatSessions.find((chat) => chat.id === activeTerminalChatId) || null;
  const currentMessages = activeTerminalChat?.messages || [];
  const currentTerminalMode = activeTerminalChat?.mode || 'chat';
  const currentTerminalSources = activeTerminalChat?.selectedSources || [];
  const currentTerminalChatFiles = activeTerminalChat?.chatFiles || [];
  const terminalWorkspaceSources = useMemo(() => {
    return sourceFiles
      .filter((file) => file.scope !== 'chat' && (file.resourceType === 'source' || file.scope === 'workspace'))
      .slice(0, 80)
      .map((file): TerminalSourceFile => {
        const status = getKnowledgeIndexStatusInfo(file);
        return {
          id: file.id,
          name: file.name,
          path: file.path,
          updatedAt: file.updatedAt,
          indexStatusLabel: status.label,
          indexStatusDetail: status.detail,
          indexStatusTone: status.tone,
          chunkCount: status.chunkCount
        };
      });
  }, [sourceFiles]);

  const refreshSelectedWorkspace = async () => {
    await loadWorkspaceShell();
  };

  const openWorkbench = (workbenchId: string) => {
    navigate(`/workbenches/${workbenchId}`);
  };

  const beginRenameWorkbench = (workbench: Workbench) => {
    setOpenWorkbenchMenuId(null);
    setEditingWorkbenchId(workbench.id);
    setEditingWorkbenchTitle(workbench.title || '');
  };

  const cancelRenameWorkbench = () => {
    setEditingWorkbenchId(null);
    setEditingWorkbenchTitle('');
  };

  const submitRenameWorkbench = async () => {
    const title = editingWorkbenchTitle.trim();
    if (!editingWorkbenchId || !title) {
      setEditingWorkbenchId(null);
      return;
    }

    try {
      await workbenchApi.update(editingWorkbenchId, { title });
      await loadWorkspaceShell();
    } catch (error) {
      console.error('Failed to rename workbench:', error);
    } finally {
      setEditingWorkbenchId(null);
      setEditingWorkbenchTitle('');
    }
  };

  const togglePinWorkbench = (workbenchId: string) => {
    setOpenWorkbenchMenuId(null);
    setPinnedWorkbenchIds((current) => {
      const next = new Set(current);
      if (next.has(workbenchId)) next.delete(workbenchId);
      else next.add(workbenchId);
      return next;
    });
  };

  const cloneWorkbench = async (workbench: Workbench) => {
    setOpenWorkbenchMenuId(null);
    try {
      await workbenchApi.clone(workbench.id, { title: `Clone of ${workbench.title}` });
      await loadWorkspaceShell();
    } catch (error) {
      console.error('Failed to clone workbench:', error);
    }
  };

  const moveWorkbench = async (workbench: Workbench, workspaceId: string) => {
    setOpenWorkbenchMenuId(null);
    try {
      await workbenchApi.move(workbench.id, { workspaceId });
      await loadWorkspaceShell();
    } catch (error) {
      console.error('Failed to move workbench:', error);
    }
  };

  const deleteWorkbenchFromSidebar = async (workbench: Workbench) => {
    setOpenWorkbenchMenuId(null);
    if (!confirm(`Delete workbench "${workbench.title}"? This cannot be undone.`)) return;
    try {
      await workbenchApi.delete(workbench.id);
      setPinnedWorkbenchIds((current) => {
        const next = new Set(current);
        next.delete(workbench.id);
        return next;
      });
      await loadWorkspaceShell();
    } catch (error) {
      console.error('Failed to delete workbench:', error);
    }
  };

  const createWorkbench = async (title?: string, openAfterCreate = true) => {
    const target = selectedWorkspace || workspaces[0];
    if (!target) {
      setCreateWorkspaceOpen(true);
      return;
    }

    setCreatingWorkbench(true);
    try {
      const workbench = await workbenchApi.create({
        workspaceId: target.id,
        title: title?.trim() || undefined
      });
      await loadWorkspaceShell();
      if (openAfterCreate) navigate(`/workbenches/${workbench.id}`);
    } catch (error) {
      console.error('Failed to create workbench:', error);
    } finally {
      setCreatingWorkbench(false);
    }
  };

  const submitWorkbenchCreate = async (payload: { title: string; description: string; resourceIds: string[] }) => {
    const target = selectedWorkspace || workspaces[0];
    if (!target) {
      setCreateWorkspaceOpen(true);
      return;
    }

    setCreatingWorkbench(true);
    setCreateWorkbenchError(null);
    try {
      const workbench = await workbenchApi.create({
        workspaceId: target.id,
        title: payload.title,
        description: payload.description,
        resourceIds: payload.resourceIds
      });
      await loadWorkspaceShell();
      setExpandedWorkspaceIds((current) => new Set(current).add(target.id));
      setCreateWorkbenchOpen(false);
      navigate(`/workbenches/${workbench.id}`);
    } catch (error) {
      console.error('Failed to create workbench:', error);
      setCreateWorkbenchError(error instanceof Error ? error.message : 'Failed to create workbench.');
    } finally {
      setCreatingWorkbench(false);
    }
  };

  const createWorkbenchInWorkspace = async (workspaceId: string, openAfterCreate = true) => {
    setCreatingWorkbench(true);
    try {
      const workbench = await workbenchApi.create({ workspaceId });
      await loadWorkspaceShell();
      setExpandedWorkspaceIds((current) => new Set(current).add(workspaceId));
      if (openAfterCreate) navigate(`/workbenches/${workbench.id}`);
    } catch (error) {
      console.error('Failed to create workbench:', error);
    } finally {
      setCreatingWorkbench(false);
    }
  };

  const uploadWorkspaceFiles = async (files: File[]) => {
    if (!selectedWorkspace || files.length === 0) return;
    await fileSystemApi.upload(selectedWorkspace.id, files, undefined, undefined, {
      resourceRole: 'source',
      resourceType: 'source',
      scope: 'workspace',
      origin: 'upload'
    });
    await refreshSelectedWorkspace();
  };

  const addWorkspaceWebsite = async ({ title, url }: { title: string; url: string }) => {
    if (!selectedWorkspace) return;
    const normalizedUrl = normalizeUrl(url);
    await fileSystemApi.importUrl(selectedWorkspace.id, {
      url: normalizedUrl,
      title: title.trim() || makeTitleFromUrl(normalizedUrl),
      resourceRole: 'source',
      resourceType: 'source',
      scope: 'workspace',
      origin: 'web'
    });
    await refreshSelectedWorkspace();
  };

  const addWorkspaceText = async ({ title, content }: { title: string; content: string }) => {
    if (!selectedWorkspace) return;
    await fileSystemApi.createFile(selectedWorkspace.id, {
      name: makeSourceFilename(title, 'pasted-source'),
      content: `# ${title || 'Pasted source'}\n\nSource type: copied text\n\n${content}\n`,
      fileCategory: 'text-source',
      resourceRole: 'source',
      resourceType: 'source',
      scope: 'workspace',
      origin: 'user'
    });
    await refreshSelectedWorkspace();
  };

  const openFileInWorkbench = async (fileId: string) => {
    if (!selectedWorkspace) return;

    let workbenchId = selectedWorkbenches[0]?.id;
    if (!workbenchId) {
      const created = await workbenchApi.create({
        workspaceId: selectedWorkspace.id,
        title: 'New Workbench'
      });
      workbenchId = created.id;
      await loadWorkspaceShell();
    }

    navigate(`/workbenches/${workbenchId}?resourceId=${encodeURIComponent(fileId)}`);
  };

  const openTerminalWithPrompt = (prompt: string) => {
    if (selectedWorkspace?.id) {
      const chat = createTerminalChatSession({ title: 'New Chat', mode: 'agentic' });
      setTerminalChatSessions((current) => ({
        ...current,
        [selectedWorkspace.id]: [chat, ...(current[selectedWorkspace.id] || [])]
      }));
      setActiveTerminalChatIds((current) => ({ ...current, [selectedWorkspace.id]: chat.id }));
    }
    setActiveTab('terminal');
    setTerminalDraftPrompt(prompt);
  };

  const startTerminalChat = (
    prompt?: string,
    options?: {
      mode?: TerminalChatMode;
      selectedSources?: Array<{ fileId: string; mode: 'focused' | 'full_context' }>;
    }
  ) => {
    if (!selectedWorkspace?.id) return;
    const chat = createTerminalChatSession({
      title: 'New Chat',
      mode: options?.mode || terminalDraftMode,
      selectedSources: options?.selectedSources || terminalDraftSources
    });
    setTerminalChatSessions((current) => ({
      ...current,
      [selectedWorkspace.id]: [chat, ...(current[selectedWorkspace.id] || [])]
    }));
    setActiveTerminalChatIds((current) => ({ ...current, [selectedWorkspace.id]: chat.id }));
    setTerminalDraftPrompt(prompt || '');
  };

  const openTerminalChat = (chatId: string) => {
    if (!selectedWorkspace?.id) return;
    setActiveTerminalChatIds((current) => ({ ...current, [selectedWorkspace.id]: chatId }));
    setTerminalDraftPrompt('');
  };

  const loadTerminalChatMessages = async (chatId: string, direction: 'initial' | 'earlier' = 'initial') => {
    if (!selectedWorkspace?.id) return;
    const workspaceId = selectedWorkspace.id;
    const chat = (terminalChatSessions[workspaceId] || []).find((item) => item.id === chatId);
    if (!chat || chat.messagesLoading) return;
    if (direction === 'earlier' && !chat.hasMoreMessages) return;

    setTerminalChatSessions((current) => ({
      ...current,
      [workspaceId]: (current[workspaceId] || []).map((item) =>
        item.id === chatId ? { ...item, messagesLoading: true } : item
      )
    }));

    try {
      const page = await learningApi.getTerminalChatMessages(workspaceId, chatId, {
        before: direction === 'earlier' ? chat.nextBefore || null : null,
        limit: 30
      });
      setTerminalChatSessions((current) => ({
        ...current,
        [workspaceId]: (current[workspaceId] || []).map((item) => {
          if (item.id !== chatId) return item;
          const existingKeys = new Set(item.messages.map((message) => `${message.role}:${message.content}`));
          const nextMessages = direction === 'earlier'
            ? [
                ...page.messages.filter((message) => !existingKeys.has(`${message.role}:${message.content}`)),
                ...item.messages
              ]
            : page.messages;
          return {
            ...item,
            messages: nextMessages,
            hasMoreMessages: page.hasMore,
            nextBefore: page.nextBefore,
            messagesLoading: false
          };
        })
      }));
    } catch (error) {
      console.error('Failed to load terminal chat messages:', error);
      setTerminalChatSessions((current) => ({
        ...current,
        [workspaceId]: (current[workspaceId] || []).map((item) =>
          item.id === chatId ? { ...item, messagesLoading: false } : item
        )
      }));
    }
  };

  useEffect(() => {
    if (!selectedWorkspace?.id || !activeTerminalChatId || !activeTerminalChat) return;
    if (activeTerminalChat.messages.length > 0 || activeTerminalChat.messagesLoading) return;
    if ((activeTerminalChat.messageCount || 0) <= 0) return;
    void loadTerminalChatMessages(activeTerminalChatId, 'initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspace?.id, activeTerminalChatId, activeTerminalChat?.messageCount]);

  const closeTerminalChat = () => {
    if (!selectedWorkspace?.id) return;
    setActiveTerminalChatIds((current) => ({ ...current, [selectedWorkspace.id]: null }));
    setTerminalDraftPrompt('');
  };

  const updateActiveTerminalMessages = (messages: LearningTerminalMessage[]) => {
    if (!selectedWorkspace?.id || !activeTerminalChatId) return;
    const now = new Date().toISOString();
    setTerminalChatSessions((current) => ({
      ...current,
      [selectedWorkspace.id]: (current[selectedWorkspace.id] || [])
        .map((chat) => chat.id === activeTerminalChatId ? {
          ...chat,
          messages,
          title: getTerminalChatTitle(messages, chat.title),
          updatedAt: now,
          messageCount: Math.max(chat.messageCount || 0, messages.length),
          lastMessagePreview: messages[messages.length - 1]?.content || chat.lastMessagePreview
        } : chat)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    }));
  };

  const updateActiveTerminalMode = (mode: TerminalChatMode) => {
    if (!selectedWorkspace?.id || !activeTerminalChatId) return;
    setTerminalChatSessions((current) => ({
      ...current,
      [selectedWorkspace.id]: (current[selectedWorkspace.id] || [])
        .map((chat) => chat.id === activeTerminalChatId ? { ...chat, mode } : chat)
    }));
  };

  const updateActiveTerminalSourceModes = (nextSources: Array<{ fileId: string; mode: 'focused' | 'full_context' }>) => {
    if (!selectedWorkspace?.id || !activeTerminalChatId) return;
    setTerminalChatSessions((current) => ({
      ...current,
      [selectedWorkspace.id]: (current[selectedWorkspace.id] || [])
        .map((chat) => chat.id === activeTerminalChatId ? { ...chat, selectedSources: nextSources } : chat)
    }));
  };

  const updateActiveTerminalChatFiles = (chatFiles: TerminalChatFile[]) => {
    if (!selectedWorkspace?.id || !activeTerminalChatId) return;
    const now = new Date().toISOString();
    setTerminalChatSessions((current) => ({
      ...current,
      [selectedWorkspace.id]: (current[selectedWorkspace.id] || [])
        .map((chat) => chat.id === activeTerminalChatId ? { ...chat, chatFiles, updatedAt: now } : chat)
    }));
  };

  const updateActiveTerminalCheckpointThread = (checkpointThreadId: string) => {
    if (!selectedWorkspace?.id || !activeTerminalChatId) return;
    setTerminalChatSessions((current) => ({
      ...current,
      [selectedWorkspace.id]: (current[selectedWorkspace.id] || [])
        .map((chat) => chat.id === activeTerminalChatId ? { ...chat, checkpointThreadId } : chat)
    }));
  };

  const uploadTerminalChatFiles = async (files: File[]): Promise<TerminalChatFile[]> => {
    if (!selectedWorkspace?.id || !activeTerminalChatId || files.length === 0) return [];
    const response = await fileSystemApi.upload(selectedWorkspace.id, files, undefined, undefined, {
      resourceRole: 'chat_attachment',
      resourceType: 'chat_attachment',
      scope: 'chat',
      origin: 'chat_attachment',
      metadata: {
        source: 'workspace_ai_terminal_chat',
        chatId: activeTerminalChatId,
        sessionId: activeTerminalChatId
      }
    });
    const created = Array.isArray(response)
      ? response
          .filter((item: any) => item?.success && item?.file?.id)
          .map((item: any) => terminalChatFileFromObject(selectedWorkspace.id, item.file as FileSystemObject))
      : [];
    if (created.length) {
      const existingIds = new Set(currentTerminalChatFiles.map((file) => file.id));
      updateActiveTerminalChatFiles([
        ...currentTerminalChatFiles,
        ...created.filter((file) => !existingIds.has(file.id))
      ].slice(-24));
    }
    return created;
  };

  const openLearningSection = (section: IntelligenceSection) => {
    if (section === 'knowledge') {
      setActiveTab('knowledge');
      return;
    }
    if (section === 'planning') {
      setActiveTab('planning');
      return;
    }
    if (section === 'memory') {
      setActiveTab('profile');
      return;
    }
    setActiveTab('intelligence');
    setActiveIntelligenceSection(section);
  };

  const toggleWorkspaceExpanded = (workspaceId: string) => {
    setExpandedWorkspaceIds((current) => {
      const next = new Set(current);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  };

  const editWorkspace = (workspaceId: string) => {
    setOpenWorkspaceMenuId(null);
    navigate(`/workspaces/${workspaceId}`);
    setActiveTab('intelligence');
    setActiveIntelligenceSection('overview');
  };

  const exportWorkspace = (workspace: Workspace) => {
    setOpenWorkspaceMenuId(null);
    const payload = {
      workspace,
      workbenches: workspaceWorkbenches[workspace.id] || [],
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${workspace.name.replace(/[\\/:*?"<>|#{}[\]`]/g, '-') || 'workspace'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const deleteWorkspace = async (workspace: Workspace) => {
    setOpenWorkspaceMenuId(null);
    if (!confirm(`Delete workspace "${workspace.name}"? This cannot be undone.`)) return;
    try {
      await workspaceApi.deleteWorkspace(workspace.id);
      await loadWorkspaceShell();
      if (selectedWorkspace?.id === workspace.id) navigate('/workspaces', { replace: true });
    } catch (error) {
      console.error('Failed to delete workspace:', error);
    }
  };

  const beginSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    sidebarResizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const draft = sidebarResizeRef.current;
      if (!draft) return;
      setSidebarWidth(clampSidebarWidth(draft.startWidth + moveEvent.clientX - draft.startX));
    };

    const handlePointerUp = () => {
      sidebarResizeRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  const discoverWorkspaceSources = async ({ query, maxResults }: { query: string; maxResults?: number }) => {
    if (!selectedWorkspace) return [];
    const response = await fileSystemApi.discoverSources(selectedWorkspace.id, {
      query,
      maxResults,
      provider: 'auto'
    });
    return response.results;
  };

  const importWorkspaceSources = async (sources: DiscoveredResource[]) => {
    if (!selectedWorkspace || sources.length === 0) return;
    for (const source of sources) {
      await fileSystemApi.importUrl(selectedWorkspace.id, {
        url: source.url,
        title: source.title,
        resourceRole: 'source',
        resourceType: 'source',
        scope: 'workspace',
        origin: 'web'
      });
    }
    await refreshSelectedWorkspace();
  };

  const importQueuedKnowledge = async (workspaceId: string, draft: CreateWorkspaceDraft) => {
    if (draft.files.length) {
      await fileSystemApi.upload(workspaceId, draft.files, undefined, undefined, {
        resourceRole: 'source',
        resourceType: 'source',
        scope: 'workspace',
        origin: 'upload'
      });
    }

    for (const source of draft.urls) {
      const normalizedUrl = normalizeUrl(source.url);
      await fileSystemApi.importUrl(workspaceId, {
        url: normalizedUrl,
        title: source.title || makeTitleFromUrl(normalizedUrl),
        resourceRole: 'source',
        resourceType: 'source',
        scope: 'workspace',
        origin: 'web'
      });
    }

    for (const source of draft.texts) {
      await fileSystemApi.createFile(workspaceId, {
        name: makeSourceFilename(source.title, 'pasted-source'),
        content: `# ${source.title || 'Pasted source'}\n\nSource type: copied text\n\n${source.content}\n`,
        fileCategory: 'text-source',
        resourceRole: 'source',
        resourceType: 'source',
        scope: 'workspace',
        origin: 'user'
      });
    }

  };

  const submitCreateWorkspace = async (draft: CreateWorkspaceDraft) => {
    const name = draft.name.trim();
    if (!name) return;
    setCreatingWorkspace(true);
    setCreateWorkspaceError(null);

    try {
      const workspace = await workspaceApi.createWorkspace({
        name,
        description: draft.background.trim(),
        major: ''
      });

      if (draft.systemPrompt.trim()) {
        await workspaceApi.updateWorkspace(workspace.id, {
          name: workspace.name,
          description: draft.background.trim(),
          major: workspace.major || '',
          aiTerminalConfig: draft.systemPrompt.trim()
        });
      }

      await importQueuedKnowledge(workspace.id, draft);
      setCreateWorkspaceOpen(false);
      await loadWorkspaceShell();
      navigate(`/workspaces/${workspace.id}`);
    } catch (error: any) {
      console.error('Failed to create workspace:', error);
      setCreateWorkspaceError(error?.response?.data?.error || error?.message || '创建 workspace 失败');
    } finally {
      setCreatingWorkspace(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#fbfbfa] text-[#202124]">
        <Loader2 className="h-6 w-6 animate-spin text-[#777b80]" />
      </div>
    );
  }

  return (
    <div className="openwebui-shell flex h-full min-h-0 overflow-hidden bg-white text-gray-900">
      {sidebarVisible ? (
      <>
      <aside
        className="openwebui-sidebar relative z-50 my-auto flex h-screen max-h-[100dvh] shrink-0 flex-col justify-between overflow-x-hidden bg-gray-50/70 text-sm text-gray-900"
        style={{ width: sidebarWidth }}
      >
        <button
          type="button"
          onClick={() => setSidebarVisible(false)}
          className="absolute right-[0.5625rem] top-2 z-30 flex size-[2.125rem] shrink-0 cursor-[w-resize] items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100/50 hover:text-gray-900"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <div className="self-center p-1.5">
            <OpenWebUISidebarIcon className="size-5" />
          </div>
        </button>

        <div className="sidebar openwebui-sidebar-header sticky top-0 z-10 -mb-3 flex min-h-12 w-full justify-between space-x-1 px-[0.5625rem] pb-1.5 pr-12 pt-2 text-gray-600">
          <button
            type="button"
            onClick={() => navigate('/workspaces')}
            className="no-drag-region flex h-[2.125rem] w-[2.125rem] shrink-0 items-center justify-center rounded-xl transition hover:bg-gray-100/50"
          >
            <span className="flex size-6 translate-y-px items-center justify-center rounded-full bg-white font-primary text-[9px] font-semibold leading-none text-gray-900 shadow-sm ring-1 ring-gray-200">SL</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/workspaces')}
            className="flex min-w-0 flex-1 px-0.5 text-left"
          >
            <span id="sidebar-webui-name" className="self-center truncate font-primary font-medium text-gray-850">Synapse Link</span>
          </button>
          <div
            className={`${sidebarScrollTop > 0 ? 'visible' : 'invisible'} sidebar-bg-gradient-to-b pointer-events-none absolute inset-0 -z-10 -mb-6 bg-gradient-to-b from-gray-50/70 from-50% to-transparent`}
          />
        </div>

        <div
          className="scrollbar-hidden relative flex min-h-0 flex-1 flex-col overflow-y-auto pb-3 pt-3"
          onScroll={(event) => setSidebarScrollTop(event.currentTarget.scrollTop)}
        >
          <div className="pb-1.5">
            <div className="flex justify-center px-[0.4375rem] text-gray-800">
              <button
                id="sidebar-new-workbench-button"
                type="button"
                onClick={() => void createWorkbench()}
                disabled={creatingWorkbench}
                className="group flex grow items-center space-x-3 rounded-2xl px-2.5 py-2 text-left outline-none transition hover:bg-gray-100 disabled:opacity-60"
              >
                <div className="self-center">
                  {creatingWorkbench ? <Loader2 className="size-[1.125rem] animate-spin" /> : <OWPencilSquareIcon className="size-[1.125rem]" strokeWidth={2} />}
                </div>
                <div className="flex flex-1 self-center translate-y-[0.5px]">
                  <div className="self-center font-primary text-sm">New Workbench</div>
                </div>
              </button>
            </div>

            <div className="flex justify-center px-[0.4375rem] text-gray-800">
              <button
                type="button"
                onClick={() => setCreateWorkspaceOpen(true)}
                className="group flex grow items-center space-x-3 rounded-2xl px-2.5 py-2 text-left outline-none transition hover:bg-gray-100"
              >
                <div className="self-center">
                  <OWWorkspaceIcon className="size-[1.125rem]" strokeWidth={2} />
                </div>
                <div className="flex flex-1 self-center translate-y-[0.5px]">
                  <div className="self-center font-primary text-sm">New Workspace</div>
                </div>
              </button>
            </div>

            <div className="flex justify-center px-[0.4375rem] text-gray-800">
              <button
                id="sidebar-search-button"
                type="button"
                onClick={() => setSearchOpen((value) => !value)}
                className="group flex grow items-center space-x-3 rounded-2xl px-2.5 py-2 text-left outline-none transition hover:bg-gray-100"
              >
                <div className="self-center">
                  <OWSearchIcon className="size-[1.125rem]" strokeWidth={2} />
                </div>
                <div className="flex flex-1 self-center translate-y-[0.5px]">
                  <div className="self-center font-primary text-sm">Search</div>
                </div>
              </button>
            </div>
          </div>

          <section className="relative px-2 mt-0.5">
            <div
              id="sidebar-folder-button"
              role="button"
              tabIndex={0}
              onClick={() => setWorkspacesCollapsed((value) => !value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setWorkspacesCollapsed((value) => !value);
                }
              }}
              className="group relative flex w-full items-center justify-between rounded-xl text-gray-600 transition hover:bg-gray-100"
            >
              <button type="button" className="flex w-full items-center gap-1.5 py-1.5 pl-2 text-xs font-medium">
                <span className="translate-y-[0.5px] pl-0.5">Workspaces</span>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setCreateWorkspaceOpen(true);
                }}
                className="absolute right-2 z-10 flex items-center self-center text-gray-600 invisible group-hover:visible"
                title="New Workspace"
              >
                <span className="rounded-lg p-0.5 touch-auto">
                  <OWPlusIcon className="size-3" strokeWidth={2.5} />
                </span>
              </button>
            </div>
            <OpenWebUICollapse open={!workspacesCollapsed}>
              <div>
                {filteredWorkspaces.map((workspace) => {
                  const isActive = selectedWorkspace?.id === workspace.id;
                  const isExpanded = expandedWorkspaceIds.has(workspace.id);
                  const nestedWorkbenches = workspaceWorkbenches[workspace.id] || [];
                  return (
                    <div key={workspace.id} className="group/workspace relative" data-workspace-menu>
                      <div
                        id="folder-button"
                        className={`relative flex w-full items-center gap-1.5 rounded-xl px-1.5 py-1 text-left transition hover:bg-gray-100 ${
                          isActive ? 'bg-gray-100 text-gray-900 selected' : 'text-gray-800'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleWorkspaceExpanded(workspace.id);
                          }}
                          className="flex shrink-0 items-center justify-center rounded-lg p-1 text-gray-500 transition hover:bg-gray-200"
                          title={isExpanded ? 'Collapse workspace' : 'Expand workspace'}
                        >
                          <span className="p-[1px]">
                            {isExpanded ? <OWChevronDownIcon className="size-3" strokeWidth={2.5} /> : <OWChevronRightIcon className="size-3" strokeWidth={2.5} />}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/workspaces/${workspace.id}`)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                          <span className="min-w-0 flex-1 translate-y-[0.5px] truncate text-start">{workspace.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void createWorkbenchInWorkspace(workspace.id, true);
                          }}
                          className="absolute right-8 z-10 invisible flex items-center self-center text-gray-500 group-hover/workspace:visible"
                          title="New workbench in this workspace"
                        >
                          <span className="rounded-lg p-1 touch-auto hover:bg-gray-200">
                            <OWPlusIcon className="size-3.5" />
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setWorkspaceMenuRect(event.currentTarget.getBoundingClientRect());
                            setOpenWorkspaceMenuId((current) => current === workspace.id ? null : workspace.id);
                          }}
                          className="absolute right-2 z-10 invisible flex items-center self-center text-gray-500 group-hover/workspace:visible"
                          title="Workspace menu"
                        >
                          <span className="rounded-lg p-1 touch-auto hover:bg-gray-200">
                            <OWEllipsisHorizontalIcon className="size-4" strokeWidth={2.5} />
                          </span>
                        </button>
                      </div>

                      <OpenWebUICollapse open={isExpanded && nestedWorkbenches.length > 0}>
                        <div className="scrollbar-hidden ml-3 mt-[1px] flex flex-col overflow-y-auto border-s border-gray-100 pl-1 text-gray-900">
                          {nestedWorkbenches.map((workbench) => {
                            const sidebarWorkbench = { ...workbench, workspaceName: workspace.name };
                            const menuKey = `workspace:${workspace.id}:${workbench.id}`;
                            return (
                              <WorkbenchSidebarItem
                                key={workbench.id}
                                menuKey={menuKey}
                                workbench={sidebarWorkbench}
                                workspaceName={workspace.name}
                                workspaces={workspaces}
                                isPinned={pinnedWorkbenchIds.has(workbench.id)}
                                isEditing={editingWorkbenchId === workbench.id}
                                editingTitle={editingWorkbenchTitle}
                                emoji={inferWorkbenchEmoji(workbench.title, workbench.description)}
                                openMenu={openWorkbenchMenuId === menuKey}
                                onOpen={() => openWorkbench(workbench.id)}
                                onOpenMenu={() => setOpenWorkbenchMenuId((current) => current === menuKey ? null : menuKey)}
                                onStartRename={() => beginRenameWorkbench(workbench)}
                                onSubmitRename={() => void submitRenameWorkbench()}
                                onCancelRename={cancelRenameWorkbench}
                                onRenameChange={setEditingWorkbenchTitle}
                                onTogglePin={() => togglePinWorkbench(workbench.id)}
                                onClone={() => void cloneWorkbench(workbench)}
                                onMove={(workspaceId) => void moveWorkbench(workbench, workspaceId)}
                                onDelete={() => void deleteWorkbenchFromSidebar(workbench)}
                              />
                            );
                          })}
                        </div>
                      </OpenWebUICollapse>

                      {openWorkspaceMenuId === workspace.id ? createPortal(
                        <div
                          className="workspace-card-menu z-[9999] min-w-[170px] rounded-2xl px-1 py-1 text-sm text-gray-900"
                          style={getMenuPositionStyleStart(workspaceMenuRect, 170)}
                          data-workspace-menu
                        >
                          <button type="button" onClick={() => editWorkspace(workspace.id)} className="workspace-card-menu-item flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-left">
                            <OWPencilIcon className="size-4" />
                            Edit
                          </button>
                          <button type="button" onClick={() => exportWorkspace(workspace)} className="workspace-card-menu-item flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-left">
                            <OWDownloadIcon className="size-4" />
                            Export
                          </button>
                          <button type="button" onClick={() => void deleteWorkspace(workspace)} className="workspace-card-menu-danger workspace-card-menu-item flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-left">
                            <OWGarbageBinIcon className="size-4" />
                            Delete
                          </button>
                        </div>,
                        document.body
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </OpenWebUICollapse>
          </section>

          <section className="px-2 mt-0.5">
            <div
              id="sidebar-folder-button"
              role="button"
              tabIndex={0}
              onClick={() => setWorkbenchesCollapsed((value) => !value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setWorkbenchesCollapsed((value) => !value);
                }
              }}
              className="group relative flex w-full items-center justify-between rounded-xl text-gray-600 transition hover:bg-gray-100"
            >
              <button type="button" className="flex w-full items-center gap-1.5 py-1.5 pl-2 text-xs font-medium">
                <span className="translate-y-[0.5px] pl-0.5">Workbenches</span>
              </button>
            </div>
            <OpenWebUICollapse open={!workbenchesCollapsed}>
              <div className="scrollbar-hidden flex flex-1 flex-col overflow-y-auto">
                <div className="pt-1.5">
                  {pinnedSidebarWorkbenches.length ? (
                    <div className="mb-1">
                      <div className="flex flex-col space-y-1 rounded-xl">
                        <div
                          id="sidebar-folder-button"
                          role="button"
                          tabIndex={0}
                          onClick={() => setPinnedWorkbenchesCollapsed((value) => !value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setPinnedWorkbenchesCollapsed((value) => !value);
                            }
                          }}
                          className="group relative flex w-full items-center justify-between rounded-xl text-gray-500 transition hover:bg-gray-100"
                        >
                          <button type="button" className="flex w-full items-center gap-1.5 py-1.5 pl-2 text-xs font-medium">
                            <span className="p-[1px]">
                              {pinnedWorkbenchesCollapsed ? <OWChevronRightIcon className="size-3" strokeWidth={2} /> : <OWChevronDownIcon className="size-3" strokeWidth={2} />}
                            </span>
                            <span className="translate-y-[0.5px]">Pinned</span>
                          </button>
                        </div>
                        <OpenWebUICollapse open={!pinnedWorkbenchesCollapsed}>
                          <div className="ml-3 mt-[1px] flex flex-col overflow-y-auto border-s border-gray-100 pl-1 text-gray-900">
                            {pinnedSidebarWorkbenches.map((workbench) => (
                              <WorkbenchSidebarItem
                                key={`pinned-${workbench.id}`}
                                menuKey={`pinned:${workbench.id}`}
                                workbench={workbench}
                                workspaceName={workbench.workspaceName}
                                workspaces={workspaces}
                                isPinned
                                isEditing={editingWorkbenchId === workbench.id}
                                editingTitle={editingWorkbenchTitle}
                                emoji={inferWorkbenchEmoji(workbench.title, workbench.description)}
                                openMenu={openWorkbenchMenuId === `pinned:${workbench.id}`}
                                onOpen={() => openWorkbench(workbench.id)}
                                onOpenMenu={() => setOpenWorkbenchMenuId((current) => current === `pinned:${workbench.id}` ? null : `pinned:${workbench.id}`)}
                                onStartRename={() => beginRenameWorkbench(workbench)}
                                onSubmitRename={() => void submitRenameWorkbench()}
                                onCancelRename={cancelRenameWorkbench}
                                onRenameChange={setEditingWorkbenchTitle}
                                onTogglePin={() => togglePinWorkbench(workbench.id)}
                                onClone={() => void cloneWorkbench(workbench)}
                                onMove={(workspaceId) => void moveWorkbench(workbench, workspaceId)}
                                onDelete={() => void deleteWorkbenchFromSidebar(workbench)}
                              />
                            ))}
                          </div>
                        </OpenWebUICollapse>
                      </div>
                    </div>
                  ) : null}

                  {groupRecentWorkbenches(unpinnedSidebarWorkbenches).map((group) => (
                    <div key={group.label}>
                      <div className="w-full pl-2.5 text-xs font-medium text-gray-500 pb-1.5 pt-5 first:pt-0">{group.label}</div>
                      <div>
                        {group.items.map((workbench) => (
                          <WorkbenchSidebarItem
                            key={workbench.id}
                            menuKey={`recent:${group.label}:${workbench.id}`}
                            workbench={workbench}
                            workspaceName={workbench.workspaceName}
                            workspaces={workspaces}
                            isPinned={false}
                            isEditing={editingWorkbenchId === workbench.id}
                            editingTitle={editingWorkbenchTitle}
                            emoji={inferWorkbenchEmoji(workbench.title, workbench.description)}
                            openMenu={openWorkbenchMenuId === `recent:${group.label}:${workbench.id}`}
                            onOpen={() => openWorkbench(workbench.id)}
                            onOpenMenu={() => setOpenWorkbenchMenuId((current) => current === `recent:${group.label}:${workbench.id}` ? null : `recent:${group.label}:${workbench.id}`)}
                            onStartRename={() => beginRenameWorkbench(workbench)}
                            onSubmitRename={() => void submitRenameWorkbench()}
                            onCancelRename={cancelRenameWorkbench}
                            onRenameChange={setEditingWorkbenchTitle}
                            onTogglePin={() => togglePinWorkbench(workbench.id)}
                            onClone={() => void cloneWorkbench(workbench)}
                            onMove={(workspaceId) => void moveWorkbench(workbench, workspaceId)}
                            onDelete={() => void deleteWorkbenchFromSidebar(workbench)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  {!filteredSidebarWorkbenches.length ? (
                    <p className="px-2 text-xs leading-5 text-gray-500">No workbenches yet.</p>
                  ) : null}
                </div>
              </div>
            </OpenWebUICollapse>
          </section>
        </div>

        <div className="sidebar sticky bottom-0 z-10 -mt-3 px-1.5 pb-2 pt-1.5">
          <div className="sidebar-bg-gradient-to-t pointer-events-none absolute inset-0 -z-10 -mt-6 bg-gradient-to-t from-gray-50/70 from-50% to-transparent" />
          <div className="flex flex-col font-primary">
            <div className="flex w-full items-center rounded-2xl px-1.5 py-2 transition hover:bg-gray-100/50">
              <div className="relative mr-3 self-center">
                <div className="flex size-7 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">
                  {user?.username?.slice(0, 1).toUpperCase() || 'U'}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 inline-flex size-2.5 rounded-full border-2 border-white bg-green-500" />
              </div>
              <span className="min-w-0 flex-1 truncate self-center font-medium text-gray-850">{user?.username || 'User'}</span>
              <button
                type="button"
                onClick={() => void logout().then(() => navigate('/', { replace: true }))}
                className="flex size-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                title="Logout"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>
        <div
          onPointerDown={beginSidebarResize}
          className="relative z-20 flex shrink-0 items-center justify-center border-l border-gray-50 transition hover:border-gray-200"
          id="sidebar-resizer"
          aria-label="Resize sidebar"
          role="separator"
        >
          <div className="absolute -bottom-0 -left-1.5 -right-1.5 -top-0 z-20 cursor-col-resize bg-transparent" />
        </div>
      </>
      ) : (
        <div className="z-10 flex h-full shrink-0 flex-col justify-between border-r border-gray-50 bg-white px-2 pb-2 pt-[7px] text-black transition-all hover:bg-gray-50/30">
          <button
            type="button"
            onClick={() => setSidebarVisible(true)}
            className="flex flex-col flex-1 cursor-pointer"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <span className="flex rounded-xl transition hover:bg-gray-100">
              <span className="flex size-9 items-center justify-center self-center">
                <OpenWebUISidebarIcon className="size-5" />
              </span>
            </span>
          </button>
        </div>
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {selectedWorkspace ? (
          <div className="relative flex h-full min-h-0 w-full flex-col">
            <nav className="shrink-0 px-2.5 pt-1.5 backdrop-blur-xl select-none">
              <div className="flex items-center gap-1">
                <div className="flex gap-1 overflow-x-auto w-fit text-center text-sm font-medium rounded-full bg-transparent py-1 touch-auto pointer-events-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {workspaceTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      aria-current={activeTab === tab.id ? 'page' : undefined}
                      className={`min-w-fit p-1.5 transition select-none ${
                        activeTab === tab.id ? 'text-gray-900' : 'text-gray-300 hover:text-gray-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </nav>

        <div className={`w-full flex-1 max-h-full ${
          activeTab === 'knowledge' || activeTab === 'terminal'
            ? 'min-h-0 overflow-hidden px-0 pb-0'
            : 'overflow-y-auto px-3 pb-1 md:px-[18px]'
        }`}>

            {activeTab === 'workbenches' ? (
              createWorkbenchOpen ? (
                <CreateWorkbenchModal
                  isOpen={Boolean(selectedWorkspace)}
                  loading={creatingWorkbench}
                  error={createWorkbenchError}
                  workspaceName={selectedWorkspace.name}
                  resources={sourceFiles}
                  onClose={() => {
                    if (!creatingWorkbench) setCreateWorkbenchOpen(false);
                  }}
                  onSubmit={(payload) => void submitWorkbenchCreate(payload)}
                />
              ) : (
                <WorkbenchList
                  workbenches={selectedWorkbenches}
                  onOpen={openWorkbench}
                  onCreate={() => {
                    setCreateWorkbenchError(null);
                    setCreateWorkbenchOpen(true);
                  }}
                />
              )
            ) : null}

            {activeTab === 'files' ? (
              <FilesPanel
                workspaceId={selectedWorkspace.id}
                files={sourceFiles}
                onAdd={() => setAddSourcesOpen(true)}
                onOpenFile={(fileId) => void openFileInWorkbench(fileId)}
                onChanged={refreshSelectedWorkspace}
              />
            ) : null}

            {activeTab === 'intelligence' ? (
              <LearningIntelligenceDashboard
                workspaceId={selectedWorkspace.id}
                workbenchId={selectedWorkbenches[0]?.id}
                workbenches={selectedWorkbenches.map((workbench) => ({ id: workbench.id, title: workbench.title }))}
                activeSection={activeIntelligenceSection === 'overview' || activeIntelligenceSection === 'diagnosis' ? activeIntelligenceSection : 'overview'}
                headerTitle="Learning Intelligence"
                headerDescription="Overview 和 Diagnosis 暂时保留在这里。"
                onSectionChange={openLearningSection}
                onOpenWorkbench={openWorkbench}
                onPlanApplied={refreshSelectedWorkspace}
                onOpenTerminal={openTerminalWithPrompt}
              />
            ) : null}

            {activeTab === 'knowledge' ? (
              <LearningIntelligenceDashboard
                workspaceId={selectedWorkspace.id}
                workbenchId={selectedWorkbenches[0]?.id}
                workbenches={selectedWorkbenches.map((workbench) => ({ id: workbench.id, title: workbench.title }))}
                activeSection="knowledge"
                hideSectionNav
                headerTitle="Knowledge"
                headerDescription="概念对象、知识关系与学习路径。"
                onSectionChange={openLearningSection}
                onOpenWorkbench={openWorkbench}
                onPlanApplied={refreshSelectedWorkspace}
                onOpenTerminal={openTerminalWithPrompt}
              />
            ) : null}

            {activeTab === 'planning' ? (
              <LearningIntelligenceDashboard
                workspaceId={selectedWorkspace.id}
                workbenches={selectedWorkbenches.map((workbench) => ({ id: workbench.id, title: workbench.title }))}
                activeSection="planning"
                hideSectionNav
                headerTitle="Planning"
                headerDescription=""
                onSectionChange={openLearningSection}
                onOpenWorkbench={openWorkbench}
                onPlanApplied={refreshSelectedWorkspace}
                onOpenTerminal={openTerminalWithPrompt}
              />
            ) : null}

            {activeTab === 'profile' ? (
              <LearningIntelligenceDashboard
                workspaceId={selectedWorkspace.id}
                workbenchId={selectedWorkbenches[0]?.id}
                workbenches={selectedWorkbenches.map((workbench) => ({ id: workbench.id, title: workbench.title }))}
                activeSection="memory"
                hideSectionNav
                headerTitle="Learning Profile"
                headerDescription="学习画像、近期状态与长期记忆。"
                onSectionChange={openLearningSection}
                onOpenWorkbench={openWorkbench}
                onPlanApplied={refreshSelectedWorkspace}
                onOpenTerminal={openTerminalWithPrompt}
              />
            ) : null}

            {activeTab === 'terminal' ? (
              activeTerminalChat ? (
                <div className="flex h-full min-h-0 flex-col bg-white">
                  <div className="mx-auto flex h-14 w-full max-w-6xl shrink-0 items-center justify-between px-4 md:px-6">
                    <button
                      type="button"
                      onClick={closeTerminalChat}
                      className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
                    >
                      <Folder className="size-4" />
                      {selectedWorkspace.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => startTerminalChat()}
                      className="inline-flex size-9 items-center justify-center rounded-full text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
                      title="New Chat"
                    >
                      <Plus className="size-5" />
                    </button>
                  </div>
                  <LearningTerminal
                    key={activeTerminalChat.id}
                    workspaceId={selectedWorkspace.id}
                    sessionId={activeTerminalChat.id}
                    initialCheckpointThreadId={activeTerminalChat.checkpointThreadId}
                    workspaceName={selectedWorkspace.name}
                    major={selectedWorkspace.major}
                    workbenches={selectedWorkbenchItems}
                    fileCount={sourceFiles.length}
                    messages={currentMessages}
                    hasMoreMessages={Boolean(activeTerminalChat.hasMoreMessages)}
                    loadingEarlierMessages={Boolean(activeTerminalChat.messagesLoading)}
                    onLoadEarlierMessages={() => loadTerminalChatMessages(activeTerminalChat.id, 'earlier')}
                    onMessagesChange={updateActiveTerminalMessages}
                    onCheckpointThreadIdChange={updateActiveTerminalCheckpointThread}
                    onChatStarted={() => undefined}
                    onUploadMaterials={() => setAddSourcesOpen(true)}
                    onCreateWorkbench={() => void createWorkbench(undefined, false)}
                    onWorkbenchCreated={(workbenchId) => openWorkbench(workbenchId)}
                    onRefresh={refreshSelectedWorkspace}
                    variant="full"
                    initialPrompt={terminalDraftPrompt}
                    mode={currentTerminalMode}
                    selectedSources={currentTerminalSources}
                    chatFiles={currentTerminalChatFiles}
                    sourceFiles={terminalWorkspaceSources}
                    onModeChange={updateActiveTerminalMode}
                    onSelectedSourcesChange={(sources) => updateActiveTerminalSourceModes(sources)}
                    onChatFilesChange={updateActiveTerminalChatFiles}
                    onUploadChatFiles={uploadTerminalChatFiles}
                  />
                </div>
              ) : (
                <WorkspaceTerminalFolderChat
                  workspaceName={selectedWorkspace.name}
                  chats={currentTerminalChatSessions}
                  sourceFiles={terminalWorkspaceSources}
                  onNewChat={() => startTerminalChat()}
                  onOpenChat={openTerminalChat}
                  onSubmitPrompt={(prompt, options) => startTerminalChat(prompt, options)}
                  onUploadMaterials={() => setAddSourcesOpen(true)}
                  onCreateWorkbench={() => void createWorkbench(undefined, false)}
                  onModeChange={setTerminalDraftMode}
                  onSelectedSourcesChange={setTerminalDraftSources}
                />
              )
            ) : null}
            </div>
          </div>
        ) : (
          <EmptyWorkspaceState onCreate={() => setCreateWorkspaceOpen(true)} />
        )}
      </main>

      <CreateWorkspaceModal
        isOpen={createWorkspaceOpen}
        loading={creatingWorkspace}
        error={createWorkspaceError}
        onClose={() => {
          if (!creatingWorkspace) setCreateWorkspaceOpen(false);
        }}
        onSubmit={(draft) => void submitCreateWorkspace(draft)}
      />

      <WorkspaceSearchModal
        isOpen={searchOpen}
        query={searchQuery}
        workspaces={filteredWorkspaces}
        workbenches={filteredSidebarWorkbenches}
        onQueryChange={setSearchQuery}
        onClose={() => setSearchOpen(false)}
        onCreateWorkbench={() => void createWorkbench()}
        onOpenWorkspace={(workspaceId) => {
          setSearchOpen(false);
          navigate(`/workspaces/${workspaceId}`);
        }}
        onOpenWorkbench={(workbenchId) => {
          setSearchOpen(false);
          openWorkbench(workbenchId);
        }}
      />

      <AddSourcesDialog
        isOpen={Boolean(addSourcesOpen && selectedWorkspace)}
        onClose={() => setAddSourcesOpen(false)}
        onUploadFiles={uploadWorkspaceFiles}
        onAddWebsite={addWorkspaceWebsite}
        onAddText={addWorkspaceText}
        onDiscoverSources={discoverWorkspaceSources}
        onImportDiscoveredSources={importWorkspaceSources}
      />
    </div>
  );
}

function WorkspaceSearchModal({
  isOpen,
  query,
  workspaces,
  workbenches,
  onQueryChange,
  onClose,
  onCreateWorkbench,
  onOpenWorkspace,
  onOpenWorkbench
}: {
  isOpen: boolean;
  query: string;
  workspaces: Workspace[];
  workbenches: SidebarWorkbench[];
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onCreateWorkbench: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenWorkbench: (workbenchId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const actionCount = 1;
  const totalCount = actionCount + workspaces.length + workbenches.length;

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIdx((current) => Math.min((current ?? -1) + 1, Math.max(totalCount - 1, 0)));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIdx((current) => Math.max((current ?? 0) - 1, 0));
      }
      if (event.key === 'Enter' && selectedIdx !== null) {
        event.preventDefault();
        if (selectedIdx === 0) onCreateWorkbench();
        const workspaceIdx = selectedIdx - actionCount;
        if (workspaceIdx >= 0 && workspaceIdx < workspaces.length) onOpenWorkspace(workspaces[workspaceIdx].id);
        const workbenchIdx = selectedIdx - actionCount - workspaces.length;
        if (workbenchIdx >= 0 && workbenchIdx < workbenches.length) onOpenWorkbench(workbenches[workbenchIdx].id);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, onCreateWorkbench, onOpenWorkbench, onOpenWorkspace, selectedIdx, totalCount, workbenches, workspaces]);

  useEffect(() => {
    if (isOpen) setSelectedIdx(null);
  }, [isOpen, query]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex h-screen max-h-[100dvh] w-full justify-center overflow-y-auto overscroll-contain bg-black/30 p-3 animate-[openwebui-fade_10ms_ease-out]"
      onMouseDown={onClose}
    >
      <style>
        {`@keyframes openwebui-fade { from { opacity: 0; } to { opacity: 1; } }
          @keyframes openwebui-scale-up { from { transform: scale(0.985); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}
      </style>
      <div
        className="m-auto max-h-[min(44rem,calc(100vh-24px))] min-h-fit w-full max-w-[70rem] overflow-hidden rounded-[32px] border border-white bg-white/95 text-gray-700 shadow-[0_24px_90px_rgba(0,0,0,0.24)] backdrop-blur-sm animate-[openwebui-scale-up_100ms_ease-out_forwards]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="py-3">
          <div className="px-4 pb-1.5">
            <div className="flex w-full items-center rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-gray-700">
              <OWSearchIcon className="mr-2 size-4 text-gray-500" />
              <input
                id="search-input"
                ref={inputRef}
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search"
                className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
              />
              {query ? (
                <button type="button" onClick={() => onQueryChange('')} className="rounded-lg p-0.5 text-gray-500 hover:bg-gray-100">
                  <OWXMarkIcon className="size-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex px-4 pb-1">
            <div className="flex h-96 max-h-full w-full flex-1 flex-col overflow-y-auto pr-2 md:h-[40rem] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="w-full px-2 pb-2 text-xs font-medium text-gray-500">Actions</div>
              <button
                type="button"
                className={`flex w-full items-center rounded-xl px-3 py-2 text-sm hover:bg-gray-50 ${selectedIdx === 0 ? 'bg-gray-50' : ''}`}
                data-arrow-selected={selectedIdx === 0 ? 'true' : undefined}
                onMouseEnter={() => setSelectedIdx(0)}
                onClick={onCreateWorkbench}
              >
                <div className="pr-2"><OWPencilSquareIcon /></div>
                <div className="flex-1 text-left"><div className="line-clamp-1 w-full text-ellipsis">Start a new workbench</div></div>
              </button>

              <hr className="my-3 border-gray-50" />

              {workspaces.length ? (
                <>
                  <div className="w-full px-2 pb-2 text-xs font-medium text-gray-500">Workspaces</div>
                  {workspaces.map((workspace, idx) => {
                    const selected = selectedIdx === actionCount + idx;
                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        className={`flex w-full items-center rounded-xl px-3 py-2 text-sm hover:bg-gray-50 ${selected ? 'bg-gray-50' : ''}`}
                        data-arrow-selected={selected ? 'true' : undefined}
                        onMouseEnter={() => setSelectedIdx(actionCount + idx)}
                        onClick={() => onOpenWorkspace(workspace.id)}
                      >
                        <div className="pr-2"><OWFolderOpenIcon /></div>
                        <div className="flex-1 text-left"><div className="line-clamp-1 w-full text-ellipsis">{workspace.name}</div></div>
                      </button>
                    );
                  })}
                </>
              ) : null}

              {workbenches.length ? (
                <>
                  <div className="w-full px-2 pb-2 pt-5 text-xs font-medium text-gray-500">Workbenches</div>
                  {workbenches.map((workbench, idx) => {
                    const selected = selectedIdx === actionCount + workspaces.length + idx;
                    return (
                      <button
                        key={workbench.id}
                        type="button"
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-gray-50 ${selected ? 'bg-gray-50' : ''}`}
                        data-arrow-selected={selected ? 'true' : undefined}
                        onMouseEnter={() => setSelectedIdx(actionCount + workspaces.length + idx)}
                        onClick={() => onOpenWorkbench(workbench.id)}
                      >
                        <div className="min-w-0 flex-1 text-left"><div className="line-clamp-1 w-full text-ellipsis">{workbench.title}</div></div>
                        <div className="shrink-0 pl-3 text-xs text-gray-500">{workbench.workspaceName}</div>
                      </button>
                    );
                  })}
                </>
              ) : null}

              {!workspaces.length && !workbenches.length ? (
                <div className="px-5 py-4 text-center text-xs text-gray-500">No results found</div>
              ) : null}
            </div>
            <div className="hidden h-96 w-full flex-1 items-center justify-center overflow-y-auto text-sm text-gray-500 md:flex md:h-[40rem] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              Select a workspace or workbench to preview
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkbenchList({
  workbenches,
  onOpen,
  onCreate
}: {
  workbenches: Workbench[];
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const sorted = [...workbenches].sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  const grouped = sorted.map((workbench) => ({
    ...workbench,
    timeRange: getTimeRange(workbench.updatedAt || workbench.createdAt)
  }));

  return (
    <section className="text-left text-sm w-full mb-3">
      <WorkspacePanelHeader
        title="Workbenches"
        count={sorted.length}
        actionLabel="New Workbench"
        onAction={onCreate}
      />

      {grouped.length ? (
        <div className="flex text-xs font-medium mb-1 items-center -mr-0.5">
          <button type="button" className="px-1.5 py-1 cursor-pointer select-none basis-3/5 text-left">
            <div className="flex gap-1.5 items-center">
              Title
              <span className="invisible">
                <OWChevronUpIcon className="size-2" />
              </span>
            </div>
          </button>
          <button type="button" className="px-1.5 py-1 cursor-pointer select-none hidden sm:flex sm:basis-2/5 justify-end">
            <div className="flex gap-1.5 items-center">
              Updated at
              <OWChevronDownIcon className="size-2" />
            </div>
          </button>
        </div>
      ) : null}

      {sorted.length ? (
        grouped.map((workbench, idx) => (
          <React.Fragment key={workbench.id}>
            {idx === 0 || workbench.timeRange !== grouped[idx - 1].timeRange ? (
              <div className={`w-full text-xs text-gray-500 font-medium ${idx === 0 ? '' : 'pt-5'} pb-2 px-2`}>
                {workbench.timeRange}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => onOpen(workbench.id)}
              className="w-full flex justify-between items-center rounded-lg text-sm py-2 px-3 hover:bg-gray-50"
            >
              <div className="flex min-w-0 w-full sm:basis-3/5 items-center gap-2 text-left">
                <span className="shrink-0 text-sm leading-none" aria-hidden="true">
                  {inferWorkbenchEmoji(workbench.title, workbench.description)}
                </span>
                <div className="text-ellipsis line-clamp-1 min-w-0">
                  {workbench.title}
                </div>
              </div>

              <div className="hidden sm:flex sm:basis-2/5 items-center justify-end">
                <div className="text-gray-500 text-xs">
                  {formatCalendarDate(workbench.updatedAt || workbench.createdAt)}
                </div>
              </div>
            </button>
          </React.Fragment>
        ))
      ) : (
        <div className="text-xs text-gray-500 text-center px-5 min-h-20 w-full h-full flex flex-col justify-center items-center">
          <div>No workbenches found</div>
          <button type="button" onClick={onCreate} className="mt-4 px-2 py-1.5 rounded-xl bg-black text-white transition font-medium text-sm flex items-center">
            <OWPlusIcon className="size-3" strokeWidth={2.5} />
            <span className="ml-1 text-xs">New Workbench</span>
          </button>
        </div>
      )}
    </section>
  );
}

function WorkspacePanelHeader({
  title,
  count,
  actionLabel,
  onAction
}: {
  title: string;
  count?: number;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 px-1 mt-1.5 mb-3">
      <div className="flex justify-between items-center">
        <div className="flex items-center md:self-center text-xl font-medium px-0.5 gap-2 shrink-0">
          <div>{title}</div>
          {typeof count === 'number' ? <div className="text-lg font-medium text-gray-500">{count}</div> : null}
        </div>

        {actionLabel && onAction ? (
          <div className="flex w-full justify-end gap-1.5">
            <button
              type="button"
              onClick={onAction}
              className="px-2 py-1.5 rounded-xl bg-black text-white transition font-medium text-sm flex items-center"
            >
              <OWPlusIcon className="size-3" strokeWidth={2.5} />
              <div className="hidden md:block md:ml-1 text-xs">{actionLabel}</div>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OWYouTubeIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.8 12l-6.2 3.6Z" />
    </svg>
  );
}

const knowledgeTypeItems = [
  { value: '', label: 'All' },
  { value: 'uploaded', label: 'Uploaded file' },
  { value: 'web', label: 'Web source' },
  { value: 'generated', label: 'Generated' },
  { value: 'notes', label: 'Notes' }
];

function KnowledgeTypeSelector({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const selectedLabel = knowledgeTypeItems.find((item) => item.value === value)?.label || 'All';

  const closeDropdown = React.useCallback(() => {
    if (!open || closing) return;
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 200);
  }, [closing, open]);

  useEffect(() => {
    if (!open) return;

    const updateRect = () => {
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    };
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || contentRef.current?.contains(target))) return;
      closeDropdown();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDropdown();
    };

    updateRect();
    window.addEventListener('click', close);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [closeDropdown, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Select view"
        onClick={(event) => {
          event.stopPropagation();
          setRect(event.currentTarget.getBoundingClientRect());
          if (open) {
            closeDropdown();
          } else {
            setClosing(false);
            setOpen(true);
          }
        }}
        className="relative w-full flex items-center gap-0.5 px-2.5 py-1.5 bg-gray-50 rounded-xl"
      >
        <span className="inline-flex h-input px-0.5 w-full outline-none bg-transparent truncate placeholder-gray-400 focus:outline-none">
          {selectedLabel}
        </span>
        <OWChevronDownIcon className="size-3.5" strokeWidth={2.5} />
      </button>

      {open && rect ? createPortal(
        <>
          <style>
            {`@keyframes openwebui-fly-and-scale {
              from { transform: translate3d(0, -8px, 0) scale(0.95); opacity: 0; }
              to { transform: translate3d(0, 0, 0) scale(1); opacity: 1; }
            }`}
          </style>
          <div
            ref={contentRef}
            className="rounded-2xl min-w-[170px] p-1 border border-gray-100 bg-white shadow-lg"
            style={{
              position: 'fixed',
              zIndex: 9999,
              top: rect.bottom + 4,
              left: rect.left,
              minWidth: rect.width,
              animation: closing
                ? 'openwebui-fly-and-scale 200ms cubic-bezier(0.33, 1, 0.68, 1) reverse forwards'
                : 'openwebui-fly-and-scale 200ms cubic-bezier(0.33, 1, 0.68, 1) forwards'
            }}
          >
            {knowledgeTypeItems.map((item) => {
              const selected = item.value === value;
              return (
                <button
                  key={item.value || 'all'}
                  type="button"
                  onClick={() => {
                    onChange(item.value);
                    closeDropdown();
                  }}
                  className="flex w-full gap-2 items-center px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 rounded-xl"
                >
                  {item.label}
                  <div className={`ml-auto ${selected ? '' : 'invisible'}`}>
                    <OWCheckIcon className="size-4" />
                  </div>
                </button>
              );
            })}
          </div>
        </>,
        document.body
      ) : null}
    </>
  );
}

const getKnowledgeTypeGroup = (file: NonNullable<Workspace['fileObjects']>[number]) => {
  const section = getFileSectionLabel(file);
  if (section === 'Generated') return 'generated';
  if (section === 'Note') return 'notes';
  if (section === 'Web source' || section === 'YouTube' || section === 'Bilibili') return 'web';
  if (section === 'Uploaded file' || section === 'Code' || section === 'Document') return 'uploaded';
  if (file.origin === 'upload') return 'uploaded';
  if (file.origin === 'web') return 'web';
  return '';
};

function FilesPanel({
  workspaceId,
  files,
  onAdd,
  onOpenFile,
  onChanged
}: {
  workspaceId: string;
  files: NonNullable<Workspace['fileObjects']>;
  onAdd: () => void;
  onOpenFile: (fileId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [knowledgeType, setKnowledgeType] = useState('');
  const [openMenuFileId, setOpenMenuFileId] = useState<string | null>(null);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const [indexingFileId, setIndexingFileId] = useState<string | null>(null);
  const sorted = [...files].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-resource-menu]')) return;
      setOpenMenuFileId(null);
    };

    window.addEventListener('pointerdown', closeMenu);
    return () => window.removeEventListener('pointerdown', closeMenu);
  }, []);

  const visibleFiles = sorted.filter((file) => {
    const section = getFileSectionLabel(file);
    if (knowledgeType && getKnowledgeTypeGroup(file) !== knowledgeType) return false;

    const value = query.trim().toLowerCase();
    if (!value) return true;
    return [
      file.name,
      getFileDisplayName(file),
      file.path,
      section,
      file.resourceType,
      file.fileCategory,
      file.origin,
      file.extension
    ]
      .filter(Boolean)
      .some((item) => String(item).toLowerCase().includes(value));
  });

  const formatFileSize = (size?: number) => {
    if (!size) return '-';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  };

  const renderFileIcon = (file: NonNullable<Workspace['fileObjects']>[number], coverUrl?: string, faviconUrl?: string) => {
    const sourceUrl = getFileSourceUrl(file).toLowerCase();
    const extension = (file.extension || file.name.split('.').pop() || '').toLowerCase();
    const mimeType = (file.mimeType || '').toLowerCase();

    if (coverUrl) return <img src={coverUrl} alt="" className="h-full w-full object-cover" />;
    if (sourceUrl.includes('youtube.com') || sourceUrl.includes('youtu.be')) return <OWYouTubeIcon className="size-4 text-red-600" />;
    if (faviconUrl) return <img src={faviconUrl} alt="" className="h-4 w-4 rounded-sm" />;
    if (file.origin === 'web') return <Globe2 className="size-4" />;
    if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) return <FileImage className="size-4" />;
    if (mimeType.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv'].includes(extension)) return <FileVideo className="size-4" />;
    if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'html', 'css', 'json', 'sql'].includes(extension) || file.fileCategory === 'code') return <FileCode className="size-4" />;
    return <FileText className="size-4" />;
  };

  const exportFile = (fileId: string) => {
    window.open(fileSystemApi.downloadUrl(workspaceId, fileId), '_blank', 'noopener,noreferrer');
    setOpenMenuFileId(null);
  };

  const deleteFile = async (fileId: string) => {
    setOpenMenuFileId(null);
    await fileSystemApi.remove(workspaceId, fileId);
    await onChanged();
  };

  const indexFile = async (fileId: string, force = false) => {
    setIndexingFileId(fileId);
    try {
      await learningApi.indexKnowledgeFile(workspaceId, fileId, { force });
      await onChanged();
    } finally {
      setIndexingFileId(null);
      setOpenMenuFileId(null);
    }
  };

  return (
    <section>
      <WorkspacePanelHeader title="Knowledge" count={sorted.length} actionLabel="Add Knowledge" onAction={onAdd} />

      <div className="py-2 bg-white rounded-3xl border border-gray-100/30">
        <div className="flex w-full space-x-2 py-0.5 px-3.5 pb-2">
          <div className="flex flex-1 items-center">
            <div className="self-center ml-1 mr-3">
              <OWSearchIcon className="size-3.5" />
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full text-sm py-1 rounded-r-xl outline-none bg-transparent"
              placeholder="Search Knowledge"
            />
            {query ? (
              <div className="self-center pl-1.5 translate-y-[0.5px] rounded-l-xl bg-transparent">
                <button type="button" onClick={() => setQuery('')} className="p-0.5 rounded-full hover:bg-gray-100 transition" aria-label="Clear search">
                  <OWXMarkIcon className="size-3" />
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div
          className="px-3 flex w-full bg-transparent overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-1"
          onWheel={(event) => {
            if (event.deltaY !== 0) {
              event.preventDefault();
              event.currentTarget.scrollLeft += event.deltaY;
            }
          }}
        >
          <div className="flex gap-0.5 w-fit text-center text-sm rounded-full bg-transparent px-1.5 whitespace-nowrap">
            <KnowledgeTypeSelector value={knowledgeType} onChange={setKnowledgeType} />
          </div>
        </div>

        {visibleFiles.length ? (
          <div className="my-2 px-3 grid grid-cols-1 lg:grid-cols-2 gap-2">
            {visibleFiles.map((file) => {
              const section = getFileSectionLabel(file);
              const coverUrl = getFileCoverUrl(file);
              const faviconUrl = getFileFaviconUrl(file);
              const displayName = getFileDisplayName(file);
              const indexStatus = getKnowledgeIndexStatusInfo(file);

              return (
                <div
                  key={file.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenFile(file.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onOpenFile(file.id);
                  }}
                  className="relative flex space-x-4 cursor-pointer text-left w-full px-3 py-2.5 hover:bg-gray-50 transition rounded-2xl"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100 text-gray-500">
                    {renderFileIcon(file, coverUrl, faviconUrl)}
                  </span>

                  <div className="w-full min-w-0">
                    <div className="self-center flex-1 justify-between">
                      <div className="flex items-center justify-between -my-1 h-8">
                        <div className="flex gap-2 items-center justify-between w-full">
                          <div>
                            <span className="w-fit rounded-lg bg-green-500/20 px-[5px] text-xs font-medium uppercase line-clamp-1 mr-0.5 text-green-700">
                              {section}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="grid min-h-6 grid-cols-[minmax(0,1fr)_minmax(11rem,auto)] items-center gap-3 px-1.5 pr-0">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <div className="text-sm font-medium line-clamp-1">{displayName}</div>
                        </div>

                        <div className="hidden min-w-0 items-center justify-end gap-2 text-xs text-gray-500 whitespace-nowrap sm:flex">
                          <div className="whitespace-nowrap">{file.origin || file.resourceType || file.fileCategory || '-'}</div>
                          <div className="whitespace-nowrap">{formatRelative(file.updatedAt)}</div>
                          <div className="whitespace-nowrap">{formatFileSize(file.size)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <button
                    data-resource-menu={file.id}
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuRect(event.currentTarget.getBoundingClientRect());
                      setOpenMenuFileId(openMenuFileId === file.id ? null : file.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      event.stopPropagation();
                      setMenuRect(event.currentTarget.getBoundingClientRect());
                      setOpenMenuFileId(openMenuFileId === file.id ? null : file.id);
                    }}
                    className="absolute right-2 top-2 flex self-center w-fit text-sm p-1.5 text-gray-700 hover:bg-black/5 rounded-xl"
                    aria-label="More Options"
                  >
                    <OWEllipsisHorizontalIcon className="size-5" />
                  </button>
                  {openMenuFileId === file.id ? createPortal(
                    <div
                      className="workspace-card-menu z-[9999] min-w-[170px] rounded-2xl px-1 py-1 text-sm text-gray-900"
                      style={getMenuPositionStyle(menuRect, 170)}
                      data-resource-menu={file.id}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <div
                        className="flex w-full select-none items-start gap-2 rounded-xl px-3 py-2 text-left"
                        title={indexStatus.detail}
                      >
                        <BookOpen className="mt-0.5 size-4 shrink-0 text-gray-500" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span>Status</span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${knowledgeIndexToneClass(indexStatus.tone)}`}>
                              {indexStatus.label}
                            </span>
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">{indexStatus.detail}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={indexingFileId === file.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void indexFile(file.id, indexStatus.chunkCount > 0);
                        }}
                        className="workspace-card-menu-item flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-left disabled:cursor-wait disabled:opacity-60"
                      >
                        {indexingFileId === file.id ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                        {indexStatus.chunkCount > 0 ? 'Re-index' : 'Index now'}
                      </button>
                      <button type="button" onClick={() => exportFile(file.id)} className="workspace-card-menu-item flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-left">
                        <OWDownloadIcon className="size-4" />
                        Export
                      </button>
                      <button type="button" onClick={() => void deleteFile(file.id)} className="workspace-card-menu-item workspace-card-menu-danger flex w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-left">
                        <OWGarbageBinIcon className="size-4" />
                        Delete
                      </button>
                    </div>,
                    document.body
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="w-full h-full flex flex-col justify-center items-center my-16 mb-24">
            <div className="max-w-md text-center">
              <div className="text-3xl mb-3">😕</div>
              <div className="text-lg font-medium mb-1">{query.trim() ? 'No knowledge found' : 'No knowledge yet'}</div>
              <div className="text-gray-500 text-center text-xs">
                {query.trim() ? 'Try adjusting your search to find what you are looking for.' : 'Upload knowledge, add web sources, or paste text into this workspace.'}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="text-gray-500 text-xs m-2">ⓘ Use knowledge inside your workbenches.</div>
    </section>
  );
}

function ToolsPanel({
  workspace,
  workbenchCount,
  sourceCount,
  onCreateWorkbench,
  onAddKnowledge
}: {
  workspace: Workspace;
  workbenchCount: number;
  sourceCount: number;
  onCreateWorkbench: () => void;
  onAddKnowledge: () => void;
}) {
  return (
    <section>
      <h1 className="text-4xl font-semibold tracking-normal text-[#34373c]">Tools</h1>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {[
          { label: 'Workbenches', value: workbenchCount, icon: LayoutDashboard },
          { label: 'Knowledge', value: sourceCount, icon: LibraryBig },
          { label: 'Updated', value: formatDate(workspace.updatedAt), icon: Sparkles }
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-[24px] border border-[#eeeeeb] p-5">
              <Icon className="h-5 w-5 text-[#777b80]" />
              <p className="mt-5 text-sm font-semibold text-[#777b80]">{item.label}</p>
              <p className="mt-1 text-2xl font-semibold text-[#34373c]">{item.value}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={onCreateWorkbench} className="inline-flex h-10 items-center gap-2 rounded-full bg-[#202124] px-4 text-sm font-semibold text-white hover:bg-black">
          <Plus className="h-4 w-4" />
          New Workbench
        </button>
        <button type="button" onClick={onAddKnowledge} className="inline-flex h-10 items-center gap-2 rounded-full bg-[#f5f5f4] px-4 text-sm font-semibold text-[#34373c] hover:bg-[#eeeeeb]">
          <Upload className="h-4 w-4" />
          Add Knowledge
        </button>
      </div>
    </section>
  );
}

function WorkspaceTerminalFolderChat({
  workspaceName,
  chats,
  sourceFiles,
  onNewChat,
  onOpenChat,
  onSubmitPrompt,
  onUploadMaterials,
  onCreateWorkbench,
  onModeChange,
  onSelectedSourcesChange
}: {
  workspaceName: string;
  chats: TerminalChatSession[];
  sourceFiles: TerminalSourceFile[];
  onNewChat: () => void;
  onOpenChat: (chatId: string) => void;
  onSubmitPrompt: (prompt: string, options: { mode: TerminalChatMode; selectedSources: Array<{ fileId: string; mode: 'focused' | 'full_context' }> }) => void;
  onUploadMaterials: () => void;
  onCreateWorkbench: () => void;
  onModeChange: (mode: TerminalChatMode) => void;
  onSelectedSourcesChange: (sources: Array<{ fileId: string; mode: 'focused' | 'full_context' }>) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<TerminalChatMode>('chat');
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [sourceModes, setSourceModes] = useState<Record<string, 'focused' | 'full_context'>>({});
  const sourceMenuRef = useRef<HTMLDivElement | null>(null);
  const [orderBy, setOrderBy] = useState<'title' | 'updatedAt'>('updatedAt');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const selectedSourceCount = Object.keys(sourceModes).length;
  const modeLabel = mode === 'agentic' ? 'Agentic' : 'Chat';

  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      const aValue = orderBy === 'title' ? a.title.toLowerCase() : new Date(a.updatedAt).getTime();
      const bValue = orderBy === 'title' ? b.title.toLowerCase() : new Date(b.updatedAt).getTime();
      if (aValue === bValue) return 0;
      if (direction === 'asc') return aValue > bValue ? 1 : -1;
      return aValue < bValue ? 1 : -1;
    });
  }, [chats, direction, orderBy]);

  const groupedChats = useMemo(() => {
    const groups: Array<{ label: string; items: TerminalChatSession[] }> = [];
    sortedChats.forEach((chat) => {
      const label = getTimeRange(chat.updatedAt);
      const group = groups.find((item) => item.label === label);
      if (group) group.items.push(chat);
      else groups.push({ label, items: [chat] });
    });
    return groups;
  }, [sortedChats]);

  const toggleSort = (key: 'title' | 'updatedAt') => {
    if (orderBy === key) {
      setDirection((value) => value === 'asc' ? 'desc' : 'asc');
      return;
    }
    setOrderBy(key);
    setDirection('asc');
  };

  const submitPrompt = () => {
    const value = prompt.trim();
    if (!value) return;
    const selectedSources = Object.entries(sourceModes).map(([fileId, sourceMode]) => ({ fileId, mode: sourceMode }));
    onSubmitPrompt(value, { mode, selectedSources });
    setPrompt('');
  };

  useEffect(() => {
    onModeChange(mode);
  }, [mode, onModeChange]);

  useEffect(() => {
    onSelectedSourcesChange(Object.entries(sourceModes).map(([fileId, sourceMode]) => ({ fileId, mode: sourceMode })));
  }, [onSelectedSourcesChange, sourceModes]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (sourceMenuRef.current?.contains(target)) return;
      setSourceMenuOpen(false);
    };

    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const SortIcon = ({ active }: { active: boolean }) => (
    <ChevronDown
      className={`size-2 transition ${active ? 'opacity-100' : 'opacity-0'} ${active && direction === 'asc' ? 'rotate-180' : ''}`}
      strokeWidth={2.5}
    />
  );

  return (
    <section className="font-primary h-full min-h-0 overflow-y-auto bg-white text-gray-900">
      <div className="mx-auto flex min-h-full w-full flex-col px-4 pb-14 pt-[clamp(44px,7vh,96px)]">
        <div className="mx-auto w-full md:max-w-3xl">
          <div className="mb-3 flex w-full items-center justify-between px-6">
            <div className="flex min-w-0 items-center gap-3.5 text-center">
              <button
                type="button"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gray-50 text-gray-800 transition hover:bg-gray-100"
                title="Workspace chat folder"
              >
                <Folder className="size-4.5" strokeWidth={2} />
              </button>
              <h1 className="min-w-0 truncate text-3xl font-normal leading-tight text-gray-800">
                {workspaceName}
              </h1>
            </div>
            <button
              type="button"
              className="flex shrink-0 translate-x-2.5 items-center justify-center rounded-full p-1.5 text-gray-700 transition hover:bg-gray-100"
              title="Folder options"
            >
              <MoreHorizontal className="size-4" strokeWidth={2.5} />
            </button>
          </div>

          <form
            className="w-full py-3 text-base font-normal"
            onSubmit={(event) => {
              event.preventDefault();
              submitPrompt();
            }}
          >
            <div className="flex flex-1 flex-col rounded-3xl border border-gray-100/30 bg-white/5 px-1 shadow-lg backdrop-blur-sm transition hover:border-gray-200 focus-within:border-gray-100">
              <div className="px-2.5">
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      submitPrompt();
                    }
                  }}
                  placeholder="How can I help you today?"
                  rows={1}
                  className="scrollbar-hidden min-h-[48px] max-h-96 w-full resize-none bg-transparent px-1 pb-1 pt-2.5 text-sm leading-6 text-gray-900 outline-none placeholder:text-gray-500"
                />
              </div>
              <div className="mx-0.5 mb-2.5 mt-0.5 flex max-w-full justify-between" dir="ltr">
                <div className="ml-1 flex max-w-[80%] flex-1 items-center self-end">
                  <button
                    type="button"
                    onClick={onUploadMaterials}
                    className="flex size-8 items-center justify-center rounded-full bg-transparent text-gray-700 outline-none transition hover:bg-gray-100"
                    title="Add"
                  >
                    <Plus className="size-5" strokeWidth={2} />
                  </button>
                  <div className="mx-1 h-4 w-px self-center bg-gray-200/50" />
                  <div ref={sourceMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setSourceMenuOpen((current) => !current)}
                      className="flex size-8 items-center justify-center rounded-full bg-transparent text-gray-700 outline-none transition hover:bg-gray-100"
                      title="Chat mode"
                    >
                      <Sparkles className="size-[1.125rem]" strokeWidth={1.5} />
                    </button>
                    {sourceMenuOpen ? (
                      <div className="absolute bottom-10 left-0 z-50 max-h-72 min-w-[17.5rem] max-w-[17.5rem] overflow-y-auto overflow-x-hidden rounded-2xl border border-gray-100 bg-white px-1 py-1 text-sm text-gray-900 shadow-lg">
                        <div className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-sm">
                          <Wrench className="size-4" strokeWidth={1.75} />
                          <div className="flex w-full items-center justify-between">
                            <div className="line-clamp-1">
                              Mode <span className="ml-0.5 text-gray-500">{modeLabel}</span>
                            </div>
                          </div>
                        </div>
                        {([
                          { value: 'chat' as const, label: 'Chat' },
                          { value: 'agentic' as const, label: 'Agentic' }
                        ]).map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => setMode(item.value)}
                            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-sm transition hover:bg-gray-50"
                          >
                            <div className="flex flex-1 items-center gap-2 truncate">
                              <Sparkles className="size-4" strokeWidth={1.75} />
                              <div className="truncate">{item.label}</div>
                            </div>
                            {mode === item.value ? <Check className="size-4 shrink-0 text-gray-900" /> : null}
                          </button>
                        ))}
                        <div className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-sm">
                          <BookOpen className="size-4" strokeWidth={1.75} />
                          <div className="flex w-full items-center justify-between">
                            <div className="line-clamp-1">Workspace scope</div>
                          </div>
                          {selectedSourceCount > 0 ? <span>{selectedSourceCount}</span> : null}
                        </div>
                        <div>
                          {sourceFiles.length > 0 ? sourceFiles.map((source) => {
                            const active = Boolean(sourceModes[source.id]);
                            return (
                              <div key={source.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-sm transition hover:bg-gray-50">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSourceModes((current) => {
                                      const next = { ...current };
                                      if (next[source.id]) delete next[source.id];
                                      else next[source.id] = 'focused';
                                      return next;
                                    });
                                  }}
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <div className="truncate text-gray-900">{source.name}</div>
                                  <div className="truncate text-xs text-gray-500">{source.path}</div>
                                  <div className="mt-1 flex min-w-0 items-center gap-1.5">
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${knowledgeIndexToneClass(source.indexStatusTone)}`}>
                                      {source.indexStatusLabel || 'Unknown'}
                                    </span>
                                    <span className="truncate text-[10px] text-gray-400">
                                      {source.indexStatusDetail || 'Index status unavailable'}
                                    </span>
                                  </div>
                                  {active && Number(source.chunkCount || 0) === 0 ? (
                                    <div className="mt-1 text-[10px] text-red-500">No chunks yet; focused retrieval may not find evidence.</div>
                                  ) : null}
                                </button>
                                {active ? <Check className="size-4 shrink-0 text-black" /> : null}
                              </div>
                            );
                          }) : (
                            <div className="px-3 py-1.5 text-sm text-gray-500">No workspace sources available.</div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mr-1 flex shrink-0 items-center gap-[0.5px] self-end">
                  <button
                    type="submit"
                    className={`self-center rounded-full p-1.5 transition ${
                      prompt.trim()
                        ? 'bg-black text-white hover:bg-gray-900'
                        : 'cursor-not-allowed bg-gray-200 text-white'
                    }`}
                    disabled={!prompt.trim()}
                    title="New Chat"
                  >
                    <ArrowUp className="size-5" strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            </div>
          </form>

          <div className="min-h-[15.5rem] px-4 md:px-6">
            <div className="mb-1 flex items-center -mr-0.5 text-xs font-medium text-gray-900">
              <button
                type="button"
                onClick={() => toggleSort('title')}
                className="basis-3/5 cursor-pointer select-none px-1.5 py-1 text-left"
              >
                <span className="flex items-center gap-1.5">
                  Title
                  <SortIcon active={orderBy === 'title'} />
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleSort('updatedAt')}
                className="hidden basis-2/5 cursor-pointer select-none justify-end px-1.5 py-1 text-right sm:flex"
              >
                <span className="flex items-center gap-1.5">
                  Updated at
                  <SortIcon active={orderBy === 'updatedAt'} />
                </span>
              </button>
            </div>

            {groupedChats.length ? (
              <div className="mb-3 w-full text-left text-sm">
                {groupedChats.map((group, groupIndex) => (
                  <div key={group.label}>
                    <div className={`w-full px-2 pb-2 text-xs font-medium text-gray-500 ${groupIndex === 0 ? '' : 'pt-5'}`}>
                      {group.label}
                    </div>
                    {group.items.map((chat) => (
                      <button
                        key={chat.id}
                        type="button"
                        onClick={() => onOpenChat(chat.id)}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition hover:bg-gray-50"
                      >
                        <span className="line-clamp-1 w-full min-w-0 text-ellipsis text-left sm:basis-3/5">
                          {chat.title || 'New Chat'}
                        </span>
                        <span className="hidden basis-2/5 items-center justify-end sm:flex">
                          <span className="text-xs text-gray-500">{formatCalendarDate(chat.updatedAt)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-20 items-center justify-center px-5 text-center text-xs text-gray-500">
                No chats found
              </div>
            )}

            <button
              type="button"
              onClick={onNewChat}
              className="mt-2 rounded-lg px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
            >
              New Chat
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function EmptyWorkspaceState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-md text-center">
        <BookOpen className="mx-auto h-10 w-10 text-[#96999d]" />
        <h1 className="mt-5 text-2xl font-semibold text-[#34373c]">Create your first workspace</h1>
        <p className="mt-2 text-sm leading-6 text-[#777b80]">A workspace organizes course context, knowledge, resources, and workbenches.</p>
        <button type="button" onClick={onCreate} className="mt-6 h-10 rounded-full bg-[#202124] px-5 text-sm font-semibold text-white hover:bg-black">
          New Workspace
        </button>
      </div>
    </div>
  );
}

function OpenWebUICollapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const element = innerRef.current;
    if (!element) return;

    const updateHeight = () => setHeight(element.scrollHeight);
    updateHeight();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children, open]);

  return (
    <div
      className={`overflow-hidden transition-[height,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
        open ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ height: open ? height : 0 }}
      aria-hidden={!open}
    >
      <div ref={innerRef}>
        {children}
      </div>
    </div>
  );
}

function OpenWebUISidebarIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="1.5"
      stroke="currentColor"
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="5" ry="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 21V3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WorkbenchSidebarItem({
  menuKey,
  workbench,
  workspaceName,
  workspaces,
  isPinned,
  isEditing,
  editingTitle,
  emoji,
  onOpen,
  onOpenMenu,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onRenameChange,
  onTogglePin,
  onClone,
  onMove,
  onDelete,
  openMenu
}: {
  menuKey: string;
  workbench: SidebarWorkbench;
  workspaceName: string;
  workspaces: Workspace[];
  isPinned: boolean;
  isEditing: boolean;
  editingTitle: string;
  emoji: string;
  onOpen: () => void;
  onOpenMenu: () => void;
  onStartRename: () => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onRenameChange: (value: string) => void;
  onTogglePin: () => void;
  onClone: () => void;
  onMove: (workspaceId: string) => void;
  onDelete: () => void;
  openMenu: boolean;
}) {
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const [moveSubmenuOpen, setMoveSubmenuOpen] = useState(false);

  useEffect(() => {
    if (!openMenu) setMoveSubmenuOpen(false);
  }, [openMenu]);

  const menuAnchor = menuRect || menuButtonRef.current?.getBoundingClientRect() || null;

  return (
    <div className="group/workbench relative" data-workbench-menu={menuKey}>
      {isEditing ? (
        <div
          id="sidebar-chat-item"
          className="relative flex w-full justify-between rounded-xl bg-gray-100 px-[11px] py-[6px] whitespace-nowrap text-ellipsis selected"
        >
          <input
            autoFocus
            value={editingTitle}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => onRenameChange(event.target.value)}
            onBlur={onSubmitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSubmitRename();
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancelRename();
              }
            }}
            className="bg-transparent w-full outline-none mr-10"
          />
        </div>
      ) : (
        <button
          id="sidebar-chat-item"
          type="button"
          onClick={onOpen}
          className="group relative flex w-full justify-between rounded-xl px-[11px] py-[6px] text-left whitespace-nowrap text-ellipsis transition hover:bg-gray-100"
        >
          <span className="flex w-full min-w-0 flex-1 self-center">
            <span dir="auto" className="flex w-full items-center gap-1.5 overflow-hidden truncate text-left self-center text-gray-900 h-[20px]">
              <span className="shrink-0 text-[13px] leading-none">{emoji}</span>
              <span className="min-w-0 truncate">{workbench.title}</span>
            </span>
            <span className="ml-2 shrink-0 self-center text-[10px] text-gray-400 group-hover:hidden">{formatRelative(workbench.updatedAt)}</span>
          </span>
        </button>
      )}

      <button
        ref={menuButtonRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setMenuRect(event.currentTarget.getBoundingClientRect());
          onOpenMenu();
        }}
        className={`absolute right-1 top-[4px] z-10 mr-1.5 flex items-center self-center bg-gradient-to-l from-gray-100 from-80% to-transparent py-1 pl-5 pr-0.5 text-gray-500 transition ${openMenu ? 'visible' : 'invisible group-hover/workbench:visible'}`}
        title="Workbench menu"
      >
        <span className="self-center transition">
          <OWEllipsisHorizontalIcon className="size-4" strokeWidth={2.5} />
        </span>
      </button>

      {openMenu ? createPortal(
        <div
          className="workspace-card-menu z-[9999] min-w-[200px] rounded-2xl px-1 py-1 text-sm text-gray-900"
          style={getMenuPositionStyleStart(menuAnchor, 200)}
          data-workbench-menu={menuKey}
        >
          <button type="button" onClick={onStartRename} className="workspace-card-menu-item flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-left">
            <OWPencilIcon className="size-4" />
            Rename
          </button>
          <button type="button" onClick={onTogglePin} className="workspace-card-menu-item flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-left">
            {isPinned ? <OWBookmarkSlashIcon className="size-4" /> : <OWBookmarkIcon className="size-4" />}
            {isPinned ? 'Unpin' : 'Pin'}
          </button>
          <button type="button" onClick={onClone} className="workspace-card-menu-item flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-left">
            <OWDocumentDuplicateIcon className="size-4" />
            Clone
          </button>
          <div
            className="relative"
            onMouseEnter={() => setMoveSubmenuOpen(true)}
            onMouseLeave={() => setMoveSubmenuOpen(false)}
          >
            <button type="button" className="workspace-card-menu-item flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-left">
              <OWFolderOpenIcon className="size-4" />
              <span className="flex flex-1 items-center">Move</span>
            </button>
            {moveSubmenuOpen ? (
              <div className="absolute left-full top-0 z-[10000] pl-2">
                <div className="workspace-card-menu min-w-[200px] max-w-[200px] max-h-52 overflow-y-auto rounded-2xl border border-gray-100 bg-white p-1 text-sm text-gray-900 shadow-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {workspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={() => onMove(workspace.id)}
                      disabled={workspace.id === workbench.workspaceId}
                      className="workspace-card-menu-item flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-xl px-3 py-1.5 text-left disabled:cursor-default disabled:opacity-50"
                    >
                      <OWFolderOpenIcon className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{workspace.id === workbench.workspaceId ? workspaceName : workspace.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <button type="button" onClick={onDelete} className="workspace-card-menu-danger workspace-card-menu-item flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-left">
            <OWGarbageBinIcon className="size-4" />
            Delete
          </button>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function OWPencilSquareIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
  );
}

function OWSearchIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" aria-hidden="true" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

function OWPlusIcon({ className = 'size-4', strokeWidth = 2 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function OWArrowLeftIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
    </svg>
  );
}

function OWCheckIcon({ className = 'size-4', strokeWidth = 2 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function OWDocumentPageIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path d="M4 21.4V2.6C4 2.26863 4.26863 2 4.6 2H16.2515C16.4106 2 16.5632 2.06321 16.6757 2.17574L19.8243 5.32426C19.9368 5.43679 20 5.5894 20 5.74853V21.4C20 21.7314 19.7314 22 19.4 22H4.6C4.26863 22 4 21.7314 4 21.4Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10L16 10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 18L16 18" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 14L12 14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 2V5.4C16 5.73137 16.2686 6 16.6 6H20" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OWArrowUpCircleIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m15 11.25-3-3m0 0-3 3m3-3v7.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function OWGlobeAltIcon({ className = 'w-4 h-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" aria-hidden="true" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}

function OWBarsArrowUpIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h14.25M3 9h9.75M3 13.5h5.25m5.25-.75L17.25 9m0 0L21 12.75M17.25 9v12" />
    </svg>
  );
}

function OWFolderOpenIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
    </svg>
  );
}

function OWWorkspaceIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 0 0 2.25-2.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v2.25A2.25 2.25 0 0 0 6 10.5Zm0 9.75h2.25A2.25 2.25 0 0 0 10.5 18v-2.25a2.25 2.25 0 0 0-2.25-2.25H6a2.25 2.25 0 0 0-2.25 2.25V18A2.25 2.25 0 0 0 6 20.25Zm9.75-9.75H18a2.25 2.25 0 0 0 2.25-2.25V6A2.25 2.25 0 0 0 18 3.75h-2.25A2.25 2.25 0 0 0 13.5 6v2.25a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  );
}

function OWChevronDownIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function OWChevronUpIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
    </svg>
  );
}

function OWChevronRightIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function OWEllipsisHorizontalIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
    </svg>
  );
}

function OWPencilIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
    </svg>
  );
}

function OWDownloadIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path d="M6 20L18 20" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 4V16M12 16L15.5 12.5M12 16L8.5 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OWBookmarkIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185v15.17a.75.75 0 0 1-1.143.639L12 17.44l-6.357 3.876a.75.75 0 0 1-1.143-.64V5.508c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
    </svg>
  );
}

function OWBookmarkSlashIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m3 3 18 18M6.407 3.323A48.507 48.507 0 0 1 12 3c1.891 0 3.754.108 5.593.323 1.1.128 1.907 1.077 1.907 2.185v11.66M8.25 4.102c-1.017.043-1.75.962-1.75 1.968v14.607c0 .587.646.945 1.143.64L12 18.66l4.357 2.656a.75.75 0 0 0 1.143-.64v-2.427" />
    </svg>
  );
}

function OWDocumentDuplicateIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75A1.125 1.125 0 0 1 3.75 20.625V7.875c0-.621.504-1.125 1.125-1.125H8.25m7.5 10.5H19.5a.75.75 0 0 0 .75-.75V6.108a.75.75 0 0 0-.22-.53l-3.858-3.858a.75.75 0 0 0-.53-.22H9.75a.75.75 0 0 0-.75.75V6.75m6.75 10.5H9.75A1.5 1.5 0 0 1 8.25 15.75v-9" />
    </svg>
  );
}

function OWGarbageBinIcon({ className = 'size-4', strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

function OWXMarkIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}

function CreateWorkbenchModal({
  isOpen,
  loading,
  error,
  workspaceName,
  resources,
  onClose,
  onSubmit
}: {
  isOpen: boolean;
  loading: boolean;
  error: string | null;
  workspaceName: string;
  resources: NonNullable<Workspace['fileObjects']>;
  onClose: () => void;
  onSubmit: (payload: { title: string; description: string; resourceIds: string[] }) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [query, setQuery] = useState('');
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!isOpen) return;
    setTitle('');
    setDescription('');
    setQuery('');
    setSelectedResourceIds(new Set());
  }, [isOpen]);

  if (!isOpen) return null;

  const normalizedQuery = query.trim().toLowerCase();
  const sortedResources = [...resources].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const visibleResources = sortedResources.filter((resource) => {
    if (!normalizedQuery) return true;
    return [resource.name, resource.path, resource.origin, resource.resourceType, resource.fileCategory]
      .filter(Boolean)
      .some((item) => String(item).toLowerCase().includes(normalizedQuery));
  });

  const toggleResource = (resourceId: string) => {
    setSelectedResourceIds((current) => {
      const next = new Set(current);
      if (next.has(resourceId)) {
        next.delete(resourceId);
      } else {
        next.add(resourceId);
      }
      return next;
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (!trimmedTitle || !trimmedDescription || loading) return;
    onSubmit({
      title: trimmedTitle,
      description: trimmedDescription,
      resourceIds: [...selectedResourceIds]
    });
  };

  return (
    <div className="w-full max-h-full">
        <button type="button" onClick={onClose} disabled={loading} className="flex w-fit space-x-1 text-gray-700 transition hover:text-black disabled:opacity-50">
          <div className="self-center">
            <OWArrowLeftIcon className="size-4" />
          </div>
          <div className="self-center text-sm font-medium">Back</div>
        </button>

        <form className="mx-auto mb-10 mt-10 flex w-full max-w-lg flex-col" onSubmit={submit}>
          <div className="flex w-full flex-col justify-center">
            <div className="mb-2.5 font-primary text-2xl font-medium text-gray-700">Create a workbench</div>

            <div className="flex w-full flex-col gap-2.5">
              <div className="w-full">
                <div className="mb-2 text-sm text-gray-700">What are you working on?</div>
                <div className="mt-1 w-full">
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="w-full rounded-lg bg-gray-50 px-4 py-2 text-sm outline-none placeholder:text-gray-400"
                    type="text"
                    placeholder="Name your workbench"
                    required
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm text-gray-700">What are you trying to achieve?</div>
                <div className="mt-1 w-full">
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="w-full resize-none rounded-lg bg-gray-50 px-4 py-2 text-sm outline-none placeholder:text-gray-400"
                    rows={4}
                    placeholder="Describe your workbench and objectives"
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-gray-500">Access List</div>
              <div className="text-xs font-medium text-gray-400">{selectedResourceIds.size} selected from {workspaceName}</div>
            </div>

            <div className="rounded-2xl bg-gray-50 px-3 py-2">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                <OWSearchIcon className="size-3.5 text-gray-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-gray-400"
                  placeholder="Search workspace knowledge"
                />
              </div>

              <div className="max-h-56 overflow-y-auto py-2">
                {visibleResources.length ? (
                  visibleResources.map((resource) => {
                    const selected = selectedResourceIds.has(resource.id);
                    return (
                      <button
                        key={resource.id}
                        type="button"
                        onClick={() => toggleResource(resource.id)}
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-gray-100"
                      >
                        <span className={`flex size-4 shrink-0 items-center justify-center rounded border transition ${selected ? 'border-black bg-black text-white' : 'border-gray-300 bg-white text-transparent'}`}>
                          <OWCheckIcon className="size-3" />
                        </span>
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-gray-500">
                          {resource.origin === 'web' ? <Globe2 className="size-4" /> : <FileText className="size-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-gray-700">{resource.name}</span>
                          <span className="block truncate text-xs text-gray-400">{resource.path}</span>
                        </span>
                        <span className="hidden shrink-0 text-xs text-gray-400 sm:block">{resource.resourceType || resource.fileCategory || 'file'}</span>
                      </button>
                    );
                  })
                ) : (
                  <div className="flex min-h-20 items-center justify-center text-center text-xs text-gray-400">
                    {query.trim() ? 'No workspace knowledge found.' : 'No workspace knowledge yet.'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {error ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}

          <div className="mt-4 flex justify-end">
            <button
              className={`flex rounded-lg px-4 py-2 text-sm transition ${loading ? 'cursor-not-allowed bg-gray-100 text-gray-500' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}`}
              type="submit"
              disabled={loading || !title.trim() || !description.trim()}
            >
              <div className="self-center font-medium">Create Workbench</div>
              {loading ? <Loader2 className="ml-1.5 size-4 animate-spin self-center" /> : null}
            </button>
          </div>
        </form>
    </div>
  );
}

function CreateWorkspaceModal({
  isOpen,
  loading,
  error,
  onClose,
  onSubmit
}: {
  isOpen: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: CreateWorkspaceDraft) => void;
}) {
  const [draft, setDraft] = useState<CreateWorkspaceDraft>(() => emptyDraft());
  const [urlDraft, setUrlDraft] = useState('');
  const [urlTitleDraft, setUrlTitleDraft] = useState('');
  const [textTitleDraft, setTextTitleDraft] = useState('pasted-source');
  const [textContentDraft, setTextContentDraft] = useState('');
  const [knowledgeDialog, setKnowledgeDialog] = useState<'web' | 'url' | 'text' | null>(null);
  const [discoveredSources, setDiscoveredSources] = useState<DiscoveredResource[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Record<string, boolean>>({});
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setDraft(emptyDraft());
      setUrlDraft('');
      setUrlTitleDraft('');
      setTextTitleDraft('pasted-source');
      setTextContentDraft('');
      setKnowledgeDialog(null);
      setDiscoveredSources([]);
      setSelectedSourceIds({});
      setIsDiscovering(false);
      setDiscoveryError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const addUrl = () => {
    const url = urlDraft.trim();
    if (!url) return;
    setDraft((current) => ({
      ...current,
      urls: [
        ...current.urls,
        {
          id: crypto.randomUUID(),
          url,
          title: urlTitleDraft.trim() || makeTitleFromUrl(url)
        }
      ]
    }));
    setUrlDraft('');
    setUrlTitleDraft('');
    setKnowledgeDialog(null);
  };

  const addText = () => {
    const content = textContentDraft.trim();
    if (!content) return;
    setDraft((current) => ({
      ...current,
      texts: [
        ...current.texts,
        {
          id: crypto.randomUUID(),
          title: textTitleDraft.trim() || 'pasted-source',
          content
        }
      ]
    }));
    setTextTitleDraft('pasted-source');
    setTextContentDraft('');
    setKnowledgeDialog(null);
  };

  const searchWeb = async () => {
    const query = draft.webQuery.trim();
    if (!query) return;

    setIsDiscovering(true);
    setDiscoveryError(null);
    try {
      const response = await fileSystemApi.discoverSourcesGlobal({
        query,
        maxResults: 10,
        provider: 'auto'
      });
      setDiscoveredSources(response.results);
      setSelectedSourceIds(
        Object.fromEntries(response.results.slice(0, 5).map((source) => [source.id, true]))
      );
      if (response.results.length === 0) {
        setDiscoveryError('No sources found. Try a more specific topic or keywords.');
      }
    } catch (searchError: any) {
      setDiscoveredSources([]);
      setSelectedSourceIds({});
      setDiscoveryError(searchError?.response?.data?.error || searchError?.message || 'Source discovery failed');
    } finally {
      setIsDiscovering(false);
    }
  };

  const selectedDiscoveredSources = discoveredSources.filter((source) => selectedSourceIds[source.id]);

  const addSelectedWebSources = () => {
    if (!selectedDiscoveredSources.length) return;
    setDraft((current) => {
      const existingUrls = new Set(current.urls.map((source) => normalizeUrl(source.url)));
      const urls = [...current.urls];
      selectedDiscoveredSources.forEach((source) => {
        const normalizedUrl = normalizeUrl(source.url);
        if (existingUrls.has(normalizedUrl)) return;
        existingUrls.add(normalizedUrl);
        urls.push({
          id: crypto.randomUUID(),
          title: source.title || makeTitleFromUrl(normalizedUrl),
          url: normalizedUrl
        });
      });
      return {
        ...current,
        urls,
        webQuery: ''
      };
    });
    setDiscoveredSources([]);
    setSelectedSourceIds({});
    setDiscoveryError(null);
    setKnowledgeDialog(null);
  };

  const knowledgeSummary = [
    draft.files.length ? `${draft.files.length} files` : null,
    draft.urls.length ? `${draft.urls.length} URLs` : null,
    draft.texts.length ? `${draft.texts.length} text sources` : null
  ].filter(Boolean).join(' · ');

  return (
    <div
      className="fixed inset-0 z-[100] flex h-screen max-h-[100dvh] w-full justify-center overflow-y-auto overscroll-contain bg-black/30 p-3 animate-[openwebui-fade_10ms_ease-out]"
      onMouseDown={onClose}
    >
      <style>
        {`@keyframes openwebui-fade { from { opacity: 0; } to { opacity: 1; } }
          @keyframes openwebui-scale-up { from { transform: scale(0.985); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}
      </style>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(draft);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className="m-auto flex max-h-[min(820px,calc(100vh-24px))] min-h-fit w-full max-w-[42rem] flex-col overflow-hidden rounded-[32px] border border-white bg-white/95 shadow-[0_24px_90px_rgba(0,0,0,0.24)] backdrop-blur-sm animate-[openwebui-scale-up_100ms_ease-out_forwards]"
      >
        <div className="flex justify-between px-5 pb-1 pt-4 text-gray-900">
          <h2 className="self-center text-lg font-medium">Create Workspace</h2>
          <button type="button" onClick={onClose} disabled={loading} className="self-center rounded-xl p-1 text-gray-700 hover:bg-gray-100 disabled:opacity-50">
            <OWXMarkIcon className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 text-gray-900 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-full flex-col">
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-gray-500">Workspace Name</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Enter workspace name"
                  autoFocus
                  className="w-full bg-transparent text-sm outline-none placeholder:text-gray-300"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs text-gray-500">Workspace Background</span>
                <textarea
                  value={draft.background}
                  onChange={(event) => setDraft((current) => ({ ...current, background: event.target.value }))}
                  placeholder="Describe the background, goals, constraints, and standing context for this course or project."
                  rows={1}
                  style={{ fieldSizing: 'content', maxHeight: 200 } as React.CSSProperties}
                  className="text-sm w-full bg-transparent outline-none placeholder:text-gray-300"
                />
              </label>

              <hr className="my-2.5 w-full border-gray-50" />

              <label className="block">
                <span className="mb-2 block text-xs text-gray-500">System Prompt</span>
                <textarea
                  value={draft.systemPrompt}
                  onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))}
                  placeholder="Write your model system prompt content here&#10;e.g.) You are Mario from Super Mario Bros, acting as an assistant."
                  rows={1}
                  style={{ fieldSizing: 'content', maxHeight: 200 } as React.CSSProperties}
                  className="text-sm w-full bg-transparent outline-none placeholder:text-gray-300"
                />
              </label>
            </div>

            <div className="my-2">
              <div className="mb-2">
                <div className="flex w-full justify-between mb-1">
                  <div className="self-center text-xs font-medium text-gray-500">Knowledge</div>
                </div>
              </div>
              <div className="flex flex-col mb-1">
                {(draft.files.length || draft.urls.length || draft.texts.length) ? (
                  <div className="flex flex-wrap items-center gap-2 mb-2.5">
                    {draft.files.map((file, index) => (
                      <CreateWorkspaceKnowledgeItem
                        key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                        name={file.name}
                        type="File"
                        size={file.size}
                        onRemove={() =>
                          setDraft((current) => ({
                            ...current,
                            files: current.files.filter((_, itemIndex) => itemIndex !== index)
                          }))
                        }
                      />
                    ))}
                    {draft.urls.map((source) => (
                      <CreateWorkspaceKnowledgeItem
                        key={source.id}
                        name={source.title || makeTitleFromUrl(source.url)}
                        type="Web source"
                        onRemove={() =>
                          setDraft((current) => ({
                            ...current,
                            urls: current.urls.filter((item) => item.id !== source.id)
                          }))
                        }
                      />
                    ))}
                    {draft.texts.map((source) => (
                      <CreateWorkspaceKnowledgeItem
                        key={source.id}
                        name={source.title || 'Pasted source'}
                        type="Text"
                        onRemove={() =>
                          setDraft((current) => ({
                            ...current,
                            texts: current.texts.filter((item) => item.id !== source.id)
                          }))
                        }
                      />
                    ))}
                  </div>
                ) : null}

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    if (files.length) {
                      setDraft((current) => ({ ...current, files: [...current.files, ...files] }));
                    }
                    event.target.value = '';
                  }}
                />
                <div className="flex flex-wrap flex-row text-sm gap-1">
                  <KnowledgePill onClick={() => fileInputRef.current?.click()} icon={<OWArrowUpCircleIcon className="size-4" />} label="Upload Files" />
                  <KnowledgePill onClick={() => setKnowledgeDialog('web')} icon={<OWSearchIcon className="size-4" />} label="Search Web" />
                  <KnowledgePill onClick={() => setKnowledgeDialog('url')} icon={<OWGlobeAltIcon className="size-4" />} label="Paste URL" />
                  <KnowledgePill onClick={() => setKnowledgeDialog('text')} icon={<OWBarsArrowUpIcon className="size-4" />} label="Paste Text" />
                </div>
                <p className="px-1 pt-2 text-xs leading-5 text-gray-500">
                  {knowledgeSummary || 'Attach files, web pages, search topics, or pasted notes.'}
                </p>
              </div>
            </div>
          </div>
          {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-1.5 px-5 pb-4 pt-3 text-sm font-medium">
          <button type="button" onClick={onClose} disabled={loading} className="h-9 rounded-full px-3.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={!draft.name.trim() || loading} className="inline-flex h-9 items-center gap-2 rounded-full bg-black px-3.5 text-sm font-medium text-white transition hover:bg-gray-950 disabled:cursor-not-allowed disabled:opacity-50">
            Save
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          </button>
        </div>
      </form>

      <KnowledgeSourceDialog
        type={knowledgeDialog}
        webQuery={draft.webQuery}
        urlDraft={urlDraft}
        urlTitleDraft={urlTitleDraft}
        textTitleDraft={textTitleDraft}
        textContentDraft={textContentDraft}
        onClose={() => setKnowledgeDialog(null)}
        onWebQueryChange={(value) => setDraft((current) => ({ ...current, webQuery: value }))}
        onUrlChange={setUrlDraft}
        onUrlTitleChange={setUrlTitleDraft}
        onTextTitleChange={setTextTitleDraft}
        onTextContentChange={setTextContentDraft}
        onAddUrl={addUrl}
        onAddText={addText}
        discoveredSources={discoveredSources}
        selectedSourceIds={selectedSourceIds}
        discoveryError={discoveryError}
        isDiscovering={isDiscovering}
        onSearchWeb={searchWeb}
        onToggleDiscoveredSource={(sourceId) =>
          setSelectedSourceIds((current) => ({
            ...current,
            [sourceId]: !current[sourceId]
          }))
        }
        onAddSelectedWebSources={addSelectedWebSources}
      />
    </div>
  );
}

function KnowledgePill({
  icon,
  label,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3.5 py-1.5 font-medium hover:bg-black/5 outline outline-1 outline-gray-100 rounded-3xl"
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
    </button>
  );
}

const formatKnowledgeFileSize = (size?: number) => {
  if (!size) return undefined;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

function CreateWorkspaceKnowledgeItem({
  name,
  type,
  size,
  onRemove
}: {
  name: string;
  type: string;
  size?: number;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      className="relative group p-1.5 w-60 flex items-center gap-1 bg-white border border-gray-50/30 rounded-xl p-2 text-left"
    >
      <div className="pl-1.5">
        <OWDocumentPageIcon className="size-4" />
      </div>
      <div className="flex flex-col justify-center -space-y-0.5 px-1 w-full">
        <div className="text-sm flex justify-between items-center">
          <div className="line-clamp-1 flex-1 pr-1 font-medium">{name}</div>
          <div className="shrink-0 text-xs capitalize text-gray-500">{formatKnowledgeFileSize(size) || type}</div>
        </div>
      </div>
      <div className=" absolute -top-1 -right-1">
        <button
          type="button"
          aria-label="Remove File"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          className="bg-white text-black border border-gray-50 rounded-full outline-none focus:outline-none group-hover:visible invisible transition"
        >
          <OWXMarkIcon className="size-4" />
        </button>
      </div>
    </button>
  );
}

function KnowledgeSourceDialog({
  type,
  webQuery,
  urlDraft,
  urlTitleDraft,
  textTitleDraft,
  textContentDraft,
  onClose,
  onWebQueryChange,
  onUrlChange,
  onUrlTitleChange,
  onTextTitleChange,
  onTextContentChange,
  onAddUrl,
  onAddText,
  discoveredSources,
  selectedSourceIds,
  discoveryError,
  isDiscovering,
  onSearchWeb,
  onToggleDiscoveredSource,
  onAddSelectedWebSources
}: {
  type: 'web' | 'url' | 'text' | null;
  webQuery: string;
  urlDraft: string;
  urlTitleDraft: string;
  textTitleDraft: string;
  textContentDraft: string;
  onClose: () => void;
  onWebQueryChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onUrlTitleChange: (value: string) => void;
  onTextTitleChange: (value: string) => void;
  onTextContentChange: (value: string) => void;
  onAddUrl: () => void;
  onAddText: () => void;
  discoveredSources: DiscoveredResource[];
  selectedSourceIds: Record<string, boolean>;
  discoveryError: string | null;
  isDiscovering: boolean;
  onSearchWeb: () => void;
  onToggleDiscoveredSource: (sourceId: string) => void;
  onAddSelectedWebSources: () => void;
}) {
  if (!type) return null;

  const title = type === 'web' ? 'Search Web' : type === 'url' ? 'Paste URL' : 'Paste Text';
  const selectedSources = discoveredSources.filter((source) => selectedSourceIds[source.id]);

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex h-screen max-h-[100dvh] w-full items-center justify-center bg-black/20 p-3 animate-[openwebui-fade_10ms_ease-out]"
      onMouseDown={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-[28px] border border-white bg-white/95 p-5 text-gray-900 shadow-[0_24px_90px_rgba(0,0,0,0.22)] backdrop-blur-sm animate-[openwebui-scale-up_100ms_ease-out_forwards]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-medium">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-xl p-1 text-gray-700 hover:bg-gray-100">
            <OWXMarkIcon className="size-5" />
          </button>
        </div>

        {type === 'web' ? (
          <div>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500">Search topic</span>
              <div className="flex items-center gap-2 rounded-2xl bg-gray-50 px-3">
                <OWSearchIcon className="size-4 shrink-0 text-gray-400" />
                <input
                  value={webQuery}
                  onChange={(event) => onWebQueryChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onSearchWeb();
                    }
                  }}
                  placeholder="Search topic"
                  autoFocus
                  className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-300"
                />
                <button
                  type="button"
                  onClick={onSearchWeb}
                  disabled={isDiscovering || !webQuery.trim()}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs font-medium transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isDiscovering ? <Loader2 className="size-3.5 animate-spin" /> : <OWSearchIcon className="size-3.5" />}
                  Search
                </button>
              </div>
            </label>

            {discoveryError ? (
              <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm leading-6 text-red-600">
                {discoveryError}
              </div>
            ) : null}

            {discoveredSources.length ? (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm">{selectedSources.length} selected from {discoveredSources.length} results</p>
                  <button
                    type="button"
                    onClick={onAddSelectedWebSources}
                    disabled={!selectedSources.length}
                    className="rounded-lg bg-gray-50 px-3 py-1.5 text-sm font-medium transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Add selected
                  </button>
                </div>

                <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                  {discoveredSources.map((source) => {
                    const selected = Boolean(selectedSourceIds[source.id]);
                    return (
                      <button
                        key={source.id}
                        type="button"
                        onClick={() => onToggleDiscoveredSource(source.id)}
                        className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                          selected ? 'border-green-100 bg-green-50' : 'border-gray-100 bg-gray-50 hover:bg-gray-100'
                        }`}
                      >
                        <span className="flex items-start gap-3">
                          <span
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                              selected ? 'border-green-600 bg-green-600 text-white' : 'border-gray-200 bg-white text-transparent'
                            }`}
                          >
                            <OWCheckIcon className="size-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium leading-5">{source.title}</span>
                            <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-gray-500">
                              <span className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 uppercase tracking-wide text-gray-600">
                                {source.provider}
                              </span>
                              <span className="truncate">{source.source || source.author || new URL(source.url).hostname.replace(/^www\./, '')}</span>
                              {source.publishedAt ? <span className="shrink-0">{source.publishedAt.slice(0, 10)}</span> : null}
                            </span>
                            <span className="mt-2 block text-sm leading-6 text-gray-600">{source.summary || source.snippet}</span>
                            <span className="mt-2 flex items-center gap-1 text-xs text-gray-500">
                              <ExternalLink className="size-3" />
                              <span className="truncate">{source.url}</span>
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-1.5">
              <button type="button" onClick={onClose} className="h-9 rounded-full px-3.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {type === 'url' ? (
          <div>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500">URL</span>
              <input
                value={urlDraft}
                onChange={(event) => onUrlChange(event.target.value)}
                placeholder="https://..."
                autoFocus
                className="h-11 w-full rounded-2xl bg-gray-50 px-3 text-sm outline-none placeholder:text-gray-300"
              />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-gray-500">Title</span>
              <input
                value={urlTitleDraft}
                onChange={(event) => onUrlTitleChange(event.target.value)}
                placeholder="Optional title"
                className="h-11 w-full rounded-2xl bg-gray-50 px-3 text-sm outline-none placeholder:text-gray-300"
              />
            </label>
            <div className="mt-4 flex justify-end gap-1.5">
              <button type="button" onClick={onClose} className="h-9 rounded-full px-3.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" onClick={onAddUrl} disabled={!urlDraft.trim()} className="h-9 rounded-full bg-black px-3.5 text-sm font-medium text-white hover:bg-gray-950 disabled:opacity-40">
                Add URL
              </button>
            </div>
          </div>
        ) : null}

        {type === 'text' ? (
          <div>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-500">Title</span>
              <input
                value={textTitleDraft}
                onChange={(event) => onTextTitleChange(event.target.value)}
                autoFocus
                className="h-11 w-full rounded-2xl bg-gray-50 px-3 text-sm outline-none"
              />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-gray-500">Text</span>
              <textarea
                value={textContentDraft}
                onChange={(event) => onTextContentChange(event.target.value)}
                placeholder="Paste notes or source text"
                className="min-h-32 w-full resize-none rounded-2xl bg-gray-50 px-3 py-2 text-sm leading-6 outline-none placeholder:text-gray-300"
              />
            </label>
            <div className="mt-4 flex justify-end gap-1.5">
              <button type="button" onClick={onClose} className="h-9 rounded-full px-3.5 text-sm font-medium text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" onClick={onAddText} disabled={!textContentDraft.trim()} className="h-9 rounded-full bg-black px-3.5 text-sm font-medium text-white hover:bg-gray-950 disabled:opacity-40">
                Add Text
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
