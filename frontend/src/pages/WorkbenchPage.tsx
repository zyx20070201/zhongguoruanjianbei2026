import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { Workbench, PanelInstance, PanelType } from '../types';
import ReactGridLayout, { Responsive, Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

import WorkbenchHeader from '../components/workbench/WorkbenchHeader';
import WorkbenchEmptyState from '../components/workbench/WorkbenchEmptyState';
import ResourcePanel from '../components/workbench/ResourcePanel';
import NotesPanel from '../components/workbench/NotesPanel';
import AIAssistantPanel from '../components/workbench/AIAssistantPanel';
import CodePanel from '../components/workbench/CodePanel';
import ResultPanel from '../components/workbench/ResultPanel';

// @ts-ignore
const WidthProvider = ReactGridLayout.WidthProvider || window.ReactGridLayout?.WidthProvider;
const ResponsiveGridLayout = WidthProvider ? WidthProvider(Responsive) : Responsive;

export default function WorkbenchPage() {
  const { id: workbenchId } = useParams();
  const navigate = useNavigate();
  const [workbench, setWorkbench] = useState<Workbench | null>(null);
  const [panels, setPanels] = useState<PanelInstance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWorkbench();
  }, [workbenchId]);

  const fetchWorkbench = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/workbenches/${workbenchId}`);
      setWorkbench(res.data.workbench);
      
      // Map backend panels to UI PanelInstances
      if (res.data.workbench.panels) {
        const mappedPanels: PanelInstance[] = res.data.workbench.panels.map((p: any) => {
          let layout = { x: 0, y: 0, w: 6, h: 4 };
          try { if (p.layoutInfo) layout = JSON.parse(p.layoutInfo); } catch (e) {}
          
          // Map legacy types to new types
          let type: PanelType = 'resource';
          if (p.panelType === 'note-editor-panel') type = 'notes';
          if (p.panelType === 'code-editor-panel') type = 'code';
          if (p.panelType === 'ai-assistant-panel') type = 'ai-assistant';
          
          return {
            id: p.id,
            type,
            title: p.title || type.charAt(0).toUpperCase() + type.slice(1),
            referencedFileId: p.fileObjectId,
            ...layout,
            state: { mode: 'edit' }
          };
        });
        setPanels(mappedPanels);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleLayoutChange = (currentLayout: any[]) => {
    setPanels(prev => prev.map(panel => {
      const layoutItem = currentLayout.find(l => l.i === panel.id);
      if (layoutItem) {
        return { ...panel, x: layoutItem.x, y: layoutItem.y, w: layoutItem.w, h: layoutItem.h };
      }
      return panel;
    }));
  };

  const handleSaveLayout = async () => {
    try {
      // In a real app, we would sync the layout back to the server
      alert('Layout saved successfully!');
    } catch (e) {
      console.error('Failed to save layout', e);
    }
  };

  const handleAddPanel = (type: string) => {
    const newPanel: PanelInstance = {
      id: `temp-${Date.now()}`,
      type: type as PanelType,
      title: `New ${type} Panel`,
      x: 0, y: Infinity, w: 6, h: 4, // Add to bottom
      state: { mode: 'edit' }
    };
    setPanels([...panels, newPanel]);
  };

  const handleRemovePanel = (id: string) => {
    setPanels(panels.filter(p => p.id !== id));
  };

  const handlePanelStateChange = (id: string, newState: any) => {
    setPanels(panels.map(p => p.id === id ? { ...p, state: newState } : p));
  };

  const handleReplaceReference = (id: string) => {
    alert('Mock: Open File Picker to replace reference for panel ' + id);
  };

  const applyTemplate = () => {
    const templatePanels: PanelInstance[] = [
      { id: `temp-1`, type: 'resource', title: 'Course Material', x: 0, y: 0, w: 6, h: 8, state: {} },
      { id: `temp-2`, type: 'notes', title: 'Study Notes', x: 6, y: 0, w: 6, h: 4, state: { mode: 'edit' } },
      { id: `temp-3`, type: 'ai-assistant', title: 'AI Assistant', x: 6, y: 4, w: 6, h: 4, state: {} }
    ];
    setPanels(templatePanels);
  };

  if (loading || !workbench) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  const renderPanel = (panel: PanelInstance) => {
    const props = {
      panel,
      onClose: () => handleRemovePanel(panel.id),
      onRemove: () => handleRemovePanel(panel.id),
      onReplaceReference: () => handleReplaceReference(panel.id),
      onStateChange: (state: any) => handlePanelStateChange(panel.id, state)
    };

    switch (panel.type) {
      case 'resource': return <ResourcePanel {...props} />;
      case 'notes': return <NotesPanel {...props} />;
      case 'ai-assistant': return <AIAssistantPanel panel={panel} onClose={props.onClose} onRemove={props.onRemove} />;
      case 'code': return <CodePanel {...props} />;
      case 'result': return <ResultPanel panel={panel} onClose={props.onClose} onRemove={props.onRemove} />;
      default: return <div className="p-4 bg-white h-full border rounded">Unknown Panel</div>;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 overflow-hidden">
      <WorkbenchHeader 
        workspaceId={workbench.workspaceId}
        workbenchName={workbench.name}
        workbenchType={(workbench as any).type || 'study'}
        updatedAt={new Date(workbench.updatedAt || new Date()).toLocaleDateString()}
        onAddPanel={() => handleAddPanel('resource')}
        onLayoutTemplate={applyTemplate}
        onSaveLayout={handleSaveLayout}
        onRename={() => alert('Mock: Rename')}
        onDuplicate={() => alert('Mock: Duplicate')}
        onDelete={() => {
          if (confirm('Are you sure you want to delete this workbench?')) {
            navigate(`/workspaces/${workbench.workspaceId}`);
          }
        }}
      />
      
      {panels.length === 0 ? (
        <WorkbenchEmptyState 
          onAddPanel={handleAddPanel}
          onUseTemplate={applyTemplate}
          onAskAI={() => alert('Mock: Ask AI to suggest layout')}
        />
      ) : (
        <main className="flex-1 overflow-auto p-4 custom-scrollbar">
          <ResponsiveGridLayout
            className="layout"
            layouts={{ lg: panels.map(p => ({ i: p.id, x: p.x, y: p.y, w: p.w, h: p.h })) }}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={100}
            draggableHandle=".panel-header"
            onLayoutChange={handleLayoutChange}
            margin={[16, 16]}
          >
            {panels.map((panel) => (
              <div key={panel.id} className="flex flex-col">
                {renderPanel(panel)}
              </div>
            ))}
          </ResponsiveGridLayout>
        </main>
      )}
    </div>
  );
}
