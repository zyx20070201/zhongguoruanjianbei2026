import { INLINE_ROOT_ATTR } from '../consts.js';
export function getInlineEditorInsideRoot(element) {
    const rootElement = element.closest(`[${INLINE_ROOT_ATTR}]`);
    if (!rootElement) {
        console.error('element must be inside a v-root');
        return null;
    }
    const inlineEditor = rootElement.inlineEditor;
    if (!inlineEditor) {
        console.error('element must be inside a v-root with inline-editor');
        return null;
    }
    return inlineEditor;
}
//# sourceMappingURL=query.js.map