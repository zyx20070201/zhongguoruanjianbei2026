import { BlockViewIdentifier } from '../identifier.js';
/**
 * Create a block view extension.
 *
 * @param flavour The flavour of the block that the view is for.
 * @param view Lit literal template for the view. Example: `my-list-block`
 *
 * The view is a lit template that is used to render the block.
 *
 * @example
 * ```ts
 * import { BlockViewExtension } from '@blocksuite/block-std';
 *
 * const MyListBlockViewExtension = BlockViewExtension(
 *   'affine:list',
 *   literal`my-list-block`
 * );
 * ```
 */
export function BlockViewExtension(flavour, view) {
    return {
        setup: di => {
            di.addImpl(BlockViewIdentifier(flavour), () => view);
        },
    };
}
//# sourceMappingURL=block-view.js.map