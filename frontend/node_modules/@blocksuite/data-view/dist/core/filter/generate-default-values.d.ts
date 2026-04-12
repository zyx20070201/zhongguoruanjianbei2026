import type { Variable } from '../expression/index.js';
import type { DVJSON } from '../property/types.js';
import type { FilterGroup } from './types.js';
/**
 * Generate default values for a new row based on current filter conditions.
 * If a property has multiple conditions, no value will be set to avoid conflicts.
 */
export declare function generateDefaultValues(filter: FilterGroup, _vars: Variable[]): Record<string, DVJSON>;
//# sourceMappingURL=generate-default-values.d.ts.map