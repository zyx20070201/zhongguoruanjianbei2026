import type { EditorHost } from '@blocksuite/block-std';
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
export declare function getViewportElement(editorHost: EditorHost): HTMLElement | null;
//# sourceMappingURL=viewport.d.ts.map