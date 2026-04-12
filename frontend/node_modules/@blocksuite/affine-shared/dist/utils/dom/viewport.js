import { isInsidePageEditor } from './checker.js';
/**
 * Get editor viewport element.
 * @example
 * ```ts
 * const viewportElement = getViewportElement(this.model.doc);
 * if (!viewportElement) return;
 * this._disposables.addFromEvent(viewportElement, 'scroll', () => {
 *   updatePosition();
 * });
 * ```
 */
export function getViewportElement(editorHost) {
    if (!isInsidePageEditor(editorHost))
        return null;
    const doc = editorHost.doc;
    if (!doc.root) {
        console.error('Failed to get root doc');
        return null;
    }
    const rootComponent = editorHost.view.getBlock(doc.root.id);
    if (!rootComponent ||
        rootComponent.closest('affine-page-root') !== rootComponent) {
        console.error('Failed to get viewport element!');
        return null;
    }
    return rootComponent
        .viewportElement;
}
//# sourceMappingURL=viewport.js.map