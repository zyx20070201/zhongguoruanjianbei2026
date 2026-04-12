// source (2018-03-11): https://github.com/jquery/jquery/blob/master/src/css/hiddenVisibleSelectors.js
function isVisible(elem) {
    return (!!elem &&
        !!(elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length));
}
export function onClickOutside(element, callback, event = 'click', reusable = false) {
    const outsideClickListener = (event) => {
        // support shadow dom
        const path = event.composedPath && event.composedPath();
        const isOutside = path
            ? path.indexOf(element) < 0
            : !element.contains(event.target) && isVisible(element);
        if (!isOutside)
            return;
        callback(element, event.target);
        // if reuseable, need to manually remove the listener
        if (!reusable)
            removeClickListener();
    };
    document.addEventListener(event, outsideClickListener);
    const removeClickListener = () => {
        document.removeEventListener(event, outsideClickListener);
    };
    return removeClickListener;
}
export const getResultInRange = (value, min, max) => {
    return Math.max(min, Math.min(max, value));
};
//# sourceMappingURL=utils.js.map