import { VElement, VLine } from '../components/index.js';
export function isNativeTextInVText(text) {
    return text instanceof Text && text.parentElement?.dataset.vText === 'true';
}
export function isVElement(element) {
    return (element instanceof HTMLElement &&
        (element.dataset.vElement === 'true' || element instanceof VElement));
}
export function isVLine(element) {
    return (element instanceof HTMLElement &&
        (element instanceof VLine || element.parentElement instanceof VLine));
}
export function isInEmptyLine(element) {
    const el = element instanceof Element ? element : element.parentElement;
    const vLine = el?.closest('v-line');
    return !!vLine && vLine.vTextLength === 0;
}
export function isInlineRoot(element) {
    return element instanceof HTMLElement && element.dataset.vRoot === 'true';
}
//# sourceMappingURL=guard.js.map