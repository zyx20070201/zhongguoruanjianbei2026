import React, { useState } from 'react';
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
  const [step, setStep] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState<CreateWorkspaceFormData>(initialFormData);

  React.useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setIsDragging(false);
      setFormData(initialFormData);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleNext = () => setStep(s => Math.min(s + 1, 3));
  const handlePrev = () => setStep(s => Math.max(s - 1, 1));

  const addResources = (files: FileList | File[]) => {
    const nextFiles = Array.from(files);
    if (nextFiles.length === 0) return;

    setFormData(current => ({
      ...current,
      resources: [...current.resources, ...nextFiles]
    }));
  };

  const removeResource = (index: number) => {
    setFormData(current => ({
      ...current,
      resources: current.resources.filter((_, fileIndex) => fileIndex !== index)
    }));
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) {
      handleNext();
    } else {
      onSubmit(formData);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full flex flex-col h-[600px] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header & Stepper */}
        <div className="p-6 border-b border-gray-100 bg-gray-50/50">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Create Workspace</h2>
              <p className="text-gray-500 text-sm mt-1">Set up your new course learning environment</p>
            </div>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
          
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((s) => (
              <React.Fragment key={s}>
                <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-colors ${
                  step === s ? 'bg-blue-600 text-white shadow-md' :
                  step > s ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {step > s ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg> : s}
                </div>
                {s < 3 && <div className={`flex-1 h-1 rounded-full transition-colors ${step > s ? 'bg-green-500' : 'bg-gray-200'}`}></div>}
              </React.Fragment>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-xs font-medium text-gray-500 px-1">
            <span>Course Basics</span>
            <span>Import Resources</span>
            <span>Review</span>
          </div>
        </div>

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <form id="create-workspace-form" onSubmit={handleSubmit}>
            {/* Step 1: Course Basics */}
            <div className={step === 1 ? 'block space-y-5 animate-in slide-in-from-right-4' : 'hidden'}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Course Name <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  required
                  value={formData.courseName}
                  onChange={e => setFormData({...formData, courseName: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-lg"
                  placeholder="e.g. Introduction to Computer Science"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Major / Discipline <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  required
                  value={formData.major}
                  onChange={e => setFormData({...formData, major: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                  placeholder="e.g. Computer Science"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
                <textarea 
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow resize-none"
                  rows={4}
                  placeholder="Brief description of this course workspace..."
                ></textarea>
              </div>
            </div>

            {/* Step 2: Import Initial Resources */}
            <div className={step === 2 ? 'block space-y-4 animate-in slide-in-from-right-4' : 'hidden'}>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-4">
                <p className="text-sm text-blue-800">
                  Upload course videos, slides, textbooks, lecture notes, exercises, code samples, etc. to jumpstart your workspace.
                </p>
              </div>

              {formData.resources.length > 0 && (
                <div className="border border-blue-200 bg-blue-50/40 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-blue-100">
                    <p className="text-sm font-semibold text-blue-900">
                      {formData.resources.length} files selected
                    </p>
                    <button
                      type="button"
                      onClick={() => setFormData(current => ({ ...current, resources: [] }))}
                      className="text-xs text-blue-700 hover:text-blue-900 px-2 py-1 rounded"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-36 overflow-y-auto divide-y divide-blue-100/70">
                    {formData.resources.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-800 truncate">{file.name}</p>
                          <p className="text-xs text-gray-500">{Math.ceil(file.size / 1024)} KB</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeResource(index)}
                          className="text-gray-500 hover:text-red-600 px-2 py-1 rounded"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <div
                className={`border-2 border-dashed rounded-xl text-center transition-colors cursor-pointer group ${
                  isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:bg-gray-50'
                } ${formData.resources.length > 0 ? 'p-5' : 'p-8'}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  addResources(e.dataTransfer.files);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addResources(e.target.files);
                    e.target.value = '';
                  }}
                />
                <div className={`${formData.resources.length > 0 ? 'w-12 h-12 mb-3' : 'w-16 h-16 mb-4'} bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto group-hover:scale-110 transition-transform`}>
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-1">
                  {formData.resources.length > 0 ? 'Click or drag to add more files' : 'Click or drag files to upload'}
                </h3>
                <p className={`text-sm text-gray-500 ${formData.resources.length > 0 ? 'mb-0' : 'mb-6'}`}>
                  Support PDF, MP4, PPTX, DOCX, ZIP, etc.
                </p>
                
                {formData.resources.length === 0 && (
                <div className="flex flex-wrap justify-center gap-2">
                  <span className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded-full border border-gray-200">Slides</span>
                  <span className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded-full border border-gray-200">Textbook</span>
                  <span className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded-full border border-gray-200">Notes</span>
                  <span className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded-full border border-gray-200">Videos</span>
                </div>
                )}
              </div>
            </div>

            {/* Step 3: Review */}
            <div className={step === 3 ? 'block space-y-4 animate-in slide-in-from-right-4' : 'hidden'}>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-4">
                <h4 className="font-medium text-blue-900 mb-1">Ready to create</h4>
                <p className="text-sm text-blue-800">
                  Uploaded files will be placed in a new folder named uploaded resources so you can reorganize them later.
                </p>
              </div>

              <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Workspace</p>
                  <p className="text-sm font-medium text-gray-900">{formData.courseName || 'Untitled workspace'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Major</p>
                  <p className="text-sm text-gray-700">{formData.major || 'General'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Initial resources</p>
                  <p className="text-sm text-gray-700">
                    {formData.resources.length > 0
                      ? `${formData.resources.length} files will be uploaded`
                      : 'No files selected'}
                  </p>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-between">
          <button 
            type="button"
            onClick={step === 1 ? onClose : handlePrev}
            className="px-6 py-2.5 text-gray-600 font-medium hover:bg-gray-200 rounded-lg transition-colors"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          
          <button 
            type="submit"
            form="create-workspace-form"
            disabled={step === 1 && (!formData.courseName || !formData.major)}
            className="px-8 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {step < 3 ? (
              <>Next Step <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg></>
            ) : (
              <>Create Workspace</>
            )}
          </button>
        </div>
        
      </div>
    </div>
  );
}
