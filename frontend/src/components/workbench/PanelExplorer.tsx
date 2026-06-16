import { FileCode2, FileText, FolderOpen, Video, X } from 'lucide-react';
import { PanelState, ResourceReference } from '../../types';

interface PanelExplorerProps {
  panels: PanelState[];
  activePanelId: string | null;
  resources: ResourceReference[];
  onActivate: (panelId: string) => void;
  onClose: (panelId: string) => void;
}

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

export default function PanelExplorer({
  panels,
  activePanelId,
  resources,
  onActivate,
  onClose
}: PanelExplorerProps) {
  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">面板浏览器</div>
        <p className="mt-1 text-sm text-slate-500">当前 workbench 桌面上的面板。</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {panels.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            还没有面板。可以从工具栏添加面板，或在文件浏览器中双击文件。
          </div>
        ) : (
          <div className="space-y-2">
            {[...panels]
              .sort((a, b) => b.zIndex - a.zIndex)
              .map((panel) => {
                const resource = resources.find((item) => item.id === panel.resourceId);
                const isActive = panel.id === activePanelId;

                return (
                  <div
                    key={panel.id}
                    className={`rounded-2xl border p-3 transition-colors ${
                      isActive ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => onActivate(panel.id)}
                        className="flex min-w-0 flex-1 items-start gap-2 text-left"
                      >
                        <span className="mt-0.5 rounded-lg bg-white p-1.5 text-slate-600 shadow-sm">
                          {getPanelIcon(panel.type)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-900">{panel.title}</span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {panel.type} {panel.minimized ? '• 已最小化' : ''}
                          </span>
                        </span>
                      </button>
                      <button
                        onClick={() => onClose(panel.id)}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="关闭面板"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      {resource
                        ? `已打开：${resource.name}`
                        : panel.type === 'notes'
                          ? '笔记内容存储在面板视图状态中。'
                          : '暂无打开的工作区文件。'}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </aside>
  );
}
