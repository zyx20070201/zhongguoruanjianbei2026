import { UIEventState } from '../base.js';
type DndEventStateOptions = {
    event: DragEvent;
};
export declare class DndEventState extends UIEventState {
    raw: DragEvent;
    type: string;
    constructor({ event }: DndEventStateOptions);
}
declare global {
    interface BlockSuiteUIEventState {
        dndState: DndEventState;
    }
}
export {};
//# sourceMappingURL=dnd.d.ts.map