export const getScrollContainer = (ele) => {
    let container = ele;
    while (container && !isScrollable(container)) {
        container = container.parentElement;
    }
    return container ?? document.body;
};
export const isScrollable = (ele) => {
    const value = window.getComputedStyle(ele).overflowY;
    return value === 'scroll' || value === 'auto';
};
//# sourceMappingURL=scroll-container.js.map