import type { UIEventDispatcher } from '../dispatcher.js';
export declare class ClipboardControl {
    private _dispatcher;
    private _copy;
    private _cut;
    private _paste;
    constructor(_dispatcher: UIEventDispatcher);
    private _createContext;
    listen(): void;
}
//# sourceMappingURL=clipboard.d.ts.map