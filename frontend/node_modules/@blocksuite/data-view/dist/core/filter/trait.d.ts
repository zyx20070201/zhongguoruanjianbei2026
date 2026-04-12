import { type ReadonlySignal } from '@preact/signals-core';
import type { SingleView } from '../view-manager/index.js';
import type { FilterGroup } from './types.js';
export declare class FilterTrait {
    readonly filter$: ReadonlySignal<FilterGroup>;
    readonly view: SingleView;
    readonly config: {
        filterSet: (filter: FilterGroup) => void;
    };
    filterSet: (filter: FilterGroup) => void;
    hasFilter$: ReadonlySignal<boolean>;
    constructor(filter$: ReadonlySignal<FilterGroup>, view: SingleView, config: {
        filterSet: (filter: FilterGroup) => void;
    });
}
export declare const filterTraitKey: import("../traits/key.js").TraitKey<FilterTrait>;
//# sourceMappingURL=trait.d.ts.map