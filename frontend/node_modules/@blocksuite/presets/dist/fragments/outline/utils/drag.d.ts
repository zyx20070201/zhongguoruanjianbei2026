import type { Doc } from '@blocksuite/store';
import type { OutlinePanelBody } from '../body/outline-panel-body.js';
/**
 * start drag notes
 * @param notes notes to drag
 */
export declare function startDragging(options: {
    onDragEnd?: (insertIndex?: number) => void;
    onDragMove?: (insertIdx?: number, indicatorTranslateY?: number) => void;
    outlineListContainer: HTMLElement;
    document: Document;
    host: Document | HTMLElement;
    container: OutlinePanelBody;
    doc: Doc;
}): void;
//# sourceMappingURL=drag.d.ts.map