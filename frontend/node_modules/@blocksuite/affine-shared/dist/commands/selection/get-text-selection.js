export const getTextSelectionCommand = (ctx, next) => {
    const currentTextSelection = ctx.std.selection.find('text');
    if (!currentTextSelection)
        return;
    next({ currentTextSelection });
};
//# sourceMappingURL=get-text-selection.js.map