function getDocTitleByEditorHost(editorHost) {
    const docViewport = editorHost.closest('.affine-page-viewport');
    if (!docViewport)
        return null;
    return docViewport.querySelector('doc-title');
}
export function getDocTitleInlineEditor(editorHost) {
    const docTitle = getDocTitleByEditorHost(editorHost);
    if (!docTitle)
        return null;
    const titleRichText = docTitle.querySelector('rich-text');
    if (!titleRichText || !titleRichText.inlineEditor)
        return null;
    return titleRichText.inlineEditor;
}
export function focusTitle(editorHost, index = Infinity, len = 0) {
    const titleInlineEditor = getDocTitleInlineEditor(editorHost);
    if (!titleInlineEditor) {
        return;
    }
    if (index > titleInlineEditor.yText.length) {
        index = titleInlineEditor.yText.length;
    }
    titleInlineEditor.setInlineRange({ index, length: len });
}
//# sourceMappingURL=title.js.map