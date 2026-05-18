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
            <Settings className="w-5 h-5 text-gray-500" /> Workspace Settings
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
              General
            </button>
            <button 
              onClick={() => setActiveTab('structure')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'structure' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              Structure
            </button>
            <button 
              onClick={() => setActiveTab('management')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'management' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              Management
            </button>
            <button
              onClick={() => setActiveTab('developer')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'developer' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              Developer
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {activeTab === 'general' && (
              <div className="space-y-4 animate-in slide-in-from-right-4">
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-4">General Information</h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Course Name</label>
                  <input 
                    type="text" 
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Major / Discipline</label>
                  <input 
                    type="text" 
                    value={formData.major}
                    onChange={(e) => setFormData({...formData, major: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
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
                  <FolderTree className="w-5 h-5 text-gray-400" /> Default Structure
                </h3>
                <p className="text-sm text-gray-500 mb-4">Configure the default system folders for this workspace.</p>
                
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
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2">Workspace Management</h3>
                
                <div className="border border-gray-200 rounded-lg p-4 flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-gray-800">Duplicate Workspace</h4>
                    <p className="text-sm text-gray-500">Create a copy of this workspace and its structure.</p>
                  </div>
                  <button className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm">
                    <Copy className="w-4 h-4" /> Duplicate
                  </button>
                </div>

                <div className="border border-yellow-200 bg-yellow-50 rounded-lg p-4 flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-yellow-800">Archive Workspace</h4>
                    <p className="text-sm text-yellow-700/80">Make this workspace read-only and remove from active view.</p>
                  </div>
                  <button className="px-4 py-2 bg-yellow-100 text-yellow-800 font-medium rounded-lg hover:bg-yellow-200 flex items-center gap-2 text-sm">
                    <Archive className="w-4 h-4" /> Archive
                  </button>
                </div>

                <div className="border border-red-200 bg-red-50 rounded-lg p-4 flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-red-800">Delete Workspace</h4>
                    <p className="text-sm text-red-700/80">Permanently delete this workspace and all its data.</p>
                  </div>
                  <button className="px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 flex items-center gap-2 text-sm shadow-sm">
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'developer' && (
              <div className="space-y-4 animate-in slide-in-from-right-4">
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 mb-4 flex items-center gap-2">
                  <Code2 className="w-5 h-5 text-gray-400" /> Developer Mode
                </h3>
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-800">Enable developer mode</p>
                      <p className="text-sm text-gray-500">Show debug panels and technical memory details in settings only.</p>
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
            Cancel
          </button>
          <button 
            onClick={() => onSave(formData)}
            className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            Save Changes
          </button>
        </div>

      </div>
    </div>
  );
}
