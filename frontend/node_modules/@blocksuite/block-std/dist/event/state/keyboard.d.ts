import { UIEventState } from '../base.js';
type KeyboardEventStateOptions = {
    event: KeyboardEvent;
    composing: boolean;
};
export declare class KeyboardEventState extends UIEventState {
    composing: boolean;
    raw: KeyboardEvent;
    type: string;
    constructor({ event, composing }: KeyboardEventStateOptions);
}
declare global {
    interface BlockSuiteUIEventState {
        keyboardState: KeyboardEventState;
    }
}
export {};
//# sourceMappingURL=keyboard.d.ts.map