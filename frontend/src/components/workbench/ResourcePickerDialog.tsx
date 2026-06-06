import { useEffect, useMemo, useRef, useState } from 'react';
import {
  OWDocumentPageIcon,
  OWPencilSquareIcon,
  OWSearchIcon,
  OWWorkspaceIcon
} from '../common/openWebUIIcons';
import { ResourceReference } from '../../types';

interface ResourcePickerDialogProps {
  open: boolean;
  resources: ResourceReference[];
  anchorRect?: { left: number; top: number; bottom: number; width: number } | null;
  onClose: () => void;
  onSelect: (resource: ResourceReference) => void;
}

type KnowledgeItemType = 'note' | 'collection' | 'file';
const MENU_ANIMATION_MS = 200;

const getKnowledgeItemType = (resource: ResourceReference): KnowledgeItemType => {
  const type = String(resource.type || '').toLowerCase();
  const resourceType = String(resource.resourceType || '').toLowerCase();
  const fileCategory = String(resource.fileCategory || '').toLowerCase();
  const extension = String(resource.extension || resource.name.split('.').pop() || '').toLowerCase();

  if (resourceType === 'note' || fileCategory.includes('note') || extension === 'md' || extension === 'markdown') {
    return 'note';
  }

  if (type.includes('folder')) return 'collection';

  return 'file';
};

const typeOrder: Record<KnowledgeItemType, number> = {
  note: 0,
  collection: 1,
  file: 2
};

const typeLabel: Record<KnowledgeItemType, string> = {
  note: 'Notes',
  collection: 'Collections',
  file: 'Files'
};

const KnowledgeIcon = ({ type }: { type: KnowledgeItemType }) => {
  if (type === 'note') return <OWPencilSquareIcon className="size-4" strokeWidth={1.75} />;
  if (type === 'collection') return <OWWorkspaceIcon className="size-4" strokeWidth={1.75} />;
  return <OWDocumentPageIcon className="size-4" strokeWidth={1.75} />;
};

export default function ResourcePickerDialog({
  open,
  resources,
  anchorRect,
  onClose,
  onSelect
}: ResourcePickerDialogProps) {
  const [query, setQuery] = useState('');
  const [shouldRender, setShouldRender] = useState(open);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const items = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return resources
      .map((resource) => ({
        resource,
        type: getKnowledgeItemType(resource)
      }))
      .filter(({ resource }) => {
        if (!normalizedQuery) return true;
        return [resource.name, resource.path, resource.type, resource.resourceType, resource.fileCategory]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => {
        const byType = typeOrder[left.type] - typeOrder[right.type];
        if (byType !== 0) return byType;
        return left.resource.name.localeCompare(right.resource.name);
      });
  }, [query, resources]);

  useEffect(() => {
    if (open) {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setShouldRender(true);
      setClosing(false);
      return;
    }

    if (shouldRender) {
      setClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        setShouldRender(false);
        setClosing(false);
        setQuery('');
        closeTimerRef.current = null;
      }, MENU_ANIMATION_MS);
    } else {
      setQuery('');
    }
  }, [open, shouldRender]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  const closeWithAnimation = (afterClose: () => void) => {
    if (closing) return;
    setClosing(true);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setShouldRender(false);
      setClosing(false);
      setQuery('');
      closeTimerRef.current = null;
      afterClose();
    }, MENU_ANIMATION_MS);
  };

  if (!shouldRender) return null;

  const menuWidth = 280;
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const fallbackLeft = Math.max(12, Math.round((viewportWidth - menuWidth) / 2));
  const rawLeft = anchorRect
    ? anchorRect.left + menuWidth > viewportWidth - 12
      ? anchorRect.left + anchorRect.width - menuWidth
      : anchorRect.left
    : fallbackLeft;
  const menuLeft = Math.max(12, Math.min(rawLeft, viewportWidth - menuWidth - 12));
  const menuTop = anchorRect ? anchorRect.bottom + 8 : 96;

  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={() => closeWithAnimation(onClose)}
    >
      <div
        className="fixed z-[10000] flex w-[17.5rem] flex-col rounded-2xl border border-gray-200 bg-white p-1.5 text-black shadow-lg dark:border-gray-800 dark:bg-[#1f2937] dark:text-white"
        style={{
          left: menuLeft,
          top: menuTop,
          transformOrigin: 'top left',
          animation: closing
            ? 'openwebui-folder-dropdown-unfold 200ms cubic-bezier(0.33, 1, 0.68, 1) reverse forwards'
            : 'openwebui-folder-dropdown-unfold 200ms cubic-bezier(0.33, 1, 0.68, 1) forwards'
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex w-full space-x-2 px-2 pb-0.5">
          <div className="flex flex-1">
            <div className="mr-2 self-center">
              <OWSearchIcon className="size-3.5" strokeWidth={2} />
            </div>
            <input
              className="w-full rounded-r-xl bg-transparent py-1 pr-4 text-sm outline-none"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              autoFocus
            />
          </div>
        </div>

        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-scroll">
          {items.length === 0 ? (
            <div className="pb-6 pt-4 text-center text-xs text-gray-500 dark:text-gray-400">
              No knowledge found
            </div>
          ) : (
            items.map((item, index) => {
              const previousType = items[index - 1]?.type;
              const showGroupLabel = index === 0 || item.type !== previousType;

              return (
                <div key={item.resource.id}>
                  {showGroupLabel ? (
                    <div className="px-2 py-1 text-xs text-gray-500">
                      {typeLabel[item.type]}
                    </div>
                  ) : null}

                  <div className="selected-command-option-button flex w-full items-center justify-between rounded-xl px-2.5 py-1 text-left text-sm hover:bg-gray-50 hover:dark:bg-gray-800 hover:dark:text-gray-100">
                    <button
                      className="w-full flex-1"
                      type="button"
                      onClick={() => {
                        closeWithAnimation(() => onSelect(item.resource));
                      }}
                    >
                      <div className="flex shrink-0 items-center gap-1 text-black dark:text-gray-100">
                        <KnowledgeIcon type={item.type} />
                        <div className="line-clamp-1 flex-1 text-left text-sm">
                          {item.resource.name}
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
