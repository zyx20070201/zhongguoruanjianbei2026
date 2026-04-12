import { FileText, FolderOpen, Link2, Video } from 'lucide-react';
import { ResourceReference } from '../../types';

interface ResourcePickerDialogProps {
  open: boolean;
  resources: ResourceReference[];
  onClose: () => void;
  onSelect: (resource: ResourceReference) => void;
}

const getResourceIcon = (resource: ResourceReference) => {
  if (resource.type.includes('video')) return <Video className="h-4 w-4" />;
  if (resource.type.includes('folder')) return <FolderOpen className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
};

export default function ResourcePickerDialog({
  open,
  resources,
  onClose,
  onSelect
}: ResourcePickerDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Bind Resource</h2>
            <p className="text-sm text-slate-500">Select a workspace resource for this editor.</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            Close
          </button>
        </div>

        {resources.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No resources found in this workspace yet. Upload or create files in the workspace explorer first.
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto px-3 py-3">
            {resources.map((resource) => (
              <button
                key={resource.id}
                onClick={() => onSelect(resource)}
                className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-slate-50"
              >
                <div className="mt-0.5 rounded-lg bg-slate-100 p-2 text-slate-600">{getResourceIcon(resource)}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{resource.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <Link2 className="h-3 w-3" />
                    <span className="truncate">{resource.path}</span>
                  </div>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-600">
                  {resource.type}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
