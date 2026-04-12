export const getBlockSelectionsCommand = (ctx, next) => {
    const currentBlockSelections = ctx.std.selection.filter('block');
    if (currentBlockSelections.length === 0)
        return;
    next({ currentBlockSelections });
};
//# sourceMappingURL=get-block-selections.js.map