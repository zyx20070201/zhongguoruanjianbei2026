import type { InsertToPosition } from '@blocksuite/affine-shared/utils';
import type { ReactiveController } from 'lit';
import type { DataViewTable } from '../table-view.js';
import { TableRow } from '../row/row.js';
export declare class TableDragController implements ReactiveController {
    private host;
    dragStart: (row: TableRow, evt: PointerEvent) => void;
    dropPreview: {
        display(x: number, y: number, width: number): void;
        remove(): void;
    };
    getInsertPosition: (evt: MouseEvent) => {
        groupKey: string | undefined;
        position: InsertToPosition;
        y: number;
        width: number;
        x: number;
    } | undefined;
    showIndicator: (evt: MouseEvent) => {
        groupKey: string | undefined;
        position: InsertToPosition;
        y: number;
        width: number;
        x: number;
    } | undefined;
    constructor(host: DataViewTable);
    hostConnected(): void;
}
//# sourceMappingURL=drag.d.ts.map