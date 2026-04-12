import type { EditorHost } from '@blocksuite/block-std';
import type { BlockModel } from '@blocksuite/store';
/**
 *
 * @example
 * ```md
 * doc
 * - note
 *   - paragraph <- 5
 * - note <- 4 (will be skipped)
 *  - paragraph <- 3
 *    - child <- 2
 *      - child <- 1
 *  - paragraph <- when invoked here, the traverse order will be above
 * ```
 *
 * NOTE: this method will just return blocks with `content` role
 */
export declare function getPrevContentBlock(editorHost: EditorHost, model: BlockModel): BlockModel | null;
/**
 *
 * @example
 * ```md
 * page
 * - note
 *  - paragraph <- when invoked here, the traverse order will be following
 *    - child <- 1
 *  - sibling <- 2
 * - note <- 3 (will be skipped)
 *   - paragraph <- 4
 * ```
 *
 * NOTE: this method will skip the `affine:note` block
 */
export declare function getNextContentBlock(editorHost: EditorHost, model: BlockModel, map?: Record<string, true>): BlockModel | null;
//# sourceMappingURL=get-content-block.d.ts.map