export const getAdjustedRect = (rect, adjustment) => {
    return {
        ...rect,
        top: rect.top + adjustment.y,
        bottom: rect.bottom + adjustment.y,
        left: rect.left + adjustment.x,
        right: rect.right + adjustment.x,
    };
};
//# sourceMappingURL=rect-adjustment.js.map