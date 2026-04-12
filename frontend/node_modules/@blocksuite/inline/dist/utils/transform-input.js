function handleInsertText(inlineRange, data, editor, attributes) {
    if (!data)
        return;
    editor.insertText(inlineRange, data, attributes);
    editor.setInlineRange({
        index: inlineRange.index + data.length,
        length: 0,
    });
}
function handleInsertReplacementText(inlineRange, data, editor, attributes) {
    editor.getDeltasByInlineRange(inlineRange).forEach(deltaEntry => {
        attributes = { ...deltaEntry[0].attributes, ...attributes };
    });
    if (data) {
        editor.insertText(inlineRange, data, attributes);
        editor.setInlineRange({
            index: inlineRange.index + data.length,
            length: 0,
        });
    }
}
function handleInsertParagraph(inlineRange, editor) {
    editor.insertLineBreak(inlineRange);
    editor.setInlineRange({
        index: inlineRange.index + 1,
        length: 0,
    });
}
function handleDelete(inlineRange, editor) {
    editor.deleteText(inlineRange);
    editor.setInlineRange({
        index: inlineRange.index,
        length: 0,
    });
}
export function transformInput(inputType, data, attributes, inlineRange, editor) {
    if (!editor.isValidInlineRange(inlineRange))
        return;
    if (inputType === 'insertText') {
        handleInsertText(inlineRange, data, editor, attributes);
    }
    else if (inputType === 'insertParagraph' ||
        inputType === 'insertLineBreak') {
        handleInsertParagraph(inlineRange, editor);
    }
    else if (inputType.startsWith('delete')) {
        handleDelete(inlineRange, editor);
    }
    else if (inputType === 'insertReplacementText') {
        // Spell Checker
        handleInsertReplacementText(inlineRange, data, editor, attributes);
    }
    else {
        return;
    }
}
//# sourceMappingURL=transform-input.js.map