import { computed } from '@preact/signals-core';
import { createTraitKey } from '../traits/key.js';
export class FilterTrait {
    constructor(filter$, view, config) {
        this.filter$ = filter$;
        this.view = view;
        this.config = config;
        this.filterSet = (filter) => {
            this.config.filterSet(filter);
        };
        this.hasFilter$ = computed(() => {
            return this.filter$.value.conditions.length > 0;
        });
    }
}
export const filterTraitKey = createTraitKey('filter');
//# sourceMappingURL=trait.js.map