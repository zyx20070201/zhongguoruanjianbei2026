import React, { useState, useEffect } from 'react';
import { PanelInstance } from '../../types';
import PanelHeader from './PanelHeader';
import { FileCode, Play } from 'lucide-react';

interface CodePanelProps {
  panel: PanelInstance;
  onClose: () => void;
  onRemove: () => void;
  onReplaceReference: () => void;
  onStateChange: (state: any) => void;
}

export default function CodePanel({ panel, onClose, onRemove, onReplaceReference, onStateChange }: CodePanelProps) {
  const [code, setCode] = useState(`// ${panel.title}

function solve() {
  console.log("Hello, World!");
}

solve();`);

  // 模拟自动保存
  useEffect(() => {
    const timer = setTimeout(() => {
      onStateChange({ ...panel.state, saving: true, saved: false });
      setTimeout(() => {
        onStateChange({ ...panel.state, saving: false, saved: true });
      }, 800);
    }, 1000);
    return () => clearTimeout(timer);
  }, [code]);

  return (
    <div className="h-full flex flex-col bg-slate-900 rounded-lg shadow-sm border border-slate-700 overflow-hidden text-slate-300">
      <PanelHeader 
        panel={panel} 
        onClose={onClose} 
        onRemove={onRemove} 
        onReplaceReference={onReplaceReference} 
      />
      
      <div className="bg-slate-800 border-b border-slate-700 px-3 py-1.5 flex justify-between items-center text-xs">
        <span className="font-mono text-slate-400">javascript</span>
        <button 
          onClick={() => alert('模拟：运行代码')}
          className="flex items-center gap-1.5 px-3 py-1 bg-green-600/20 text-green-400 hover:bg-green-600/30 rounded transition-colors border border-green-600/30"
        >
          <Play className="w-3 h-3" /> 运行
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative font-mono text-sm">
        {!panel.referencedFileId ? (
          <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center p-4 z-10">
            <FileCode className="w-12 h-12 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 mb-4 font-sans">未选择代码文件</p>
            <button 
              onClick={onReplaceReference}
              className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-md font-medium text-slate-300 hover:bg-slate-700 transition-colors font-sans"
            >
              选择文件
            </button>
          </div>
        ) : null}

        <textarea 
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full h-full p-4 resize-none outline-none bg-transparent text-slate-300"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
