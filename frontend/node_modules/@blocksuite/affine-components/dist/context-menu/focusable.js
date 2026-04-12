import { computed } from '@preact/signals-core';
import { MenuItem } from './item.js';
export class MenuFocusable extends MenuItem {
    constructor() {
        super(...arguments);
        this.isFocused$ = computed(() => this.menu.currentFocused$.value === this);
    }
    connectedCallback() {
        super.connectedCallback();
        this.dataset.focusable = 'true';
    }
    focus() {
        this.menu.focusTo(this);
    }
}
//# sourceMappingURL=focusable.js.map