import type { ReactiveController } from 'lit';
import type { DataViewKanban } from '../kanban-view.js';
export declare class KanbanClipboardController implements ReactiveController {
    host: DataViewKanban;
    private _onCopy;
    private _onPaste;
    private get readonly();
    constructor(host: DataViewKanban);
    hostConnected(): void;
}
//# sourceMappingURL=clipboard.d.ts.map