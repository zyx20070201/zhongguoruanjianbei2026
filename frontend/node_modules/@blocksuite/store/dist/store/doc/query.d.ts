import type { Block } from './block/index.js';
import { BlockViewType } from './consts.js';
export type QueryMatch = {
    id?: string;
    flavour?: string;
    props?: Record<string, unknown>;
    viewType: BlockViewType;
};
/**
 * - `strict` means that only blocks that match the query will be included.
 * - `loose` means that all blocks will be included first, and then the blocks will be run through the query.
 * - `include` means that only blocks and their ancestors that match the query will be included.
 */
type QueryMode = 'strict' | 'loose' | 'include';
export type Query = {
    match: QueryMatch[];
    mode: QueryMode;
};
export declare function runQuery(query: Query, block: Block): void;
export {};
//# sourceMappingURL=query.d.ts.map