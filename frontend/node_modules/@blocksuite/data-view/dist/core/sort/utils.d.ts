import type { DatabaseAllViewEvents, EventTraceFn } from '@blocksuite/affine-shared/services';
import { type ReadonlySignal } from '@preact/signals-core';
import type { Variable } from '../expression/index.js';
import type { SortManager } from './manager.js';
import type { SortBy } from './types.js';
export interface SortUtils {
    sortList$: ReadonlySignal<SortBy[]>;
    vars$: ReadonlySignal<Variable[]>;
    add: (sort: SortBy) => void;
    move: (from: number, to: number) => void;
    change: (index: number, sort: SortBy) => void;
    remove: (index: number) => void;
    removeAll: () => void;
}
export declare const createSortUtils: (sortTrait: SortManager, eventTrace: EventTraceFn<DatabaseAllViewEvents>) => SortUtils;
//# sourceMappingURL=utils.d.ts.map