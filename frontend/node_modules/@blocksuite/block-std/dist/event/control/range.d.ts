import type { UIEventDispatcher } from '../dispatcher.js';
export declare class RangeControl {
    private _dispatcher;
    private _buildScope;
    private _compositionEnd;
    private _compositionStart;
    private _compositionUpdate;
    private _prev;
    private _selectionChange;
    constructor(_dispatcher: UIEventDispatcher);
    private _buildEventScopeByNativeRange;
    private _createContext;
    private _findBlockComponentPath;
    listen(): void;
}
//# sourceMappingURL=range.d.ts.map