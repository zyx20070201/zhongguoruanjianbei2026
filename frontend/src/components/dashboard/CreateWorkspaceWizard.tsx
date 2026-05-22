import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { CreateWorkspaceFormData } from '../../types';

interface CreateWorkspaceWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateWorkspaceFormData) => void;
}

const initialFormData: CreateWorkspaceFormData = {
  courseName: '',
  description: '',
  major: '',
  resources: [],
  initMode: 'empty'
};

export default function CreateWorkspaceWizard({ isOpen, onClose, onSubmit }: CreateWorkspaceWizardProps) {
  const [formData, setFormData] = useState<CreateWorkspaceFormData>(initialFormData);

  React.useEffect(() => {
    if (!isOpen) setFormData(initialFormData);
  }, [isOpen]);

  if (!isOpen) return null;

  const canCreate = formData.courseName.trim().length > 0;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;

    onSubmit({
      ...formData,
      courseName: formData.courseName.trim(),
      major: '',
      description: (formData.description || '').trim(),
      resources: []
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#202124]/12 p-4">
      <form
        id="create-workspace-form"
        onSubmit={handleSubmit}
        className="workspace-modal-enter w-full max-w-lg rounded-xl border border-[#e5e5df] bg-white p-6 shadow-[0_26px_80px_rgba(32,33,36,0.18)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-[#202124]">新建课程</h2>
            <p className="mt-1 text-sm text-[#777b80]">先放一个课程文件夹，之后再慢慢补资料。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#7d8188] transition hover:bg-[#f1f3f4] hover:text-[#3c4043]"
            title="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <div className="relative">
            <label
              className="mb-1.5 block text-sm font-medium text-[#34373c]"
              htmlFor="course-name"
            >
              课程名称 *
            </label>
            <input
              id="course-name"
              type="text"
              required
              value={formData.courseName}
              onChange={(event) => setFormData({ ...formData, courseName: event.target.value })}
              className="h-10 w-full rounded-lg border border-[#d8d8d3] bg-white px-3 text-sm text-[#202124] outline-none transition focus:border-[#b9bab2] focus:shadow-[0_0_0_4px_rgba(32,33,36,0.04)]"
              placeholder="课程名称"
              autoFocus
            />
          </div>

          <div className="relative">
            <label
              className="mb-1.5 block text-sm font-medium text-[#34373c]"
              htmlFor="course-description"
            >
              课程描述
            </label>
            <textarea
              id="course-description"
              value={formData.description}
              onChange={(event) => setFormData({ ...formData, description: event.target.value })}
              className="min-h-24 w-full resize-none rounded-lg border border-[#d8d8d3] bg-white px-3 py-2 text-sm leading-6 text-[#202124] outline-none transition focus:border-[#b9bab2] focus:shadow-[0_0_0_4px_rgba(32,33,36,0.04)]"
              placeholder="课程描述"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-3 text-sm font-medium text-[#666a70] transition hover:bg-[#f6f6f4] hover:text-[#202124]"
          >
            取消
          </button>

          <button
            type="submit"
            disabled={!canCreate}
            className="flex h-9 items-center gap-2 rounded-lg bg-[#202124] px-4 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-[#d6d6d1]"
          >
            <Plus className="h-4 w-4" />
            新建课程
          </button>
        </div>
      </form>
    </div>
  );
}
