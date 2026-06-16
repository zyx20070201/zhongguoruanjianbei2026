import React from 'react';
import { PanelInstance } from '../../types';
import PanelHeader from './PanelHeader';
import { Terminal, Save, Copy } from 'lucide-react';

interface ResultPanelProps {
  panel: PanelInstance;
  onClose: () => void;
  onRemove: () => void;
}

export default function ResultPanel({ panel, onClose, onRemove }: ResultPanelProps) {
  return (
    <div className="h-full flex flex-col bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <PanelHeader 
        panel={panel} 
        onClose={onClose} 
        onRemove={onRemove} 
        onReplaceReference={() => {}} 
      />
      
      <div className="bg-gray-50 border-b border-gray-200 px-3 py-1.5 flex justify-end gap-2">
        <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors" title="复制输出">
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors" title="保存到文件">
          <Save className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 bg-[#1e1e1e] text-[#d4d4d4] font-mono text-sm flex flex-col">
        <div className="flex items-center gap-2 text-[#858585] mb-2 text-xs">
          <Terminal className="w-3 h-3" />
          <span>输出 / 结果</span>
        </div>
        
        <pre className="flex-1 whitespace-pre-wrap break-words mt-2">
          {`> 正在执行任务...
> 正在编译...
> 成功。

Hello, World!

执行完成，退出码 0。`}
        </pre>
      </div>
    </div>
  );
}
