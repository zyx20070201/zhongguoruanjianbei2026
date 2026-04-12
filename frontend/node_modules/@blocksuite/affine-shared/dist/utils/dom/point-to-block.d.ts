import type { Point, Rect } from '@blocksuite/global/utils';
import { type BlockComponent } from '@blocksuite/block-std';
/**
 * Returns the closest block element by a point in the rect.
 *
 * ```
 * ############### block
 * ||############# block
 * ||||########### block
 * ||||    ...
 * ||||  y - 2 * n
 * ||||    ...
 * ||||----------- cursor
 * ||||    ...
 * ||||  y + 2 * n
 * ||||    ...
 * ||||########### block
 * ||############# block
 * ############### block
 * ```
 */
export declare function getClosestBlockComponentByPoint(point: Point, state?: {
    rect?: Rect;
    container?: Element;
    snapToEdge?: {
        x: boolean;
        y: boolean;
    };
} | null, scale?: number): BlockComponent | null;
/**
 * Find the most close block on the given position
 * @param container container which the blocks can be found inside
 * @param point position
 * @param selector selector to find the block
 */
export declare function findClosestBlockComponent(container: BlockComponent, point: Point, selector: string): BlockComponent | null;
/**
 * Returns the closest block element by element that does not contain the page element and note element.
 */
export declare function getClosestBlockComponentByElement(element: Element | null): BlockComponent | null;
/**
 * Returns rect of the block element.
 *
 * Compatible with Safari!
 * https://github.com/toeverything/blocksuite/issues/902
 * https://github.com/toeverything/blocksuite/pull/1121
 */
export declare function getRectByBlockComponent(element: Element | BlockComponent): DOMRect;
/**
 * Returns block elements excluding their subtrees.
 * Only keep block elements of same level.
 */
export declare function getBlockComponentsExcludeSubtrees(elements: Element[] | BlockComponent[]): BlockComponent[];
//# sourceMappingURL=point-to-block.d.ts.map