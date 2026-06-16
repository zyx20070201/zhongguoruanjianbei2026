import { useEffect, useMemo, useRef } from 'react';
import {
  FileCode2,
  FileText,
  FolderOpen,
  GripHorizontal,
  Minimize2,
  Square,
  Video,
  X
} from 'lucide-react';
import { PanelState, ResourceReference } from '../../types';

interface PanelCanvasProps {
  panels: PanelState[];
  activePanelId: string | null;
  resources: ResourceReference[];
  onActivate: (panelId: string) => void;
  onClose: (panelId: string) => void;
  onMovePanel: (panelId: string, patch: Partial<PanelState>) => void;
  onUpdateViewState: (panelId: string, patch: Record<string, any>) => void;
  onBindResource: (panelId: string) => void;
}

type ActionState =
  | {
      mode: 'move';
      panelId: string;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      mode: 'resize';
      panelId: string;
      startX: number;
      startY: number;
      originW: number;
      originH: number;
    };

const MIN_WIDTH = 300;
const MIN_HEIGHT = 220;

const getPanelIcon = (type: PanelState['type']) => {
  switch (type) {
    case 'resource':
      return <FolderOpen className="h-4 w-4" />;
    case 'notes':
      return <FileText className="h-4 w-4" />;
    case 'code':
      return <FileCode2 className="h-4 w-4" />;
    case 'video':
      return <Video className="h-4 w-4" />;
  }
};

const getBoundResource = (panel: PanelState, resources: ResourceReference[]) =>
  resources.find((resource) => resource.id === panel.resourceId) ?? null;

function PanelBody({
  panel,
  resource,
  onUpdateViewState
}: {
  panel: PanelState;
  resource: ResourceReference | null;
  onUpdateViewState: (panelId: string, patch: Record<string, any>) => void;
}) {
  if (panel.minimized) {
    return <div className="flex-1 bg-[var(--wb-editor)]" />;
  }

  if (panel.type === 'notes') {
    return (
      <textarea
        value={String(panel.viewState.content ?? '')}
        onChange={(event) => onUpdateViewState(panel.id, { content: event.target.value })}
        className="h-full w-full resize-none border-0 bg-[var(--wb-editor)] px-4 py-3 text-sm text-[var(--wb-text)] outline-none"
        placeholder="Capture notes for this task. Content is saved into the workbench view state."
      />
    );
  }

  if (!resource) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--wb-editor)] px-6 text-center">
        <div className="rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-panel)] p-4 text-[var(--wb-text-muted)] shadow-sm">{getPanelIcon(panel.type)}</div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--wb-text)]">暂无打开的工作区文件</h3>
          <p className="mt-1 text-sm text-[var(--wb-text-muted)]">
            从工作区文件树中打开文件后即可在此面板中使用。
          </p>
        </div>
      </div>
    );
  }

  if (panel.type === 'resource') {
    return (
      <div className="h-full bg-[var(--wb-editor)] p-4">
        <div className="rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-panel)] p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--wb-text-dim)]">文件引用</div>
              <div className="mt-3 text-lg font-semibold text-[var(--wb-text)]">{resource.name}</div>
              <div className="mt-2 text-sm text-[var(--wb-text-muted)]">{resource.path}</div>
            </div>
          </div>
          <div className="mt-4 inline-flex rounded-full bg-[var(--wb-sidebar-alt)] px-3 py-1 text-xs font-medium text-[#d7e7ff]">
            {resource.type}
          </div>
        </div>
      </div>
    );
  }

  if (panel.type === 'code') {
    return (
      <div className="h-full bg-[var(--wb-editor)] px-4 py-3 font-mono text-sm text-[#d7e7ff]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--wb-text-dim)]">代码占位</div>
        </div>
        <div className="rounded-xl border border-[var(--wb-border)] bg-black/20 p-4">
          <div>{`// 工作区文件：${resource.name}`}</div>
          <div className="mt-2 text-[var(--wb-text-muted)]">{`// 路径：${resource.path}`}</div>
          <div className="mt-4 text-[var(--wb-text-dim)]">{`// 这个面板会承载后续的代码体验。`}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col justify-between bg-[var(--wb-editor)] p-4 text-[var(--wb-text)]">
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--wb-text-dim)]">视频占位</div>
        </div>
        <div className="mt-3 text-lg font-semibold">{resource.name}</div>
        <div className="mt-2 text-sm text-[var(--wb-text-muted)]">{resource.path}</div>
      </div>
      <div className="rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-panel)] px-4 py-8 text-center text-sm text-[var(--wb-text-muted)]">
        视频播放暂未实现。此面板会保留工作区文件和 workbench 布局。
      </div>
    </div>
  );
}

