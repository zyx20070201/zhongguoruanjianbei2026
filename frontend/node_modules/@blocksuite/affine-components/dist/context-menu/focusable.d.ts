import { MenuItem } from './item.js';
export declare abstract class MenuFocusable extends MenuItem {
    isFocused$: import("@preact/signals-core").ReadonlySignal<boolean>;
    connectedCallback(): void;
    focus(): void;
    abstract onPressEnter(): void;
}
//# sourceMappingURL=focusable.d.ts.map