/**
 * Returns the bounding client rect of an element relative to the viewport.
 */
export function getClientRect(element) {
    const { top, left, width, height, bottom, right } = element.getBoundingClientRect();
    return {
        top,
        left,
        width,
        height,
        bottom,
        right,
    };
}
//# sourceMappingURL=rect.js.map