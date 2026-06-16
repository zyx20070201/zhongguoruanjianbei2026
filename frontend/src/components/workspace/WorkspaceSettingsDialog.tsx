import React, { useState } from 'react';
import { X, Settings, FolderTree, Copy, Archive, Trash2, Code2 } from 'lucide-react';

interface WorkspaceSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialData: {
    name: string;
    description: string;
    major: string;
  };
  onSave: (data: any) => void;
  developerMode: boolean;
  onToggleDeveloperMode: (enabled: boolean) => void;
  developerContent?: React.ReactNode;
}

export default function WorkspaceSettingsDialog({
  isOpen,
  onClose,
  initialData,
  onSave,
  developerMode,
  onToggleDeveloperMode,
  developerContent
}: WorkspaceSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'structure' | 'management' | 'developer'>('general');
  const [formData, setFormData] = useState(initialData);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full flex flex-col h-[500px] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-gray-500" /> Workspace 设置
          </h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Tabs Sidebar */}
          <div className="w-48 bg-gray-50 border-r border-gray-100 p-4 space-y-1">
            <button 
              onClick={() => setActiveTab('general')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'general' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              通用
            </button>
            <button 
              onClick={() => setActiveTab('structure')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'structure' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              结构
            </button>
            <button 
              onClick={() => setActiveTab('management')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'management' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              管理
            </button>
            <button
              onClick={() => setActiveTab('developer')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'developer' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              开发者
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {activeTab === 'general' && (
              <div className="space-y-4 animate-in slide-in-from-right-4">
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">基本信息</h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">课程名称</label>
                  <input 
                    type="text" 
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">专业 / 学科</label>
                  <input 
                    type="text" 
                    value={formData.major}
                    onChange={(e) => setFormData({...formData, major: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                  <textarea 
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                    rows={4}
                  />
                </div>
              </div>
            )}

            {activeTab === 'structure' && (
              <div className="space-y-4 animate-in slide-in-from-right-4">
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-4 flex items-center gap-2">
                  <FolderTree className="w-5 h-5 text-gray-400" /> 默认结构
                </h3>
                <p className="text-sm text-gray-500 mb-4">配置这个 workspace 的默认系统文件夹。</p>
                
                <div className="space-y-3">
                  {['materials', 'notes', 'code', 'resources', 'prompts', 'generated'].map(folder => (
                    <label key={folder} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                      <div className="flex items-center gap-3">
                        <input type="checkbox" defaultChecked className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" />
                        <span className="font-medium text-gray-700">{folder}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'management' && (
              <div className="space-y-6 animate-in slide-in-from-right-4">
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2">Workspace 管理</h3>
                
                <div className="border border-gray-200 rounded-lg p-4 flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-gray-800">复制 Workspace</h4>
                    <p className="text-sm text-gray-500">创建这个 workspace 及其结构的副本。</p>
                  </div>
                  <button className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm">
                    <Copy className="w-4 h-4" /> 复制
                  </button>
                </div>

                <div className="border border-yellow-200 bg-yellow-50 rounded-lg p-4 flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-yellow-800">归档 Workspace</h4>
                    <p className="text-sm text-yellow-700/80">将这个 workspace 设为只读，并从活跃视图中移除。</p>
                  </div>
                  <button className="px-4 py-2 bg-yellow-100 text-yellow-800 font-medium rounded-lg hover:bg-yellow-200 flex items-center gap-2 text-sm">
                    <Archive className="w-4 h-4" /> 归档
                  </button>
                </div>

                <div className="border border-red-200 bg-red-50 rounded-lg p-4 flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-red-800">删除 Workspace</h4>
                    <p className="text-sm text-red-700/80">永久删除这个 workspace 及其全部数据。</p>
                  </div>
                  <button className="px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 flex items-center gap-2 text-sm shadow-sm">
                    <Trash2 className="w-4 h-4" /> 删除
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'developer' && (
              <div className="space-y-4 animate-in slide-in-from-right-4">
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-4 flex items-center gap-2">
                  <Code2 className="w-5 h-5 text-gray-400" /> 开发者模式
                </h3>
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-800">启用开发者模式</p>
                      <p className="text-sm text-gray-500">仅在设置中显示调试面板和技术记忆详情。</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onToggleDeveloperMode(!developerMode)}
                      className={`inline-flex h-7 w-12 items-center rounded-full transition ${developerMode ? 'bg-blue-600 justify-end' : 'bg-gray-300 justify-start'} p-1`}
                    >
                      <span className="h-5 w-5 rounded-full bg-white" />
                    </button>
                  </div>
                </div>
                {developerMode && developerContent ? (
                  <div className="max-h-[380px] overflow-y-auto rounded-lg border border-gray-200 p-3">
                    {developerContent}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-200 rounded-lg transition-colors"
          >
            取消
          </button>
          <button 
            onClick={() => onSave(formData)}
            className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            保存更改
          </button>
        </div>

      </div>
    </div>
  );
}
