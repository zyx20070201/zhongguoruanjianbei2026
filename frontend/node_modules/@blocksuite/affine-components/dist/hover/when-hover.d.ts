import type { WhenHoverOptions } from './types.js';
/**
 * Call the `whenHoverChange` callback when the element is hovered.
 *
 * After the mouse leaves the element, there is a 300ms delay by default.
 *
 * Note: The callback may be called multiple times when the mouse is hovering or hovering out.
 *
 * See also https://floating-ui.com/docs/useHover
 *
 * @example
 * ```ts
 * private _setReference: RefOrCallback;
 *
 * connectedCallback() {
 *   let hoverTip: HTMLElement | null = null;
 *   const { setReference, setFloating } = whenHover(isHover => {
 *     if (!isHover) {
 *       hoverTips?.remove();
 *       return;
 *     }
 *     hoverTip = document.createElement('div');
 *     document.body.append(hoverTip);
 *     setFloating(hoverTip);
 *   }, { hoverDelay: 500 });
 *   this._setReference = setReference;
 * }
 *
 * render() {
 *   return html`
 *     <div ref=${this._setReference}></div>
 *   `;
 * }
 * ```
 */
export declare const whenHover: (whenHoverChange: (isHover: boolean, event?: Event) => void, { enterDelay, leaveDelay, alwayRunWhenNoFloating, safeTriangle: triangleOptions, safeBridge: bridgeOptions, }?: WhenHoverOptions) => {
    setReference: (element?: Element) => void;
    setFloating: (element?: Element) => void;
    dispose: () => void;
};
export type { WhenHoverOptions };
//# sourceMappingURL=when-hover.d.ts.map