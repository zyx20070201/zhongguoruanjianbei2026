export function isMaybeInlineRangeEqual(a, b) {
    return a === b || (a && b ? isInlineRangeEqual(a, b) : false);
}
export function isInlineRangeContain(a, b) {
    return a.index <= b.index && a.index + a.length >= b.index + b.length;
}
export function isInlineRangeEqual(a, b) {
    return a.index === b.index && a.length === b.length;
}
export function isInlineRangeIntersect(a, b) {
    return a.index <= b.index + b.length && a.index + a.length >= b.index;
}
export function isInlineRangeBefore(a, b) {
    return a.index + a.length <= b.index;
}
export function isInlineRangeAfter(a, b) {
    return a.index >= b.index + b.length;
}
export function isInlineRangeEdge(index, range) {
    return index === range.index || index === range.index + range.length;
}
export function isInlineRangeEdgeBefore(index, range) {
    return index === range.index;
}
export function isInlineRangeEdgeAfter(index, range) {
    return index === range.index + range.length;
}
export function isPoint(range) {
    return range.length === 0;
}
export function mergeInlineRange(a, b) {
    const index = Math.min(a.index, b.index);
    const length = Math.max(a.index + a.length, b.index + b.length) - index;
    return { index, length };
}
export function intersectInlineRange(a, b) {
    if (!isInlineRangeIntersect(a, b)) {
        return null;
    }
    const index = Math.max(a.index, b.index);
    const length = Math.min(a.index + a.length, b.index + b.length) - index;
    return { index, length };
}
//# sourceMappingURL=inline-range.js.map