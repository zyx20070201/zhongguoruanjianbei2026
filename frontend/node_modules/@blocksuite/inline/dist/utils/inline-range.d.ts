import type { InlineRange } from '../types.js';
export declare function isMaybeInlineRangeEqual(a: InlineRange | null, b: InlineRange | null): boolean;
export declare function isInlineRangeContain(a: InlineRange, b: InlineRange): boolean;
export declare function isInlineRangeEqual(a: InlineRange, b: InlineRange): boolean;
export declare function isInlineRangeIntersect(a: InlineRange, b: InlineRange): boolean;
export declare function isInlineRangeBefore(a: InlineRange, b: InlineRange): boolean;
export declare function isInlineRangeAfter(a: InlineRange, b: InlineRange): boolean;
export declare function isInlineRangeEdge(index: InlineRange['index'], range: InlineRange): boolean;
export declare function isInlineRangeEdgeBefore(index: InlineRange['index'], range: InlineRange): boolean;
export declare function isInlineRangeEdgeAfter(index: InlineRange['index'], range: InlineRange): boolean;
export declare function isPoint(range: InlineRange): boolean;
export declare function mergeInlineRange(a: InlineRange, b: InlineRange): InlineRange;
export declare function intersectInlineRange(a: InlineRange, b: InlineRange): InlineRange | null;
//# sourceMappingURL=inline-range.d.ts.map