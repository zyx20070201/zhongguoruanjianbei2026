import { focusTextModel } from '../dom.js';
export function getPrefixText(inlineEditor) {
    const inlineRange = inlineEditor.getInlineRange();
    if (!inlineRange)
        return '';
    const firstLineEnd = inlineEditor.yTextString.search(/\n/);
    if (firstLineEnd !== -1 && inlineRange.index > firstLineEnd) {
        return '';
    }
    const textPoint = inlineEditor.getTextPoint(inlineRange.index);
    if (!textPoint)
        return '';
    const [leafStart, offsetStart] = textPoint;
    return leafStart.textContent
        ? leafStart.textContent.slice(0, offsetStart)
        : '';
}
export function beforeConvert(std, model, index) {
    const { text } = model;
    if (!text)
        return;
    // Add a space after the text, then stop capturing
    // So when the user undo, the prefix will be restored with a `space`
    // Ex. (| is the cursor position)
    // *| <- user input
    // <space> -> bullet list
    // *<space>| -> undo
    text.insert(' ', index);
    focusTextModel(std, model.id, index + 1);
    std.doc.captureSync();
    text.delete(0, index + 1);
}
//# sourceMappingURL=utils.js.map