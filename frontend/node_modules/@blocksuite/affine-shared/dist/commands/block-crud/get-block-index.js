import { assertExists } from '@blocksuite/global/utils';
export const getBlockIndexCommand = (ctx, next) => {
    const path = ctx.path ?? ctx.currentSelectionPath;
    assertExists(path, '`path` is required, you need to pass it in args or ctx before adding this command to the pipeline.');
    const parentModel = ctx.std.doc.getParent(path);
    if (!parentModel)
        return;
    const parent = ctx.std.view.getBlock(parentModel.id);
    if (!parent)
        return;
    const index = parent.childBlocks.findIndex(x => {
        return x.blockId === path;
    });
    next({
        blockIndex: index,
        parentBlock: parent,
    });
};
//# sourceMappingURL=get-block-index.js.map