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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        id="create-workspace-form"
        onSubmit={handleSubmit}
        className="workspace-modal-enter w-full max-w-xl rounded-[22px] bg-[#fafafa] px-8 py-8 shadow-[0_28px_90px_rgba(60,64,67,0.24)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-normal text-[#202124]">Create Workspace</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#7d8188] transition hover:bg-[#f1f3f4] hover:text-[#3c4043]"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-10 space-y-7">
          <div className="relative">
            <input
              id="course-name"
              type="text"
              required
              value={formData.courseName}
              onChange={(event) => setFormData({ ...formData, courseName: event.target.value })}
              className="peer h-14 w-full rounded-[6px] border border-[#cfd4dc] bg-transparent px-4 text-base text-[#202124] outline-none transition-[border,box-shadow] duration-200 placeholder:text-transparent focus:border-[#1a73e8] focus:border-2"
              placeholder="Course name"
              autoFocus
            />
            <label
              className="pointer-events-none absolute -top-2 left-3 bg-[#fafafa] px-1 text-xs font-medium text-[#5f6368] transition-colors peer-focus:text-[#1a73e8]"
              htmlFor="course-name"
            >
              Course name *
            </label>
          </div>

          <div className="relative">
            <textarea
              id="course-description"
              value={formData.description}
              onChange={(event) => setFormData({ ...formData, description: event.target.value })}
              className="peer min-h-32 w-full resize-none rounded-[6px] border border-[#cfd4dc] bg-transparent px-4 py-4 text-sm leading-6 text-[#202124] outline-none transition-[border,box-shadow] duration-200 placeholder:text-transparent focus:border-[#1a73e8] focus:border-2"
              placeholder="Description"
            />
            <label
              className="pointer-events-none absolute -top-2 left-3 bg-[#fafafa] px-1 text-xs font-medium text-[#5f6368] transition-colors peer-focus:text-[#1a73e8]"
              htmlFor="course-description"
            >
              Description
            </label>
          </div>
        </div>

        <div className="mt-10 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#d9dfe8] bg-white px-7 py-3 text-sm font-semibold text-[#202124] transition hover:bg-[#f6f7f8]"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={!canCreate}
            className="flex h-12 items-center gap-2 rounded-full bg-[#4357ff] px-7 text-sm font-semibold text-white shadow-sm transition hover:bg-[#3347f4] disabled:cursor-not-allowed disabled:bg-[#d6d9de] disabled:text-[#8a8f98]"
          >
            <Plus className="h-4 w-4" />
            Create workspace
          </button>
        </div>
      </form>
    </div>
  );
}
