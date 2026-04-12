import { UIEventState } from '../base.js';
type ClipboardEventStateOptions = {
    event: ClipboardEvent;
};
export declare class ClipboardEventState extends UIEventState {
    raw: ClipboardEvent;
    type: string;
    constructor({ event }: ClipboardEventStateOptions);
}
declare global {
    interface BlockSuiteUIEventState {
        clipboardState: ClipboardEventState;
    }
}
export {};
//# sourceMappingURL=clipboard.d.ts.map