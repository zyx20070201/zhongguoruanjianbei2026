import type { Variable, VariableRef } from '../expression/types.js';
import type { FilterGroup, SingleFilter } from './types.js';
export declare const firstFilterName: (vars: Variable[], ref: VariableRef) => string | undefined;
export declare const firstFilterByRef: (vars: Variable[], ref: VariableRef) => SingleFilter;
export declare const firstFilter: (vars: Variable[]) => SingleFilter;
export declare const firstFilterInGroup: (vars: Variable[]) => FilterGroup;
export declare const emptyFilterGroup: FilterGroup;
//# sourceMappingURL=utils.d.ts.map