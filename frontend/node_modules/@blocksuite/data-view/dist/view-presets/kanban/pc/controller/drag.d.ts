import type { InsertToPosition } from '@blocksuite/affine-shared/utils';
import type { ReactiveController } from 'lit';
import type { DataViewKanban } from '../kanban-view.js';
import { KanbanCard } from '../card.js';
import { KanbanGroup } from '../group.js';
export declare class KanbanDragController implements ReactiveController {
    private host;
    dragStart: (ele: KanbanCard, evt: PointerEvent) => void;
    dropPreview: {
        display(group: KanbanGroup, self: KanbanCard | undefined, card?: KanbanCard): void;
        remove(): void;
    };
    getInsertPosition: (evt: MouseEvent) => {
        group: KanbanGroup;
        card?: KanbanCard;
        position: InsertToPosition;
    } | undefined;
    shooIndicator: (evt: MouseEvent, self: KanbanCard | undefined) => {
        group: KanbanGroup;
        position: InsertToPosition;
    } | undefined;
    get scrollContainer(): HTMLElement;
    constructor(host: DataViewKanban);
    hostConnected(): void;
}
//# sourceMappingURL=drag.d.ts.map