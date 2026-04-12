import { computed } from '@preact/signals-core';
import { createTraitKey } from '../traits/key.js';
import { evalSort } from './eval.js';
export class SortManager {
    constructor(sort$, view, ops) {
        this.sort$ = sort$;
        this.view = view;
        this.ops = ops;
        this.hasSort$ = computed(() => (this.sort$.value?.sortBy?.length ?? 0) > 0);
        this.setSortList = (sortList) => {
            this.ops.setSortList({
                manuallySort: [],
                ...this.sort$.value,
                sortBy: sortList,
            });
        };
        this.sort = (rows) => {
            if (!this.sort$.value) {
                return rows;
            }
            const compare = evalSort(this.sort$.value, this.view);
            if (!compare) {
                return rows;
            }
            const newRows = rows.slice();
            newRows.sort(compare);
            return newRows;
        };
        this.sortList$ = computed(() => this.sort$.value?.sortBy ?? []);
    }
}
export const sortTraitKey = createTraitKey('sort');
//# sourceMappingURL=manager.js.map