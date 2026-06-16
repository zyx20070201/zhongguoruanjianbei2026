import React from 'react';

export default function AICommandBar() {
  const [isOpen, setIsOpen] = React.useState(false);

  const handleSuggestionClick = (text: string) => {
    alert(`模拟 AI 操作：${text}
(AI Terminal 即将可用)`);
  };

  return (
    <div className="w-full mb-8 relative">
      <div 
        className="w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-2 flex items-center hover:border-blue-300 hover:shadow-md transition-all cursor-text"
        onClick={() => setIsOpen(true)}
      >
        <div className="pl-4 pr-3 text-blue-500">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
        </div>
        <input 
          type="text" 
          className="flex-1 bg-transparent border-none focus:ring-0 text-lg py-2 outline-none"
          placeholder="让 AI 整理课程资料、创建复习 workspace，或建议下一步..."
          onClick={(e) => e.stopPropagation()}
          onFocus={() => setIsOpen(true)}
        />
        <div className="pr-4 flex gap-2">
          <kbd className="hidden md:inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-100 border border-gray-200 rounded">⌘ K</kbd>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3 px-2">
        <button onClick={() => handleSuggestionClick('整理课程资料')} className="px-3 py-1.5 bg-blue-50 text-blue-700 text-sm rounded-full hover:bg-blue-100 transition-colors border border-blue-100 flex items-center gap-1">
          <span>✨</span> 整理课程资料
        </button>
        <button onClick={() => handleSuggestionClick('创建复习 Workbench')} className="px-3 py-1.5 bg-purple-50 text-purple-700 text-sm rounded-full hover:bg-purple-100 transition-colors border border-purple-100 flex items-center gap-1">
          <span>📚</span> 创建复习 Workbench
        </button>
        <button onClick={() => handleSuggestionClick('生成课程概览')} className="px-3 py-1.5 bg-green-50 text-green-700 text-sm rounded-full hover:bg-green-100 transition-colors border border-green-100 flex items-center gap-1">
          <span>📊</span> 生成课程概览
        </button>
        <button onClick={() => handleSuggestionClick('推荐下一步学习任务')} className="px-3 py-1.5 bg-orange-50 text-orange-700 text-sm rounded-full hover:bg-orange-100 transition-colors border border-orange-100 flex items-center gap-1">
          <span>🎯</span> 推荐下一步学习任务
        </button>
      </div>

      {/* Mock AI Modal/Drawer */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/20 z-40 flex items-start justify-center pt-32" onClick={() => setIsOpen(false)}>
          <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center gap-3">
              <span className="text-blue-500">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
              </span>
              <input 
                type="text" 
                className="flex-1 text-lg outline-none"
                placeholder="询问 AI..."
                autoFocus
              />
              <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">
                <kbd className="px-2 py-1 text-xs font-semibold bg-gray-100 rounded">ESC</kbd>
              </button>
            </div>
            <div className="p-8 text-center text-gray-500 flex flex-col items-center">
              <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
              </div>
              <p className="text-lg font-medium text-gray-800 mb-2">AI Terminal 即将可用</p>
              <p>这里是全局 AI 工作流入口的占位区域。</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
