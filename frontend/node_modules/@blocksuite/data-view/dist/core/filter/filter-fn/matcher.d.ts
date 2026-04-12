import type { TypeInstance } from '../../logical/type.js';
import type { FilterConfig } from './create.js';
export declare const filterMatcher: {
    filterListBySelfType: (selfType: TypeInstance) => FilterConfig[];
    firstMatchedBySelfType: (selfType: TypeInstance) => FilterConfig | undefined;
    getFilterByName: (name?: string) => FilterConfig | undefined;
};
//# sourceMappingURL=matcher.d.ts.map