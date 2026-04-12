import type { ReactiveController } from 'lit';
import type { DataViewKanban } from '../kanban-view.js';
export declare class KanbanHotkeysController implements ReactiveController {
    private host;
    private get hasSelection();
    constructor(host: DataViewKanban);
    hostConnected(): void;
}
//# sourceMappingURL=hotkeys.d.ts.map