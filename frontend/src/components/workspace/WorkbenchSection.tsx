import React from 'react';
import { WorkbenchItem } from '../../types';
import { Plus, Play, BookOpen, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

interface WorkbenchSectionProps {
  workbenches: WorkbenchItem[];
  onCreateNew: () => void;
  onDelete: (id: string) => void;
}

export default function WorkbenchSection({ workbenches, onCreateNew, onDelete }: WorkbenchSectionProps) {
  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Workbenches</h3>
          <p className="text-sm text-gray-500">这个课程的任务型学习空间</p>
        </div>
        
        <button 
          onClick={onCreateNew}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          新建 Workbench
        </button>
      </div>

      {workbenches.length === 0 ? (
        <div className="py-12 px-6 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50 text-center">
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-gray-100">
            <BookOpen className="w-6 h-6 text-gray-400" />
          </div>
          <h4 className="text-gray-900 font-medium mb-1">还没有 workbench</h4>
          <p className="text-gray-500 text-sm mb-4">创建第一个任务型学习空间，开始学习。</p>
          <button 
            onClick={onCreateNew}
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            创建 Workbench
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workbenches.map(wb => (
            <div key={wb.id} className="bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-md transition-all group flex flex-col">
              <div className="flex items-start justify-between mb-3 gap-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-gray-50 rounded-md border border-gray-100">
                    <BookOpen className="w-4 h-4 text-blue-500" />
                  </div>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-100">
                    Workbench
                  </span>
                </div>
                <button
                  onClick={() => onDelete(wb.id)}
                  className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
                  title="删除 workbench"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              
              <h4 className="font-bold text-gray-900 text-lg mb-1 group-hover:text-blue-600 transition-colors">{wb.title}</h4>
              <p className="text-xs text-gray-500 mb-2">
                更新于 {wb.updatedAt}
              </p>
              <p className="text-sm text-gray-600 mb-4 flex-1">
                {wb.description || '已保存打开的编辑器、布局和任务上下文。'}
              </p>
              
              <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
                <span>{wb.panelCount} 个打开的编辑器</span>
              </div>

              <Link 
                to={`/workbenches/${wb.id}`}
                className="mt-auto w-full flex items-center justify-center gap-1.5 py-2 bg-gray-50 hover:bg-blue-50 text-gray-700 hover:text-blue-700 text-sm font-medium rounded-lg border border-gray-200 hover:border-blue-200 transition-colors"
              >
                <Play className="w-4 h-4" /> 打开 Workbench
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