export default function PanelCanvas({
  panels,
  activePanelId,
  resources,
  onActivate,
  onClose,
  onMovePanel,
  onUpdateViewState,
  onBindResource: _onBindResource
}: PanelCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const actionRef = useRef<ActionState | null>(null);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const action = actionRef.current;
      if (!action) return;

      const dx = event.clientX - action.startX;
      const dy = event.clientY - action.startY;

      if (action.mode === 'move') {
        onMovePanel(action.panelId, {
          x: Math.max(12, action.originX + dx),
          y: Math.max(12, action.originY + dy)
        });
        return;
      }

      onMovePanel(action.panelId, {
        w: Math.max(MIN_WIDTH, action.originW + dx),
        h: Math.max(MIN_HEIGHT, action.originH + dy)
      });
    };

    const handlePointerUp = () => {
      actionRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [onMovePanel]);

  const orderedPanels = useMemo(
    () => [...panels].sort((a, b) => a.zIndex - b.zIndex),
    [panels]
  );

  return (
    <div
      ref={containerRef}
      className="relative min-h-full overflow-auto bg-[radial-gradient(circle_at_top_left,_rgba(90,166,255,0.08),_transparent_28%),linear-gradient(180deg,_#0b1016_0%,_#101720_100%)]"
      style={{ backgroundSize: 'auto, 100% 100%' }}
    >
      <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'linear-gradient(rgba(122,135,152,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(122,135,152,0.12) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

      {orderedPanels.map((panel) => {
        const resource = getBoundResource(panel, resources);
        const isActive = panel.id === activePanelId;

        return (
          <section
            key={panel.id}
            className={`absolute overflow-hidden rounded-2xl border bg-[var(--wb-panel)] shadow-[0_24px_48px_rgba(0,0,0,0.28)] transition-shadow ${
              isActive ? 'border-[var(--wb-accent)] shadow-[0_28px_56px_rgba(90,166,255,0.18)]' : 'border-[var(--wb-border)]'
            }`}
            style={{
              left: panel.x,
              top: panel.y,
              width: panel.w,
              height: panel.minimized ? 56 : panel.h,
              zIndex: panel.zIndex
            }}
            onPointerDown={() => onActivate(panel.id)}
          >
            <div
              className={`flex items-center justify-between border-b px-3 py-2 ${
                isActive
                  ? 'border-[var(--wb-accent)] bg-[rgba(90,166,255,0.08)]'
                  : 'border-[var(--wb-border)] bg-[var(--wb-panel)]'
              }`}
            >
              <button
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onActivate(panel.id);
                  actionRef.current = {
                    mode: 'move',
                    panelId: panel.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: panel.x,
                    originY: panel.y
                  };
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="rounded-lg border border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] p-1.5 text-[var(--wb-text-muted)] shadow-sm">{getPanelIcon(panel.type)}</span>
                <span className="truncate text-sm font-medium text-[var(--wb-text)]">{panel.title}</span>
                <GripHorizontal className="h-4 w-4 shrink-0 text-[var(--wb-text-dim)]" />
              </button>

              <div className="ml-3 flex items-center gap-1">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onMovePanel(panel.id, { minimized: !panel.minimized });
                  }}
                  className="rounded-lg p-1.5 text-[var(--wb-text-dim)] transition-colors hover:bg-white/5 hover:text-[var(--wb-text)]"
                  title={panel.minimized ? '展开面板' : '最小化面板'}
                >
                  {panel.minimized ? <Square className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(panel.id);
                  }}
                  className="rounded-lg p-1.5 text-[var(--wb-text-dim)] transition-colors hover:bg-red-500/10 hover:text-red-300"
                  title="关闭面板"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="h-[calc(100%-49px)]">
              <PanelBody
                panel={panel}
                resource={resource}
                onUpdateViewState={onUpdateViewState}
              />
            </div>

            {!panel.minimized && (
              <button
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onActivate(panel.id);
                  actionRef.current = {
                    mode: 'resize',
                    panelId: panel.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originW: panel.w,
                    originH: panel.h
                  };
                }}
                className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize rounded-tl-xl bg-[var(--wb-sidebar-alt)] text-[var(--wb-text-dim)]"
                title="Resize panel"
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
