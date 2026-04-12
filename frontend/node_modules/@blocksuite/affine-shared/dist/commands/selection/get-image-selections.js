export const getImageSelectionsCommand = (ctx, next) => {
    const currentImageSelections = ctx.std.selection.filter('image');
    if (currentImageSelections.length === 0)
        return;
    next({ currentImageSelections });
};
//# sourceMappingURL=get-image-selections.js.map