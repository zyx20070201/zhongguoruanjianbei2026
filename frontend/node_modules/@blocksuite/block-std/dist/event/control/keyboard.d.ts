import type { EventOptions, UIEventDispatcher } from '../dispatcher.js';
import { type UIEventHandler } from '../base.js';
export declare class KeyboardControl {
    private _dispatcher;
    private _down;
    private _shouldTrigger;
    private _up;
    private composition;
    constructor(_dispatcher: UIEventDispatcher);
    private _createContext;
    bindHotkey(keymap: Record<string, UIEventHandler>, options?: EventOptions): () => void;
    listen(): void;
}
//# sourceMappingURL=keyboard.d.ts.map