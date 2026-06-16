import React from 'react';
import { Sparkles, Send, X, FileText, Layout, Lightbulb, Minimize2, Folder } from 'lucide-react';

interface AITerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}

export default function AITerminalDrawer({ isOpen, onClose, workspaceName }: AITerminalDrawerProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/20 z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col transform transition-transform animate-in slide-in-from-right duration-300 border-l border-gray-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center gap-2 text-indigo-700">
            <Sparkles className="w-5 h-5" />
            <h2 className="font-bold">AI Chat</h2>
          </div>
          <div className="flex items-center gap-1">
            <button className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white/50 rounded-md transition-colors">
              <Minimize2 className="w-4 h-4" />
            </button>
            <button 
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white/50 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Context info */}
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 flex items-center justify-between">
          <span className="truncate">上下文：{workspaceName} Workspace</span>
          <span className="flex items-center gap-1 text-green-600 font-medium">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> 活跃
          </span>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col gap-4">
          <div className="flex gap-3 max-w-[85%]">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 text-white shadow-sm">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-tl-none p-3 text-sm text-gray-800">
              <p>你好！我是 <strong>{workspaceName}</strong> 的 AI Chat。我可以帮你整理文件、总结资料、创建 workbench，或建议下一步学习任务。</p>
              <p className="mt-2 text-gray-500 text-xs">你想先做什么？</p>
            </div>
          </div>
          
          <div className="flex gap-3 max-w-[85%] self-end flex-row-reverse">
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 text-gray-500 text-xs font-bold shadow-sm">
              ME
            </div>
            <div className="bg-blue-600 text-white rounded-2xl rounded-tr-none p-3 text-sm shadow-sm">
              能帮我设置这个 workspace 吗？
            </div>
          </div>
          
          <div className="flex gap-3 max-w-[85%]">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 text-white shadow-sm">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-tl-none p-3 text-sm text-gray-800">
              <p>当然！我可以扫描你上传的资料，并建议一个初始结构。</p>
              
              <div className="mt-3 border border-gray-200 bg-white rounded-lg p-3 shadow-sm">
                <p className="font-bold text-xs text-gray-500 uppercase tracking-wider mb-2">建议操作</p>
                <div className="space-y-2">
                  <button className="w-full text-left px-3 py-2 text-sm border border-blue-100 hover:border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-md transition-colors flex items-center gap-2">
                    <Folder className="w-4 h-4" /> 创建默认文件夹结构
                  </button>
                  <button className="w-full text-left px-3 py-2 text-sm border border-gray-200 hover:border-gray-300 bg-white text-gray-700 rounded-md transition-colors flex items-center gap-2">
                    <Layout className="w-4 h-4 text-gray-400" /> 创建“入门学习”workbench
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-gray-200 bg-white">
          <div className="flex flex-wrap gap-2 mb-3">
            <button className="px-2.5 py-1 text-xs border border-gray-200 rounded-full hover:bg-gray-50 text-gray-600 flex items-center gap-1 transition-colors">
              <FileText className="w-3 h-3" /> 总结
            </button>
            <button className="px-2.5 py-1 text-xs border border-gray-200 rounded-full hover:bg-gray-50 text-gray-600 flex items-center gap-1 transition-colors">
              <Layout className="w-3 h-3" /> 新建 Workbench
            </button>
            <button className="px-2.5 py-1 text-xs border border-gray-200 rounded-full hover:bg-gray-50 text-gray-600 flex items-center gap-1 transition-colors">
              <Lightbulb className="w-3 h-3" /> 建议下一步
            </button>
          </div>
          
          <div className="relative flex items-end shadow-sm rounded-xl border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 transition-shadow overflow-hidden">
            <textarea 
              className="w-full max-h-32 min-h-[44px] py-3 pl-3 pr-10 text-sm outline-none resize-none bg-transparent"
              placeholder="询问 AI Chat..."
              rows={1}
            />
            <button className="absolute right-2 bottom-2 p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50">
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="text-[10px] text-center text-gray-400 mt-2">
            AI Chat 可以访问这个 workspace 的文件和任务。
          </div>
        </div>

      </div>
    </>
  );
}
