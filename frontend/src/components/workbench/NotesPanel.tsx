import React, { useState, useEffect } from 'react';
import { PanelInstance } from '../../types';
import PanelHeader from './PanelHeader';
import { FileText, Eye, Edit2 } from 'lucide-react';

interface NotesPanelProps {
  panel: PanelInstance;
  onClose: () => void;
  onRemove: () => void;
  onReplaceReference: () => void;
  onStateChange: (state: any) => void;
}

export default function NotesPanel({ panel, onClose, onRemove, onReplaceReference, onStateChange }: NotesPanelProps) {
  const [content, setContent] = useState(`# ${panel.title}

在这里开始写笔记...`);
  const [mode, setMode] = useState<'edit' | 'preview'>(panel.state?.mode || 'edit');

  // Mock auto-save
  useEffect(() => {
    if (mode === 'edit') {
      const timer = setTimeout(() => {
        onStateChange({ ...panel.state, saving: true, saved: false });
        setTimeout(() => {
          onStateChange({ ...panel.state, saving: false, saved: true });
        }, 800);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [content, mode]);

  const toggleMode = () => {
    const newMode = mode === 'edit' ? 'preview' : 'edit';
    setMode(newMode);
    onStateChange({ ...panel.state, mode: newMode });
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <PanelHeader 
        panel={panel} 
        onClose={onClose} 
        onRemove={onRemove} 
        onReplaceReference={onReplaceReference} 
      />
      
      <div className="bg-gray-50 border-b border-gray-200 px-2 py-1.5 flex justify-between items-center">
        <div className="flex bg-gray-200/50 rounded p-0.5">
          <button 
            onClick={() => { setMode('edit'); onStateChange({ ...panel.state, mode: 'edit' }); }}
            className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${mode === 'edit' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <div className="flex items-center gap-1.5"><Edit2 className="w-3 h-3" /> 编辑</div>
          </button>
          <button 
            onClick={() => { setMode('preview'); onStateChange({ ...panel.state, mode: 'preview' }); }}
            className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${mode === 'preview' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <div className="flex items-center gap-1.5"><Eye className="w-3 h-3" /> 预览</div>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {!panel.referencedFileId ? (
          <div className="absolute inset-0 bg-gray-50 flex flex-col items-center justify-center p-4 z-10">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500 mb-4">未选择笔记文件</p>
            <button 
              onClick={onReplaceReference}
              className="px-4 py-2 bg-white border border-gray-200 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              选择或新建笔记
            </button>
          </div>
        ) : null}

        {mode === 'edit' ? (
          <textarea 
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-full p-4 resize-none outline-none font-mono text-sm text-gray-800 bg-white"
            placeholder="在这里写 Markdown 笔记..."
          />
        ) : (
          <div className="w-full h-full p-6 overflow-auto bg-white prose prose-sm max-w-none">
            {/* Markdown 预览占位 */}
            <h1>{panel.title}</h1>
            <p>这里是 Markdown 内容预览。</p>
            <pre><code>{content}</code></pre>
          </div>
        )}
      </div>
    </div>
  );
}
