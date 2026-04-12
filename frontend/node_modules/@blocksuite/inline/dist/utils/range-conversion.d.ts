import type * as Y from 'yjs';
import type { InlineRange } from '../types.js';
/**
 * calculate the inline range from dom selection for **this Editor**
 * there are three cases when the inline range of this Editor is not null:
 * (In the following, "|" mean anchor and focus, each line is a separate Editor)
 * 1. anchor and focus are in this Editor
 *    aaaaaa
 *    b|bbbb|b
 *    cccccc
 *    the inline range of second Editor is {index: 1, length: 4}, the others are null
 * 2. anchor and focus one in this Editor, one in another Editor
 *    aaa|aaa    aaaaaa
 *    bbbbb|b or bbbbb|b
 *    cccccc     cc|cccc
 *    2.1
 *        the inline range of first Editor is {index: 3, length: 3}, the second is {index: 0, length: 5},
 *        the third is null
 *    2.2
 *        the inline range of first Editor is null, the second is {index: 5, length: 1},
 *        the third is {index: 0, length: 2}
 * 3. anchor and focus are in another Editor
 *    aa|aaaa
 *    bbbbbb
 *    cccc|cc
 *    the inline range of first Editor is {index: 2, length: 4},
 *    the second is {index: 0, length: 6}, the third is {index: 0, length: 4}
 */
export declare function domRangeToInlineRange(range: Range, rootElement: HTMLElement, yText: Y.Text): InlineRange | null;
/**
 * calculate the dom selection from inline range for **this Editor**
 */
export declare function inlineRangeToDomRange(rootElement: HTMLElement, inlineRange: InlineRange): Range | null;
//# sourceMappingURL=range-conversion.d.ts.map