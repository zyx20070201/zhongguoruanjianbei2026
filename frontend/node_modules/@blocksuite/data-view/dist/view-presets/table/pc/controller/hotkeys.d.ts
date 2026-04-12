import type { ReactiveController } from 'lit';
import type { DataViewTable } from '../table-view.js';
export declare class TableHotkeysController implements ReactiveController {
    private host;
    get selectionController(): import("./selection.js").TableSelectionController;
    constructor(host: DataViewTable);
    hostConnected(): void;
}
//# sourceMappingURL=hotkeys.d.ts.map